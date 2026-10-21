import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.services.caregiver_notes import delete_note, note_history, notes_for, save_note


class CaregiverNoteTests(unittest.TestCase):
    @patch('app.services.caregiver_notes._database')
    def test_note_can_be_saved_and_deleted(self, mocked_database):
        database = MagicMock()
        database.communication_sessions.find_one.return_value = {'_id': 'session'}
        mocked_database.return_value = database
        database.caregiver_notes.find_one.return_value = None
        result = save_note('caregiver', 'demo', 'session', '물을 자주 찾음')
        self.assertEqual(result['content'], '물을 자주 찾음')
        database.caregiver_notes.insert_one.assert_called_once()
        document = database.caregiver_notes.insert_one.call_args.args[0]
        database.caregiver_notes.find_one.return_value = document
        database.caregiver_notes.replace_one.return_value.matched_count = 1
        delete_note('caregiver', 'demo', 'session')
        deleted = database.caregiver_notes.replace_one.call_args.args[1]
        self.assertTrue(deleted['deleted'])
        self.assertIsNone(deleted['content'])
        self.assertTrue(all(item['content'] is None for item in deleted['history']))

    @patch('app.services.caregiver_notes._database')
    def test_note_rejects_unknown_session(self, mocked_database):
        database = MagicMock()
        database.communication_sessions.find_one.return_value = None
        mocked_database.return_value = database
        with self.assertRaises(HTTPException) as caught:
            save_note('caregiver', 'demo', 'missing', '메모')
        self.assertEqual(caught.exception.status_code, 404)

    @patch('app.services.caregiver_notes._database')
    def test_notes_are_scoped_to_caregiver_and_user(self, mocked_database):
        database = MagicMock()
        database.caregiver_notes.find.return_value = [
            {'session_id': 'one', 'content': '메모 1'}, {'session_id': 'two', 'content': '메모 2'}]
        mocked_database.return_value = database
        self.assertEqual(notes_for('caregiver', 'demo', ['one', 'two']), {'one': '메모 1', 'two': '메모 2'})
        query = database.caregiver_notes.find.call_args.args[0]
        self.assertEqual(query['caregiver_id'], 'caregiver')
        self.assertEqual(query['user_id'], 'demo')

    @patch('app.services.caregiver_notes._database')
    def test_history_conflict_and_delete_erase_all_old_bodies(self, mocked_database):
        database = mocked_database.return_value
        database.communication_sessions.find_one.return_value = {'_id': 'session'}
        database.caregiver_notes.find_one.return_value = None
        first = save_note('author', 'child', 'session', 'first', 0)
        document = database.caregiver_notes.insert_one.call_args.args[0]
        self.assertEqual(first['revision'], 1)
        database.caregiver_notes.find_one.return_value = document
        with self.assertRaises(HTTPException) as caught:
            save_note('author', 'child', 'session', 'stale', 0)
        self.assertEqual(caught.exception.status_code, 409)
        database.caregiver_notes.replace_one.return_value.matched_count = 1
        save_note('author', 'child', 'session', 'second', 1)
        document = database.caregiver_notes.replace_one.call_args.args[1]
        database.caregiver_notes.find_one.return_value = document
        self.assertEqual([row['content'] for row in note_history('author', 'child', 'session')['history']], ['first', 'second'])
        delete_note('author', 'child', 'session', 2)
        deleted = database.caregiver_notes.replace_one.call_args.args[1]
        self.assertEqual(deleted['revision'], 3)
        self.assertTrue(all(row['content'] is None for row in deleted['history']))
        self.assertTrue(all(row['author_id'] == 'author' for row in deleted['history']))

    @patch('app.services.caregiver_notes._database')
    def test_concurrent_update_cannot_overwrite_winner(self, mocked_database):
        database = mocked_database.return_value
        database.communication_sessions.find_one.return_value = {'_id': 'session'}
        database.caregiver_notes.find_one.return_value = {
            '_id': 'author:session', 'user_id': 'child', 'caregiver_id': 'author', 'session_id': 'session',
            'revision': 4, 'content': 'winning note',
        }
        database.caregiver_notes.replace_one.return_value.matched_count = 0
        with self.assertRaises(HTTPException) as caught:
            save_note('author', 'child', 'session', 'losing note', 4)
        self.assertEqual(caught.exception.status_code, 409)
        query = database.caregiver_notes.replace_one.call_args.args[0]
        self.assertEqual(query['revision'], 4)
        self.assertEqual(query['caregiver_id'], 'author')

    @patch('app.services.caregiver_notes._database')
    def test_mongodb_utc_note_timestamps_keep_timezone_for_tablets(self, mocked_database):
        database = mocked_database.return_value
        database.communication_sessions.find_one.return_value = {'_id': 'session'}
        database.caregiver_notes.find_one.return_value = {
            '_id': 'author:session', 'user_id': 'child', 'caregiver_id': 'author', 'session_id': 'session',
            'content': 'synthetic', 'updated_at': datetime(2026, 10, 21),
            'history': [{'revision': 1, 'created_at': datetime(2026, 10, 21), 'content': 'synthetic'}],
        }
        history = note_history('author', 'child', 'session')
        self.assertEqual(history['updated_at'].tzinfo, timezone.utc)
        self.assertEqual(history['history'][0]['created_at'].tzinfo, timezone.utc)


if __name__ == '__main__':
    unittest.main()
