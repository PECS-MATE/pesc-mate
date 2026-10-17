from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import unittest
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.api.router import api_router
from app.services.authentication import current_user
from app.services.learning import record_attempt
from app.services.observability import configure_observability
from app.services.offline_events import sync_events
from app.services.offline_sync_metrics import KINDS, OfflineSyncMetrics


def event():
    return {'id': uuid4(), 'event_type': 'immediate_speech', 'card_ids': ['help'],
            'occurred_at': datetime.now(timezone.utc)}


class OfflineSyncMetricsTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.metrics = OfflineSyncMetrics(clock=lambda: self.now)

    def test_empty_window_has_no_claimed_success_rate(self):
        result = self.metrics.snapshot()
        self.assertIsNone(result['totals']['operation_failure_rate'])
        self.assertEqual([row['kind'] for row in result['by_kind']], list(KINDS))

    def test_inserted_and_duplicate_items_are_distinct_from_retry_candidates(self):
        with self.metrics.measure('communication', 3, 2) as observation:
            observation.accepted(True)
            observation.accepted(False)
            observation.accepted(False)
        totals = self.metrics.snapshot()['totals']
        self.assertEqual((totals['received'], totals['retried'], totals['inserted'], totals['duplicates']), (3, 2, 1, 2))
        self.assertEqual(totals['operation_failure_rate'], 0)

    def test_partial_failure_keeps_processed_failed_and_unprocessed_separate(self):
        with self.assertRaises(HTTPException):
            with self.metrics.measure('communication', 4, 1) as observation:
                observation.accepted(True)
                observation.accepted(False)
                raise HTTPException(503, 'private-database-detail')
        totals = self.metrics.snapshot()['totals']
        self.assertEqual(totals['failed'], 1)
        self.assertEqual(totals['unprocessed'], 1)
        self.assertEqual(totals['received'], sum(totals[key] for key in ('inserted', 'duplicates', 'failed', 'unprocessed')))
        self.assertEqual(totals['errors']['database'], 1)
        self.assertEqual(totals['operation_failure_rate'], 1)
        self.assertNotIn('private-database-detail', json.dumps(totals))

    def test_error_labels_do_not_retain_exception_details(self):
        for status in (409, 422, 500):
            with self.assertRaises(HTTPException):
                with self.metrics.measure('learning', 1):
                    raise HTTPException(status, 'secret-token-user')
        with self.assertRaises(RuntimeError):
            with self.metrics.measure('learning', 1):
                raise RuntimeError('private-runtime-value')
        result = self.metrics.snapshot()
        self.assertEqual(result['totals']['errors'], {'conflict': 1, 'database': 0, 'validation': 1, 'internal': 2})
        self.assertNotIn('secret-token-user', json.dumps(result))
        self.assertNotIn('private-runtime-value', json.dumps(result))

    def test_fixed_window_expires_idle_buckets_and_resets_on_restart(self):
        for minute in range(30):
            self.now = minute * 60
            with self.metrics.measure('communication', 1) as observation:
                observation.accepted(True)
        self.assertEqual(len(self.metrics._buckets), 15)
        self.assertEqual(self.metrics.snapshot()['totals']['received'], 15)
        self.now += 900
        self.assertEqual(self.metrics.snapshot()['totals']['received'], 0)
        self.assertEqual(OfflineSyncMetrics().snapshot()['totals']['received'], 0)

    def test_concurrent_operations_do_not_lose_counts(self):
        def record(_index):
            with self.metrics.measure('learning', 1, 1) as observation:
                observation.accepted(False)
        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(record, range(200)))
        totals = self.metrics.snapshot()['totals']
        self.assertEqual((totals['operations'], totals['duplicates'], totals['retried']), (200, 200, 200))

    def test_metric_collection_failure_does_not_change_operation_result_or_error(self):
        with patch.object(self.metrics, 'record', side_effect=RuntimeError('private-collector')):
            with self.assertLogs('uvicorn.error', level='WARNING') as logs:
                with self.metrics.measure('learning', 1) as observation:
                    observation.accepted(True)
                with self.assertRaises(HTTPException) as caught:
                    with self.metrics.measure('learning', 1):
                        raise HTTPException(409, 'original')
        self.assertEqual(caught.exception.status_code, 409)
        self.assertNotIn('private-collector', '\n'.join(logs.output))

    @patch('app.services.offline_events._database')
    def test_event_database_failure_retains_partial_batch_counts(self, database):
        collection = database.return_value.offline_events
        collection.find_one.return_value = None
        collection.update_one.side_effect = [MagicMock(upserted_id='new'), PyMongoError('private-db')]
        with self.assertRaises(HTTPException) as caught:
            with self.metrics.measure('communication', 3) as observation:
                sync_events('child', [event(), event(), event()], observation)
        self.assertEqual(caught.exception.status_code, 503)
        totals = self.metrics.snapshot()['totals']
        self.assertEqual((totals['inserted'], totals['failed'], totals['unprocessed']), (1, 1, 1))

    @patch('app.services.offline_events._database')
    def test_concurrent_upsert_winner_is_a_duplicate_not_a_failure(self, database):
        collection = database.return_value.offline_events
        collection.find_one.side_effect = [None, {'user_id': 'child'}]
        collection.update_one.side_effect = DuplicateKeyError('private-id')
        with self.metrics.measure('communication', 1) as observation:
            result = sync_events('child', [event()], observation)
        self.assertEqual(len(result['accepted_ids']), 1)
        self.assertEqual(self.metrics.snapshot()['totals']['duplicates'], 1)

    @patch('app.services.offline_events._database')
    def test_other_owner_wins_upsert_race_and_returns_conflict(self, database):
        collection = database.return_value.offline_events
        collection.find_one.side_effect = [None, {'user_id': 'other'}]
        collection.update_one.side_effect = DuplicateKeyError('private-id')
        with self.assertRaises(HTTPException) as caught:
            with self.metrics.measure('communication', 1) as observation:
                sync_events('child', [event()], observation)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(self.metrics.snapshot()['totals']['errors']['conflict'], 1)

    @patch('app.services.learning._database')
    def test_learning_insert_replay_and_race_are_observed_without_result_changes(self, database):
        collection = database.return_value.learning_attempts
        collection.find_one.return_value = None
        with self.metrics.measure('learning', 1) as observation:
            first = record_attempt('child', 'request', 'word_picture_match', 'food', 1, 1, 2, observation=observation)
        document = collection.insert_one.call_args.args[0]
        collection.find_one.return_value = document
        with self.metrics.measure('learning', 1, 1) as observation:
            replay = record_attempt('child', 'request', 'word_picture_match', 'food', 1, 1, 2, observation=observation)
        collection.find_one.side_effect = [None, document]
        collection.insert_one.side_effect = DuplicateKeyError('private-id')
        with self.metrics.measure('learning', 1, 1) as observation:
            race = record_attempt('child', 'request', 'word_picture_match', 'food', 1, 1, 2, observation=observation)
        self.assertEqual(first, replay)
        self.assertEqual(first, race)
        totals = self.metrics.snapshot()['totals']
        self.assertEqual((totals['inserted'], totals['duplicates']), (1, 2))

    @patch('app.services.learning._database')
    def test_learning_race_lookup_database_error_is_a_safe_503(self, database):
        collection = database.return_value.learning_attempts
        collection.find_one.side_effect = [None, PyMongoError('private-db')]
        collection.insert_one.side_effect = DuplicateKeyError('private-id')
        with self.assertRaises(HTTPException) as caught:
            with self.metrics.measure('learning', 1) as observation:
                record_attempt('child', 'request', 'word_picture_match', 'food', 1, 1, 2, observation=observation)
        self.assertEqual(caught.exception.status_code, 503)
        self.assertNotIn('private-db', caught.exception.detail)
        self.assertEqual(self.metrics.snapshot()['totals']['errors']['database'], 1)


class OfflineSyncMetricsEndpointTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        configure_observability(self.app)
        self.app.include_router(api_router, prefix='/api')
        self.client = TestClient(self.app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)

    def test_only_operator_can_read_counters_and_responses_are_not_cached(self):
        self.assertEqual(self.client.get('/api/admin/offline-sync-metrics').status_code, 401)
        for role in ('user', 'caregiver', 'support_staff'):
            self.app.dependency_overrides[current_user] = lambda: {'id': 'account', 'role': role}
            self.assertEqual(self.client.get('/api/admin/offline-sync-metrics').status_code, 403)
        self.app.dependency_overrides[current_user] = lambda: {
            'id': 'operator', 'role': 'support_staff', 'account_permissions': ['content_manage'],
        }
        response = self.client.get('/api/admin/offline-sync-metrics')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(response.json()['scope'], 'process')

    @patch('app.api.router.require_guardian_consent')
    @patch('app.api.router.sync_events')
    def test_retry_headers_are_bounded_and_do_not_modify_event_payload(self, sync, _consent):
        self.app.dependency_overrides[current_user] = lambda: {'id': 'child', 'role': 'user'}
        item = event()
        body = {'events': [{**item, 'id': str(item['id']), 'occurred_at': item['occurred_at'].isoformat()}]}
        for value in ('-1', '101', '2', 'secret'):
            response = self.client.post('/api/offline/events/sync', json=body, headers={'X-Pesc-Sync-Retried': value})
            self.assertEqual(response.status_code, 422)
        sync.assert_not_called()

        def accept(_user, events, observation):
            self.assertNotIn('sync_attempted', events[0])
            observation.accepted(False)
            return {'accepted_ids': [str(events[0]['id'])]}
        sync.side_effect = accept
        response = self.client.post('/api/offline/events/sync', json=body, headers={'X-Pesc-Sync-Retried': '1'})
        self.assertEqual(response.status_code, 200)
        totals = self.app.state.offline_sync_metrics.snapshot()['totals']
        self.assertEqual((totals['received'], totals['retried'], totals['duplicates']), (1, 1, 1))

    @patch('app.api.router.require_guardian_consent')
    @patch('app.api.router.record_learning_attempt')
    def test_online_learning_is_not_counted_as_offline_and_header_mismatch_is_rejected(self, record, _consent):
        self.app.dependency_overrides[current_user] = lambda: {'id': 'child', 'role': 'user'}
        body = {'request_id': str(uuid4()), 'activity_type': 'word_picture_match', 'category_id': 'food',
                'total_questions': 1, 'correct_answers': 1, 'duration_seconds': 2}
        record.side_effect = HTTPException(422, 'fixture validation failure')
        self.assertEqual(self.client.post('/api/learning/attempts', json=body).status_code, 422)
        self.assertEqual(self.app.state.offline_sync_metrics.snapshot()['totals']['operations'], 0)
        self.assertEqual(self.client.post('/api/learning/attempts', json=body, headers={'X-Pesc-Sync-Retried': '1'}).status_code, 422)
        self.assertEqual(record.call_count, 1)
        response = self.client.post('/api/learning/attempts', json=body, headers={'X-Pesc-Offline-Sync': 'true', 'X-Pesc-Sync-Retried': '1'})
        self.assertEqual(response.status_code, 422)
        totals = self.app.state.offline_sync_metrics.snapshot()['totals']
        self.assertEqual((totals['operations'], totals['retried'], totals['errors']['validation']), (1, 1, 1))
