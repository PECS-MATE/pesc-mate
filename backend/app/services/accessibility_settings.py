"""Per-user AAC display and motion preferences stored in MongoDB."""
from datetime import datetime, timezone

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.database import database as _database, log_crud


DEFAULT_SETTINGS = {
    'display_mode': 'image_text',
    'cards_per_page': 12,
    'card_size': 'medium',
    'text_size': 'medium',
    'reduced_motion': False,
    'high_contrast': False,
}


def settings_for(user_id):
    try:
        document = _database().accessibility_settings.find_one({'_id': user_id})
        log_crud('READ', 'accessibility_settings', '사용자 접근 설정 조회')
        if not document:
            return DEFAULT_SETTINGS.copy()
        return {key: document.get(key, value) for key, value in DEFAULT_SETTINGS.items()}
    except PyMongoError as exc:
        raise HTTPException(503, '접근 설정을 불러오지 못했습니다.') from exc


def save_settings(user_id, settings):
    saved = {key: settings[key] for key in DEFAULT_SETTINGS}
    try:
        now = datetime.now(timezone.utc)
        _database().accessibility_settings.update_one(
            {'_id': user_id},
            {'$set': saved | {'updated_at': now},
             '$setOnInsert': {'user_id': user_id, 'created_at': now}},
            upsert=True,
        )
        log_crud('UPDATE', 'accessibility_settings', '사용자 접근 설정 저장')
        return saved
    except PyMongoError as exc:
        raise HTTPException(503, '접근 설정을 저장하지 못했습니다.') from exc
