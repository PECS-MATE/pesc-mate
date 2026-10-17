from datetime import datetime, timedelta, timezone
import json
import unittest
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pymongo.errors import ExecutionTimeout

from app.api.router import api_router
from app.services.authentication import current_user
from app.services.observability import configure_observability
from app.services.operational_alerts import operational_report, review_queue


class OperationalAlertsTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 17, tzinfo=timezone.utc)
        self.queue_patch = patch('app.services.operational_alerts.review_queue', return_value={
            'status': 'ok', 'pending': 0, 'oldest_at': None,
        })
        self.queue = self.queue_patch.start()
        self.addCleanup(self.queue_patch.stop)
        self.tts_patch = patch('app.services.operational_alerts.tts_report', return_value={
            'totals': {'failed': 0, 'resolved': 0},
        })
        self.tts = self.tts_patch.start()
        self.addCleanup(self.tts_patch.stop)
        self.api = MagicMock()
        self.api.snapshot.return_value = {'window_seconds': 900, 'totals': {
            'server_errors': 0, 'transfer_errors': 0, 'requests': 0,
        }}
        self.sync = MagicMock()
        self.sync.snapshot.return_value = {'window_seconds': 900, 'totals': {
            'failed_operations': 0, 'operations': 0,
        }}

    def report(self):
        return operational_report(self.api, self.sync, now=self.now)

    def test_no_samples_have_no_alert_but_do_not_claim_device_health(self):
        result = self.report()
        self.assertEqual(result['alerts'], [])
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['sources']['tts']['resolved'], 0)
        self.tts.assert_called_once_with(hours=1, now=self.now)

    def test_pending_review_is_info_until_24_hour_boundary(self):
        for age, severity in ((23, 'info'), (24, 'warning'), (25, 'warning')):
            with self.subTest(age=age):
                self.queue.return_value = {'status': 'ok', 'pending': 12,
                                          'oldest_at': (self.now - timedelta(hours=age)).isoformat()}
                alert = self.report()['alerts'][0]
                self.assertEqual(alert['code'], 'review_pending')
                self.assertEqual(alert['count'], 12)
                self.assertEqual(alert['severity'], severity)
                self.assertEqual(alert['action'], 'review')

    def test_missing_review_date_does_not_invent_oldest_age(self):
        self.queue.return_value = {'status': 'ok', 'pending': 1, 'oldest_at': None}
        result = self.report()
        self.assertIsNone(result['sources']['review_queue']['oldest_at'])
        self.assertEqual(result['alerts'][0]['severity'], 'info')

    def test_failures_below_threshold_do_not_alert(self):
        self.api.snapshot.return_value['totals'].update(server_errors=2, requests=3, client_errors=100)
        self.tts.return_value['totals'].update(failed=2, resolved=2)
        self.sync.snapshot.return_value['totals'].update(failed_operations=2, operations=2)
        self.assertEqual(self.report()['alerts'], [])

    def test_repeated_failures_include_transfer_errors_but_not_client_errors(self):
        self.api.snapshot.return_value['totals'].update(server_errors=2, transfer_errors=1, requests=6, client_errors=99)
        self.tts.return_value['totals'].update(failed=3, resolved=5, cancelled=100, requested=100)
        self.sync.snapshot.return_value['totals'].update(failed_operations=3, operations=4, duplicates=100)
        result = self.report()
        self.assertEqual([alert['code'] for alert in result['alerts']], [
            'api_repeated_failure', 'tts_repeated_failure', 'offline_sync_repeated_failure',
        ])
        self.assertTrue(all(alert['count'] == 3 for alert in result['alerts']))
        self.assertEqual(result['sources']['tts']['window_seconds'], 3600)
        self.assertEqual(result['sources']['api']['window_seconds'], 900)

    def test_source_failure_is_not_a_zero_and_other_alerts_survive(self):
        self.queue.side_effect = HTTPException(503, 'private-db-query')
        self.tts.side_effect = HTTPException(503, 'private-tts-data')
        self.sync.snapshot.return_value['totals'].update(failed_operations=3, operations=3)
        result = self.report()
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(result['sources']['review_queue'], {'status': 'unavailable'})
        self.assertEqual(result['sources']['tts'], {'status': 'unavailable'})
        self.assertIn('offline_sync_repeated_failure', [alert['code'] for alert in result['alerts']])
        self.assertNotIn('private', json.dumps(result))

    def test_metric_snapshot_failures_are_isolated(self):
        self.api.snapshot.side_effect = RuntimeError('secret-api-data')
        self.sync.snapshot.side_effect = RuntimeError('secret-sync-data')
        result = self.report()
        self.assertEqual(result['status'], 'partial')
        self.assertEqual([alert['code'] for alert in result['alerts']], ['api_unavailable', 'offline_sync_unavailable'])
        self.assertNotIn('secret', json.dumps(result))

    def test_repeated_reads_have_one_alert_per_code_and_resolve_without_acknowledgement(self):
        self.tts.return_value['totals'].update(failed=3, resolved=3)
        for _ in range(3):
            self.assertEqual(len(self.report()['alerts']), 1)
        self.tts.return_value['totals'].update(failed=0, resolved=0)
        self.assertEqual(self.report()['alerts'], [])


