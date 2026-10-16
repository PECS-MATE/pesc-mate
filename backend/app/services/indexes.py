"""Create MongoDB indexes for the main lookup paths when the application starts."""
import logging
import time

from pymongo import ASCENDING, DESCENDING
from pymongo.errors import PyMongoError

from app.services.database import database

logger = logging.getLogger('uvicorn.error')

# (collection, keys, options). Names stay stable so repeated startups are no-ops.
INDEXES = (
    ('users', [('username', ASCENDING)], {'name': 'username_unique', 'unique': True}),
    ('auth_sessions', [('expires_at', ASCENDING)], {'name': 'session_expiry_ttl', 'expireAfterSeconds': 0}),
    ('auth_sessions', [('user_id', ASCENDING)], {'name': 'session_user'}),
    ('login_attempts', [('expires_at', ASCENDING)], {'name': 'login_attempt_expiry_ttl', 'expireAfterSeconds': 0}),
    ('communication_sessions', [('user_id', ASCENDING), ('created_at', DESCENDING)], {'name': 'user_recent_sessions'}),
    ('tts_events', [('user_id', ASCENDING), ('requested_at', DESCENDING)], {'name': 'user_recent_tts'}),
    ('tts_events', [('requested_at', DESCENDING)], {'name': 'tts_metrics_window'}),
    ('offline_events', [('user_id', ASCENDING), ('occurred_at', DESCENDING)], {'name': 'user_recent_offline_events'}),
    ('learning_attempts', [('user_id', ASCENDING), ('completed_at', DESCENDING)], {'name': 'user_recent_attempts'}),
    ('caregiver_notes', [('caregiver_id', ASCENDING), ('user_id', ASCENDING), ('session_id', ASCENDING)],
     {'name': 'caregiver_session_notes'}),
    ('caregiver_notes', [('user_id', ASCENDING), ('updated_at', DESCENDING)], {'name': 'user_recent_notes'}),
    ('caregiver_links', [('supporter_id', ASCENDING), ('active', ASCENDING)], {'name': 'supporter_links'}),
    ('caregiver_links', [('caregiver_id', ASCENDING), ('active', ASCENDING)], {'name': 'legacy_caregiver_links'}),
    ('caregiver_links', [('user_id', ASCENDING), ('active', ASCENDING)], {'name': 'user_links'}),
    ('card_submissions', [('owner_id', ASCENDING), ('created_at', DESCENDING)], {'name': 'owner_recent_submissions'}),
    ('privacy_audit_logs', [('user_id', ASCENDING), ('created_at', DESCENDING)], {'name': 'user_recent_privacy_audit'}),
    ('board_audit_logs', [('target_user_id', ASCENDING), ('created_at', DESCENDING)],
     {'name': 'target_recent_board_audit'}),
    ('learning_audit_logs', [('target_user_id', ASCENDING), ('created_at', DESCENDING)],
     {'name': 'target_recent_learning_audit'}),
)


def ensure_indexes(attempts=10, retry_seconds=3, sleep=time.sleep):
    """Wait for MongoDB, then create each index so one conflict does not block the others."""
    db = database()
    for attempt in range(1, attempts + 1):
        try:
            db.command('ping')
            break
        except PyMongoError:
            if attempt == attempts:
                logger.warning('DB INDEX | skipped | MongoDB unavailable')
                return 0
            sleep(retry_seconds)
    created = 0
    for collection, keys, options in INDEXES:
        try:
            db[collection].create_index(keys, **options)
            created += 1
        except PyMongoError as exc:
            logger.warning('DB INDEX | %s.%s | %s', collection, options['name'], type(exc).__name__)
    logger.info('DB INDEX | ready %d/%d', created, len(INDEXES))
    return created
