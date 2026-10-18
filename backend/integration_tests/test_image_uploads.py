"""Real multipart/auth/MongoDB tests. Only the external safety transport is faked."""
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import re
import unittest
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pymongo import MongoClient

from app.api.router import api_router
from app.services.card_submissions import MAX_IMAGE_BYTES
from app.services.observability import configure_observability
from tests.image_fixtures import FORMATS, PRIVATE, assert_clean_webp, metadata_image


class RealImageUploadTests(unittest.TestCase):
    def setUp(self):
        self.original_database = os.environ.get('MONGODB_DATABASE', 'pesc_mate')
        self.name = 'pesc_mate_image_test_' + uuid4().hex
        self.mongo = MongoClient(os.environ.get('MONGODB_URI', 'mongodb://127.0.0.1:27017'),
                                 serverSelectionTimeoutMS=3000)
        self.addCleanup(self.mongo.close)
        self.addCleanup(self.drop_owned_database)
        self.database = self.mongo[self.name]
        environment = patch.dict(os.environ, MONGODB_DATABASE=self.name, OLLAMA_ENABLED='false',
                                 DEMO_ACCOUNTS_ENABLED='false', DB_CRUD_LOG_ENABLED='false',
                                 IMAGE_SAFETY_API_URL='https://safety.invalid/check')
        environment.start()
        self.addCleanup(environment.stop)
        connection = patch('app.services.database.client', return_value=self.mongo)
        connection.start()
        self.addCleanup(connection.stop)
        self.provider_passes = True
        self.sent_images = []

        def provider(request, **kwargs):
            self.assertEqual(kwargs['timeout'], 5)
            payload = json.loads(request.data)
            self.assertEqual(payload['mime_type'], 'image/webp')
            data = base64.b64decode(payload['image_base64'])
            assert_clean_webp(self, data)
            self.sent_images.append(data)
            response = MagicMock()
            response.__enter__.return_value.read.return_value = json.dumps({
                'safe': self.provider_passes, 'provider': 'synthetic-test-provider', 'reasons': [],
            }).encode()
            return response

        transport = patch('app.services.image_safety.urlopen', side_effect=provider)
        self.transport = transport.start()
        self.addCleanup(transport.stop)
        application = FastAPI()  # No production startup workers or demo seed.
        configure_observability(application)
        application.include_router(api_router, prefix='/api')
        self.http = TestClient(application)
        self.addCleanup(self.http.close)
        self.headers = {}
        for identity in ('child-a', 'child-b'):
            self.database.users.insert_one({'_id': identity, 'username': identity,
                                             'name': '합성 이미지 계정', 'role': 'user'})
            token = 'synthetic-' + uuid4().hex
            self.headers[identity] = {'Authorization': 'Bearer ' + token}
            self.database.auth_sessions.insert_one({'_id': hashlib.sha256(token.encode()).hexdigest(),
                'user_id': identity, 'expires_at': datetime.now(timezone.utc) + timedelta(hours=1)})
            self.database.privacy_settings.insert_one({'_id': identity, 'guardian_consent': True})
        self.database.card_categories.insert_one({'_id': 'food', 'name': '음식', 'display_order': 1, 'active': True})

    def drop_owned_database(self):
        if (not re.fullmatch(r'pesc_mate_image_test_[a-f0-9]{32}', self.name)
                or self.name == self.original_database):
            raise RuntimeError('Refusing unsafe image fixture cleanup')
        self.mongo.drop_database(self.name)

    def upload(self, kind, data, mime, *, filename='SYNTHETIC_PRIVATE_PERSON.jpg', expected=None):
        fields = {'label': '검증사진' + uuid4().hex[:12], 'meaning': '합성 업로드 검증',
                  'category': '음식', 'visibility': 'private'} if kind == 'card' else {}
        response = self.http.post('/api/cards/submissions' if kind == 'card' else '/api/profile/image',
                                 headers=self.headers['child-a'], data=fields,
                                 files={'image': (filename, data, mime)})
        self.assertEqual(response.status_code, expected or (201 if kind == 'card' else 200), response.text)
        return response

    def test_card_formats_store_and_serve_only_clean_webp_and_drop_original_filename(self):
        for format, mime in FORMATS.items():
            with self.subTest(format=format):
                original = metadata_image(format)
                response = self.upload('card', original, mime).json()
                stored = self.database.card_submissions.find_one({'_id': response['id']})['image']
                self.assertEqual(set(stored), {'data', 'filename', 'content_type'})
                self.assertEqual(stored['filename'], 'card-image.webp')
                self.assertEqual(stored['content_type'], 'image/webp')
                self.assertEqual(stored['data'], self.sent_images[-1])
                self.assertNotEqual(stored['data'], original)
                self.assertNotIn('SYNTHETIC_PRIVATE_PERSON', json.dumps(response))
                served = self.http.get(response['image_url'], headers=self.headers['child-a'])
                self.assertEqual(served.status_code, 200)
                self.assertEqual(served.headers['content-type'], 'image/webp')
                self.assertEqual(served.content, stored['data'])
                assert_clean_webp(self, served.content)

    def test_profile_formats_store_and_serve_only_clean_webp(self):
        previous_url = None
        for format, mime in FORMATS.items():
            with self.subTest(format=format):
                original = metadata_image(format)
                response = self.upload('profile', original, mime).json()
                self.assertNotEqual(response['image_url'], previous_url)
                previous_url = response['image_url']
                stored = self.database.users.find_one({'_id': 'child-a'})['profile']
                self.assertEqual(stored['content_type'], 'image/webp')
                self.assertEqual(stored['image_data'], self.sent_images[-1])
                self.assertNotEqual(stored['image_data'], original)
                served = self.http.get(response['image_url'], headers=self.headers['child-a'])
                self.assertEqual(served.status_code, 200)
                self.assertEqual(served.content, stored['image_data'])
                self.assertEqual(served.headers['content-type'], 'image/webp')
                assert_clean_webp(self, served.content)

    def test_mismatches_and_bad_content_do_not_call_provider_write_audit_or_replace_profile(self):
        self.upload('profile', metadata_image(), 'image/png')
        before = self.database.users.find_one({'_id': 'child-a'})
        calls = self.transport.call_count
        invalid = [(metadata_image('JPEG'), 'image/png'), (metadata_image('PNG'), 'image/jpeg'),
                   (metadata_image('WEBP'), 'image/png'), (b'\x89PNG\r\n\x1a\nnot-an-image', 'image/png'),
                   (b'<svg>synthetic</svg>', 'image/png'), (metadata_image(), 'application/octet-stream')]
        for kind in ('card', 'profile'):
            for data, mime in invalid:
                response = self.upload(kind, data, mime, expected=422)
                self.assertNotIn(PRIVATE.decode(), response.text)
        self.assertEqual(self.transport.call_count, calls)
        self.assertEqual(self.database.users.find_one({'_id': 'child-a'}), before)
        self.assertEqual(self.database.card_submissions.count_documents({}), 0)
        self.assertEqual(self.database.card_audit_logs.count_documents({}), 0)

    def test_oversized_multipart_is_rejected_before_provider_and_storage(self):
        for kind in ('card', 'profile'):
            self.upload(kind, b'x' * (MAX_IMAGE_BYTES + 1), 'image/png', expected=422)
        self.transport.assert_not_called()
        self.assertEqual(self.database.card_submissions.count_documents({}), 0)
        self.assertNotIn('profile', self.database.users.find_one({'_id': 'child-a'}))

    def test_other_child_cannot_fetch_clean_private_card_or_profile(self):
        for kind in ('card', 'profile'):
            result = self.upload(kind, metadata_image(), 'image/png').json()
            response = self.http.get(result['image_url'], headers=self.headers['child-b'])
            self.assertEqual(response.status_code, 403)
            self.assertNotIn(PRIVATE.decode(), response.text)

    def test_blocked_safety_result_does_not_store_card_or_replace_profile(self):
        self.upload('profile', metadata_image(), 'image/png')
        before = self.database.users.find_one({'_id': 'child-a'})
        self.provider_passes = False
        for kind in ('card', 'profile'):
            self.upload(kind, metadata_image('JPEG'), 'image/jpeg', expected=422)
        self.assertEqual(self.database.users.find_one({'_id': 'child-a'}), before)
        self.assertEqual(self.database.card_submissions.count_documents({}), 0)
        self.assertEqual(self.database.card_audit_logs.count_documents({}), 0)
        self.assertEqual(len(self.sent_images), 3)  # All three requests were normalized first.


if __name__ == '__main__':
    unittest.main()
