import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.services.caregiver_notes import delete_note, notes_for, save_note


class CaregiverNoteTests(unittest.TestCase):
    @patch('app.services.caregiver_notes._database')
    def test_note_can_be_saved_and_deleted(self, mocked_database):
        database = MagicMock()
        database.communication_sessions.find_one.return_value = {'_id': 'session'}
        mocked_database.return_value = database
        result = save_note('caregiver', 'demo', 'session', '물을 자주 찾음')
        self.assertEqual(result['content'], '물을 자주 찾음')
        database.caregiver_notes.update_one.assert_called_once()
        delete_note('caregiver', 'demo', 'session')
        database.caregiver_notes.delete_one.assert_called_once()

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


if __name__ == '__main__':
    unittest.main()
