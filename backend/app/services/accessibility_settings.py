"""Per-user AAC display and motion preferences stored in MongoDB."""
from datetime import datetime, timezone

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.database import database as _database
from app.services.schema_versions import SCHEMA_VERSION


DEFAULT_SETTINGS = {
    'display_mode': 'image_text',
    'cards_per_page': 12,
    'card_size': 'medium',
    'text_size': 'medium',
    'reduced_motion': False,
    'high_contrast': False,
    'start_screen': 'home',
    'output_mode': 'natural',
}


PROTECTED_SETTINGS = {'display_mode', 'cards_per_page', 'card_size', 'start_screen', 'output_mode'}


def _effective(document, user):
    defaults = DEFAULT_SETTINGS | {'output_mode': (user or {}).get('default_output_mode', 'natural')}
    return {key: (document or {}).get(key, value) for key, value in defaults.items()}


def settings_for(user_id):
    try:
        database = _database()
        document = database.accessibility_settings.find_one({'_id': user_id})
        user = database.users.find_one({'_id': user_id}, {'default_output_mode': 1})
        return _effective(document, user)
    except PyMongoError as exc:
        raise HTTPException(503, '접근 설정을 불러오지 못했습니다.') from exc


def save_settings(user_id, settings, actor):
    saved = {key: settings[key] for key in DEFAULT_SETTINGS}
    try:
        database = _database()
        user = database.users.find_one({'_id': user_id}, {'default_output_mode': 1})
        if actor['role'] == 'user':
            current = _effective(database.accessibility_settings.find_one({'_id': user_id}),
                user)
            if any(saved[key] != current[key] for key in PROTECTED_SETTINGS):
                raise HTTPException(403, '시작 화면·발화 방식·카드 배치는 연결된 보호자 설정에서 변경해 주세요.')
        write_values = {key: value for key, value in saved.items()
                        if actor['role'] != 'user' or key not in PROTECTED_SETTINGS}
        now = datetime.now(timezone.utc)
        database.accessibility_settings.update_one(
            {'_id': user_id},
            {'$set': write_values | {'updated_at': now},
             '$setOnInsert': {'schema_version': SCHEMA_VERSION, 'user_id': user_id, 'created_at': now}},
            upsert=True,
        )
        return _effective(database.accessibility_settings.find_one({'_id': user_id}), user)
    except PyMongoError as exc:
        raise HTTPException(503, '접근 설정을 저장하지 못했습니다.') from exc
