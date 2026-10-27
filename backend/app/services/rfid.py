"""Authenticated, account-scoped latest RFID board state; not a scan-history store."""
from datetime import datetime, timedelta, timezone
from functools import wraps
import hashlib
import hmac
import re
import secrets
from uuid import uuid4

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.services.database import database
from app.services.schema_versions import SCHEMA_VERSION
from app.services.image_storage import image_write_lock
from app.services.privacy import privacy_for
from app.services.communication import CARDS
from app.services.card_submissions import approved_cards_for
from app.services.account_access import account_access_allowed
from app.services.support_links import require_link_permission, SUPPORT_ROLES

STALE_SECONDS = 20
MAX_DEVICES = 8
MAX_BINDINGS = 200


def guarded(function):
    @wraps(function)
    def call(*args, **kwargs):
        try:
            return function(*args, **kwargs)
        except DuplicateKeyError as exc:
            raise HTTPException(409, '이미 등록되었거나 동시에 변경된 RFID 구성입니다. 새로 조회해 주세요.') from exc
        except PyMongoError as exc:
            raise HTTPException(503, 'RFID 상태를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.') from exc
    return call


def normalize_uid(value):
    if not isinstance(value, str):
        raise ValueError('UID는 16진수 문자열이어야 합니다.')
    normalized = re.sub(r'[\s:-]', '', value).upper()
    if not re.fullmatch(r'(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})', normalized):
        raise ValueError('UID는 4·7·10바이트의 16진수여야 합니다.')
    return normalized


def consent(user_id):
    privacy = privacy_for(user_id)
    if not privacy['guardian_consent'] or privacy['deletion_status'] in {'in_progress', 'failed', 'completed'}:
        raise HTTPException(403, 'RFID 상태 저장에는 유효한 개인정보 동의가 필요합니다. 기본 말하기는 계속 사용할 수 있습니다.')


def available_cards(user_id):
    return {card['id']: card for card in CARDS + approved_cards_for(user_id)}


@guarded
def resolve_usb(user_id, uids):
    # Session-scoped lookup only. USB scans are not persisted or queued as history.
    cards = available_cards(user_id)
    rows = database().rfid_bindings.find({'user_id': user_id, 'uid': {'$in': uids}})
    bindings = {row['uid']: row['card_id'] for row in rows}
    result = []
    for uid in uids:
        identity = bindings.get(uid)
        card = cards.get(identity)
        result.append({'status': 'PRESENT' if card else 'UNAVAILABLE' if identity else 'UNMAPPED',
                       'card_id': card['id'] if card else None, 'label': card['label'] if card else None})
    return result


def recheck_manager(db, user_id, actor_id, permission):
    actor = db.users.find_one({'_id': actor_id})
    owner = db.users.find_one({'_id': user_id, 'role': 'user'})
    if (not actor or actor.get('role') not in SUPPORT_ROLES or not account_access_allowed(actor)
            or not owner or not account_access_allowed(owner)):
        raise HTTPException(403, 'RFID 설정을 변경할 계정 권한이 없습니다.')
    require_link_permission(actor | {'id': actor_id}, user_id, permission)


def audit(db, user_id, actor_id, action, target_id):
    # No raw UID, credential or utterance in general audit fields.
    db.privacy_audit_logs.insert_one({'_id': str(uuid4()), 'schema_version': SCHEMA_VERSION,
        'user_id': user_id, 'actor_id': actor_id, 'action': action,
        'target_id': target_id, 'created_at': datetime.now(timezone.utc)})


def public_device(document):
    return {key: document.get(key) for key in ('device_id', 'name', 'reader_labels', 'revision', 'active', 'last_seen')}


def owned_device(db, user_id, device_id):
    row = db.rfid_devices.find_one({'_id': device_id, 'user_id': user_id})
    if not row:
        raise HTTPException(404, '등록된 RFID 장치를 찾지 못했습니다.')
    return row


@guarded
def list_devices(user_id):
    rows = list(database().rfid_devices.find({'user_id': user_id}, {'key_hash': 0}).limit(MAX_DEVICES + 1))
    if len(rows) > MAX_DEVICES:
        raise HTTPException(413, 'RFID 장치 수를 정리해 주세요.')
    return [public_device(row) for row in rows]


