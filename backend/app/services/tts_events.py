"""TTS request and completion history for each communicator."""
from datetime import datetime, timezone

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.services.database import database as _database, log_crud


def _public(document):
    result = {'id': str(document['_id']), **{key: document.get(key) for key in (
        'status', 'error_code', 'requested_at', 'completed_at', 'startup_ms',
    )}}
    for key in ('requested_at', 'completed_at'):
        value = result[key]
        if isinstance(value, datetime) and value.tzinfo is None:
            result[key] = value.replace(tzinfo=timezone.utc)
    return result


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
        document = _database().tts_events.find_one_and_update(
            {'_id': request_id, 'user_id': user_id},
            {'$setOnInsert': {'_id': request_id, **{key: value for key, value in event.items() if key != 'id'}}},
            upsert=True, return_document=ReturnDocument.AFTER,
        )
        log_crud('CREATE', 'tts_events', 'TTS 요청 기록')
        return _public(document)
    except DuplicateKeyError as exc:
        raise HTTPException(409, '이미 사용된 음성 재생 요청 ID입니다.') from exc
    except PyMongoError as exc:
        raise HTTPException(503, '음성 재생 요청 이력을 저장하지 못했습니다.') from exc


def finish_event(user_id, request_id, status, error_code='', startup_ms=None):
    try:
        now = datetime.now(timezone.utc)
        completion = {
            'status': status, 'error_code': error_code or None, 'completed_at': now,
            'startup_ms': startup_ms,
        }
        collection = _database().tts_events
        document = collection.find_one_and_update(
            {'_id': request_id, 'user_id': user_id, 'status': 'requested'},
            {'$set': completion},
            return_document=ReturnDocument.AFTER,
        )
        if document is None:
            existing = collection.find_one({'_id': request_id, 'user_id': user_id})
            if existing and existing.get('status') in {'succeeded', 'failed', 'cancelled'}:
                return _public(existing)
            raise HTTPException(404, '음성 재생 요청 이력을 찾을 수 없습니다.')
        log_crud('UPDATE', 'tts_events', f'TTS 결과 기록: {status}')
        return _public(document)
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '음성 재생 결과 이력을 저장하지 못했습니다.') from exc
