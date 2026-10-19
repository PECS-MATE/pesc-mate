"""Account-wide access checks; a deadline is enforced on requests, never by a TTL job."""
from datetime import datetime, timezone

from fastapi import HTTPException


def utc_now():
    return datetime.now(timezone.utc)


def access_state(user):
    active = user.get('account_active', True)
    deadline = user.get('access_expires_at')
    if not isinstance(active, bool) or (deadline is not None and not isinstance(deadline, datetime)):
        raise HTTPException(503, '계정 접근 설정을 확인하지 못했습니다.')
    if deadline is not None:
        deadline = deadline.replace(tzinfo=timezone.utc) if deadline.tzinfo is None else deadline.astimezone(timezone.utc)
    return active, deadline


def account_access_allowed(user, now=None):
    active, deadline = access_state(user)
    return active and (deadline is None or (now or utc_now()) < deadline)


def public_access_state(user):
    active, deadline = access_state(user)
    return {'account_active': active, 'access_expires_at': deadline.isoformat() if deadline else None}