@guarded
def create_device(user_id, actor_id, device_id, name):
    db = database()
    with image_write_lock(db):  # Share the account deletion boundary; never resurrect after deletion.
        recheck_manager(db, user_id, actor_id, 'board_manage')
        consent(user_id)
        if db.rfid_devices.count_documents({'user_id': user_id}) >= MAX_DEVICES:
            raise HTTPException(422, 'RFID 장치는 사용자당 8개까지 등록할 수 있습니다.')
        key = secrets.token_urlsafe(32)
        row = {'_id': device_id, 'device_id': device_id, 'user_id': user_id, 'name': name,
            'schema_version': SCHEMA_VERSION, 'key_hash': hashlib.sha256(key.encode()).hexdigest(),
            'reader_labels': ['첫 번째 카드', '두 번째 카드', '세 번째 카드'], 'revision': 0,
            'active': True, 'session_id': None, 'last_event_id': 0, 'readers': [],
            'created_at': datetime.now(timezone.utc), 'last_seen': None}
        db.rfid_devices.insert_one(row)
        audit(db, user_id, actor_id, 'rfid_device_created', device_id)
        return public_device(row) | {'device_key': key}


@guarded
def change_device(user_id, actor_id, device_id, revision, operation, name=None, reader_labels=None):
    db = database()
    with image_write_lock(db):
        recheck_manager(db, user_id, actor_id, 'board_manage')
        consent(user_id)
        row = owned_device(db, user_id, device_id)
        if row['revision'] != revision:
            raise HTTPException(409, '장치 구성이 변경되었습니다. 최신 상태를 확인해 주세요.')
        key = secrets.token_urlsafe(32) if operation == 'rotate_key' else None
        values = {'name': name, 'reader_labels': reader_labels} if operation == 'configure' else {
            'active': operation == 'rotate_key', 'session_id': None, 'last_seen': None, 'readers': [],
            **({'key_hash': hashlib.sha256(key.encode()).hexdigest()} if key else {})}
        result = db.rfid_devices.update_one({'_id': device_id, 'user_id': user_id, 'revision': revision},
            {'$set': values, '$inc': {'revision': 1}})
        if result.matched_count != 1:
            raise HTTPException(409, '장치 변경이 충돌했습니다. 새로 조회해 주세요.')
        audit(db, user_id, actor_id, 'rfid_device_' + operation, device_id)
        return public_device(row | values | {'revision': revision + 1}) | ({'device_key': key} if key else {})


def authenticate_device(db, device_id, key):
    row = db.rfid_devices.find_one({'_id': device_id, 'active': True})
    candidate = hashlib.sha256(key.encode()).hexdigest()
    if not row or not hmac.compare_digest(row.get('key_hash', ''), candidate):
        raise HTTPException(401, 'RFID 장치 인증에 실패했습니다.')
    owner = db.users.find_one({'_id': row['user_id'], 'role': 'user'})
    if not owner or not account_access_allowed(owner):
        raise HTTPException(403, '연결된 계정을 사용할 수 없습니다.')
    consent(row['user_id'])
    return row


@guarded
def start_session(device_id, key):
    db = database()
    with image_write_lock(db):
        row = authenticate_device(db, device_id, key)
        identity = str(uuid4())
        result = db.rfid_devices.update_one({'_id': device_id, 'active': True, 'key_hash': row['key_hash']},
            {'$set': {'session_id': identity, 'last_event_id': 0, 'readers': [], 'last_seen': None},
             '$unset': {'last_digest': ''}, '$inc': {'state_revision': 1}})
        if result.matched_count != 1:
            raise HTTPException(409, '장치 상태가 변경되었습니다.')
        return {'session_id': identity, 'protocol_version': 1}


@guarded
def ingest(device_id, key, payload):
    db = database()
    with image_write_lock(db):
        row = authenticate_device(db, device_id, key)
        if row.get('session_id') != payload['session_id']:
            raise HTTPException(412, '현재 장치 세션으로 다시 연결해 주세요.')
        import json
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        sequence = payload['event_id']
        previous = row.get('last_event_id', 0)
        if sequence <= previous:
            if sequence == previous and row.get('last_digest') != digest:
                raise HTTPException(409, '동일 이벤트 번호의 내용이 다릅니다.')
            # An old retry is not a new heartbeat and cannot revive stale card state.
            return {'accepted': False, 'duplicate': True, 'event_id': sequence}
        result = db.rfid_devices.update_one({'_id': device_id, 'active': True, 'key_hash': row['key_hash'],
            'session_id': payload['session_id'], 'last_event_id': previous}, {'$set': {
                'readers': sorted(payload['readers'], key=lambda item: item['reader_id']),
                'last_event_id': sequence, 'last_digest': digest, 'last_seen': datetime.now(timezone.utc)},
                '$inc': {'state_revision': 1}})
        if result.matched_count != 1:
            raise HTTPException(409, '장치 상태가 변경되었습니다. 최신 상태를 다시 보내 주세요.')
        return {'accepted': True, 'duplicate': False, 'event_id': sequence}


