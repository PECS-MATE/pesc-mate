from concurrent.futures import ThreadPoolExecutor
import json
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from app.api.router import api_router
from app.services.api_metrics import ApiMetrics, DURATION_LIMITS_MS
from app.services.authentication import current_user
from app.services.observability import configure_observability


class ApiMetricsTests(unittest.TestCase):
    def setUp(self):
        self.now = 0.0
        self.metrics = ApiMetrics(clock=lambda: self.now)

    def test_rates_and_histogram_include_client_server_and_broken_stream_errors(self):
        for status, duration, failed in ((200, 5, False), (403, 25, False),
                                         (503, 100, False), (200, 20000, True)):
            self.metrics.record('GET', '/sample/{id}', status, duration, failed)
        result = self.metrics.snapshot()
        totals = result['totals']
        self.assertEqual(totals['requests'], 4)
        self.assertEqual(totals['client_errors'], 1)
        self.assertEqual(totals['server_errors'], 1)
        self.assertEqual(totals['transfer_errors'], 1)
        self.assertEqual(totals['error_rate'], 0.75)
        self.assertEqual(totals['server_error_rate'], 0.5)
        duration = totals['duration_ms']
        self.assertEqual(duration['mean'], 5032.5)
        self.assertEqual(duration['p50_upper_bound'], 25)
        self.assertIsNone(duration['p95_upper_bound'])  # Beyond the largest finite bucket.
        self.assertEqual(duration['max'], 20000)
        self.assertEqual([item['count'] for item in duration['buckets'][:4]], [1, 2, 2, 3])
        self.assertEqual(duration['buckets'][-1], {'le_ms': None, 'count': 4})
        self.assertEqual(result['routes'][0]['route'], '/sample/{id}')

    def test_minute_buckets_expire_even_without_new_requests(self):
        self.now = 59
        self.metrics.record('GET', '/first', 200, 3)
        self.now = 60
        self.metrics.record('GET', '/second', 200, 4)
        self.assertEqual(self.metrics.snapshot()['totals']['requests'], 2)
        self.now = 900
        result = self.metrics.snapshot()
        self.assertEqual([item['route'] for item in result['routes']], ['/second'])
        self.now = 960
        result = self.metrics.snapshot()
        self.assertEqual(result['totals']['requests'], 0)
        self.assertEqual(result['routes'], [])
        self.assertIsNone(result['totals']['duration_ms']['mean'])
        self.assertEqual(result['totals']['error_rate'], 0)

    def test_concurrent_requests_are_counted_once(self):
        def record_many(_index):
            for _ in range(100):
                self.metrics.record('POST', '/sample', 201, 50)
        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(record_many, range(16)))
        result = self.metrics.snapshot()
        self.assertEqual(result['totals']['requests'], 1600)
        self.assertEqual(result['totals']['duration_ms']['buckets'][-1]['count'], 1600)
        self.assertEqual(result['totals']['duration_ms']['mean'], 50)

    def test_route_cardinality_and_bucket_retention_are_bounded(self):
        metrics = ApiMetrics(clock=lambda: self.now, max_series=3)
        for minute in range(40):
            self.now = minute * 60
            for index in range(20):
                metrics.record('GET', f'/configured-route-{index}', 200, 5)
        result = metrics.snapshot()
        self.assertLessEqual(len(result['routes']), 4)  # Three routes plus overflow.
        self.assertEqual(result['totals']['requests'], 15 * 20)
        overflow = next(item for item in result['routes'] if item['route'] == 'other')
        self.assertEqual(overflow['requests'], 15 * 17)

    def test_invalid_durations_never_publish_nan_or_infinity(self):
        for duration in (float('nan'), float('inf'), -10):
            self.metrics.record('UNTRUSTED_METHOD', '/sample', 200, duration)
        result = self.metrics.snapshot()
        json.dumps(result, allow_nan=False)
        self.assertEqual(result['routes'][0]['method'], 'UNKNOWN')
        self.assertEqual(result['totals']['duration_ms']['max'], 0)
        self.assertEqual(len(result['totals']['duration_ms']['buckets']), len(DURATION_LIMITS_MS) + 1)

    def test_collectors_are_isolated_and_restarts_reset_counts(self):
        self.metrics.record('GET', '/sample', 200, 10)
        self.now = 30
        other = ApiMetrics(clock=lambda: self.now)
        self.assertEqual(other.snapshot()['totals']['requests'], 0)
        self.assertEqual(self.metrics.snapshot()['uptime_seconds'], 30)
        self.assertTrue(other.snapshot()['reset_on_restart'])


class ApiMetricsEndpointTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        configure_observability(self.app)
        self.app.include_router(api_router, prefix='/api')

        @self.app.get('/sample/{user_id}')
        async def sample(user_id: str):
            return {'ok': True}

        @self.app.get('/broken-stream/{user_id}')
        async def broken_stream(user_id: str):
            async def chunks():
                yield b'first'
                raise RuntimeError('private-payload')
            return StreamingResponse(chunks())

        self.client = TestClient(self.app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)

    def as_operator(self):
        self.app.dependency_overrides[current_user] = lambda: {
            'id': 'operator', 'role': 'support_staff', 'account_permissions': ['content_manage'],
        }

    def test_only_account_operators_can_read_metrics(self):
        self.assertEqual(self.client.get('/api/admin/metrics').status_code, 401)
        for role in ('user', 'caregiver', 'support_staff'):
            with self.subTest(role=role):
                self.app.dependency_overrides[current_user] = lambda: {'id': 'account', 'role': role}
                response = self.client.get('/api/admin/metrics')
                self.assertEqual(response.status_code, 403)
                self.assertNotIn('totals', response.json())
        self.as_operator()
        response = self.client.get('/api/admin/metrics')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertIn('X-Request-ID', response.headers)
        self.assertEqual(response.json()['scope'], 'process')

    def test_route_templates_coalesce_requests_without_private_values(self):
        private = 'private-child-token-text'
        self.client.get(f'/sample/{private}?search={private}', headers={'Authorization': f'Bearer {private}'})
        self.client.get('/sample/another-child')
        self.client.get(f'/missing/{private}')
        self.as_operator()
        result = self.client.get('/api/admin/metrics').json()
        self.assertNotIn(private, json.dumps(result))
        self.assertNotIn('another-child', json.dumps(result))
        routes = {item['route']: item for item in result['routes']}
        self.assertEqual(routes['/sample/{user_id}']['requests'], 2)
        self.assertEqual(routes['unmatched']['client_errors'], 1)
        self.assertEqual(result['totals']['requests'], 3)

    def test_stream_failure_with_200_headers_is_still_a_failure(self):
        self.client.get('/broken-stream/private-child')
        self.as_operator()
        result = self.client.get('/api/admin/metrics').json()
        self.assertEqual(result['totals']['transfer_errors'], 1)
        self.assertEqual(result['totals']['server_error_rate'], 1)
        self.assertEqual(result['totals']['server_errors'], 0)
        self.assertNotIn('private-payload', json.dumps(result))

    def test_metrics_collector_failure_does_not_break_application_responses(self):
        with patch.object(self.app.state.api_metrics, 'record', side_effect=RuntimeError('private-metrics-detail')):
            with self.assertLogs('uvicorn.error', level='INFO') as captured:
                response = self.client.get('/sample/private-child')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'ok': True})
        self.assertNotIn('private-metrics-detail', '\n'.join(captured.output))


if __name__ == '__main__':
    unittest.main()
