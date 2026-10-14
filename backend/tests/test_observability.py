import json
import logging
import traceback
import unittest
from uuid import UUID

from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from app.services import observability


REQUEST_ID = '36b34017-f740-4a87-a21b-89d815178120'
ORIGIN = 'http://localhost:5173'
PRIVATE_MARKER = 'private-child-communication-secret'


class ValidationPayload(BaseModel):
    count: int
    label: str = Field(min_length=3)


def create_test_app():
    app = FastAPI()
    observability.configure_observability(app)

    @app.get('/success/{user_id}')
    async def success(user_id: str):
        return {'ok': True}

    @app.get('/http-error/{status_code}')
    async def http_error(status_code: int):
        raise HTTPException(
            status_code=status_code,
            detail=PRIVATE_MARKER if status_code == 500 else '기존 오류 안내',
            headers={'Retry-After': '5'},
        )

    @app.post('/validate/{user_id}')
    async def validate(user_id: str, payload: ValidationPayload):
        return {'count': payload.count}

    @app.get('/failure/{user_id}')
    async def failure(user_id: str):
        raise RuntimeError(PRIVATE_MARKER)

    @app.get('/stream/{user_id}')
    async def stream(user_id: str):
        async def chunks():
            yield b'\x00\x01'
            yield b'\xff\x80'

        return StreamingResponse(chunks(), media_type='application/octet-stream')

    @app.get('/failing-stream/{user_id}')
    async def failing_stream(user_id: str):
        async def chunks():
            yield b'first chunk'
            raise RuntimeError(PRIVATE_MARKER)

        return StreamingResponse(chunks(), media_type='application/octet-stream')

    @app.delete('/empty/{user_id}', status_code=204)
    async def empty(user_id: str):
        return Response(status_code=204)

    return app


class ObservabilityTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(create_test_app(), raise_server_exceptions=False)

    def tearDown(self):
        self.client.close()

    def assert_request_id(self, response):
        request_id = response.headers['X-Request-ID']
        self.assertEqual(str(UUID(request_id)), request_id.lower())
        return request_id

    def request_with_log(self, method, path, **kwargs):
        with self.assertLogs(observability.logger, level='INFO') as captured:
            response = getattr(self.client, method)(path, **kwargs)
        entries = [json.loads(record.getMessage()) for record in captured.records]
        request_entries = [entry for entry in entries if entry.get('event') == 'api_request']
        self.assertEqual(len(request_entries), 1)
        return response, request_entries[0], captured.output

    def assert_error(self, response, code):
        request_id = self.assert_request_id(response)
        body = response.json()
        self.assertIn('detail', body)
        self.assertEqual(body['error']['code'], code)
        self.assertEqual(body['error']['request_id'], request_id)
        self.assertIsInstance(body['error']['message'], str)
        self.assertTrue(body['error']['message'])
        return body

    def test_success_preserves_uuid_and_logs_template_without_private_values(self):
        response, entry, output = self.request_with_log(
            'get', f'/success/{PRIVATE_MARKER}?token={PRIVATE_MARKER}',
            headers={'X-Request-ID': REQUEST_ID, 'Authorization': f'Bearer {PRIVATE_MARKER}'},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'ok': True})
        self.assertEqual(self.assert_request_id(response), REQUEST_ID)
        self.assertEqual(entry['request_id'], REQUEST_ID)
        self.assertEqual(entry['method'], 'GET')
        self.assertEqual(entry['route'], '/success/{user_id}')
        self.assertEqual(entry['status_code'], 200)
        self.assertIsInstance(entry['duration_ms'], (int, float))
        self.assertGreaterEqual(entry['duration_ms'], 0)
        self.assertNotIn(PRIVATE_MARKER, '\n'.join(output))

    def test_uppercase_canonical_uuid_is_accepted(self):
        response = self.client.get('/success/one', headers={'X-Request-ID': REQUEST_ID.upper()})

        self.assertEqual(self.assert_request_id(response).lower(), REQUEST_ID)

    def test_missing_and_noncanonical_request_ids_are_replaced(self):
        invalid_values = [
            None, '', 'not-a-uuid', REQUEST_ID.replace('-', ''),
            '{' + REQUEST_ID + '}', 'urn:uuid:' + REQUEST_ID,
            ' ' + REQUEST_ID, REQUEST_ID + ' ',
        ]
        generated = set()
        for value in invalid_values:
            with self.subTest(value=value):
                headers = {} if value is None else {'X-Request-ID': value}
                response = self.client.get('/success/one', headers=headers)
                request_id = self.assert_request_id(response)
                self.assertNotEqual(request_id.lower(), REQUEST_ID)
                self.assertNotIn(request_id, generated)
                generated.add(request_id)

    def test_duplicate_request_id_headers_are_rejected(self):
        response, entry, _output = self.request_with_log(
            'get', '/success/one',
            headers=[('X-Request-ID', REQUEST_ID), ('x-request-id', REQUEST_ID)],
        )

        self.assertEqual(response.status_code, 200)
        request_id = self.assert_request_id(response)
        self.assertNotEqual(request_id, REQUEST_ID)
        self.assertEqual(entry['request_id'], request_id)

    def test_handled_http_errors_preserve_safe_details_and_headers(self):
        statuses = {
            401: 'unauthorized', 403: 'forbidden', 404: 'not_found',
            409: 'conflict', 422: 'validation_error', 503: 'service_unavailable',
            500: 'internal_error', 418: 'http_error',
        }
        for status, code in statuses.items():
            with self.subTest(status=status):
                response = self.client.get(
                    f'/http-error/{status}', headers={'X-Request-ID': REQUEST_ID},
                )
                self.assertEqual(response.status_code, status)
                body = self.assert_error(response, code)
                expected_detail = observability.SERVER_ERROR_MESSAGE if status == 500 else '기존 오류 안내'
                self.assertEqual(body['detail'], expected_detail)
                self.assertNotIn(PRIVATE_MARKER, json.dumps(body))
                self.assertEqual(response.headers['Retry-After'], '5')
                self.assertEqual(response.headers['X-Request-ID'], REQUEST_ID)

    def test_unknown_path_has_request_id_and_logs_no_path_or_query_value(self):
        response, entry, output = self.request_with_log(
            'get', f'/unknown/{PRIVATE_MARKER}?token={PRIVATE_MARKER}',
        )

        self.assertEqual(response.status_code, 404)
        self.assert_error(response, 'not_found')
        self.assertEqual(entry['route'], 'unmatched')
        self.assertEqual(entry['request_id'], response.headers['X-Request-ID'])
        self.assertEqual(entry['status_code'], 404)
        self.assertNotIn(PRIVATE_MARKER, '\n'.join(output))

    def test_validation_omits_submitted_input_and_context_from_response_and_logs(self):
        response, entry, output = self.request_with_log(
            'post', f'/validate/{PRIVATE_MARKER}?token={PRIVATE_MARKER}',
            json={'count': PRIVATE_MARKER, 'label': 'a'},
            headers={'Authorization': f'Bearer {PRIVATE_MARKER}'},
        )

        self.assertEqual(response.status_code, 422)
        body = self.assert_error(response, 'validation_error')
        self.assertIsInstance(body['detail'], list)
        self.assertEqual({tuple(error['loc']) for error in body['detail']},
                         {('body', 'count'), ('body', 'label')})
        for error in body['detail']:
            self.assertIn('type', error)
            self.assertIn('msg', error)
            self.assertNotIn('input', error)
            self.assertNotIn('ctx', error)
        self.assertNotIn(PRIVATE_MARKER, json.dumps(body))
        self.assertEqual(entry['route'], '/validate/{user_id}')
        self.assertEqual(entry['status_code'], 422)
        self.assertNotIn(PRIVATE_MARKER, '\n'.join(output))

    def test_unhandled_exception_is_generic_and_logs_only_exception_class(self):
        response, entry, output = self.request_with_log(
            'get', f'/failure/{PRIVATE_MARKER}?token={PRIVATE_MARKER}',
            headers={'X-Request-ID': REQUEST_ID, 'Authorization': PRIVATE_MARKER},
        )

        self.assertEqual(response.status_code, 500)
        body = self.assert_error(response, 'internal_error')
        self.assertEqual(response.headers['X-Request-ID'], REQUEST_ID)
        self.assertNotIn(PRIVATE_MARKER, json.dumps(body))
        self.assertNotIn('RuntimeError', json.dumps(body))
        self.assertEqual(entry['request_id'], REQUEST_ID)
        self.assertEqual(entry['route'], '/failure/{user_id}')
        self.assertEqual(entry['status_code'], 500)
        self.assertEqual(entry['error_type'], 'RuntimeError')
        self.assertNotIn(PRIVATE_MARKER, '\n'.join(output))
        self.assertNotIn('Traceback', '\n'.join(output))

    def test_streaming_binary_body_and_204_response_remain_unchanged(self):
        response = self.client.get('/stream/one', headers={'X-Request-ID': REQUEST_ID})

        self.assertEqual(response.status_code, 200)
        self.assert_request_id(response)
        self.assertEqual(response.content, b'\x00\x01\xff\x80')
        self.assertEqual(response.headers['Content-Type'], 'application/octet-stream')

        empty = self.client.delete('/empty/one', headers={'X-Request-ID': REQUEST_ID})
        self.assertEqual(empty.status_code, 204)
        self.assert_request_id(empty)
        self.assertEqual(empty.content, b'')

    def test_failure_after_stream_start_has_safe_traceback_and_error_log(self):
        failure = None
        formatted_traceback = ''
        with TestClient(create_test_app(), raise_server_exceptions=True) as client:
            with self.assertLogs(observability.logger, level='INFO') as captured:
                try:
                    client.get(
                        f'/failing-stream/{PRIVATE_MARKER}',
                        headers={'X-Request-ID': REQUEST_ID},
                    )
                except observability.ResponseStreamError as exc:
                    failure = exc
                    formatted_traceback = ''.join(traceback.format_exception(exc))

        self.assertIsNotNone(failure, 'A response that already started must propagate its failure')
        self.assertEqual(str(failure), 'Response stream failed')
        self.assertNotIn(PRIVATE_MARKER, formatted_traceback)
        self.assertNotIn('RuntimeError', formatted_traceback)
        entries = [json.loads(record.getMessage()) for record in captured.records]
        request_entries = [entry for entry in entries if entry.get('event') == 'api_request']
        self.assertEqual(len(request_entries), 1)
        entry = request_entries[0]
        self.assertEqual(entry['route'], '/failing-stream/{user_id}')
        self.assertEqual(entry['status_code'], 200)
        self.assertEqual(entry['request_id'], REQUEST_ID)
        self.assertEqual(entry['error_type'], 'RuntimeError')
        request_records = [
            record for record in captured.records
            if json.loads(record.getMessage()).get('event') == 'api_request'
        ]
        self.assertEqual(request_records[0].levelno, logging.ERROR)
        self.assertNotIn(PRIVATE_MARKER, '\n'.join(captured.output))

    def test_cors_error_responses_expose_request_id_including_unhandled_failure(self):
        for path, status in [('/http-error/403', 403), ('/missing', 404), ('/failure/one', 500)]:
            with self.subTest(path=path):
                response = self.client.get(path, headers={'Origin': ORIGIN})
                self.assertEqual(response.status_code, status)
                self.assert_request_id(response)
                self.assertEqual(response.headers['Access-Control-Allow-Origin'], ORIGIN)
                exposed = {
                    value.strip().lower()
                    for value in response.headers['Access-Control-Expose-Headers'].split(',')
                }
                self.assertIn('x-request-id', exposed)

    def test_cors_preflight_is_traced_without_changing_its_response(self):
        response, entry, _output = self.request_with_log(
            'options', '/success/one', headers={
                'Origin': ORIGIN,
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'X-Request-ID, Authorization',
                'X-Request-ID': REQUEST_ID,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.assert_request_id(response), REQUEST_ID)
        self.assertEqual(response.headers['Access-Control-Allow-Origin'], ORIGIN)
        self.assertIn('GET', response.headers['Access-Control-Allow-Methods'])
        self.assertEqual(response.text, 'OK')
        self.assertEqual(entry['method'], 'OPTIONS')
        self.assertEqual(entry['status_code'], 200)
        self.assertEqual(entry['request_id'], REQUEST_ID)


if __name__ == '__main__':
    unittest.main()
