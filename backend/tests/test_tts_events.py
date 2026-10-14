import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.services.tts_events import finish_event, start_event


class TtsEventTests(unittest.TestCase):
    @patch('app.services.tts_events._database')
    def test_request_is_recorded_for_user_without_text(self, mocked_database):
        database = MagicMock()
        mocked_database.return_value = database

        event = start_event('demo', 'request-id', 'card', 3)

        self.assertEqual(event['status'], 'requested')
        query, update = database.tts_events.update_one.call_args.args[:2]
        self.assertEqual(query, {'_id': 'request-id', 'user_id': 'demo'})
        self.assertNotIn('content', update['$setOnInsert'])
        self.assertTrue(database.tts_events.update_one.call_args.kwargs['upsert'])

    @patch('app.services.tts_events._database')
    def test_result_updates_only_matching_users_request(self, mocked_database):
        database = MagicMock()
        database.tts_events.update_one.return_value.matched_count = 1
        mocked_database.return_value = database

        result = finish_event('demo', 'request-id', 'succeeded', startup_ms=240)

        self.assertEqual(result['status'], 'succeeded')
        query, update = database.tts_events.update_one.call_args.args
        self.assertEqual(query, {'_id': 'request-id', 'user_id': 'demo', 'status': 'requested'})
        self.assertEqual(update['$set']['status'], 'succeeded')
        self.assertEqual(update['$set']['startup_ms'], 240)

    @patch('app.services.tts_events._database')
    def test_unknown_request_cannot_be_completed(self, mocked_database):
        database = MagicMock()
        database.tts_events.update_one.return_value.matched_count = 0
        mocked_database.return_value = database

        with self.assertRaises(HTTPException) as caught:
            finish_event('another-user', 'request-id', 'failed', 'synthesis-failed')

        self.assertEqual(caught.exception.status_code, 404)


if __name__ == '__main__':
    unittest.main()
