"""Caregiver notes attached to linked communication sessions."""
from datetime import datetime, timezone

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.services.database import database as _database
from app.services.schema_versions import SCHEMA_VERSION


def _ensure_session(database, session_id, user_id):
    if not database.communication_sessions.find_one({'_id': session_id, 'user_id': user_id}):
        raise HTTPException(404, '의사소통 기록을 찾을 수 없습니다.')


def _scope(caregiver_id, user_id, session_id):
    return {'_id': f'{caregiver_id}:{session_id}', 'caregiver_id': caregiver_id,
            'user_id': user_id, 'session_id': session_id}


def _public_note(document):
    updated = document.get('updated_at')
    if isinstance(updated, datetime) and updated.tzinfo is None:
        updated = updated.replace(tzinfo=timezone.utc)
    return {'id': document['_id'], 'session_id': document['session_id'], 'user_id': document['user_id'],
            'author_id': document['caregiver_id'], 'revision': document.get('revision', 0),
            'content': document.get('content') if not document.get('deleted') else None,
            'updated_at': updated, 'deleted': document.get('deleted', False)}


def _change_note(caregiver_id, user_id, session_id, content, expected_revision, deleted=False):
    database = _database()
    _ensure_session(database, session_id, user_id)
    scope = _scope(caregiver_id, user_id, session_id)
    previous = database.caregiver_notes.find_one(scope)
    revision = (previous or {}).get('revision', 0)
    if expected_revision is not None and expected_revision != revision:
        raise HTTPException(409, '다른 화면에서 메모가 변경되었습니다. 기록을 다시 조회해 주세요. 초안은 유지됩니다.')
    if deleted and (not previous or previous.get('deleted')):
        return _public_note(previous) if previous else None
    now = datetime.now(timezone.utc)
    history = list((previous or {}).get('history', []))
    if previous and not history:
        history.append({'revision': revision, 'author_id': caregiver_id, 'action': 'legacy',
                        'content': previous.get('content'), 'created_at': previous.get('updated_at')})
    if len(history) >= 1000 and not deleted:
        raise HTTPException(409, '메모 이력이 1,000개에 도달해 새 수정을 저장할 수 없습니다. 기존 이력 조회와 본문 삭제는 가능합니다.')
    if deleted:
        # A delete must also erase the old bodies, not leave recoverable text in revision history.
        history = [{**item, 'content': None} for item in history]
    history.append({'revision': revision + 1, 'author_id': caregiver_id,
                    'action': 'deleted' if deleted else 'updated' if previous else 'created',
                    'content': None if deleted else content, 'created_at': now})
    document = {**scope, 'schema_version': SCHEMA_VERSION, 'revision': revision + 1,
                'content': None if deleted else content, 'deleted': deleted, 'history': history,
                'created_at': (previous or {}).get('created_at', now), 'updated_at': now}
    if previous and 'schema_version' in previous:
        document['schema_version'] = previous['schema_version']
    if previous:
        condition = scope | {'revision': revision if 'revision' in previous else {'$exists': False}}
        result = database.caregiver_notes.replace_one(condition, document)
        if not result.matched_count:
            raise HTTPException(409, '다른 화면에서 메모가 변경되었습니다. 기록을 다시 조회해 주세요. 초안은 유지됩니다.')
    else:
        try:
            database.caregiver_notes.insert_one(document)
        except DuplicateKeyError as exc:
            raise HTTPException(409, '다른 화면에서 메모가 변경되었습니다. 기록을 다시 조회해 주세요.') from exc
    return _public_note(document)


def save_note(caregiver_id, user_id, session_id, content, expected_revision=None):
    try:
        return _change_note(caregiver_id, user_id, session_id, content, expected_revision)
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '보호자 메모를 저장하지 못했습니다.') from exc


def delete_note(caregiver_id, user_id, session_id, expected_revision=None):
    try:
        return _change_note(caregiver_id, user_id, session_id, None, expected_revision, deleted=True)
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '보호자 메모를 삭제하지 못했습니다.') from exc


def note_history(caregiver_id, user_id, session_id):
    try:
        database = _database()
        _ensure_session(database, session_id, user_id)
        document = database.caregiver_notes.find_one(_scope(caregiver_id, user_id, session_id))
        if not document:
            return {'revision': 0, 'deleted': False, 'history': [], 'author_id': caregiver_id}
        history = document.get('history') or [{'revision': document.get('revision', 0), 'author_id': caregiver_id,
            'action': 'legacy', 'content': document.get('content'), 'created_at': document.get('updated_at')}]
        history = [{**row, 'created_at': row['created_at'].replace(tzinfo=timezone.utc)}
                   if isinstance(row.get('created_at'), datetime) and row['created_at'].tzinfo is None else row
                   for row in history]
        return _public_note(document) | {'history': history}
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '메모 이력을 조회하지 못했습니다.') from exc


def notes_for(caregiver_id, user_id, session_ids, include_details=False):
    if not session_ids:
        return {}
    try:
        rows = _database().caregiver_notes.find({
            'caregiver_id': caregiver_id, 'user_id': user_id, 'session_id': {'$in': session_ids},
        })
        return {row['session_id']: _public_note(row) if include_details else
                (row.get('content') if not row.get('deleted') else None) for row in rows}
    except PyMongoError as exc:
        raise HTTPException(503, '보호자 메모를 조회하지 못했습니다.') from exc