class ReviewQueueTests(unittest.TestCase):
    @patch('app.services.operational_alerts._database')
    def test_only_shared_pending_counts_are_aggregated_without_returning_images(self, database):
        database.return_value.card_submissions.aggregate.return_value = [
            {'_id': None, 'pending': 12, 'oldest': datetime(2026, 10, 16)},
        ]
        result = review_queue()
        self.assertEqual(result, {'status': 'ok', 'pending': 12, 'oldest_at': '2026-10-16T00:00:00+00:00'})
        args = database.return_value.card_submissions.aggregate.call_args
        self.assertEqual(args.args[0][0], {'$match': {'visibility': 'shared', 'status': 'pending'}})
        self.assertEqual(args.kwargs['maxTimeMS'], 2000)
        self.assertNotIn('image', json.dumps(args.args[0]))
        self.assertNotIn('owner_id', json.dumps(args.args[0]))

    @patch('app.services.operational_alerts._database')
    def test_empty_queue_is_known_zero(self, database):
        database.return_value.card_submissions.aggregate.return_value = []
        self.assertEqual(review_queue(), {'status': 'ok', 'pending': 0, 'oldest_at': None})

    @patch('app.services.operational_alerts._database')
    def test_database_timeout_has_safe_error_not_zero(self, database):
        database.return_value.card_submissions.aggregate.side_effect = ExecutionTimeout('private-child-query')
        with self.assertRaises(HTTPException) as caught:
            review_queue()
        self.assertEqual(caught.exception.status_code, 503)
        self.assertNotIn('private-child-query', caught.exception.detail)


class OperationalAlertsEndpointTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        configure_observability(self.app)
        self.app.include_router(api_router, prefix='/api')
        self.client = TestClient(self.app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)

    @patch('app.api.router.operational_report')
    def test_only_operators_read_no_store_report(self, report):
        report.return_value = {'status': 'partial', 'alerts': []}
        self.assertEqual(self.client.get('/api/admin/alerts').status_code, 401)
        for role in ('user', 'caregiver', 'support_staff'):
            self.app.dependency_overrides[current_user] = lambda: {'id': 'account', 'role': role}
            self.assertEqual(self.client.get('/api/admin/alerts').status_code, 403)
        report.assert_not_called()
        self.app.dependency_overrides[current_user] = lambda: {
            'id': 'operator', 'role': 'support_staff', 'account_permissions': ['content_manage'],
        }
        response = self.client.get('/api/admin/alerts')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(response.json()['status'], 'partial')
        report.assert_called_once_with(self.app.state.api_metrics, self.app.state.offline_sync_metrics)
