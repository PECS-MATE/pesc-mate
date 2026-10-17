"""Caregiver notes attached to linked communication sessions."""
from datetime import datetime, timezone

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.database import database as _database, log_crud
from app.services.schema_versions import SCHEMA_VERSION


def _ensure_session(database, session_id, user_id):
    if not database.communication_sessions.find_one({'_id': session_id, 'user_id': user_id}):
        log_crud('READ', 'communication_sessions', '보호자 메모 대상 확인')
        raise HTTPException(404, '의사소통 기록을 찾을 수 없습니다.')


def save_note(caregiver_id, user_id, session_id, content):
    try:
        database = _database()
        _ensure_session(database, session_id, user_id)
        now = datetime.now(timezone.utc)
        note_id = f'{caregiver_id}:{session_id}'
        database.caregiver_notes.update_one(
            {'_id': note_id},
            {'$set': {'caregiver_id': caregiver_id, 'user_id': user_id, 'session_id': session_id,
                      'content': content, 'updated_at': now},
             '$setOnInsert': {'schema_version': SCHEMA_VERSION, 'created_at': now}},
            upsert=True,
        )
        log_crud('UPDATE', 'caregiver_notes', '보호자 메모 저장')
        return {'id': note_id, 'session_id': session_id, 'user_id': user_id,
                'content': content, 'updated_at': now}
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '보호자 메모를 저장하지 못했습니다.') from exc


def delete_note(caregiver_id, user_id, session_id):
    try:
        database = _database()
        _ensure_session(database, session_id, user_id)
        database.caregiver_notes.delete_one({'_id': f'{caregiver_id}:{session_id}',
                                             'caregiver_id': caregiver_id, 'user_id': user_id})
        log_crud('DELETE', 'caregiver_notes', '보호자 메모 삭제')
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '보호자 메모를 삭제하지 못했습니다.') from exc


def notes_for(caregiver_id, user_id, session_ids):
    if not session_ids:
        return {}
    try:
        rows = _database().caregiver_notes.find({
            'caregiver_id': caregiver_id, 'user_id': user_id, 'session_id': {'$in': session_ids},
        })
        log_crud('READ', 'caregiver_notes', '보호자 메모 목록 조회')
        return {row['session_id']: row['content'] for row in rows}
    except PyMongoError as exc:
        raise HTTPException(503, '보호자 메모를 조회하지 못했습니다.') from exc
