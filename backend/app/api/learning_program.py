"""Explicit caregiver sets and a thirty-day course; no automatic activity starts."""
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, model_validator
from pymongo.errors import PyMongoError

from app.services.authentication import current_user
from app.services.support_links import SUPPORT_ROLES, require_link_permission
from app.services.privacy import privacy_for
from app.services.database import database
from app.services.schema_versions import SCHEMA_VERSION
from app.services.communication import CARDS
from app.services.card_submissions import approved_cards_for
from app.services.learning import _audit

router = APIRouter(prefix='/learning/program', tags=['학습 코스'])
ACTIVITIES = Literal['word_picture_match', 'sound_picture_match', 'situation_card_match']
SITUATIONS = Literal['meal', 'school', 'outing']


class PracticeSet(BaseModel):
    id: UUID
    title: str = Field(min_length=1, max_length=40)
    activity_type: ACTIVITIES = 'word_picture_match'
    situation_id: SITUATIONS = 'meal'
    card_ids: list[Annotated[str, Field(min_length=1, max_length=64)]] = Field(min_length=2, max_length=60)
    question_count: Literal[5, 10, 15, 20, 30] = 5
    option_count: Literal[2, 3, 4] = 3

    @model_validator(mode='after')
    def unique_cards(self):
        self.title = self.title.strip()
        if not self.title:
            raise ValueError('연습 이름을 입력해 주세요.')
        if len(set(self.card_ids)) != len(self.card_ids) or len(self.card_ids) < self.option_count:
            raise ValueError('보기 수 이상의 서로 다른 카드를 선택해 주세요.')
        targets = {'meal': {'water', 'rice', 'stop', 'finished'},
                   'school': {'help', 'rest', 'want_rest', 'toilet'},
                   'outing': {'home', 'wait', 'hold_on', 'water'}}
        if self.activity_type == 'situation_card_match' and not targets[self.situation_id].intersection(self.card_ids):
            raise ValueError('선택한 상황에 맞는 카드를 하나 이상 넣어 주세요.')
        return self


class ProgramChange(BaseModel):
    expected_revision: int = Field(ge=0)
    sets: list[PracticeSet] = Field(default_factory=list, max_length=20)
    daily_set_ids: list[UUID] = Field(default_factory=list, max_length=30)
    starts_on: date
    review_interval_days: int = Field(default=3, ge=1, le=30)

    @model_validator(mode='after')
    def references(self):
        ids = {row.id for row in self.sets}
        if len(ids) != len(self.sets) or any(key not in ids for key in self.daily_set_ids):
            raise ValueError('중복 세트나 코스에 없는 세트를 확인해 주세요.')
        return self


def authorize(user, target, write=False):
    if write and user['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '보호자 또는 담당자만 연습 코스를 변경할 수 있습니다.')
    require_link_permission(user, target, 'learning_manage')
    require_link_permission(user, target, 'cards_manage')
    if not privacy_for(target).get('guardian_consent'):
        raise HTTPException(403, '보호자 동의 후 연습 코스를 사용할 수 있습니다.')


def available_cards(target):
    return CARDS + approved_cards_for(target)


def public_program(document, cards, today=None):
    today = today or (datetime.now(timezone.utc) + timedelta(hours=9)).date()
    stored = (document or {}).get('program') or {}
    allowed = {card['id'] for card in cards}
    sets = [{**row, 'card_ids': [key for key in row['card_ids'] if key in allowed]}
            for row in stored.get('sets', [])]
    return {'revision': (document or {}).get('program_revision', 0), 'sets': sets,
            'daily_set_ids': stored.get('daily_set_ids', []),
            'starts_on': stored.get('starts_on', today.isoformat()),
            'review_interval_days': stored.get('review_interval_days', 3),
            'today': today.isoformat(), 'cards': cards}


@router.get('')
def get_program(response: Response, user_id: str | None = Query(default=None, max_length=64),
                user=Depends(current_user)):
    target = user_id or user['id']
    authorize(user, target)
    response.headers['Cache-Control'] = 'no-store'
    try:
        db = database()
        result = public_program(db.learning_settings.find_one({'_id': target}), available_cards(target))
        result['last_completed'] = {}
        for row in result['sets']:
            attempt = db.learning_attempts.find_one({'user_id': target, 'program_set_id': row['id']},
                {'completed_at': 1}, sort=[('completed_at', -1)])
            if attempt:
                at = attempt['completed_at'].replace(tzinfo=attempt['completed_at'].tzinfo or timezone.utc)
                result['last_completed'][row['id']] = at.isoformat()
        authorize(user, target)
        return result
    except PyMongoError as exc:
        raise HTTPException(503, '연습 코스를 불러오지 못했습니다.') from exc


@router.put('')
def save_program(body: ProgramChange, response: Response, user_id: str = Query(min_length=1, max_length=64),
                 user=Depends(current_user)):
    authorize(user, user_id, True)
    cards = available_cards(user_id)
    allowed = {card['id'] for card in cards}
    if any(key not in allowed for row in body.sets for key in row.card_ids):
        raise HTTPException(422, '현재 사용할 수 없는 카드가 있습니다. 목록을 다시 불러오세요.')
    values = body.model_dump(mode='json', exclude={'expected_revision'})
    try:
        collection = database().learning_settings
        # Keep ordinary learning settings and their privacy/export/deletion lifecycle.
        collection.update_one({'_id': user_id}, {'$setOnInsert': {'schema_version': SCHEMA_VERSION}}, upsert=True)
        result = collection.update_one({'_id': user_id, 'program_revision':
            {'$in': [0, None]} if body.expected_revision == 0 else body.expected_revision},
            {'$set': {'program': values, 'program_revision': body.expected_revision + 1,
                      'program_updated_by': user['id'], 'program_updated_at': datetime.now(timezone.utc)}})
        if result.matched_count != 1:
            raise HTTPException(409, '다른 화면에서 코스가 변경됐습니다. 다시 불러온 뒤 수정하세요.')
        _audit(database(), user_id, user['id'], 'learning_program_changed', None,
               {'revision': body.expected_revision + 1, 'set_count': len(body.sets)})
        response.headers['Cache-Control'] = 'no-store'
        return public_program({'program': values, 'program_revision': body.expected_revision + 1}, cards)
    except PyMongoError as exc:
        raise HTTPException(503, '연습 코스를 저장하지 못했습니다.') from exc
