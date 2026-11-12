"""Real unique _id, separate processes and explicit synchronization barriers."""
import multiprocessing

import pytest
from fastapi import HTTPException
from pymongo import MongoClient

from app.services.image_storage import image_write_lock
from app.image_maintenance import maintain

pytestmark = pytest.mark.integration


def writer(uri, name, entered, release):
    client = MongoClient(uri, serverSelectionTimeoutMS=3000)
    try:
        with image_write_lock(client[name]):
            entered.set()
            if not release.wait(15):
                raise RuntimeError('test barrier timed out')
    finally:
        client.close()


def test_separate_process_conflict_release_and_recovery(mongo_db, mongo_config):
    context = multiprocessing.get_context('spawn')
    entered, release = context.Event(), context.Event()
    uri, name = mongo_config
    process = context.Process(target=writer, args=(uri, name, entered, release))
    process.start()
    try:
        assert entered.wait(10), 'writer failed to acquire lock'
        lock = mongo_db.image_storage_state.find_one({'_id': 'image-writes'})
        assert lock and 'expires_at' not in lock
        with pytest.raises(HTTPException) as error:
            with image_write_lock(mongo_db):
                pytest.fail('concurrent writer entered')
        assert error.value.status_code == 409
        release.set(); process.join(10)
        assert process.exitcode == 0
        assert mongo_db.image_storage_state.count_documents({'_id': 'image-writes'}) == 0
        # A second writer is killed while inside the critical section.
        entered.clear(); release.clear()
        process = context.Process(target=writer, args=(uri, name, entered, release))
        process.start(); assert entered.wait(10)
        lock = mongo_db.image_storage_state.find_one({'_id': 'image-writes'})
        process.terminate(); process.join(10)
        assert not process.is_alive()
        assert mongo_db.image_storage_state.find_one({'_id': 'image-writes'})['token'] == lock['token']
        with pytest.raises(ValueError, match='exact_lock_token_required'):
            maintain(mongo_db, 'clear-lock', apply=True, confirm_database=name, writers_stopped=True, lock_token='wrong')
        assert maintain(mongo_db, 'clear-lock', apply=True, confirm_database=name,
                        writers_stopped=True, lock_token=lock['token'])['locks_removed'] == 1
        with image_write_lock(mongo_db):
            mongo_db.synthetic_probe.insert_one({'_id': 'recovered'})
        assert mongo_db.synthetic_probe.count_documents({}) == 1
    finally:
        # A terminated process may die holding Event internals on Windows.
        # Never signal a synchronization primitive after terminating its waiter.
        if process.is_alive():
            release.set()
        process.join(2)
        if process.is_alive():
            process.terminate(); process.join(3)
        assert not process.is_alive(), 'owned writer process did not terminate'


def test_exception_release_and_foreign_owner_are_preserved(mongo_db):
    with pytest.raises(RuntimeError):
        with image_write_lock(mongo_db):
            raise RuntimeError('synthetic exception')
    assert mongo_db.image_storage_state.count_documents({}) == 0
    with image_write_lock(mongo_db):
        mongo_db.image_storage_state.update_one({'_id': 'image-writes'}, {'$set': {'token': 'other-owner'}})
    assert mongo_db.image_storage_state.find_one({'_id': 'image-writes'})['token'] == 'other-owner'
