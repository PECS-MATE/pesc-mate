"""Serialize short history writes with consent withdrawal and personal-data deletion."""
from contextlib import contextmanager
from functools import wraps
from inspect import signature

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.database import database
from app.services.image_storage import image_write_lock


def recording_revision(user_id):
    try:
        state = database().privacy_settings.find_one({'_id': user_id}) or {}
    except PyMongoError as exc:
        raise HTTPException(503, '기록 저장 동의를 확인하지 못했습니다.') from exc
    if not state.get('guardian_consent'):
        raise HTTPException(403, '기록 저장 동의를 다시 확인해 주세요.')
    if state.get('deletion_status') in {'in_progress', 'failed'}:
        raise HTTPException(409, '개인정보 삭제 상태를 먼저 확인해 주세요.')
    return state.get('recording_revision', 0)


@contextmanager
def recording_write(user_id, expected_revision):
    # Same MongoDB-backed, non-expiring lock as deletion. No inference/network work here.
    with image_write_lock(database()):
        if recording_revision(user_id) != expected_revision:
            raise HTTPException(409, '동의 또는 삭제 상태가 변경되었습니다. 새 요청으로 다시 시도해 주세요.')
        yield


def guarded_recording(function):
    parameters = signature(function)

    @wraps(function)
    def guarded(*args, **kwargs):
        user_id = parameters.bind(*args, **kwargs).arguments['user_id']
        revision = recording_revision(user_id)
        with recording_write(user_id, revision):
            return function(*args, **kwargs)
    return guarded
