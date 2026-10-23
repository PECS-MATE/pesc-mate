"""Stable per-user communication board and quick-expression configuration."""
from datetime import datetime, timezone
from uuid import uuid4
import unicodedata

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.services.database import database as _database
from app.services.schema_versions import SCHEMA_VERSION


DEFAULT_QUICK_IDS = ['hurt', 'no', 'help', 'toilet', 'stop']
RECOVERY_EXPRESSIONS = {
    'hold_on': '잠깐만요',
    'wrong_tap': '잘못 눌렀어요',
    'not_that': '그 뜻이 아니에요',
    'say_again': '다시 말할게요',
    'please_wait': '제 말을 기다려 주세요',
    'dont_understand': '질문을 잘 모르겠어요',
    'yes': '맞아요',
    'no': '아니에요',
}
FIXED_RECOVERY_IDS = ['wrong_tap', 'not_that']
DEFAULT_RECOVERY_IDS = ['wrong_tap', 'not_that', 'hold_on', 'say_again']
MAX_QUICK_EXPRESSIONS = 8
MAX_RECOVERY_EXPRESSIONS = 4
MAX_BOARD_SLOTS = 30
MAX_SITUATIONS = 6
SITUATION_NAMES = ['집', '학교', '치료실', '외출', '식사', '병원']


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
    configured_recovery_ids = [expression_id for expression_id in
                               (document or {}).get('recovery_expression_ids', DEFAULT_RECOVERY_IDS)
                               if expression_id in RECOVERY_EXPRESSIONS]
    recovery_ids = list(dict.fromkeys(FIXED_RECOVERY_IDS + configured_recovery_ids))[
        :MAX_RECOVERY_EXPRESSIONS
    ]
    slots = [slot for slot in (document or {}).get('slots', default_slots)
             if slot.get('card_id') in available_ids]
    return {
        'user_id': document.get('user_id') if document else None,
        'quick_expression_ids': quick_ids,
        'recovery_expression_ids': recovery_ids,
        'slots': sorted(slots, key=lambda slot: slot['position']),
        'available_cards': available,
        'updated_at': document.get('updated_at') if document else None,
        'revision': (document or {}).get('revision', 0),
        'locked_card_ids': list((document or {}).get('locked_card_ids', [])),
        'situations': [{'id': item['id'], 'name': item['name'],
                        'slots': sorted([slot for slot in item['slots'] if slot.get('card_id') in available_ids],
                                        key=lambda slot: slot['position'])}
                       for item in (document or {}).get('situations', [])],
        'situation_names': SITUATION_NAMES.copy(),
        'max_situations': MAX_SITUATIONS,
    }


def layout_for(user_id):
    try:
        available = _available_cards(user_id)
        document = _database().board_layouts.find_one({'_id': user_id})
        result = _public(document, available)
        result['user_id'] = user_id
        return result
    except PyMongoError as exc:
        raise HTTPException(503, '카드판 구성을 불러오지 못했습니다.') from exc


def save_quick_expressions(user_id, actor_id, card_ids, expected_revision=0):
    card_ids = _validate_card_ids(user_id, card_ids, 1, MAX_QUICK_EXPRESSIONS, '빠른 표현')
    return _save(user_id, actor_id, 'quick_expression_ids', card_ids, 'quick_expressions_changed',
                 expected_revision)


def save_recovery_expressions(user_id, actor_id, expression_ids, expected_revision=0):
    values = list(expression_ids)
    if not 2 <= len(values) <= MAX_RECOVERY_EXPRESSIONS:
        raise HTTPException(422, f'복구 표현은 2~{MAX_RECOVERY_EXPRESSIONS}개로 구성해 주세요.')
    if len(values) != len(set(values)):
        raise HTTPException(422, '같은 복구 표현을 중복 배치할 수 없습니다.')
    if any(expression_id not in RECOVERY_EXPRESSIONS for expression_id in values):
        raise HTTPException(422, '사용할 수 없는 복구 표현이 포함되어 있습니다.')
    if not set(FIXED_RECOVERY_IDS).issubset(values):
        raise HTTPException(422, '필수 복구 표현은 제외할 수 없습니다.')
    return _save(user_id, actor_id, 'recovery_expression_ids', values,
                 'recovery_expressions_changed', expected_revision)


