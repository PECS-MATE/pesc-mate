"""One durable MongoDB write boundary shared by images, records and deletion.

This is deliberately a single non-expiring lock. Recovery is token-scoped and
requires stopped writers. Collection, owner token and HTTP errors are unchanged.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError, PyMongoError
from app.services.schema_versions import SCHEMA_VERSION

LOCK_ID = 'image-writes'

@contextmanager
def image_write_lock(db):
    token = uuid4().hex
    try:
        db.image_storage_state.insert_one({'_id': LOCK_ID, 'schema_version': SCHEMA_VERSION,
            'token': token, 'created_at': datetime.now(timezone.utc)})
    except DuplicateKeyError as exc:
        raise HTTPException(409, '다른 이미지 저장·삭제 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.') from exc
    except PyMongoError as exc:
        raise HTTPException(503, '이미지 저장소를 확인하지 못했습니다.') from exc
    # No expiring lease: a stopped writer can never wake up and overspend a new writer's quota.
    # A process crash leaves a recoverable lock; the maintenance CLI requires writers stopped + token.
    try:
        yield
    finally:
        db.image_storage_state.delete_one({'_id': LOCK_ID, 'token': token})

