"""Consent, export, retention and deletion controls."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.database import database as _database, log_crud


CONSENT_VERSION = '2026-10-09'
DEFAULT_PRIVACY = {
    'guardian_consent': False,
    'consent_version': CONSENT_VERSION,
    'consented_at': None,
    'retention_days': 365,
    'deletion_status': 'none',
    'deleted_at': None,
}


def _privacy_public(document):
    if not document:
        return DEFAULT_PRIVACY.copy()
    return {key: document.get(key, default) for key, default in DEFAULT_PRIVACY.items()}


def privacy_for(user_id):
    try:
        document = _database().privacy_settings.find_one({'_id': user_id})
        log_crud('READ', 'privacy_settings', '개인정보 설정 조회')
        return _privacy_public(document)
    except PyMongoError as exc:
        raise HTTPException(503, '개인정보 설정을 불러오지 못했습니다.') from exc


def save_privacy(user_id, guardian_consent, retention_days):
    if retention_days not in {30, 90, 365, 1095}:
        raise HTTPException(422, '보존 기간이 올바르지 않습니다.')
    now = datetime.now(timezone.utc)
    settings = {
        'guardian_consent': guardian_consent,
        'consent_version': CONSENT_VERSION,
        'consented_at': now if guardian_consent else None,
        'retention_days': retention_days,
        'deletion_status': 'none',
        'deleted_at': None,
    }
    try:
        database = _database()
        database.privacy_settings.update_one(
            {'_id': user_id},
            {'$set': settings | {'updated_at': now},
             '$setOnInsert': {'user_id': user_id, 'created_at': now}},
            upsert=True,
        )
        cutoff = now - timedelta(days=retention_days)
        database.communication_sessions.delete_many({'user_id': user_id, 'created_at': {'$lt': cutoff}})
        database.tts_events.delete_many({'user_id': user_id, 'requested_at': {'$lt': cutoff}})
        database.offline_events.delete_many({'user_id': user_id, 'occurred_at': {'$lt': cutoff}})
        database.caregiver_notes.delete_many({'user_id': user_id, 'updated_at': {'$lt': cutoff}})
        database.learning_attempts.delete_many({'user_id': user_id, 'completed_at': {'$lt': cutoff}})
        log_crud('UPDATE', 'privacy_settings', '동의 및 보존 기간 저장')
        return settings
    except PyMongoError as exc:
        raise HTTPException(503, '개인정보 설정을 저장하지 못했습니다.') from exc


def access_audit_for(user_id):
    try:
        rows = _database().privacy_audit_logs.find({'user_id': user_id}).sort('created_at', -1)
        log_crud('READ', 'privacy_audit_logs', '개인정보 변경 이력 조회')
        return [{
            'id': str(row['_id']), 'action': row['action'], 'actor_id': row['actor_id'],
            'target_id': row.get('target_id'), 'created_at': row['created_at'],
            'before_permissions': row.get('before_permissions'),
            'after_permissions': row.get('after_permissions'),
        } for row in rows]
    except PyMongoError as exc:
        raise HTTPException(503, '개인정보 변경 이력을 조회하지 못했습니다.') from exc


def export_for(user_id):
    try:
        database = _database()
        user = database.users.find_one({'_id': user_id}) or {}
        profile = user.get('profile') or {}
        safe_profile = {key: value for key, value in profile.items() if key != 'image_data'}
        cards = database.card_submissions.find({'owner_id': user_id})
        from app.services.support_links import support_access_for
        payload = {
            'exported_at': datetime.now(timezone.utc),
            'account': {'id': user_id, 'username': user.get('username'), 'name': user.get('name'),
                        'role': user.get('role'), 'profile': safe_profile},
            'privacy': privacy_for(user_id),
            'support_access': support_access_for(user_id),
            'communication_sessions': list(database.communication_sessions.find({'user_id': user_id})),
            'tts_events': list(database.tts_events.find({'user_id': user_id})),
            'offline_events': list(database.offline_events.find({'user_id': user_id})),
            'learning_settings': database.learning_settings.find_one({'_id': user_id}),
            'learning_attempts': list(database.learning_attempts.find({'user_id': user_id})),
            'cards': [{key: row.get(key) for key in
                       ('_id', 'label', 'meaning', 'category', 'visibility', 'status', 'created_at')}
                      for row in cards],
        }
        log_crud('READ', 'users', '본인 개인정보 내보내기')
        return payload
    except PyMongoError as exc:
        raise HTTPException(503, '개인정보를 내보내지 못했습니다.') from exc


def delete_personal_data(user_id):
    """Delete user-generated content while retaining login credentials and the deletion receipt."""
    now = datetime.now(timezone.utc)
    try:
        database = _database()
        card_ids = [row['_id'] for row in database.card_submissions.find({'owner_id': user_id})]
        for collection, query in (
            (database.communication_sessions, {'user_id': user_id}),
            (database.tts_events, {'user_id': user_id}),
            (database.offline_events, {'user_id': user_id}),
            (database.tts_settings, {'_id': user_id}),
            (database.accessibility_settings, {'_id': user_id}),
            (database.board_layouts, {'_id': user_id}),
            (database.board_audit_logs, {'target_user_id': user_id}),
            (database.learning_settings, {'_id': user_id}),
            (database.learning_attempts, {'user_id': user_id}),
            (database.learning_audit_logs, {'target_user_id': user_id}),
            (database.caregiver_notes, {'user_id': user_id}),
            (database.caregiver_links, {'user_id': user_id}),
            (database.card_submissions, {'owner_id': user_id}),
        ):
            collection.delete_many(query)
        if card_ids:
            database.card_audit_logs.delete_many({'card_submission_id': {'$in': card_ids}})
        database.users.update_one({'_id': user_id}, {'$unset': {'profile': ''}})
        receipt = {
            'guardian_consent': False, 'consent_version': CONSENT_VERSION,
            'consented_at': None, 'retention_days': 365,
            'deletion_status': 'completed', 'deleted_at': now, 'updated_at': now,
        }
        database.privacy_settings.update_one(
            {'_id': user_id}, {'$set': receipt, '$setOnInsert': {'user_id': user_id, 'created_at': now}},
            upsert=True,
        )
        _audit(database, user_id, user_id, 'personal_data_deleted', None)
        log_crud('DELETE', 'user_data', '사용자 생성 개인정보 삭제')
        return _privacy_public(receipt)
    except PyMongoError as exc:
        raise HTTPException(503, '개인정보를 삭제하지 못했습니다.') from exc


def _audit(database, user_id, actor_id, action, target_id):
    database.privacy_audit_logs.insert_one({
        '_id': str(uuid4()), 'user_id': user_id, 'actor_id': actor_id,
        'action': action, 'target_id': target_id, 'created_at': datetime.now(timezone.utc),
    })
    log_crud('CREATE', 'privacy_audit_logs', '개인정보 변경 기록')
