"""Idempotent synchronization of minimal offline AAC usage events."""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.services.database import database as _database
from app.services.schema_versions import SCHEMA_VERSION
from app.services.communication_activity import ACTIVITY_FIELDS


def sync_events(user_id, events, observation=None):
    accepted = []
    try:
        collection = _database().offline_events
        for event in events:
            event_id = str(event['id'])
            existing = collection.find_one({'_id': event_id})
            if existing and existing.get('user_id') != user_id:
                raise HTTPException(409, '같은 오프라인 이벤트 번호를 사용할 수 없습니다.')
            occurred_at = event['occurred_at']
            if occurred_at.tzinfo is None:
                occurred_at = occurred_at.replace(tzinfo=timezone.utc)
            if occurred_at > datetime.now(timezone.utc) + timedelta(minutes=5):
                raise HTTPException(422, '기기 시각이 현재보다 많이 앞서 있습니다. 시각 설정을 확인해 주세요.')
            if event.get('completed_at') and event['completed_at'] > datetime.now(timezone.utc) + timedelta(minutes=5):
                raise HTTPException(422, '완료 시각의 기기 시계 설정을 확인해 주세요.')
            values = {key: event[key] for key in ACTIVITY_FIELDS if key in event and event[key] is not None}
            values['occurred_at'] = occurred_at
            for key in ('stream_id', 'selection_id', 'session_id'):
                if key in values:
                    values[key] = str(values[key])
            if values.get('session_id') and not _database().communication_sessions.find_one({
                    '_id': values['session_id'], 'user_id': user_id}):
                raise HTTPException(404, '연결할 문장 기록을 찾을 수 없습니다.')
            try:
                result = collection.update_one(
                    {'_id': event_id, 'user_id': user_id},
                    {'$setOnInsert': {
                        'schema_version': SCHEMA_VERSION,
                        'user_id': user_id, **values,
                    }},
                    upsert=True,
                )
                inserted = result.upserted_id is not None
            except DuplicateKeyError:
                # A competing upsert can win after the ownership check above.
                winner = collection.find_one({'_id': event_id})
                if not winner or winner.get('user_id') != user_id:
                    raise HTTPException(409, '같은 오프라인 이벤트 번호를 사용할 수 없습니다.')
                inserted = False
            if observation is not None:
                observation.accepted(inserted)
            accepted.append(event_id)
        return {'accepted_ids': accepted}
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '오프라인 이력을 동기화하지 못했습니다.') from exc