def save_slots(user_id, actor_id, card_ids, expected_revision=0):
    card_ids = _validate_card_ids(user_id, card_ids, 1, MAX_BOARD_SLOTS, '카드판')
    slots = [{'position': position, 'card_id': card_id}
             for position, card_id in enumerate(card_ids, 1)]
    return _save(user_id, actor_id, 'slots', slots, 'board_slots_changed', expected_revision)


def save_locks(user_id, requester, card_ids, expected_revision):
    from app.services import image_storage
    from app.services.support_links import SUPPORT_ROLES, require_link_permission
    if requester.get('role') not in SUPPORT_ROLES:
        raise HTTPException(403, '보호자 또는 담당자만 핵심 카드 잠금을 변경할 수 있습니다.')
    require_link_permission(requester, user_id, 'board_manage')
    if type(expected_revision) is not int or expected_revision < 0:
        raise HTTPException(422, '카드판 버전을 확인해 주세요.')
    values = _validate_card_ids(user_id, card_ids, 0, MAX_BOARD_SLOTS, '핵심 잠금')
    started = datetime.now(timezone.utc)
    # Serialize lock changes with photo replacement and privacy deletion. Board
    # moves are independently serialized by the same board revision CAS below.
    db = _database()
    with image_storage.image_write_lock(db):
        image_storage.check_deletion_race(db, user_id, started)
        require_link_permission(requester, user_id, 'board_manage')
        return _save(user_id, requester['id'], 'locked_card_ids', values,
                     'core_card_locks_changed', expected_revision)


def change_situations(user_id, requester, expected_revision, operation, *,
                      situation_id=None, source_id='default', name=None, card_ids=None):
    from app.services import image_storage
    from app.services.support_links import SUPPORT_ROLES, require_link_permission
    if requester.get('role') not in SUPPORT_ROLES:
        raise HTTPException(403, '보호자 또는 담당자만 상황별 카드판을 관리할 수 있습니다.')
    require_link_permission(requester, user_id, 'board_manage')
    if type(expected_revision) is not int or expected_revision < 0:
        raise HTTPException(422, '카드판 버전을 확인해 주세요.')
    if operation not in {'create', 'copy', 'update', 'delete'}:
        raise HTTPException(422, '상황 카드판 작업을 확인해 주세요.')

    def transform(document, available):
        previous = (document or {}).get('situations', [])
        entries = [dict(item) for item in previous]
        selected = next((item for item in entries if item['id'] == situation_id), None)
        if operation in {'update', 'delete'} and not selected:
            raise HTTPException(404, '수정할 상황 카드판을 찾을 수 없습니다.')
        if operation == 'delete':
            return [item for item in entries if item['id'] != situation_id]
        label = unicodedata.normalize('NFC', (name or '').strip())
        if (not 1 <= len(label) <= 30 or any(unicodedata.category(char).startswith('C') for char in label)):
            raise HTTPException(422, '상황 이름은 제어 문자 없이 1~30자로 입력해 주세요.')
        if any(item['id'] != situation_id and item['name'].casefold() == label.casefold() for item in entries):
            raise HTTPException(409, '같은 이름의 상황 카드판이 있습니다.')
        if operation == 'update':
            ids = _validate_card_ids(user_id, card_ids or [], 1, MAX_BOARD_SLOTS, '상황 카드판')
            updated = {**selected, 'name': label, 'slots': [
                {'position': index + 1, 'card_id': card_id} for index, card_id in enumerate(ids)]}
            return [updated if item['id'] == situation_id else item for item in entries]
        if len(entries) >= MAX_SITUATIONS:
            raise HTTPException(422, f'상황 카드판은 최대 {MAX_SITUATIONS}개입니다.')
        source = (_public(document, available) if operation == 'create' else
                  next((item for item in entries if item['id'] == source_id), None))
        if not source:
            raise HTTPException(404, '복사할 상황 카드판을 찾을 수 없습니다.')
        # Copy IDs/positions only, never another child's photo, usage, or speech.
        source_slots = [dict(slot) for slot in source['slots']]
        _validate_card_ids(user_id, [slot['card_id'] for slot in source_slots], 1, MAX_BOARD_SLOTS, '상황 카드판')
        entries.append({'id': str(uuid4()), 'name': label, 'slots': source_slots})
        return entries

    started = datetime.now(timezone.utc)
    db = _database()
    with image_storage.image_write_lock(db):
        image_storage.check_deletion_race(db, user_id, started)
        require_link_permission(requester, user_id, 'board_manage')
        return _save(user_id, requester['id'], 'situations', transform,
                     f'situation_{operation}', expected_revision)


