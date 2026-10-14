import io
import json
import os
import unittest
from http.client import IncompleteRead
from unittest.mock import MagicMock, patch
from urllib.error import URLError

from pymongo.errors import ServerSelectionTimeoutError
from fastapi.testclient import TestClient

from app.main import app
from app.services import health


class HealthTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {'OLLAMA_ENABLED': 'false'})
        environment.start()
        self.addCleanup(environment.stop)
        mongodb = patch('app.services.health.client')
        self.client = mongodb.start()
        self.client.return_value.admin.command.return_value = {'ok': 1.0}
        self.addCleanup(mongodb.stop)
        ollama = patch('app.services.health.urlopen')
        self.urlopen = ollama.start()
        self.addCleanup(ollama.stop)

    def enable_ollama(self, models):
        environment = patch.dict(os.environ, {
            'OLLAMA_ENABLED': 'true',
            'OLLAMA_BASE_URL': 'http://ollama.private:11434/',
            'OLLAMA_MODEL': 'qwen2.5:0.5b',
        })
        environment.start()
        self.addCleanup(environment.stop)
        self.urlopen.return_value = io.BytesIO(json.dumps({'models': models}).encode())

    def test_mongodb_ready_and_disabled_ollama_preserve_ok_status(self):
        with patch('app.services.health.timeout') as deadline:
            payload, status_code = health.health_report()
        self.assertEqual((payload['status'], status_code), ('ok', 200))
        self.assertEqual(payload['checks']['mongodb']['status'], 'ok')
        self.assertEqual(payload['checks']['ollama']['status'], 'disabled')
        self.client.return_value.admin.command.assert_called_once_with('ping')
        deadline.assert_called_once_with(health.CHECK_TIMEOUT_SECONDS)
        self.urlopen.assert_not_called()

    def test_required_mongodb_failure_returns_service_unavailable(self):
        self.client.return_value.admin.command.side_effect = ServerSelectionTimeoutError(
            'mongodb://private_user:private_password@private.database',
        )
        payload, status_code = health.health_report()
        self.assertEqual((payload['status'], status_code), ('unavailable', 503))
        self.assertTrue(payload['checks']['mongodb']['required'])
        self.assertEqual(payload['checks']['mongodb']['detail'], 'unreachable')
        self.assertNotIn('private_', json.dumps(payload))

    def test_unsuccessful_mongodb_ping_is_unavailable(self):
        self.client.return_value.admin.command.return_value = {'ok': 0}
        payload, status_code = health.health_report()
        self.assertEqual((payload['status'], status_code), ('unavailable', 503))

    def test_available_configured_model_is_healthy(self):
        self.enable_ollama([{'name': 'another:latest'}, {'model': 'qwen2.5:0.5b'}])
        payload, status_code = health.health_report()
        self.assertEqual((payload['status'], status_code), ('ok', 200))
        self.assertEqual(payload['checks']['ollama']['detail'], 'ready')
        self.urlopen.assert_called_once_with(
            'http://ollama.private:11434/api/tags', timeout=health.CHECK_TIMEOUT_SECONDS,
        )
        self.assertNotIn('ollama.private', json.dumps(payload))

    def test_model_without_tag_matches_latest(self):
        self.enable_ollama([{'name': 'qwen2.5:latest'}])
        with patch.dict(os.environ, {'OLLAMA_MODEL': 'qwen2.5'}):
            payload, status_code = health.health_report()
        self.assertEqual((payload['status'], status_code), ('ok', 200))

    def test_missing_configured_model_degrades_with_rule_fallback(self):
        self.enable_ollama([{'name': 'another:latest'}])
        payload, status_code = health.health_report()
        self.assertEqual((payload['status'], status_code), ('degraded', 200))
        self.assertEqual(payload['checks']['ollama']['detail'], 'model_missing')
        self.assertEqual(payload['checks']['ollama']['fallback'], 'rule')
        self.assertFalse(payload['checks']['ollama']['required'])

    def test_optional_model_failure_degrades_without_leaking_error(self):
        self.enable_ollama([])
        for error in (TimeoutError('private_endpoint'), URLError('private_endpoint')):
            with self.subTest(error=type(error).__name__):
                self.urlopen.side_effect = error
                payload, status_code = health.health_report()
                self.assertEqual((payload['status'], status_code), ('degraded', 200))
                self.assertEqual(payload['checks']['ollama']['detail'], 'unreachable')
                self.assertNotIn('private_endpoint', json.dumps(payload))

    def test_invalid_model_response_degrades(self):
        self.enable_ollama([])
        for body in (b'not json', b'[]', b'{"models": {}}', b'{"models": [1]}',
                     b'x' * (health.MAX_TAGS_BYTES + 1)):
            with self.subTest(body_length=len(body)):
                self.urlopen.return_value = io.BytesIO(body)
                payload, status_code = health.health_report()
                self.assertEqual((payload['status'], status_code), ('degraded', 200))
                self.assertEqual(payload['checks']['ollama']['detail'], 'invalid_response')

    def test_interrupted_model_response_degrades_with_rule_fallback(self):
        self.enable_ollama([])
        self.urlopen.return_value = MagicMock()
        response = self.urlopen.return_value.__enter__.return_value
        response.read.side_effect = IncompleteRead(b'private-response-partial', 100)
        payload, status_code = health.health_report()
        self.assertEqual((payload['status'], status_code), ('degraded', 200))
        self.assertEqual(payload['checks']['ollama']['detail'], 'unreachable')
        self.assertEqual(payload['checks']['ollama']['fallback'], 'rule')
        self.assertNotIn('private-response-partial', json.dumps(payload))

    def test_tts_requires_device_check_instead_of_claiming_readiness(self):
        payload, _ = health.health_report()
        self.assertEqual(payload['checks']['tts'], {
            'status': 'client_side', 'required': False, 'detail': 'device_check_required',
        })


class HealthEndpointTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {'OLLAMA_ENABLED': 'false'})
        environment.start()
        self.addCleanup(environment.stop)
        mongodb = patch('app.services.health.client')
        self.mongodb = mongodb.start()
        self.mongodb.return_value.admin.command.return_value = {'ok': 1.0}
        self.addCleanup(mongodb.stop)
        self.http = TestClient(app)
        self.addCleanup(self.http.close)
        self.request_id = '36b34017-f740-4a87-a21b-89d815178120'

    def test_readiness_endpoint_is_public_uncached_and_correlated(self):
        response = self.http.get('/api/health', headers={'X-Request-ID': self.request_id})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'ok')
        self.assertEqual(response.json()['checks']['mongodb']['status'], 'ok')
        self.assertEqual(response.headers['X-Request-ID'], self.request_id)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_database_failure_preserves_checks_and_uses_common_error(self):
        self.mongodb.return_value.admin.command.side_effect = ServerSelectionTimeoutError('private-database')
        response = self.http.get('/api/health', headers={'X-Request-ID': self.request_id})

        self.assertEqual(response.status_code, 503)
        body = response.json()
        self.assertEqual(body['status'], 'unavailable')
        self.assertEqual(body['checks']['mongodb']['status'], 'unavailable')
        self.assertEqual(body['error']['code'], 'service_unavailable')
        self.assertEqual(body['error']['request_id'], response.headers['X-Request-ID'])
        self.assertEqual(body['error']['request_id'], self.request_id)
        self.assertNotIn('private-database', response.text)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_optional_model_failure_keeps_readiness_http_success(self):
        with patch.dict(os.environ, {'OLLAMA_ENABLED': 'true'}), patch(
                'app.services.health.urlopen', side_effect=URLError('private-ollama')):
            response = self.http.get('/api/health', headers={'X-Request-ID': self.request_id})

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['status'], 'degraded')
        self.assertEqual(body['checks']['mongodb']['status'], 'ok')
        self.assertEqual(body['checks']['ollama']['fallback'], 'rule')
        self.assertNotIn('error', body)
        self.assertNotIn('private-ollama', response.text)
        self.assertEqual(response.headers['X-Request-ID'], self.request_id)


if __name__ == '__main__':
    unittest.main()
