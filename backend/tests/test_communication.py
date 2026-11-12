from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException
from app.services import communication as communication

REQUEST_ID = UUID('00000000-0000-4000-8000-000000000001')


def request(cards=None):
    return SimpleNamespace(cards=cards or ['water', 'drink'], request_id=REQUEST_ID,
                           selected_at=[datetime(2026, 1, 1, tzinfo=timezone.utc), None])


@pytest.mark.parametrize('model_output,source', [('물 마셔요.', 'ollama'), ('사과 먹어요.', 'ollama'), ('물 마셔요.', 'rule')])
def test_generation_fallback_order_selection_times_and_idempotency(consented, monkeypatch, model_output, source):
    calls = []
    def generate(labels, fallback, **kwargs):
        calls.append(labels)
        return (fallback if source == 'rule' else model_output), source
    monkeypatch.setattr(communication, 'generate_sentence', generate)
    monkeypatch.setattr(communication, 'model_status', lambda: {'model': 'synthetic'})
    first = communication.save_session(request(), 'one')
    second = communication.save_session(request(), 'one')
    # BSON stores milliseconds; current first response retains microseconds.
    assert {k: v for k, v in first.items() if k != 'created_at'} == {k: v for k, v in second.items() if k != 'created_at'}
    assert abs((datetime.fromisoformat(first['created_at']) - datetime.fromisoformat(second['created_at'])).total_seconds()) < .001
    assert calls == [[communication.INDEX['water']['label'], communication.INDEX['drink']['label']]]
    document = consented.communication_sessions.find_one({'_id': str(REQUEST_ID)})
    assert document['cards'] == ['water', 'drink']
    assert document['card_selected_at'] == request().selected_at
    expected_source = 'rule' if model_output == '사과 먹어요.' else source
    assert document['generation_source'] == expected_source
    if expected_source == 'rule':
        assert document['sentence'] == communication.sentence(['water', 'drink'])
    with pytest.raises(HTTPException) as error:
        communication.save_session(request(['drink', 'water']), 'one')
    assert error.value.status_code == 409
    assert consented.communication_sessions.count_documents({}) == 1


def test_consent_withdrawal_during_generation_does_not_save(consented, monkeypatch):
    def generate(labels, fallback, **kwargs):
        consented.privacy_settings.update_one({'_id': 'one'}, {'$set': {'guardian_consent': False, 'recording_revision': 2}})
        return fallback, 'rule'
    monkeypatch.setattr(communication, 'generate_sentence', generate)
    with pytest.raises(HTTPException) as error:
        communication.save_session(request(), 'one')
    assert error.value.status_code == 403
    assert consented.communication_sessions.count_documents({}) == 0
    assert consented.image_storage_state.count_documents({'_id': 'image-writes'}) == 0


def test_delete_then_reconsent_invalidates_earlier_generation(consented, monkeypatch):
    def generate(labels, fallback, **kwargs):
        consented.privacy_settings.update_one({'_id': 'one'}, {'$inc': {'recording_revision': 2}})
        return fallback, 'rule'
    monkeypatch.setattr(communication, 'generate_sentence', generate)
    with pytest.raises(HTTPException) as error:
        communication.save_session(request(), 'one')
    assert error.value.status_code == 409
    assert consented.communication_sessions.count_documents({}) == 0
