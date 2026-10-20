"""Per-user text-to-speech preferences stored in MongoDB."""
from datetime import datetime, timezone

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.database import database as _database
from app.services.schema_versions import SCHEMA_VERSION


DEFAULT_SETTINGS = {
    'preset': 'child',
    'voice_name': '',
    'rate': 0.9,
    'pitch': 1.25,
    'volume': 1.0,
}


def settings_for(user_id):
    try:
        document = _database().tts_settings.find_one({'_id': user_id})
        if not document:
            return DEFAULT_SETTINGS.copy()
        return {key: document.get(key, value) for key, value in DEFAULT_SETTINGS.items()}
    except PyMongoError as exc:
        raise HTTPException(503, '음성 설정을 불러오지 못했습니다.') from exc


def save_settings(user_id, preset, voice_name, rate, pitch, volume):
    try:
        settings = {
            'preset': preset,
            'voice_name': voice_name,
            'rate': rate,
            'pitch': pitch,
            'volume': volume,
        }
        now = datetime.now(timezone.utc)
        _database().tts_settings.update_one(
            {'_id': user_id},
            {'$set': settings | {'updated_at': now},
             '$setOnInsert': {'schema_version': SCHEMA_VERSION, 'user_id': user_id, 'created_at': now}},
            upsert=True,
        )
        return settings
    except PyMongoError as exc:
        raise HTTPException(503, '음성 설정을 저장하지 못했습니다.') from exc
