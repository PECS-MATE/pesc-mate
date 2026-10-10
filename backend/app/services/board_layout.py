"""Stable per-user communication board and quick-expression configuration."""
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.database import database as _database, log_crud


DEFAULT_QUICK_IDS = ['hurt', 'no', 'help', 'toilet', 'stop']
RECOVERY_EXPRESSIONS = {
    'wrong_tap': '잘못 눌렀어요',
    'not_that': '그 뜻이 아니에요',
    'say_again': '다시 말할게요',
    'please_wait': '제 말을 기다려 주세요',
    'dont_understand': '질문을 잘 모르겠어요',
    'yes': '맞아요',
    'no': '아니에요',
}
DEFAULT_RECOVERY_IDS = ['wrong_tap', 'not_that', 'say_again']
MAX_QUICK_EXPRESSIONS = 8
MAX_RECOVERY_EXPRESSIONS = 4
MAX_BOARD_SLOTS = 30


def _available_cards(user_id):
    from app.services.card_submissions import approved_cards_for
    from app.services.communication import CARDS
    return CARDS + approved_cards_for(user_id)


def _ids(cards):
    return [card['id'] for card in cards]


def _public(document, available):
    available_ids = set(_ids(available))
    default_quick = [card_id for card_id in DEFAULT_QUICK_IDS if card_id in available_ids]
    default_slots = [{'position': position, 'card_id': card_id}
                     for position, card_id in enumerate(_ids(available), 1)][:MAX_BOARD_SLOTS]
    quick_ids = [card_id for card_id in (document or {}).get('quick_expression_ids', default_quick)
                 if card_id in available_ids]
    recovery_ids = [expression_id for expression_id in
                    (document or {}).get('recovery_expression_ids', DEFAULT_RECOVERY_IDS)
                    if expression_id in RECOVERY_EXPRESSIONS]
    slots = [slot for slot in (document or {}).get('slots', default_slots)
             if slot.get('card_id') in available_ids]
    return {
        'user_id': document.get('user_id') if document else None,
        'quick_expression_ids': quick_ids,
        'recovery_expression_ids': recovery_ids,
        'slots': sorted(slots, key=lambda slot: slot['position']),
        'available_cards': available,
        'updated_at': document.get('updated_at') if document else None,
    }


def layout_for(user_id):
    try:
        available = _available_cards(user_id)
        document = _database().board_layouts.find_one({'_id': user_id})
        result = _public(document, available)
        result['user_id'] = user_id
        log_crud('READ', 'board_layouts', '사용자 카드판 구성 조회')
        return result
    except PyMongoError as exc:
        raise HTTPException(503, '카드판 구성을 불러오지 못했습니다.') from exc


def save_quick_expressions(user_id, actor_id, card_ids):
    card_ids = _validate_card_ids(user_id, card_ids, 1, MAX_QUICK_EXPRESSIONS, '빠른 표현')
    return _save(user_id, actor_id, 'quick_expression_ids', card_ids, 'quick_expressions_changed')


def save_recovery_expressions(user_id, actor_id, expression_ids):
    values = list(expression_ids)
    if not 2 <= len(values) <= MAX_RECOVERY_EXPRESSIONS:
        raise HTTPException(422, f'복구 표현은 2~{MAX_RECOVERY_EXPRESSIONS}개로 구성해 주세요.')
    if len(values) != len(set(values)):
        raise HTTPException(422, '같은 복구 표현을 중복 배치할 수 없습니다.')
    if any(expression_id not in RECOVERY_EXPRESSIONS for expression_id in values):
        raise HTTPException(422, '사용할 수 없는 복구 표현이 포함되어 있습니다.')
    return _save(user_id, actor_id, 'recovery_expression_ids', values,
                 'recovery_expressions_changed')


def save_slots(user_id, actor_id, card_ids):
    card_ids = _validate_card_ids(user_id, card_ids, 1, MAX_BOARD_SLOTS, '카드판')
    slots = [{'position': position, 'card_id': card_id}
             for position, card_id in enumerate(card_ids, 1)]
    return _save(user_id, actor_id, 'slots', slots, 'board_slots_changed')


def _validate_card_ids(user_id, card_ids, minimum, maximum, label):
    values = list(card_ids)
    if not minimum <= len(values) <= maximum:
        raise HTTPException(422, f'{label} 카드는 {minimum}~{maximum}개로 구성해 주세요.')
    if len(values) != len(set(values)):
        raise HTTPException(422, f'{label}에 같은 카드를 중복 배치할 수 없습니다.')
    available_ids = set(_ids(_available_cards(user_id)))
    unknown = [card_id for card_id in values if card_id not in available_ids]
    if unknown:
        raise HTTPException(422, '사용할 수 없는 카드가 포함되어 있습니다.')
    return values


def _save(user_id, actor_id, field, value, action):
    now = datetime.now(timezone.utc)
    try:
        database = _database()
        before_document = database.board_layouts.find_one({'_id': user_id})
        before = _public(before_document, _available_cards(user_id))[field]
        database.board_layouts.update_one(
            {'_id': user_id},
            {'$set': {'user_id': user_id, field: value, 'updated_at': now, 'updated_by': actor_id},
             '$setOnInsert': {'created_at': now}},
            upsert=True,
        )
        database.board_audit_logs.insert_one({
            '_id': str(uuid4()), 'target_user_id': user_id, 'actor_id': actor_id,
            'action': action, 'before': before, 'after': value, 'created_at': now,
        })
        log_crud('UPDATE', 'board_layouts', '사용자 카드판 구성 저장')
        log_crud('CREATE', 'board_audit_logs', '카드판 변경 기록')
        return layout_for(user_id)
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '카드판 구성을 저장하지 못했습니다.') from exc


def audit_for(user_id):
    try:
        rows = _database().board_audit_logs.find({'target_user_id': user_id}).sort('created_at', -1)
        return [{
            'id': str(row['_id']), 'target_user_id': row['target_user_id'],
            'actor_id': row['actor_id'], 'action': row['action'],
            'before': row.get('before'), 'after': row.get('after'),
            'created_at': row['created_at'],
        } for row in rows]
    except PyMongoError as exc:
        raise HTTPException(503, '카드판 변경 이력을 불러오지 못했습니다.') from exc