@guarded
def board_state(user_id, device_id, show_uids=False, now=None):
    db = database()
    row = owned_device(db, user_id, device_id)
    privacy = privacy_for(user_id)
    seen = row.get('last_seen')
    if seen:
        seen = seen.replace(tzinfo=seen.tzinfo or timezone.utc)
    fresh = bool(row['active'] and privacy['guardian_consent'] and privacy['deletion_status'] == 'none'
                 and seen and (now or datetime.now(timezone.utc)) - seen < timedelta(seconds=STALE_SECONDS))
    cards = available_cards(user_id)
    bindings = {item['uid']: item for item in db.rfid_bindings.find({'user_id': user_id}).limit(MAX_BINDINGS)}
    readings = {item['reader_id']: item for item in row.get('readers', [])} if fresh else {}
    readers = []
    for index in range(1, 4):
        reading = readings.get(index, {'status': 'STALE', 'uid': None})
        binding = bindings.get(reading.get('uid'))
        card = cards.get(binding['card_id']) if binding else None
        status = reading['status']
        if status == 'PRESENT' and not card:
            status = 'UNAVAILABLE' if binding else 'UNMAPPED'
        readers.append({'reader_id': index, 'name': row['reader_labels'][index - 1], 'status': status,
            'card_id': card['id'] if card and status == 'PRESENT' else None,
            'label': card['label'] if card and status == 'PRESENT' else None,
            **({'uid': reading.get('uid')} if show_uids else {})})
    return {'device': public_device(row), 'online': fresh, 'state_revision': row.get('state_revision', 0),
            'session_id': row.get('session_id'), 'event_id': row.get('last_event_id', 0), 'readers': readers}


@guarded
def list_bindings(user_id):
    rows = list(database().rfid_bindings.find({'user_id': user_id}).limit(MAX_BINDINGS + 1))
    if len(rows) > MAX_BINDINGS:
        raise HTTPException(413, 'RFID 태그 등록 수를 정리해 주세요.')
    return [{key: row[key] for key in ('uid', 'card_id', 'revision')} for row in rows]


@guarded
def save_binding(user_id, actor_id, uid, card_id, revision):
    db = database()
    with image_write_lock(db):
        recheck_manager(db, user_id, actor_id, 'cards_manage')
        consent(user_id)
        if card_id is not None and card_id not in available_cards(user_id):
            raise HTTPException(422, '이 사용자에게 제공되지 않는 카드입니다.')
        identity = hashlib.sha256((user_id + '|' + uid).encode()).hexdigest()
        old = db.rfid_bindings.find_one({'_id': identity})
        if (old['revision'] if old else None) != revision:
            raise HTTPException(409, '태그 연결이 변경되었습니다. 최신 목록을 확인해 주세요.')
        if card_id is None:
            if old:
                db.rfid_bindings.delete_one({'_id': identity, 'revision': revision})
        else:
            if not old and db.rfid_bindings.count_documents({'user_id': user_id}) >= MAX_BINDINGS:
                raise HTTPException(422, '태그는 사용자당 200개까지 등록할 수 있습니다.')
            # Opaque numeric revision avoids delete/re-create ABA conflicts.
            values = {'user_id': user_id, 'uid': uid, 'card_id': card_id, 'revision': secrets.randbits(52) + 1,
                      'updated_at': datetime.now(timezone.utc), 'schema_version': SCHEMA_VERSION}
            if old:
                db.rfid_bindings.update_one({'_id': identity, 'revision': revision}, {'$set': values})
            else:
                db.rfid_bindings.insert_one({'_id': identity, **values})
        audit(db, user_id, actor_id, 'rfid_binding_removed' if card_id is None else 'rfid_binding_saved', identity)
        return {'saved': True}
