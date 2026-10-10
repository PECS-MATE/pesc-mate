"""Privacy-minimized console logging for browser device access."""
import hashlib
import logging
import re
import threading
import time

logger = logging.getLogger('uvicorn.error')
ACCESS_DEDUP_SECONDS = 600
_seen = {}
_lock = threading.Lock()


def device_type(user_agent):
    value = (user_agent or '').lower()
    if 'ipad' in value or ('android' in value and 'mobile' not in value):
        return 'tablet'
    if 'iphone' in value or 'mobile' in value or 'android' in value:
        return 'mobile'
    return 'desktop'


def browser_name(user_agent):
    value = user_agent or ''
    if 'Edg/' in value or 'EdgiOS/' in value or 'EdgA/' in value:
        return 'Edge'
    if 'CriOS/' in value or 'Chrome/' in value:
        return 'Chrome'
    if 'FxiOS/' in value or 'Firefox/' in value:
        return 'Firefox'
    if 'Safari/' in value:
        return 'Safari'
    return 'Other'


def log_device_access(request, now=None):
    forwarded = request.headers.get('x-forwarded-for')
    source_ip = forwarded or (request.client.host if request.client else '')
    user_agent = request.headers.get('user-agent', '')
    kind = device_type(user_agent)
    browser = browser_name(user_agent)
    timestamp = time.monotonic() if now is None else now
    supplied_id = request.headers.get('x-pesc-device', '')
    if re.fullmatch(r'[0-9A-Za-z_-]{8,64}', supplied_id):
        device_ref = supplied_id.replace('-', '')[:8].lower()
        fingerprint = supplied_id
    else:
        fingerprint = f'{source_ip}|{user_agent}'
        device_ref = hashlib.sha256(fingerprint.encode()).hexdigest()[:8]

    with _lock:
        previous = _seen.get(fingerprint)
        if previous is not None and timestamp - previous < ACCESS_DEDUP_SECONDS:
            return False
        _seen[fingerprint] = timestamp
        expired = [key for key, seen_at in _seen.items()
                   if timestamp - seen_at >= ACCESS_DEDUP_SECONDS]
        for key in expired:
            _seen.pop(key, None)

    logger.info('DEVICE | CONNECT | device=%s | type=%s | browser=%s',
                device_ref, kind, browser)
    return True
