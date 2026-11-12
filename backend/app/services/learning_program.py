"""Learning course persistence, authorization rechecks and audit writes."""
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from pymongo.errors import PyMongoError
from app.schemas.learning import ProgramChange
from app.services.support_links import SUPPORT_ROLES, require_link_permission
from app.services.privacy import privacy_for
from app.services.database import database
from app.services.schema_versions import SCHEMA_VERSION
from app.services.communication import CARDS
from app.services.card_submissions import approved_cards_for
from app.services.learning import _audit
from app.services.recording_guard import recording_revision, recording_write


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


def get_program(target, user):
    authorize(user, target)


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


def save_program(body: ProgramChange, user_id, user):
    authorize(user, user_id, True)

    consent_revision = recording_revision(user_id)

    cards = available_cards(user_id)

    allowed = {card['id'] for card in cards}

    if any(key not in allowed for row in body.sets for key in row.card_ids):

        raise HTTPException(422, '현재 사용할 수 없는 카드가 있습니다. 목록을 다시 불러오세요.')

    values = body.model_dump(mode='json', exclude={'expected_revision'})

    try:

        # Card loading/validation stay outside the lock. Recheck consent revision

        # and current link permissions before any upsert or audit write.

        with recording_write(user_id, consent_revision):

            authorize(user, user_id, True)

            collection = database().learning_settings

            collection.update_one({'_id': user_id}, {'$setOnInsert': {'schema_version': SCHEMA_VERSION}}, upsert=True)

            result = collection.update_one({'_id': user_id, 'program_revision':

                {'$in': [0, None]} if body.expected_revision == 0 else body.expected_revision},

                {'$set': {'program': values, 'program_revision': body.expected_revision + 1,

                          'program_updated_by': user['id'], 'program_updated_at': datetime.now(timezone.utc)}})

            if result.matched_count != 1:

                raise HTTPException(409, '다른 화면에서 코스가 변경됐습니다. 다시 불러온 뒤 수정하세요.')

            _audit(database(), user_id, user['id'], 'learning_program_changed', None,

                   {'revision': body.expected_revision + 1, 'set_count': len(body.sets)})


        return public_program({'program': values, 'program_revision': body.expected_revision + 1}, cards)

    except PyMongoError as exc:

        raise HTTPException(503, '연습 코스를 저장하지 못했습니다.') from exc
