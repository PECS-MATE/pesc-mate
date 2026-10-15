"""Limit repeated login failures per account and client without storing raw identifiers."""
import hashlib
import math
import os
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.services.database import database as _database, log_crud


def _max_failures():
    return max(1, int(os.environ.get('LOGIN_MAX_FAILURES', '5')))


def _lock_window():
    return timedelta(minutes=max(1, int(os.environ.get('LOGIN_LOCK_MINUTES', '15'))))


def _key(username, client_ip):
    return hashlib.sha256(f'{username.lower()}|{client_ip or ""}'.encode()).hexdigest()


def _aware(value):
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


def ensure_login_allowed(username, client_ip, now=None):
    now = now or datetime.now(timezone.utc)
    attempt = _database().login_attempts.find_one({'_id': _key(username, client_ip)})
    log_crud('READ', 'login_attempts', '로그인 시도 제한 확인')
    expires_at = _aware(attempt.get('expires_at')) if attempt else None
    if not attempt or not expires_at or expires_at <= now or attempt.get('failures', 0) < _max_failures():
        return
    minutes = max(1, math.ceil((expires_at - now).total_seconds() / 60))
    raise HTTPException(
        429, f'로그인 시도가 너무 많습니다. {minutes}분 후 다시 시도해 주세요.',
        headers={'Retry-After': str(int((expires_at - now).total_seconds()) + 1)},
    )


def record_login_failure(username, client_ip, now=None):
    now = now or datetime.now(timezone.utc)
    collection = _database().login_attempts
    key = _key(username, client_ip)
    attempt = collection.find_one({'_id': key})
    if attempt and _aware(attempt.get('expires_at')) <= now:
        collection.delete_one({'_id': key, 'expires_at': attempt['expires_at']})
    collection.update_one(
        {'_id': key},
        {'$inc': {'failures': 1}, '$set': {'expires_at': now + _lock_window()}},
        upsert=True,
    )
    log_crud('UPDATE', 'login_attempts', '로그인 실패 기록')


def clear_login_failures(username, client_ip):
    _database().login_attempts.delete_one({'_id': _key(username, client_ip)})
    log_crud('DELETE', 'login_attempts', '로그인 실패 기록 초기화')
