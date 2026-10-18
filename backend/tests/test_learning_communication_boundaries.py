"""Fail closed if a domain service even accesses the other domain's collection."""
from datetime import datetime, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi import HTTPException

from app.services import caregiver_notes, communication, learning, offline_events


class DomainDatabase:
    def __init__(self, *allowed):
        self.collections = {name: MagicMock(name=name) for name in allowed}
        for collection in self.collections.values():
            collection.find_one.return_value = None
            collection.find.return_value.sort.return_value = []

    def __getattr__(self, name):
        if name not in self.collections:
            raise AssertionError('Cross-domain collection access: ' + name)
        return self.collections[name]


class LearningCommunicationBoundaryTests(unittest.TestCase):
    def test_learning_writes_settings_and_audit_without_accessing_communication(self):
        database = DomainDatabase('learning_settings', 'learning_attempts', 'learning_audit_logs')
        with patch.object(learning, '_database', return_value=database):
            learning.settings_for('child')
            learning.save_settings('child', 'support', ['food'], 5, 3, 1, 60, True)
            learning.record_attempt('child', str(uuid4()), 'word_picture_match', 'food', 2, 1, 3)
            self.assertEqual(learning.progress_for('child')['attempts'], 0)
            self.assertEqual(learning.audit_for('child'), [])
        document = database.learning_attempts.insert_one.call_args.args[0]
        self.assertEqual(document['record_type'], 'learning_attempt')
        self.assertEqual(document['score'], 50)
        self.assertNotIn('sentence', document)
        database.learning_audit_logs.insert_one.assert_called_once()

    def test_communication_create_and_statistics_never_access_learning(self):
        database = DomainDatabase('communication_sessions')
        request = SimpleNamespace(cards=['help'], request_id=uuid4())
        with patch.object(communication, 'database', return_value=database), \
             patch.object(communication, 'generate_sentence', return_value=('도와주세요.', 'rule')):
            result = communication.save_session(request, 'child')
            self.assertEqual(communication.statistics('child')['sessions'], 0)
        document = database.communication_sessions.insert_one.call_args.args[0]
        self.assertEqual(result['cards'], ['help'])
        self.assertFalse({'score', 'items', 'correct_answers', 'activity_type'} & document.keys())
        self.assertEqual(database.communication_sessions.find.call_args.args[0], {'user_id': 'child'})

    def test_regeneration_only_reads_and_writes_communication(self):
        database = DomainDatabase('communication_sessions')
        original = {'_id': str(uuid4()), 'user_id': 'child', 'cards': ['help']}
        database.communication_sessions.find_one.side_effect = [original, None, None]
        database.communication_sessions.count_documents.return_value = 0
        with patch.object(communication, 'database', return_value=database), \
             patch.object(communication, 'generate_sentence', return_value=('도와주세요.', 'rule')):
            result = communication.regenerate_session(original['_id'], uuid4(), 'child')
        self.assertEqual(result['regeneration_of'], original['_id'])
        self.assertEqual(result['generation_attempt'], 2)
        database.communication_sessions.insert_one.assert_called_once()

    def test_learning_progress_requires_learning_record_type_user_and_own_timestamp(self):
        database = DomainDatabase('learning_attempts')
        now = datetime.now(timezone.utc)
        with patch.object(learning, '_database', return_value=database):
            learning.progress_for('child', days=7, now=now)
        query = database.learning_attempts.find.call_args.args[0]
        self.assertEqual(query['record_type'], 'learning_attempt')
        self.assertEqual(query['user_id'], 'child')
        self.assertIn('completed_at', query)
        self.assertNotIn('created_at', query)

    def test_offline_speech_is_not_promoted_to_sentence_or_learning_attempt(self):
        database = DomainDatabase('offline_events')
        event = {'id': uuid4(), 'event_type': 'immediate_speech', 'card_ids': ['help'],
                 'occurred_at': datetime.now(timezone.utc)}
        with patch.object(offline_events, '_database', return_value=database):
            result = offline_events.sync_events('child', [event])
        self.assertEqual(result['accepted_ids'], [str(event['id'])])
        database.offline_events.update_one.assert_called_once()

    def test_note_cannot_fall_back_to_learning_collection_for_unknown_session(self):
        database = DomainDatabase('communication_sessions')
        with patch.object(caregiver_notes, '_database', return_value=database):
            for action in (lambda: caregiver_notes.save_note('support', 'child', 'learning-id', '메모'),
                           lambda: caregiver_notes.delete_note('support', 'child', 'learning-id')):
                with self.assertRaises(HTTPException) as caught:
                    action()
                self.assertEqual(caught.exception.status_code, 404)


if __name__ == '__main__':
    unittest.main()
