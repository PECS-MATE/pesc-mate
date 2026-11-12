from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from pymongo.errors import AutoReconnect
from app.services import recording_guard, offline_events, learning, image_storage
from app.image_maintenance import maintain


def test_lock_conflict_exception_release_and_owner_token(db):
    with pytest.raises(RuntimeError):
        with image_storage.image_write_lock(db):
            lock = db.image_storage_state.find_one({'_id': 'image-writes'})
            assert lock['token'] and 'expires_at' not in lock
            with pytest.raises(HTTPException) as error:
                with image_storage.image_write_lock(db):
                    pytest.fail('second writer entered')
            assert error.value.status_code == 409
            raise RuntimeError('synthetic')
    assert db.image_storage_state.count_documents({}) == 0
    with image_storage.image_write_lock(db):
        db.image_storage_state.update_one({'_id': 'image-writes'}, {'$set': {'token': 'replacement'}})
    assert db.image_storage_state.find_one({'_id': 'image-writes'})['token'] == 'replacement'


def test_recovery_requires_exact_token_and_confirmation(db):
    db.image_storage_state.insert_one({'_id': 'image-writes', 'token': 'synthetic-owner'})
    for options in ({'lock_token': 'wrong'}, {'lock_token': None}):
        with pytest.raises(ValueError, match='exact_lock_token_required'):
            maintain(db, 'clear-lock', apply=True, confirm_database=db.name, writers_stopped=True, **options)
    with pytest.raises(ValueError, match='confirmation_required'):
        maintain(db, 'clear-lock', apply=True, lock_token='synthetic-owner')
    assert maintain(db, 'clear-lock')['lock_present']
    assert maintain(db, 'clear-lock', apply=True, confirm_database=db.name,
                    writers_stopped=True, lock_token='synthetic-owner')['locks_removed'] == 1


@pytest.mark.parametrize('state,expected', [({'guardian_consent': False}, 403),
    ({'deletion_status': 'in_progress'}, 409), ({'deletion_status': 'failed'}, 409), ({'recording_revision': 2}, 409)])
def test_recording_guard_rechecks_consent_and_revision(consented, state, expected):
    consented.privacy_settings.update_one({'_id': 'one'}, {'$set': state})
    with pytest.raises(HTTPException) as error:
        with recording_guard.recording_write('one', 1):
            pytest.fail('stale request entered write')
    assert error.value.status_code == expected
    assert consented.image_storage_state.count_documents({}) == 0


def test_offline_retransmission_is_idempotent_and_account_scoped(consented):
    event = {'id': 'synthetic-event', 'occurred_at': datetime.now(timezone.utc), 'action': 'card_selected'}
    assert offline_events.sync_events('one', [event]) == {'accepted_ids': ['synthetic-event']}
    assert offline_events.sync_events('one', [event]) == {'accepted_ids': ['synthetic-event']}
    assert consented.offline_events.count_documents({}) == 1
    with pytest.raises(HTTPException) as error:
        offline_events.sync_events('two', [event])
    assert error.value.status_code == 409
    with pytest.raises(HTTPException) as error:
        offline_events.sync_events('one', [{**event, 'id': 'future', 'occurred_at': datetime.now(timezone.utc) + timedelta(hours=1)}])
    assert error.value.status_code == 422


def test_learning_attempt_replay_and_cross_account_rejection(consented):
    args = dict(request_id='synthetic-attempt', activity_type='word_picture_match', category_id='food',
                total_questions=3, correct_answers=2, duration_seconds=10)
    first = learning.record_attempt('one', **args)
    assert learning.record_attempt('one', **args) == first
    assert first['score'] == 67 and first['incorrect_answers'] == 1
    assert consented.learning_attempts.count_documents({}) == 1
    with pytest.raises(HTTPException) as error:
        learning.record_attempt('two', **args)
    assert error.value.status_code == 409
