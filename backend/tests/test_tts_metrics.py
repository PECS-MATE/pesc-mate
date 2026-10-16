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
from app.services.tts_metrics import STARTUP_LIMITS_MS, tts_report


def grouped(status, count=1, kind='card', bucket=None, total=0, maximum=None, code='other'):
    return {'_id': {'status': status, 'content_type': kind, 'startup_bucket': bucket, 'error_code': code},
            'count': count, 'startup_sum': total, 'startup_max': maximum}


class TtsMetricsTests(unittest.TestCase):
    def setUp(self):
        patcher = patch('app.services.tts_metrics._database')
        self.db = MagicMock()
        patcher.start().return_value = self.db
        self.addCleanup(patcher.stop)
        self.db.tts_events.aggregate.return_value = []
        self.now = datetime(2026, 10, 17, 0, 0, tzinfo=timezone.utc)

    def test_rates_exclude_cancellations_and_unreported_requests(self):
        self.db.tts_events.aggregate.return_value = [
            grouped('succeeded', count=2, bucket=500, total=600, maximum=400),
            grouped('failed', count=1, code='voice-unavailable'),
            grouped('cancelled', count=3, kind='sentence'),
            grouped('requested', count=4, kind='preview'),
        ]
        report = tts_report(now=self.now)
        totals = report['totals']
        self.assertEqual(totals['requests'], 10)
        self.assertEqual(totals['resolved'], 3)
        self.assertEqual(totals['failure_rate'], 0.333333)
        self.assertEqual(totals['success_rate'], 0.666667)
        self.assertEqual(totals['cancelled'], 3)
        self.assertEqual(totals['requested'], 4)
        self.assertEqual(report['failure_codes'], [{'code': 'voice-unavailable', 'count': 1}])
        self.assertEqual({row['content_type'] for row in report['by_content_type']}, {'card', 'sentence', 'preview'})

    def test_zero_latency_is_a_sample_and_missing_latency_is_not_zero(self):
        self.db.tts_events.aggregate.return_value = [
            grouped('succeeded', bucket=100, total=0, maximum=0),
            grouped('succeeded', bucket=500, total=500, maximum=500),
            grouped('failed'), grouped('cancelled', bucket=250, total=200, maximum=200),
        ]
        result = tts_report(now=self.now)['totals']['startup_ms']
        self.assertEqual(result['samples'], 3)
        self.assertEqual(result['mean'], 233.33)
        self.assertEqual(result['max'], 500)
        self.assertEqual(result['p50_upper_bound'], 250)
        self.assertEqual(result['p95_upper_bound'], 500)
        self.assertEqual(result['buckets'][-1]['count'], 3)
        self.assertEqual([row['le_ms'] for row in result['buckets']], list(STARTUP_LIMITS_MS))

    def test_empty_data_does_not_claim_zero_failure_rate_or_latency(self):
        result = tts_report(now=self.now)
        self.assertEqual(result['totals']['requests'], 0)
        self.assertIsNone(result['totals']['failure_rate'])
        self.assertIsNone(result['totals']['startup_ms']['mean'])
        self.assertEqual(result['by_content_type'], [])
        self.assertEqual(result['source'], 'client_reported')

    def test_requested_and_cancelled_only_have_no_success_failure_denominator(self):
        self.db.tts_events.aggregate.return_value = [grouped('requested'), grouped('cancelled')]
        result = tts_report(now=self.now)['totals']
        self.assertIsNone(result['failure_rate'])
        self.assertIsNone(result['success_rate'])

    def test_pipeline_filters_request_time_and_projects_only_safe_group_dimensions(self):
        result = tts_report(hours=2, now=self.now)
        call = self.db.tts_events.aggregate.call_args
        pipeline = call.args[0]
        self.assertEqual(pipeline[0], {'$match': {'requested_at': {
            '$gte': self.now - timedelta(hours=2), '$lte': self.now,
        }}})
        projection = pipeline[1]['$project']
        self.assertEqual(projection['_id'], 0)
        self.assertEqual(set(projection), {'_id', 'content_type', 'status', 'error_code', 'startup_ms'})
        self.assertEqual(projection['error_code']['$cond'][-1], 'other')
        self.assertEqual(call.kwargs['maxTimeMS'], 2000)
        self.assertEqual(result['window_hours'], 2)
        self.assertEqual(result['requested_from'], (self.now - timedelta(hours=2)).isoformat())

    def test_unknown_group_values_have_fixed_public_labels(self):
        self.db.tts_events.aggregate.return_value = [grouped('other', kind='other'), grouped('failed', code='other')]
        report = tts_report(now=self.now)
        self.assertEqual(report['totals']['other'], 1)
        self.assertEqual(report['failure_codes'], [{'code': 'other', 'count': 1}])

    def test_timeout_is_safe_and_invalid_period_does_not_query_database(self):
        self.db.tts_events.aggregate.side_effect = ExecutionTimeout('private-child-query')
        with self.assertRaises(HTTPException) as caught:
            tts_report(now=self.now)
        self.assertEqual(caught.exception.status_code, 503)
        self.assertNotIn('private-child-query', caught.exception.detail)
        self.db.reset_mock()
        for hours in (0, 169):
            with self.assertRaises(HTTPException) as caught:
                tts_report(hours=hours)
            self.assertEqual(caught.exception.status_code, 422)
        self.db.tts_events.aggregate.assert_not_called()


class TtsMetricsEndpointTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        configure_observability(self.app)
        self.app.include_router(api_router, prefix='/api')
        self.client = TestClient(self.app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)
        self.report = patch('app.api.router.tts_report', return_value={'scope': 'stored_events'})
        self.report_mock = self.report.start()
        self.addCleanup(self.report.stop)

    def test_only_operators_query_aggregate_data(self):
        self.assertEqual(self.client.get('/api/admin/tts-metrics').status_code, 401)
        for role in ('user', 'caregiver', 'support_staff'):
            self.app.dependency_overrides[current_user] = lambda: {'id': 'account', 'role': role}
            self.assertEqual(self.client.get('/api/admin/tts-metrics').status_code, 403)
        self.report_mock.assert_not_called()
        self.app.dependency_overrides[current_user] = lambda: {
            'id': 'operator', 'role': 'support_staff', 'account_permissions': ['content_manage'],
        }
        response = self.client.get('/api/admin/tts-metrics?hours=2')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.report_mock.assert_called_once_with(2)

    def test_period_validation_and_collection_failure_preserve_safe_api_errors(self):
        self.app.dependency_overrides[current_user] = lambda: {
            'id': 'operator', 'role': 'support_staff', 'account_permissions': ['content_manage'],
        }
        for period in ('0', '169', 'invalid'):
            self.assertEqual(self.client.get(f'/api/admin/tts-metrics?hours={period}').status_code, 422)
        self.report_mock.assert_not_called()
        self.report_mock.side_effect = HTTPException(503, '음성 재생 지표를 불러오지 못했습니다.')
        response = self.client.get('/api/admin/tts-metrics')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['error']['code'], 'service_unavailable')
        self.assertNotIn('user_id', json.dumps(response.json()))
