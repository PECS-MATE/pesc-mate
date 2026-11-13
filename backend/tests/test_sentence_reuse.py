from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from app.services import communication


def attempt(cards=None):
    return SimpleNamespace(cards=cards or ['water', 'drink'], request_id=uuid4(), selected_at=None)


@pytest.fixture
def ai(monkeypatch):
    calls = []
    def generate(labels, fallback, **kwargs):
        calls.append(labels)
        return '물을 마시고 싶어요.', 'ollama'
    monkeypatch.setattr(communication, 'model_status', lambda: {'enabled': True, 'model': 'synthetic-ai'})
    monkeypatch.setattr(communication, 'generate_sentence', generate)
    return calls


def test_same_account_combination_reuses_ai_but_saves_a_new_event(consented, ai):
    first = communication.save_session(attempt(), 'one')
    second_request = attempt()
    second = communication.save_session(second_request, 'one')
    assert len(ai) == 1
    assert second['id'] != first['id'] and second['sentence'] == first['sentence']
    assert second['generation']['performance']['status'] == 'reused'
    assert consented.communication_sessions.count_documents({'user_id': 'one'}) == 2
    replay = communication.save_session(second_request, 'one')
    # Existing BSON date precision is milliseconds; the original first response is finer.
    assert {k: v for k, v in replay.items() if k != 'created_at'} == {k: v for k, v in second.items() if k != 'created_at'}
    assert abs((datetime.fromisoformat(replay['created_at']) - datetime.fromisoformat(second['created_at'])).total_seconds()) < .001


def test_account_boundary_order_and_explicit_regeneration_do_not_reuse(consented, ai):
    first = communication.save_session(attempt(), 'one')
    communication.save_session(attempt(), 'two')
    communication.save_session(attempt(['drink', 'water']), 'one')
    communication.save_session(attempt(), 'one', regeneration_of=first['id'])
    assert len(ai) == 4


@pytest.mark.parametrize('change', ['expired', 'model', 'policy', 'unsafe', 'format', 'rule'])
def test_stale_or_invalid_ai_is_not_reused(consented, ai, monkeypatch, change):
    first = communication.save_session(attempt(), 'one')
    updates = {
        'expired': {'created_at': datetime.now(timezone.utc) - timedelta(minutes=10)},
        'model': {'generation.model': 'different-model'},
        'policy': {'generation.versions': {}},
        'unsafe': {'sentence': '물 마시다 전화번호는 010-0000-0000'},
        'format': {'sentence': '물 마시다\n물'},
        'rule': {'generation_source': 'rule'},
    }
    consented.communication_sessions.update_one({'_id': first['id']}, {'$set': updates[change]})
    communication.save_session(attempt(), 'one')
    assert len(ai) == 2


def test_changed_custom_card_metadata_is_not_reused(consented, ai):
    card = {'id': 'custom:synthetic', 'label': '물', 'meaning': '합성 카드', 'category': '음식'}
    communication.save_session(attempt(['custom:synthetic', 'drink']), 'one', [card])
    communication.save_session(attempt(['custom:synthetic', 'drink']), 'one', [{**card, 'meaning': '수정된 의미'}])
    assert len(ai) == 2


def test_reuse_still_rechecks_consent_before_writing(consented, ai, monkeypatch):
    communication.save_session(attempt(), 'one')
    original = communication._recent_ai_sentence
    def withdraw(*args):
        sentence = original(*args)
        consented.privacy_settings.update_one({'_id': 'one'}, {'$set': {'guardian_consent': False}, '$inc': {'recording_revision': 1}})
        return sentence
    monkeypatch.setattr(communication, '_recent_ai_sentence', withdraw)
    with pytest.raises(HTTPException) as error:
        communication.save_session(attempt(), 'one')
    assert error.value.status_code == 403
    assert len(ai) == 1 and consented.communication_sessions.count_documents({}) == 1
