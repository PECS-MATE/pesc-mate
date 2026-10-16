import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.services.tts_events import finish_event, start_event


class TtsEventTests(unittest.TestCase):
    @patch('app.services.tts_events._database')
    def test_request_is_recorded_for_user_without_text(self, mocked_database):
        database = MagicMock()
        database.tts_events.find_one_and_update.return_value = {'_id': 'request-id', 'status': 'requested'}
        mocked_database.return_value = database

        event = start_event('demo', 'request-id', 'card', 3)

        self.assertEqual(event['status'], 'requested')
        query, update = database.tts_events.find_one_and_update.call_args.args[:2]
        self.assertEqual(query, {'_id': 'request-id', 'user_id': 'demo'})
        self.assertNotIn('content', update['$setOnInsert'])
        self.assertTrue(database.tts_events.find_one_and_update.call_args.kwargs['upsert'])
        self.assertEqual(database.tts_events.find_one_and_update.call_args.kwargs['return_document'], ReturnDocument.AFTER)

    @patch('app.services.tts_events._database')
    def test_result_updates_only_matching_users_request(self, mocked_database):
        database = MagicMock()
        database.tts_events.find_one_and_update.return_value = {
            '_id': 'request-id', 'status': 'succeeded', 'startup_ms': 240,
        }
        mocked_database.return_value = database

        result = finish_event('demo', 'request-id', 'succeeded', startup_ms=240)

        self.assertEqual(result['status'], 'succeeded')
        query, update = database.tts_events.find_one_and_update.call_args.args
        self.assertEqual(query, {'_id': 'request-id', 'user_id': 'demo', 'status': 'requested'})
        self.assertEqual(update['$set']['status'], 'succeeded')
        self.assertEqual(update['$set']['startup_ms'], 240)

    @patch('app.services.tts_events._database')
    def test_unknown_request_cannot_be_completed(self, mocked_database):
        database = MagicMock()
        database.tts_events.find_one_and_update.return_value = None
        database.tts_events.find_one.return_value = None
        mocked_database.return_value = database

        with self.assertRaises(HTTPException) as caught:
            finish_event('another-user', 'request-id', 'failed', 'synthesis-failed')

        self.assertEqual(caught.exception.status_code, 404)

    @patch('app.services.tts_events._database')
    def test_repeated_start_returns_stored_result_without_resetting_it(self, mocked_database):
        collection = mocked_database.return_value.tts_events
        collection.find_one_and_update.return_value = {
            '_id': 'request-id', 'status': 'succeeded', 'startup_ms': 240,
        }
        event = start_event('demo', 'request-id', 'preview', 20)
        self.assertEqual(event['status'], 'succeeded')
        self.assertEqual(event['startup_ms'], 240)
        self.assertEqual(set(collection.find_one_and_update.call_args.args[1]), {'$setOnInsert'})

    @patch('app.services.tts_events._database')
    def test_replayed_completion_preserves_the_first_result_and_user_scope(self, mocked_database):
        collection = mocked_database.return_value.tts_events
        collection.find_one_and_update.return_value = None
        collection.find_one.return_value = {
            '_id': 'request-id', 'status': 'succeeded', 'startup_ms': 240,
        }
        result = finish_event('demo', 'request-id', 'failed', 'changed-result', startup_ms=999)
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(result['startup_ms'], 240)
        collection.find_one.assert_called_once_with({'_id': 'request-id', 'user_id': 'demo'})
        self.assertNotIn('user_id', result)

    @patch('app.services.tts_events._database')
    def test_losing_concurrent_completion_returns_the_winning_result(self, mocked_database):
        collection = mocked_database.return_value.tts_events
        winner = {'_id': 'request-id', 'status': 'succeeded', 'startup_ms': 0}
        collection.find_one_and_update.side_effect = [winner, None]
        collection.find_one.return_value = winner
        first = finish_event('demo', 'request-id', 'succeeded', startup_ms=0)
        second = finish_event('demo', 'request-id', 'failed', 'late-error')
        self.assertEqual(first, second)
        for call in collection.find_one_and_update.call_args_list:
            self.assertEqual(call.args[0]['status'], 'requested')

    @patch('app.services.tts_events._database')
    def test_start_id_cannot_be_reused_by_another_user(self, mocked_database):
        mocked_database.return_value.tts_events.find_one_and_update.side_effect = DuplicateKeyError('private-id')
        with self.assertRaises(HTTPException) as caught:
            start_event('another-user', 'request-id', 'card', 3)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertNotIn('private-id', caught.exception.detail)

    @patch('app.services.tts_events._database')
    def test_database_failure_returns_safe_service_unavailable(self, mocked_database):
        mocked_database.return_value.tts_events.find_one_and_update.side_effect = PyMongoError('private-token')
        for action in (lambda: start_event('demo', 'request-id', 'card', 3),
                       lambda: finish_event('demo', 'request-id', 'succeeded')):
            with self.assertRaises(HTTPException) as caught:
                action()
            self.assertEqual(caught.exception.status_code, 503)
            self.assertNotIn('private-token', caught.exception.detail)

    @patch('app.services.tts_events._database')
    def test_stored_utc_dates_keep_the_api_timezone(self, mocked_database):
        mocked_database.return_value.tts_events.find_one_and_update.return_value = {
            '_id': 'request-id', 'status': 'succeeded',
            'requested_at': datetime(2026, 10, 17), 'completed_at': datetime(2026, 10, 17, 0, 1),
        }
        result = start_event('demo', 'request-id', 'card', 3)
        self.assertEqual(result['requested_at'].tzinfo, timezone.utc)
        self.assertEqual(result['completed_at'].tzinfo, timezone.utc)


if __name__ == '__main__':
    unittest.main()
