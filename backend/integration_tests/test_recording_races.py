from datetime import datetime, timezone
import multiprocessing
from types import SimpleNamespace
from uuid import UUID

import pytest
from pymongo import MongoClient

pytestmark = pytest.mark.integration


def generate_while_consent_changes(uri, name, entered, release, outcomes):
    from app.services import communication, recording_guard
    from fastapi import HTTPException
    client = MongoClient(uri, tz_aware=True, serverSelectionTimeoutMS=3000)
    communication.database = lambda: client[name]
    recording_guard.database = lambda: client[name]
    def generate(labels, fallback, **kwargs):
        entered.set()
        if not release.wait(15):
            raise RuntimeError('test barrier timed out')
        return fallback, 'rule'
    communication.generate_sentence = generate
    try:
        request = SimpleNamespace(cards=['water', 'drink'], request_id=UUID(int=1), selected_at=None)
        try:
            communication.save_session(request, 'synthetic')
            outcomes.put(200)
        except HTTPException as exc:
            outcomes.put(exc.status_code)
    finally:
        client.close()


@pytest.mark.parametrize('consent,revision,expected', [(False, 2, 403), (True, 3, 409)])
def test_old_generation_cannot_write_after_withdrawal_or_delete_reconsent(mongo_db, mongo_config, monkeypatch, consent, revision, expected):
    from app.services import privacy
    monkeypatch.setattr(privacy, '_database', lambda: mongo_db)
    mongo_db.privacy_settings.insert_one({'_id': 'synthetic', 'guardian_consent': True, 'recording_revision': 1})
    context = multiprocessing.get_context('spawn')
    entered, release, outcomes = context.Event(), context.Event(), context.Queue()
    process = context.Process(target=generate_while_consent_changes,
        args=(*mongo_config, entered, release, outcomes))
    process.start()
    try:
        assert entered.wait(10)
        if consent:
            receipt = privacy.delete_personal_data('synthetic')
            assert receipt['deletion_status'] == 'completed'
            privacy.save_privacy('synthetic', True, 365)
        else:
            privacy.save_privacy('synthetic', False, 365)
        release.set(); process.join(10)
        assert process.exitcode == 0
        assert outcomes.get(timeout=2) == expected
        assert mongo_db.communication_sessions.count_documents({}) == 0
        assert mongo_db.image_storage_state.count_documents({'_id': 'image-writes'}) == 0
    finally:
        release.set(); process.join(2)
        if process.is_alive():
            process.terminate(); process.join(3)
        outcomes.close(); outcomes.join_thread()
        assert not process.is_alive()
