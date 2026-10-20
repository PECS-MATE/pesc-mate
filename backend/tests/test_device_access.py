import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


class DeviceTrackingRemovalTests(unittest.TestCase):
    def test_device_tracking_endpoint_is_not_registered(self):
        self.assertNotIn('/api/device/access', {getattr(route, 'path', None) for route in app.routes})

    def test_legacy_tracking_request_does_not_touch_database_or_log_device_information(self):
        client = TestClient(app)
        self.addCleanup(client.close)
        with patch('app.services.database.client') as database_client, \
                self.assertNoLogs('uvicorn.error', level='DEBUG'):
            response = client.post('/api/device/access', headers={
                'X-Pesc-Device': 'synthetic-device-id', 'User-Agent': 'private-device-marker',
            })
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()['error']['code'], 'not_found')
        self.assertTrue(response.headers['X-Request-ID'])
        database_client.assert_not_called()


if __name__ == '__main__':
    unittest.main()