def _assert_locked_positions(original, slots, locked_ids):
    expected = {slot['card_id']: slot['position'] for slot in original}
    actual = {slot['card_id']: slot['position'] for slot in slots}
    if any(card_id not in expected or actual.get(card_id) != expected[card_id] for card_id in locked_ids):
        raise HTTPException(409, '잠긴 핵심 카드는 이동하거나 제외할 수 없습니다. 잠금과 최신 구성을 확인해 주세요.')


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


def _save(user_id, actor_id, field, value, action, expected_revision):
    now = datetime.now(timezone.utc)
    try:
        database = _database()
        before_document = database.board_layouts.find_one({'_id': user_id})
        revision = (before_document or {}).get('revision', 0)
        if revision != expected_revision:
            raise HTTPException(409, '다른 기기에서 카드판을 변경했습니다. 최신 구성을 불러온 뒤 다시 수정해 주세요.')
        available = _available_cards(user_id)
        if callable(value):
            value = value(before_document, available)
        saved_slots = (before_document or {}).get('slots', _public(None, available)['slots'])
        locked_ids = (before_document or {}).get('locked_card_ids', [])
        if field == 'slots':
            _assert_locked_positions(saved_slots, value, locked_ids)
        if field == 'locked_card_ids':
            slotted = {slot['card_id'] for slot in _public(before_document, available)['slots']}
            if not set(value).issubset(slotted):
                raise HTTPException(422, '현재 저장된 슬롯에 있는 카드만 잠글 수 있습니다.')
            for situation in (before_document or {}).get('situations', []):
                _assert_locked_positions(saved_slots, situation['slots'], value)
        if field == 'situations':
            for situation in value:
                _assert_locked_positions(saved_slots, situation['slots'], locked_ids)
        before = _public(before_document, available)[field]
        changes = {'user_id': user_id, field: value, 'updated_at': now,
                   'updated_by': actor_id, 'revision': revision + 1}
        if before_document is None:
            # Competing first saves must conflict rather than upsert over each other.
            database.board_layouts.insert_one({'schema_version': SCHEMA_VERSION, '_id': user_id, 'created_at': now, **changes})
        else:
            query = {'_id': user_id, 'revision': expected_revision}
            if expected_revision == 0:
                query = {'_id': user_id, '$or': [{'revision': 0}, {'revision': {'$exists': False}}]}
            result = database.board_layouts.update_one(query, {'$set': changes})
            if result.matched_count != 1:
                raise HTTPException(409, '다른 기기에서 카드판을 변경했습니다. 최신 구성을 불러온 뒤 다시 수정해 주세요.')
        database.board_audit_logs.insert_one({
            'schema_version': SCHEMA_VERSION,
            '_id': str(uuid4()), 'target_user_id': user_id, 'actor_id': actor_id,
            'action': action, 'before': before, 'after': value, 'created_at': now,
            'before_revision': revision, 'after_revision': revision + 1,
        })
        # Return the version this write committed, not a later concurrent write.
        return _public({**(before_document or {}), **changes}, available)
    except DuplicateKeyError as exc:
        raise HTTPException(409, '다른 기기에서 카드판을 변경했습니다. 최신 구성을 불러온 뒤 다시 수정해 주세요.') from exc
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
            'created_at': row['created_at'].replace(tzinfo=timezone.utc) if row['created_at'].tzinfo is None else row['created_at'],
            'before_revision': row.get('before_revision'),
            'after_revision': row.get('after_revision'),
        } for row in rows]
    except PyMongoError as exc:
        raise HTTPException(503, '카드판 변경 이력을 불러오지 못했습니다.') from exc
