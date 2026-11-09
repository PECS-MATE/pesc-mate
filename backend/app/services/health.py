"""Readiness checks for the API and its required and optional dependencies."""
import json
import os
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPException
from urllib.error import URLError
from urllib.request import urlopen

from pymongo import timeout
from pymongo.errors import PyMongoError

from app.services.database import client
from app.services.model import enabled as ollama_enabled
from app.services.speech_runtime import speech_runtime

CHECK_TIMEOUT_SECONDS = 2.0
MAX_TAGS_BYTES = 65536


def _mongodb_check():
    try:
        with timeout(CHECK_TIMEOUT_SECONDS):
            result = client().admin.command('ping')
        if result.get('ok') == 1:
            return {'status': 'ok', 'required': True, 'detail': 'ready'}
    except (PyMongoError, OSError, ValueError):
        pass
    return {'status': 'unavailable', 'required': True, 'detail': 'unreachable'}


def _model_name(name):
    """Ollama treats an omitted model tag as :latest."""
    return name if ':' in name.rsplit('/', 1)[-1] else f'{name}:latest'


def _ollama_check():
    check = {'status': 'disabled', 'required': False, 'detail': 'disabled', 'fallback': 'rule'}
    if not ollama_enabled():
        return check

    check.update(status='unavailable', detail='unreachable')
    base_url = os.environ.get('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').rstrip('/')
    configured_model = os.environ.get('OLLAMA_MODEL', 'qwen2.5:0.5b')
    try:
        with urlopen(f'{base_url}/api/tags', timeout=CHECK_TIMEOUT_SECONDS) as response:
            body = response.read(MAX_TAGS_BYTES + 1)
        if len(body) > MAX_TAGS_BYTES:
            check['detail'] = 'invalid_response'
            return check
        result = json.loads(body)
    except (HTTPException, URLError, TimeoutError, OSError):
        return check
    except ValueError:
        check['detail'] = 'invalid_response'
        return check

    if not isinstance(result, dict) or not isinstance(result.get('models'), list):
        check['detail'] = 'invalid_response'
        return check
    models = result['models']
    if any(not isinstance(model, dict) for model in models):
        check['detail'] = 'invalid_response'
        return check
    names = {
        _model_name(name)
        for model in models
        for name in (model.get('name'), model.get('model'))
        if isinstance(name, str) and name
    }
    if _model_name(configured_model) in names:
        check.update(status='ok', detail='ready')
    else:
        check['detail'] = 'model_missing'
    return check


def _tts_check():
    base, provider = speech_runtime()
    check = {'status': 'unavailable', 'required': False, 'provider': provider,
             'detail': 'not_configured', 'device_check': 'client_side'}
    if not base:
        return check
    check['detail'] = 'unreachable'
    try:
        with urlopen(f'{base}/health', timeout=CHECK_TIMEOUT_SECONDS) as response:
            body = response.read(4097)
        if len(body) > 4096:
            check['detail'] = 'invalid_response'
            return check
        result = json.loads(body)
        if isinstance(result, dict) and result.get('status') == 'ready' and result.get('provider') == provider:
            check.update(status='ok', detail='ready')
        else:
            check['detail'] = 'invalid_response'
    except (HTTPException, URLError, TimeoutError, OSError):
        pass
    except ValueError:
        check['detail'] = 'invalid_response'
    return check


def health_report():
    """Return a safe readiness payload and its HTTP status code.

    MongoDB is required. Ollama can degrade while sentence generation keeps
    using its rule fallback. Selected speech-worker readiness is checked separately; audible
    playback and device fallback still require checks on the user's device.
    """
    # Independent 2s checks must not accumulate past the Compose 5s health timeout.
    with ThreadPoolExecutor(max_workers=3) as pool:
        checks_pending = [pool.submit(check) for check in (_mongodb_check, _ollama_check, _tts_check)]
        mongodb, ollama, tts = [check.result() for check in checks_pending]
    checks = {
        'service': {'status': 'ok', 'required': True},
        'mongodb': mongodb,
        'ollama': ollama,
        'tts': tts,
    }
    if mongodb['status'] != 'ok':
        return {'status': 'unavailable', 'checks': checks}, 503
    status = 'degraded' if ollama['status'] == 'unavailable' or tts['status'] != 'ok' else 'ok'
    return {'status': status, 'checks': checks}, 200
