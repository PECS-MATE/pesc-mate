from io import BytesIO
import json
from urllib.error import HTTPError

import pytest
from app.services import model, communication, health


@pytest.fixture
def cloud(monkeypatch):
    monkeypatch.setenv('SENTENCE_PROVIDER', 'openrouter')
    monkeypatch.setenv('OPENROUTER_API_KEY', 'synthetic-key')
    monkeypatch.setenv('OPENROUTER_MODEL', 'qwen/qwen3-30b-a3b-instruct-2507')


def response(text='물을 마시고 싶어요.', reason='stop'):
    return BytesIO(json.dumps({'choices': [{'finish_reason': reason, 'message': {'content': text}}],
                               'usage': {'prompt_tokens': 100, 'completion_tokens': 12}}).encode())


def test_cloud_payload_and_metrics_skip_local_warmup(cloud, monkeypatch):
    calls = []
    def send(request, **kwargs):
        calls.append((request, kwargs))
        return response()
    monkeypatch.setattr(model, 'urlopen', send)
    metrics = {}
    assert not model.warmup()
    assert model.generate_sentence(['물', '마시다'], '물을 마셔요.', metrics=metrics) == ('물을 마시고 싶어요.', 'openrouter')
    request, options = calls[0]
    assert request.full_url == 'https://openrouter.ai/api/v1/chat/completions'
    assert request.get_header('Authorization') == 'Bearer synthetic-key'
    payload = json.loads(request.data)
    assert payload['model'] == model.status()['model']
    assert payload['reasoning']['enabled'] is False
    assert payload['max_tokens'] <= 128
    assert options['timeout'] == 8
    assert metrics['input_tokens'] == 100 and metrics['output_tokens'] == 12
    assert metrics['status'] == 'generated'


@pytest.mark.parametrize('body', [None, {}, {'choices': []}, {'choices': [None]},
    {'choices': [{'finish_reason': 'length', 'message': {'content': '물'}}]},
    {'choices': [{'finish_reason': 'stop', 'message': {'content': '첫째\n둘째'}}]}])
def test_invalid_response_falls_back(cloud, monkeypatch, body):
    monkeypatch.setattr(model, 'urlopen', lambda *a, **k: BytesIO(json.dumps(body).encode()))
    assert model.generate_sentence(['물'], '물 주세요.') == ('물 주세요.', 'rule')


@pytest.mark.parametrize('failure', [TimeoutError(), HTTPError('https://openrouter.ai', 402, 'Payment required', {}, None)])
def test_network_and_balance_errors_fall_back_without_local_model(cloud, monkeypatch, failure):
    calls = []
    def send(request, **kwargs):
        calls.append(request.full_url)
        raise failure
    monkeypatch.setattr(model, 'urlopen', send)
    assert model.generate_sentence(['물'], '물 주세요.') == ('물 주세요.', 'rule')
    assert calls == ['https://openrouter.ai/api/v1/chat/completions']


def test_missing_key_disables_generation_without_network(cloud, monkeypatch):
    monkeypatch.setenv('OPENROUTER_API_KEY', '')
    monkeypatch.setattr(model, 'urlopen', lambda *a, **k: pytest.fail('Unexpected request'))
    assert model.generate_sentence(['물'], '물 주세요.') == ('물 주세요.', 'rule')
    assert health._ollama_check()['detail'] == 'missing_api_key'


def test_cloud_sessions_validate_and_reuse_without_crossing_provider_boundary(cloud, consented, monkeypatch):
    from types import SimpleNamespace
    from uuid import uuid4
    calls = []
    def send(*args, **kwargs):
        calls.append(1)
        return response()
    monkeypatch.setattr(model, 'urlopen', send)
    def attempt():
        return SimpleNamespace(cards=['water', 'drink'], request_id=uuid4(), selected_at=None)
    first = communication.save_session(attempt(), 'one')
    second = communication.save_session(attempt(), 'one')
    assert first['generation_source'] == second['generation_source'] == 'openrouter'
    assert second['generation']['performance']['status'] == 'reused'
    assert len(calls) == 1
    consented.communication_sessions.update_many({}, {'$set': {'generation_source': 'ollama'}})
    communication.save_session(attempt(), 'one')
    assert len(calls) == 2
    monkeypatch.setattr(model, 'urlopen', lambda *a, **k: response('사과를 먹어요.'))
    bad = communication.save_session(attempt(), 'two')
    assert bad['generation_source'] == 'rule'
    assert bad['generation']['initial_source'] == 'openrouter'
