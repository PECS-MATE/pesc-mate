"""Consent, export, retention and deletion controls."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.database import database as _database
from app.services.schema_versions import SCHEMA_VERSION


CONSENT_VERSION = '2026-10-09'
DEFAULT_PRIVACY = {
    'guardian_consent': False,
    'consent_version': CONSENT_VERSION,
    'consented_at': None,
    'retention_days': 365,
    'deletion_status': 'none',
    'deleted_at': None,
    'deletion_receipt': None,
}


def _privacy_public(document):
    if not document:
        return DEFAULT_PRIVACY.copy()
    result = {key: document.get(key, default) for key, default in DEFAULT_PRIVACY.items()}
    for key in ('consented_at', 'deleted_at'):
        if isinstance(result[key], datetime) and result[key].tzinfo is None:
            result[key] = result[key].replace(tzinfo=timezone.utc)
    if result['deletion_receipt']:
        receipt = dict(result['deletion_receipt'])
        for key in ('requested_at', 'finished_at'):
            if isinstance(receipt.get(key), datetime) and receipt[key].tzinfo is None:
                receipt[key] = receipt[key].replace(tzinfo=timezone.utc)
        result['deletion_receipt'] = receipt
    return result


def privacy_for(user_id):
    try:
        document = _database().privacy_settings.find_one({'_id': user_id})
        return _privacy_public(document)
    except PyMongoError as exc:
        raise HTTPException(503, '개인정보 설정을 불러오지 못했습니다.') from exc


def save_privacy(user_id, guardian_consent, retention_days):
    # Serialize withdrawal with hardware registration/ingest and account deletion.
    # Otherwise a writer that already checked consent could insert after withdrawal.
    if retention_days not in {30, 90, 365, 1095}:
        raise HTTPException(422, '보존 기간이 올바르지 않습니다.')
    from app.services.image_storage import image_write_lock
    try:
        with image_write_lock(_database()):
            return _save_privacy(user_id, guardian_consent, retention_days)
    except PyMongoError as exc:
        raise HTTPException(503, '개인정보 설정을 저장하지 못했습니다.') from exc


def _save_privacy(user_id, guardian_consent, retention_days):
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
             '$setOnInsert': {'schema_version': SCHEMA_VERSION, 'user_id': user_id, 'created_at': now}},
            upsert=True,
        )
        cutoff = now - timedelta(days=retention_days)
        database.communication_sessions.delete_many({'user_id': user_id, 'created_at': {'$lt': cutoff}})
        database.tts_events.delete_many({'user_id': user_id, 'requested_at': {'$lt': cutoff}})
        database.offline_events.delete_many({'user_id': user_id, 'occurred_at': {'$lt': cutoff}})
        database.caregiver_notes.delete_many({'user_id': user_id, 'updated_at': {'$lt': cutoff}})
        database.learning_attempts.delete_many({'user_id': user_id, 'completed_at': {'$lt': cutoff}})
        database.recommendation_batches.delete_many({'user_id': user_id, 'created_at': {'$lt': cutoff}})
        database.practice_suggestion_batches.delete_many({'user_id': user_id, 'created_at': {'$lt': cutoff}})
        database.practice_suggestion_plans.delete_many({'user_id': user_id, 'created_at': {'$lt': cutoff}})
        database.practice_suggestion_feedback.delete_many({'user_id': user_id, 'updated_at': {'$lt': cutoff}})
        if not guardian_consent:
            database.practice_suggestion_settings.update_one({'_id': user_id},
                {'$set': {'enabled': False, 'updated_at': now}, '$inc': {'revision': 1}})
            for name in ('practice_suggestion_batches', 'practice_suggestion_plans', 'practice_suggestion_feedback'):
                database[name].delete_many({'user_id': user_id})
            # A stale hardware write cannot repopulate data: ingest only updates
            # an active device/session, never upserts it.
            database.rfid_devices.update_many({'user_id': user_id}, {'$set': {
                'active': False, 'session_id': None, 'last_seen': None, 'readers': []}})
        else:
            database.rfid_devices.update_many({'user_id': user_id, 'last_seen': {'$lt': cutoff}},
                {'$set': {'readers': [], 'last_seen': None}})
        return settings
    except PyMongoError as exc:
        raise HTTPException(503, '개인정보 설정을 저장하지 못했습니다.') from exc


def access_audit_for(user_id):
    try:
        rows = _database().privacy_audit_logs.find({'user_id': user_id}).sort('created_at', -1)
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
        user = database.users.find_one({'_id': user_id}, {
            'profile.original_image': 0, 'profile.image_data': 0, 'profile.thumbnail_data': 0}) or {}
        profile = user.get('profile') or {}
        safe_profile = {key: value for key, value in profile.items() if key not in {'image_data', 'thumbnail_data', 'original_image'}}
        cards = database.card_submissions.find({'owner_id': user_id}, {'image': 0, 'original_image': 0, 'thumbnail': 0})
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
            'recommendation_settings': database.recommendation_settings.find_one({'_id': user_id}),
            'recommendation_batches': list(database.recommendation_batches.find({'user_id': user_id})),
            'practice_suggestion_settings': database.practice_suggestion_settings.find_one({'_id': user_id}),
            'practice_suggestion_batches': list(database.practice_suggestion_batches.find({'user_id': user_id})),
            'practice_suggestion_plans': list(database.practice_suggestion_plans.find({'user_id': user_id})),
            'practice_suggestion_feedback': list(database.practice_suggestion_feedback.find({'user_id': user_id})),
            'rfid_devices': list(database.rfid_devices.find({'user_id': user_id}, {'key_hash': 0, 'last_digest': 0})),
            'rfid_bindings': list(database.rfid_bindings.find({'user_id': user_id})),
            'cards': [{key: row.get(key) for key in
                       ('_id', 'label', 'meaning', 'category', 'visibility', 'status', 'created_at')}
                      for row in cards],
        }
        return payload
    except PyMongoError as exc:
        raise HTTPException(503, '개인정보를 내보내지 못했습니다.') from exc


def delete_personal_data(user_id):
    from app.services.image_storage import deletion_watermark, image_write_lock
    try:
        db = _database()
        with image_write_lock(db):
            deletion_watermark(db)
            db.privacy_settings.update_one({'_id': user_id}, {
                '$max': {'image_deleted_before': datetime.now(timezone.utc)},
                '$setOnInsert': {'schema_version': SCHEMA_VERSION, 'user_id': user_id}}, upsert=True)
            return _delete_personal_data(user_id)
    except PyMongoError as exc:
        raise HTTPException(503, '이미지 삭제 상태를 저장하지 못했습니다.') from exc


def _delete_personal_data(user_id):
    """Delete user-generated content while retaining login credentials and the deletion receipt."""
    now = datetime.now(timezone.utc)
    confirmation = {'id': str(uuid4()), 'status': 'in_progress', 'requested_at': now,
                    'finished_at': None, 'counts': {}, 'profile_removed': False,
                    'preserved': ['로그인 계정', '삭제 확인 기록'],
                    'limitations': '이미 내려받은 파일과 별도 백업은 이 요청으로 자동 삭제되지 않습니다.'}
    try:
        database = _database()
        database.privacy_settings.update_one({'_id': user_id}, {'$set': {
            'guardian_consent': False, 'deletion_status': 'in_progress', 'deletion_receipt': confirmation,
        }, '$setOnInsert': {'schema_version': SCHEMA_VERSION, 'user_id': user_id, 'created_at': now}}, upsert=True)
        card_ids = [row['_id'] for row in database.card_submissions.find({'owner_id': user_id}, {'_id': 1})]
        for name, query in (
            ('communication_sessions', {'user_id': user_id}),
            ('recommendation_settings', {'_id': user_id}),
            ('recommendation_batches', {'user_id': user_id}),
            ('practice_suggestion_settings', {'_id': user_id}),
            ('practice_suggestion_batches', {'user_id': user_id}),
            ('practice_suggestion_plans', {'user_id': user_id}),
            ('practice_suggestion_feedback', {'user_id': user_id}),
            ('tts_events', {'user_id': user_id}),
            ('offline_events', {'user_id': user_id}),
            ('tts_settings', {'_id': user_id}),
            ('accessibility_settings', {'_id': user_id}),
            ('board_layouts', {'_id': user_id}),
            ('board_audit_logs', {'target_user_id': user_id}),
            ('learning_settings', {'_id': user_id}),
            ('learning_attempts', {'user_id': user_id}),
            ('learning_audit_logs', {'target_user_id': user_id}),
            ('rfid_devices', {'user_id': user_id}),
            ('rfid_bindings', {'user_id': user_id}),
            ('privacy_audit_logs', {'user_id': user_id}),
            ('caregiver_notes', {'user_id': user_id}),
            ('caregiver_links', {'user_id': user_id}),
            ('card_submissions', {'owner_id': user_id}),
        ):
            collection = getattr(database, name)
            result = collection.delete_many(query)
            count = result.deleted_count
            confirmation['counts'][name] = count if isinstance(count, int) else 0
        if card_ids:
            result = database.card_audit_logs.delete_many({'card_submission_id': {'$in': card_ids}})
            confirmation['counts']['card_audit_logs'] = result.deleted_count if isinstance(result.deleted_count, int) else 0
        database.users.update_one({'_id': user_id}, {'$unset': {'profile': ''}})
        confirmation['profile_removed'] = True
        _audit(database, user_id, user_id, 'personal_data_deleted', None)
        confirmation.update(status='completed', finished_at=datetime.now(timezone.utc))
        receipt = {
            'guardian_consent': False, 'consent_version': CONSENT_VERSION,
            'consented_at': None, 'retention_days': 365,
            'deletion_status': 'completed', 'deleted_at': now, 'updated_at': now,
            'deletion_receipt': confirmation,
        }
        database.privacy_settings.update_one(
            {'_id': user_id}, {'$set': receipt, '$setOnInsert': {'schema_version': SCHEMA_VERSION, 'user_id': user_id, 'created_at': now}},
            upsert=True,
        )
        return _privacy_public(receipt)
    except PyMongoError as exc:
        confirmation.update(status='failed', finished_at=datetime.now(timezone.utc))
        try:
            _database().privacy_settings.update_one({'_id': user_id}, {'$set': {
                'guardian_consent': False, 'deletion_status': 'failed', 'deletion_receipt': confirmation,
            }})
        except PyMongoError:
            pass  # Never report success when even the failure receipt cannot be saved.
        raise HTTPException(503, '개인정보를 삭제하지 못했습니다.') from exc


def _audit(database, user_id, actor_id, action, target_id):
    database.privacy_audit_logs.insert_one({
        'schema_version': SCHEMA_VERSION,
        '_id': str(uuid4()), 'user_id': user_id, 'actor_id': actor_id,
        'action': action, 'target_id': target_id, 'created_at': datetime.now(timezone.utc),
    })
