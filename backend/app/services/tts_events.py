"""TTS request and completion history for each communicator."""
from datetime import datetime, timezone

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.database import database as _database, log_crud


def start_event(user_id, request_id, content_type, char_count):
    try:
        now = datetime.now(timezone.utc)
        event = {
            'id': request_id,
            'user_id': user_id,
            'content_type': content_type,
            'char_count': char_count,
            'status': 'requested',
            'error_code': None,
            'requested_at': now,
            'completed_at': None,
        }
        _database().tts_events.update_one(
            {'_id': request_id, 'user_id': user_id},
            {'$setOnInsert': {'_id': request_id, **{key: value for key, value in event.items() if key != 'id'}}},
            upsert=True,
        )
        log_crud('CREATE', 'tts_events', 'TTS 요청 기록')
        return event
    except PyMongoError as exc:
        raise HTTPException(503, '음성 재생 요청 이력을 저장하지 못했습니다.') from exc


def finish_event(user_id, request_id, status, error_code='', startup_ms=None):
    try:
        now = datetime.now(timezone.utc)
        completion = {
            'status': status, 'error_code': error_code or None, 'completed_at': now,
            'startup_ms': startup_ms,
        }
        result = _database().tts_events.update_one(
            {'_id': request_id, 'user_id': user_id, 'status': 'requested'},
            {'$set': completion},
        )
        if not result.matched_count:
            raise HTTPException(404, '음성 재생 요청 이력을 찾을 수 없습니다.')
        log_crud('UPDATE', 'tts_events', f'TTS 결과 기록: {status}')
        return {'id': request_id, **completion}
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '음성 재생 결과 이력을 저장하지 못했습니다.') from exc
