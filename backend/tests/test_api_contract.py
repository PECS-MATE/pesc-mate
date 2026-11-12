"""Public contract baseline captured before production refactoring."""
import json
from hashlib import sha256
from pathlib import Path
import struct

import pytest
from app.main import app
from app.api import router
from app.services.authentication import current_user

BASELINE = Path(__file__).with_name('fixtures') / 'openapi.json'


def test_openapi_contract_matches_baseline():
    actual = json.loads(json.dumps(app.openapi()))
    assert actual == json.loads(BASELINE.read_text())
    operations = [operation['operationId'] for path in actual['paths'].values()
                  for method, operation in path.items() if method in {'get', 'post', 'put', 'patch', 'delete'}]
    assert len(operations) == len(set(operations))


@pytest.mark.parametrize('method,path', [
    ('get', '/api/cards'), ('post', '/api/sentences'), ('post', '/api/tts/speech'),
    ('post', '/api/offline/events/sync'), ('get', '/api/learning/program'),
    ('get', '/api/dashboard'), ('get', '/api/cards/submissions/unknown/image'),
    ('get', '/api/privacy/settings'), ('get', '/api/rfid/devices'),
])
def test_anonymous_access_denied_before_business_work(client, method, path):
    result = client.request(method, path, json={} if method == 'post' else None)
    assert result.status_code == 401
    assert result.headers['www-authenticate'] == 'Bearer'
    assert result.headers['x-request-id']
    assert result.json()['error']['request_id'] == result.headers['x-request-id']


def authenticated():
    app.dependency_overrides[current_user] = lambda: {'id': 'one', 'role': 'user', 'name': '합성 사용자', 'username': 'synthetic'}


def test_tts_binary_default_voice_rate_and_headers(client, monkeypatch):
    authenticated()
    # Valid synthetic 8 kHz mono PCM WAV with 20 samples, no recorded voice.
    wave = b'RIFF' + struct.pack('<I', 76) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, 8000, 16000, 2, 16) + b'data' + struct.pack('<I', 40) + bytes(40)
    calls = []
    def synthesize(text, rate, **kwargs):
        calls.append((text, rate, kwargs))
        return wave
    monkeypatch.setattr(router, 'synthesize_speech', synthesize)
    result = client.post('/api/tts/speech', json={'text': ' 물 '})
    assert result.status_code == 200 and result.content == wave
    assert result.headers['content-type'] == 'audio/wav'
    assert result.headers['cache-control'] == 'no-store'
    assert result.headers['x-content-type-options'] == 'nosniff'
    assert calls == [('물', .9, {'account_id': 'one', 'voice': 'girl'})]
    assert client.post('/api/tts/speech', json={'text': '물', 'rate': 5}).status_code == 422
    assert client.post('/api/tts/speech', json={'text': '  '}).status_code == 422


def test_image_conditional_request_reauthorizes_and_preserves_headers(client, monkeypatch, png_bytes):
    authenticated()
    calls = []
    def image(submission_id, user, variant):
        calls.append((submission_id, user['id'], variant))
        return png_bytes, 'image/png'
    monkeypatch.setattr(router, 'image_for', image)
    first = client.get('/api/cards/submissions/synthetic/image')
    etag = '"' + sha256(png_bytes).hexdigest() + '"'
    assert first.status_code == 200 and first.content == png_bytes
    assert first.headers['etag'] == etag and first.headers['vary'] == 'Authorization, Origin'
    assert first.headers['cache-control'] == 'private, no-cache'
    second = client.get('/api/cards/submissions/synthetic/image', headers={'If-None-Match': etag})
    assert second.status_code == 304 and not second.content
    assert len(calls) == 2


def test_sentence_validation_rejects_mismatched_selection_times(client):
    authenticated()
    response = client.post('/api/sentences', json={
        'cards': ['water', 'drink'], 'request_id': '00000000-0000-4000-8000-000000000001',
        'selected_at': ['2026-01-01T00:00:00Z'],
    })
    assert response.status_code == 422
