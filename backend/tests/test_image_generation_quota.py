import base64
import json
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

import pytest
from fastapi import HTTPException
from pymongo.errors import ConnectionFailure
from app.services import card_image_tools as tools


def test_quota_is_shared_atomic_and_resets_on_next_korean_day(db, monkeypatch):
    monkeypatch.setenv('IMAGE_GENERATION_DAILY_LIMIT', '3')
    monkeypatch.setattr(tools, 'daily_identity', lambda: '2026-11-17')
    def reserve(_):
        try:
            tools.generation_quota(reserve=True)
            return True
        except HTTPException as exc:
            assert exc.status_code == 429
            return False
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(reserve, range(10))) == 3
    assert tools.generation_quota()['remaining'] == 0
    monkeypatch.setattr(tools, 'daily_identity', lambda: '2026-11-18')
    assert tools.generation_quota()['remaining'] == 3


@pytest.mark.parametrize('configured,expected', [('500', 30), ('invalid', 30), ('0', 0), ('-1', 0)])
def test_daily_limit_never_exceeds_thirty(monkeypatch, configured, expected):
    monkeypatch.setenv('IMAGE_GENERATION_DAILY_LIMIT', configured)
    assert tools.daily_limit() == expected


def test_database_failure_blocks_paid_generation(monkeypatch):
    def unavailable():
        raise ConnectionFailure('synthetic failure')
    monkeypatch.setattr(tools, 'database', unavailable)
    with pytest.raises(HTTPException) as error:
        tools.generation_quota(reserve=True)
    assert error.value.status_code == 503


def test_gemini_request_preview_and_exhaustion(db, monkeypatch, png_bytes):
    monkeypatch.setenv('IMAGE_GENERATION_PROVIDER', 'gemini')
    monkeypatch.setenv('GEMINI_API_KEY', 'synthetic-not-a-real-key')
    monkeypatch.setenv('GEMINI_IMAGE_MODEL', 'gemini-2.5-flash-image')
    monkeypatch.setenv('IMAGE_GENERATION_DAILY_LIMIT', '1')
    calls = []
    class Opener:
        def open(self, request, timeout):
            calls.append(json.loads(request.data))
            return BytesIO(json.dumps({'candidates': [{'content': {'parts': [
                {'inlineData': {'mimeType': 'image/png', 'data': base64.b64encode(png_bytes).decode()}}
            ]}}]}).encode())
    monkeypatch.setattr(tools, 'build_opener', lambda *args: Opener())
    result = tools.generate('물컵', True, '파란 손잡이 컵')
    assert result['review_required'] and result['data_url'].startswith('data:image/')
    assert '파란 손잡이 컵' in calls[0]['contents'][0]['parts'][0]['text']
    with pytest.raises(HTTPException) as error:
        tools.generate('물컵', True)
    assert error.value.status_code == 429 and len(calls) == 1


def test_failed_paid_request_remains_counted_without_retry(db, monkeypatch):
    monkeypatch.setenv('IMAGE_GENERATION_PROVIDER', 'gemini')
    monkeypatch.setenv('GEMINI_API_KEY', 'synthetic-not-a-real-key')
    calls = []
    class Opener:
        def open(self, *args, **kwargs):
            calls.append(1)
            raise TimeoutError()
    monkeypatch.setattr(tools, 'build_opener', lambda *args: Opener())
    with pytest.raises(HTTPException) as error:
        tools.generate('물', True)
    assert error.value.status_code == 502
    assert len(calls) == 1 and tools.generation_quota()['used'] == 1


def test_no_key_or_consent_never_reserves_quota(db, monkeypatch):
    monkeypatch.setenv('IMAGE_GENERATION_PROVIDER', 'gemini')
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    for consent in (False, True):
        with pytest.raises(HTTPException):
            tools.generate('물', consent)
    assert tools.generation_quota()['used'] == 0


def test_anonymous_generation_is_rejected_before_quota(client, db):
    response = client.post('/api/card-image-tools/generate', json={'label': '물',
        'description': '파란 컵', 'expected_backend': 'gemini',
        'expected_model': 'gemini-2.5-flash-image', 'scope': 'shared', 'external_accepted': True})
    assert response.status_code == 401
    assert db.image_generation_usage.count_documents({}) == 0


def test_openrouter_uses_existing_key_and_normalizes_one_image(db, monkeypatch, png_bytes):
    monkeypatch.setenv('IMAGE_GENERATION_PROVIDER', 'openrouter')
    monkeypatch.setenv('OPENROUTER_API_KEY', 'synthetic-openrouter-key')
    calls = []
    class Opener:
        def open(self, request, timeout):
            calls.append((request.full_url, json.loads(request.data), request.get_header('Authorization')))
            return BytesIO(json.dumps({'data': [{'b64_json': base64.b64encode(png_bytes).decode(),
                                                'media_type': 'image/png'}]}).encode())
    monkeypatch.setattr(tools, 'build_opener', lambda *args: Opener())
    assert tools.status()['generation_ready']
    result = tools.generate('물컵', True)
    assert result['data_url'].startswith('data:image/')
    assert result['review_required']
    assert result['guideline_version'] == 'card-image-guidelines-v3-rules-only'
    assert result['reference_ids'][0] == 'aac-common'
    endpoint, body, authorization = calls[0]
    assert endpoint == 'https://openrouter.ai/api/v1/images'
    assert body['model'] == 'google/gemini-2.5-flash-image'
    assert body['n'] == 1 and body['aspect_ratio'] == '1:1'
    assert 'RETRIEVED_GUIDELINES' in body['prompt'] and '#ffffff' in body['prompt']
    assert authorization == 'Bearer synthetic-openrouter-key'
    assert tools.generation_quota()['used'] == 1


@pytest.mark.parametrize('payload', [{'data': []}, {'data': [{'url': 'http://localhost/private'}]},
                                   {'data': [{'b64_json': 'not-base64'}]}])
def test_openrouter_invalid_images_are_not_fetched_or_retried(db, monkeypatch, payload):
    monkeypatch.setenv('IMAGE_GENERATION_PROVIDER', 'openrouter')
    monkeypatch.setenv('OPENROUTER_API_KEY', 'synthetic-secret')
    calls = []
    class Opener:
        def open(self, *args, **kwargs):
            calls.append(1)
            return BytesIO(json.dumps(payload).encode())
    monkeypatch.setattr(tools, 'build_opener', lambda *args: Opener())
    with pytest.raises(HTTPException) as error:
        tools.generate('물', True)
    assert error.value.status_code == 502 and len(calls) == 1
    assert 'synthetic-secret' not in error.value.detail
    assert tools.generation_quota()['used'] == 1


def test_openrouter_credit_failure_has_actionable_message_without_retry(db, monkeypatch):
    from urllib.error import HTTPError
    monkeypatch.setenv('IMAGE_GENERATION_PROVIDER', 'openrouter')
    monkeypatch.setenv('OPENROUTER_API_KEY', 'synthetic-secret')
    calls = []
    class Opener:
        def open(self, *args, **kwargs):
            calls.append(1)
            raise HTTPError('https://openrouter.ai/api/v1/images', 402, 'Payment required', {}, None)
    monkeypatch.setattr(tools, 'build_opener', lambda *args: Opener())
    with pytest.raises(HTTPException) as error:
        tools.generate('물', True)
    assert '크레딧을 충전' in error.value.detail
    assert len(calls) == 1
