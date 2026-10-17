"""Idempotent synchronization of minimal offline AAC usage events."""
from datetime import timezone

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.services.database import database as _database, log_crud


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
            try:
                result = collection.update_one(
                    {'_id': event_id, 'user_id': user_id},
                    {'$setOnInsert': {
                        'user_id': user_id, 'event_type': event['event_type'],
                        'card_ids': event['card_ids'], 'occurred_at': occurred_at,
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
        if accepted:
            log_crud('CREATE', 'offline_events', f'오프라인 이력 동기화 {len(accepted)}건')
        return {'accepted_ids': accepted}
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '오프라인 이력을 동기화하지 못했습니다.') from exc
