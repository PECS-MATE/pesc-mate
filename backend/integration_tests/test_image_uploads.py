"""Real multipart/auth/MongoDB tests. Only the external safety transport is faked."""
import base64
from datetime import datetime, timedelta, timezone
import hashlib
from io import BytesIO
import json
import os
import re
import unittest
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
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
                                 DEMO_ACCOUNTS_ENABLED='false',
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

    def upload(self, kind, data, mime, *, filename='SYNTHETIC_PRIVATE_PERSON.jpg', expected=None, edits=None):
        fields = {'label': '검증사진' + uuid4().hex[:12], 'meaning': '합성 업로드 검증',
                  'category': '음식', 'visibility': 'private'} if kind == 'card' else {}
        if edits is not None:
            fields['image_edits'] = edits if isinstance(edits, str) else json.dumps(edits)
        response = self.http.post('/api/cards/submissions' if kind == 'card' else '/api/profile/image',
                                 headers=self.headers['child-a'], data=fields,
                                 files={'image': (filename, data, mime)})
        self.assertEqual(response.status_code, expected or (201 if kind == 'card' else 200), response.text)
        return response

    def card_manager(self, permissions=None):
        identity = 'manager-' + uuid4().hex
        self.database.users.insert_one({'_id': identity, 'username': identity, 'name': '합성 보호자', 'role': 'caregiver'})
        token = 'synthetic-' + uuid4().hex
        self.database.auth_sessions.insert_one({'_id': hashlib.sha256(token.encode()).hexdigest(),
            'user_id': identity, 'expires_at': datetime.now(timezone.utc) + timedelta(hours=1)})
        self.database.caregiver_links.insert_one({'_id': uuid4().hex, 'supporter_id': identity, 'user_id': 'child-a',
            'active': True, 'permissions': permissions if permissions is not None else ['cards_manage']})
        return identity, {'Authorization': 'Bearer ' + token}

    def replace_photo(self, card, data, headers, *, revision=0, target='child-a', mime='image/png'):
        return self.http.put(f"/api/cards/submissions/{card['id']}/image", headers=headers,
            data={'user_id': target, 'expected_revision': str(revision)}, files={'image': ('synthetic.png', data, mime)})

    def test_private_photo_replacement_keeps_identity_text_board_and_voice_and_replaces_all_variants(self):
        card = self.upload('card', metadata_image(), 'image/png', edits={'crop': 'square'}).json()
        identity, headers = self.card_manager()
        before = self.database.card_submissions.find_one({'_id': card['id']})
        layout = {'_id': 'child-a', 'revision': 7, 'slots': [{'position': 1, 'card_id': 'custom:' + card['id']}],
                  'quick_expression_ids': ['help']}
        self.database.board_layouts.insert_one(layout)
        self.database.tts_settings.insert_one({'_id': 'child-a', 'preset': 'woman', 'rate': 1.2})
        new = metadata_image('JPEG')
        response = self.replace_photo(card, new, headers, mime='image/jpeg')
        self.assertEqual(response.status_code, 200, response.text)
        saved = response.json(); after = self.database.card_submissions.find_one({'_id': card['id']})
        self.assertEqual(saved['image_revision'], 1)
        for field in ('_id', 'label', 'normalized_label', 'meaning', 'category', 'owner_id', 'visibility', 'status', 'created_at'):
            self.assertEqual(after[field], before[field])
        self.assertEqual(after['original_image']['data'], new)
        self.assertNotEqual(after['thumbnail']['version'], before['thumbnail']['version'])
        self.assertNotIn('image_edits', after)
        self.assertEqual(self.database.board_layouts.find_one({'_id': 'child-a'}), layout)
        self.assertEqual(self.database.tts_settings.find_one({'_id': 'child-a'})['rate'], 1.2)
        self.assertEqual(self.http.get(saved['image_url'], headers=headers).content, after['image']['data'])
        old_etag = '"' + hashlib.sha256(before['image']['data']).hexdigest() + '"'
        revalidated = self.http.get(saved['image_url'], headers=headers | {'If-None-Match': old_etag})
        self.assertEqual(revalidated.status_code, 200)
        self.assertNotEqual(revalidated.headers['etag'], old_etag)
        assert_clean_webp(self, after['image']['data'])
        audit = self.database.card_audit_logs.find_one({'action': 'image_replaced'})
        self.assertEqual((audit['actor_id'], audit['before_revision'], audit['after_revision']), (identity, 0, 1))
        calls = self.transport.call_count
        stale = self.replace_photo(card, metadata_image(), headers)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(self.transport.call_count, calls)
        self.assertEqual(self.database.card_submissions.find_one({'_id': card['id']}), after)

    def test_private_photo_replacement_rejects_owner_direct_permission_missing_foreign_shared_and_locked(self):
        card = self.upload('card', metadata_image(), 'image/png').json()
        _, headers = self.card_manager()
        _, wrong_permission = self.card_manager(['board_manage'])
        calls = self.transport.call_count
        for auth, target in ((self.headers['child-a'], 'child-a'), (wrong_permission, 'child-a'), (headers, 'child-b')):
            self.assertEqual(self.replace_photo(card, metadata_image(), auth, target=target).status_code, 403)
        self.database.card_submissions.update_one({'_id': card['id']}, {'$set': {'visibility': 'shared'}})
        self.assertEqual(self.replace_photo(card, metadata_image(), headers).status_code, 403)
        self.database.card_submissions.update_one({'_id': card['id']}, {'$set': {'visibility': 'private'}})
        self.database.board_layouts.insert_one({'_id': 'child-a', 'locked_card_ids': ['custom:' + card['id']]})
        self.assertEqual(self.replace_photo(card, metadata_image(), headers).status_code, 409)
        self.assertEqual(self.transport.call_count, calls)
        self.assertEqual(self.database.card_audit_logs.count_documents({'action': 'image_replaced'}), 0)

    def test_photo_replacement_failures_never_remove_existing_original_or_bypass_quota(self):
        card = self.upload('card', metadata_image(), 'image/png').json()
        _, headers = self.card_manager()
        before = self.database.card_submissions.find_one({'_id': card['id']})
        self.assertEqual(self.replace_photo(card, metadata_image('JPEG'), headers).status_code, 422)
        self.provider_passes = False
        self.assertEqual(self.replace_photo(card, metadata_image(), headers).status_code, 422)
        self.provider_passes = True
        with patch.dict(os.environ, IMAGE_USER_LIMIT_MIB='1', IMAGE_TOTAL_LIMIT_MIB='2'):
            self.assertEqual(self.replace_photo(card, metadata_image() + b'x' * (1024 * 1024), headers).status_code, 413)
        self.assertEqual(self.database.card_submissions.find_one({'_id': card['id']}), before)
        self.assertEqual(self.database.card_audit_logs.count_documents({'action': 'image_replaced'}), 0)

    def test_photo_replacement_rechecks_link_after_safety_and_legacy_revision_is_conditional(self):
        card = self.upload('card', metadata_image(), 'image/png').json()
        identity, headers = self.card_manager()
        self.database.card_submissions.update_one({'_id': card['id']}, {'$unset': {'image_revision': ''}})
        before = self.database.card_submissions.find_one({'_id': card['id']})
        def revoke(*_args):
            self.database.caregiver_links.update_one({'supporter_id': identity}, {'$set': {'active': False}})
            return {'status': 'passed', 'provider': 'synthetic', 'reasons': []}
        with patch('app.services.card_submissions.check_image_safety', side_effect=revoke):
            self.assertEqual(self.replace_photo(card, metadata_image(), headers).status_code, 403)
        self.assertEqual(self.database.card_submissions.find_one({'_id': card['id']}), before)
        self.database.caregiver_links.update_one({'supporter_id': identity}, {'$set': {'active': True}})
        response = self.replace_photo(card, metadata_image('JPEG'), headers, mime='image/jpeg')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['image_revision'], 1)

    def test_photo_replacement_compare_and_set_conflict_never_emits_success_audit(self):
        card = self.upload('card', metadata_image(), 'image/png').json()
        _, headers = self.card_manager()
        before = self.database.card_submissions.find_one({'_id': card['id']})
        def compete(*_args):
            self.database.card_submissions.update_one({'_id': card['id']}, {'$inc': {'image_revision': 1}})
        with patch('app.services.card_submissions.storage.check_capacity', side_effect=compete):
            self.assertEqual(self.replace_photo(card, metadata_image(), headers).status_code, 409)
        after = self.database.card_submissions.find_one({'_id': card['id']})
        self.assertEqual(after['original_image'], before['original_image'])
        self.assertEqual(self.database.card_audit_logs.count_documents({'action': 'image_replaced'}), 0)

    def test_edited_card_archives_original_and_checks_full_frame_before_clean_edited_derivatives(self):
        original = metadata_image()
        result = self.upload('card', original, 'image/png', edits={
            'crop': 'square', 'rotation': 90, 'brightness': 125}).json()
        stored = self.database.card_submissions.find_one({'_id': result['id']})
        self.assertEqual(stored['original_image']['data'], original)
        self.assertEqual(stored['original_image']['sha256'], hashlib.sha256(original).hexdigest())
        self.assertEqual(stored['image_edits'], {
            'version': 'card-image-edit-v1', 'crop': 'square', 'rotation': 90, 'brightness': 125})
        self.assertEqual(len(self.sent_images), 2)
        sizes = []
        for content in self.sent_images:
            assert_clean_webp(self, content)
            with Image.open(BytesIO(content)) as image:
                sizes.append(image.size)
        self.assertEqual(sizes, [(128, 160), (128, 128)])
        self.assertEqual(stored['image']['data'], self.sent_images[-1])
        for url in (result['image_url'], result['thumbnail_url']):
            served = self.http.get(url, headers=self.headers['child-a'])
            self.assertEqual(served.status_code, 200)
            assert_clean_webp(self, served.content)
            with Image.open(BytesIO(served.content)) as image:
                self.assertEqual(image.size, (128, 128))
        self.assertNotIn('original_image', result)

    def test_invalid_edit_options_never_reach_safety_or_create_documents(self):
        original = metadata_image()
        for edits in ('not-json', '{"crop":"smart"}', '{"rotation":45}', '{"brightness":151}',
                      '{"brightness":true}', '{"url":"https://private.invalid"}', ' ' * 257):
            with self.subTest(edits=edits):
                self.upload('card', original, 'image/png', edits=edits, expected=422)
        self.transport.assert_not_called()
        self.assertEqual(self.database.card_submissions.count_documents({}), 0)
        self.assertEqual(self.database.card_audit_logs.count_documents({}), 0)

    def test_card_formats_archive_original_but_serve_only_clean_webp_and_drop_original_filename(self):
        for format, mime in FORMATS.items():
            with self.subTest(format=format):
                original = metadata_image(format)
                response = self.upload('card', original, mime).json()
                document = self.database.card_submissions.find_one({'_id': response['id']})
                archived = document['original_image']
                self.assertEqual(archived['data'], original)
                self.assertEqual(archived['content_type'], mime)
                self.assertEqual(archived['size_bytes'], len(original))
                self.assertEqual(archived['sha256'], hashlib.sha256(original).hexdigest())
                self.assertNotIn('original_image', response)
                stored = document['image']
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
                self.assertEqual(stored['original_image']['data'], original)
                self.assertEqual(stored['original_image']['content_type'], mime)
                self.assertEqual(stored['original_image']['sha256'], hashlib.sha256(original).hexdigest())
                self.assertNotIn('original_image', response)
                self.assertNotEqual(stored['image_data'], original)
                served = self.http.get(response['image_url'], headers=self.headers['child-a'])
                self.assertEqual(served.status_code, 200)
                self.assertEqual(served.content, stored['image_data'])
                self.assertEqual(served.headers['content-type'], 'image/webp')
                assert_clean_webp(self, served.content)

    def test_originals_are_not_in_auth_list_export_and_are_removed_with_profile_replacement_or_deletion(self):
        card = self.upload('card', metadata_image('JPEG'), 'image/jpeg').json()
        self.upload('profile', metadata_image(), 'image/png')
        for path in ('/api/auth/me', '/api/cards/submissions', '/api/privacy/export'):
            response = self.http.get(path, headers=self.headers['child-a'])
            self.assertEqual(response.status_code, 200, response.text)
            self.assertNotIn('original_image', response.text)
            self.assertNotIn(PRIVATE.decode(), response.text)
        # An approved shared card must also expose only its clean display image to another user.
        self.database.card_submissions.update_one({'_id': card['id']}, {'$set': {'visibility': 'shared'}})
        served = self.http.get(card['image_url'], headers=self.headers['child-b'])
        self.assertEqual(served.status_code, 200)
        assert_clean_webp(self, served.content)
        preset = self.http.put('/api/profile', headers=self.headers['child-a'], json={'preset': 'pink'})
        self.assertEqual(preset.status_code, 200)
        self.assertEqual(self.database.users.find_one({'_id': 'child-a'})['profile'], {'kind': 'preset', 'preset': 'pink'})
        self.upload('profile', metadata_image('WEBP'), 'image/webp')
        self.upload('profile', metadata_image('JPEG'), 'image/jpeg')
        self.assertEqual(self.database.users.find_one({'_id': 'child-a'})['profile']['original_image']['content_type'], 'image/jpeg')
        self.database.users.update_one({'_id': 'child-b'}, {'$set': {'profile': {'kind': 'preset', 'preset': 'sky'}}})
        deletion = self.http.request('DELETE', '/api/privacy/data', headers=self.headers['child-a'], json={'confirmation': 'DELETE'})
        self.assertEqual(deletion.status_code, 200, deletion.text)
        self.assertIsNone(self.database.card_submissions.find_one({'_id': card['id']}))
        self.assertNotIn('profile', self.database.users.find_one({'_id': 'child-a'}))
        self.assertEqual(self.database.users.find_one({'_id': 'child-b'})['profile']['preset'], 'sky')

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


    def test_display_thumbnail_sizes_cache_revalidation_and_private_authorization(self):
        from io import BytesIO
        from PIL import Image
        output = BytesIO(); Image.new('RGBA', (1800, 900), (200, 10, 50, 120)).save(output, format='PNG')
        for kind, display_edge, thumb_edge in [('card', 1280, 256), ('profile', 512, 128)]:
            saved = self.upload(kind, output.getvalue(), 'image/png').json()
            display = self.http.get(saved['image_url'], headers=self.headers['child-a'])
            thumb = self.http.get(saved['thumbnail_url'], headers=self.headers['child-a'])
            self.assertEqual(thumb.status_code, 200)
            self.assertEqual(display.headers['cache-control'], 'private, no-cache')
            with Image.open(BytesIO(display.content)) as image:
                self.assertEqual(image.size, (display_edge, display_edge // 2))
            with Image.open(BytesIO(thumb.content)) as image:
                self.assertEqual(image.size, (thumb_edge, thumb_edge // 2))
            assert_clean_webp(self, thumb.content)
            cached_headers = self.headers['child-a'] | {'If-None-Match': thumb.headers['etag']}
            cached = self.http.get(saved['thumbnail_url'], headers=cached_headers)
            self.assertEqual(cached.status_code, 304)
            self.assertEqual(cached.content, b'')
            denied = self.http.get(saved['thumbnail_url'], headers=self.headers['child-b'] | {'If-None-Match': thumb.headers['etag']})
            self.assertEqual(denied.status_code, 403)
            original = self.http.get(saved['image_url'].split('?')[0] + '?variant=original', headers=self.headers['child-a'])
            self.assertEqual(original.status_code, 422)

    def test_quotas_measure_all_variants_charge_owner_and_reject_without_mutation(self):
        from app.services.image_storage import byte_count, usage
        with patch.dict(os.environ, IMAGE_USER_LIMIT_MIB='1', IMAGE_TOTAL_LIMIT_MIB='2'):
            self.database.users.update_one({'_id': 'child-a'}, {'$set': {'profile': {
                'kind': 'preset', 'preset': 'pink', 'original_image': {'data': b'x' * (1024 * 1024)}}}})
            self.upload('card', metadata_image(), 'image/png', expected=413)
            self.assertEqual(self.database.card_submissions.count_documents({}), 0)
            self.assertEqual(self.database.card_audit_logs.count_documents({}), 0)
            # Shrinking an over-quota legacy profile is allowed instead of trapping the user.
            self.upload('profile', metadata_image(), 'image/png')
            saved = self.database.users.find_one({'_id': 'child-a'})['profile']
            measured = usage(self.database, 'child-a')
            self.assertEqual(measured['user_bytes'], byte_count(saved))
            self.database.users.update_one({'_id': 'child-b'}, {'$set': {'profile': {
                'kind': 'preset', 'preset': 'sky', 'original_image': {'data': b'x' * (2 * 1024 * 1024)}}}})
            self.upload('card', metadata_image(), 'image/png', expected=413)
            self.assertEqual(self.database.users.find_one({'_id': 'child-a'})['profile'], saved)

    def test_global_lock_blocks_another_writer_but_not_card_reads_and_requires_exact_recovery_token(self):
        from app.image_maintenance import maintain
        from app.services.image_storage import LOCK_ID, image_write_lock
        with image_write_lock(self.database):
            self.upload('card', metadata_image(), 'image/png', expected=409)
            self.assertEqual(self.http.get('/api/cards', headers=self.headers['child-a']).status_code, 200)
        self.database.image_storage_state.insert_one({'_id': LOCK_ID, 'token': 'simulated-stopped-writer'})
        report = maintain(self.database, 'clear-lock')
        self.assertTrue(report['lock_present'])
        with self.assertRaises(ValueError):
            maintain(self.database, 'clear-lock', apply=True, confirm_database=self.name,
                writers_stopped=True, lock_token='not-the-owned-token')
        maintain(self.database, 'clear-lock', apply=True, confirm_database=self.name,
            writers_stopped=True, lock_token=report['lock_token'])
        self.upload('card', metadata_image(), 'image/png')

    def test_deletion_between_normalization_and_storage_cannot_resurrect_originals(self):
        from app.services.privacy import delete_personal_data
        for kind, target in [('card', 'app.services.card_submissions.check_image_safety'),
                             ('profile', 'app.services.profiles.check_image_safety')]:
            def remove_then_pass(*args):
                delete_personal_data('child-a')
                return {'status': 'passed', 'provider': 'synthetic', 'reasons': []}
            self.database.privacy_settings.update_one({'_id': 'child-a'}, {'$set': {'guardian_consent': True, 'deletion_status': 'none'}})
            with patch(target, side_effect=remove_then_pass):
                self.upload(kind, metadata_image(), 'image/png', expected=409)
            self.assertEqual(self.database.card_submissions.count_documents({}), 0)
            self.assertNotIn('profile', self.database.users.find_one({'_id': 'child-a'}))
        self.assertIsNotNone(self.database.image_storage_state.find_one({'_id': 'deletion-cutoff'}))

    def test_orphan_cleanup_is_bounded_dry_run_and_removes_only_owned_image_payloads(self):
        from app.image_maintenance import maintain
        card = self.upload('card', metadata_image(), 'image/png').json()
        self.database.card_submissions.update_one({'_id': card['id']}, {'$set': {'owner_id': 'nonexistent-synthetic-owner'}})
        self.database.users.update_one({'_id': 'child-b'}, {'$set': {'profile': {'kind': 'preset',
            'preset': 'sky', 'original_image': {'data': b'synthetic unused bytes'}}}})
        report = maintain(self.database)
        self.assertEqual((report['orphan_cards'], report['stale_preset_images'], report['changed']), (1, 1, 0))
        self.assertIsNotNone(self.database.card_submissions.find_one({'_id': card['id']}))
        report = maintain(self.database, apply=True, confirm_database=self.name, writers_stopped=True)
        self.assertEqual(report['changed'], 2)
        self.assertIsNone(self.database.card_submissions.find_one({'_id': card['id']}))
        self.assertEqual(self.database.users.find_one({'_id': 'child-b'})['profile'], {'kind': 'preset', 'preset': 'sky'})
        self.assertIsNotNone(self.database.users.find_one({'_id': 'child-a'}))
        self.assertIsNotNone(self.database.image_storage_state.find_one({'_id': 'deletion-cutoff'}))

    def test_thin_derivative_backfill_preserves_originals_display_and_upload_minimum(self):
        from app.image_maintenance import maintain
        for size in ((4096, 128), (128, 4096)):
            with self.subTest(size=size):
                output = BytesIO()
                Image.new('RGBA', size, (20, 30, 40, 64)).save(output, format='PNG')
                original = output.getvalue()
                card = self.upload('card', original, 'image/png').json()
                profile = self.upload('profile', original, 'image/png').json()
                self.database.card_submissions.update_one({'_id': card['id']}, {'$unset': {'thumbnail': ''}})
                self.database.users.update_one({'_id': 'child-a'}, {'$unset': {
                    'profile.thumbnail_data': '', 'profile.thumbnail_url': '', 'profile.thumbnail_version': ''}})
                before_card = self.database.card_submissions.find_one({'_id': card['id']})
                before_profile = self.database.users.find_one({'_id': 'child-a'})['profile']
                for kind, display in (('card', before_card['image']['data']),
                                      ('profile', before_profile['image_data'])):
                    self.upload(kind, display, 'image/webp', expected=422)
                plan = maintain(self.database, 'backfill')
                self.assertEqual((plan['missing_thumbnails'], plan['changed']), (2, 0))
                self.assertEqual(self.database.card_submissions.find_one({'_id': card['id']}), before_card)
                self.assertEqual(self.database.users.find_one({'_id': 'child-a'})['profile'], before_profile)
                result = maintain(self.database, 'backfill', apply=True,
                                  confirm_database=self.name, writers_stopped=True)
                self.assertEqual((result['changed'], result['skipped']), (2, 0))
                after_card = self.database.card_submissions.find_one({'_id': card['id']})
                after_profile = self.database.users.find_one({'_id': 'child-a'})['profile']
                self.assertEqual(after_card['image'], before_card['image'])
                self.assertEqual(after_profile['image_data'], before_profile['image_data'])
                for document in (after_card, after_profile):
                    self.assertEqual(document['original_image']['data'], original)
                for url, bounds in ((card['thumbnail_url'], (256, 8)),
                                    (after_profile['thumbnail_url'], (128, 4))):
                    served = self.http.get(url, headers=self.headers['child-a'])
                    self.assertEqual(served.status_code, 200)
                    assert_clean_webp(self, served.content)
                    with Image.open(BytesIO(served.content)) as image:
                        self.assertEqual(image.size, bounds if size[0] > size[1] else bounds[::-1])
                        self.assertEqual(image.getpixel((0, 0))[3], 64)
                self.assertEqual(maintain(self.database, 'backfill', apply=True,
                    confirm_database=self.name, writers_stopped=True)['changed'], 0)

    def test_legacy_thumbnail_fallback_backfill_and_idempotence_keep_originals_unchanged(self):
        from app.image_maintenance import maintain
        card = self.upload('card', metadata_image(), 'image/png').json()
        profile = self.upload('profile', metadata_image(), 'image/png').json()
        original = self.database.card_submissions.find_one({'_id': card['id']})['original_image']
        self.database.card_submissions.update_one({'_id': card['id']}, {'$unset': {'thumbnail': ''}})
        self.database.users.update_one({'_id': 'child-a'}, {'$unset': {
            'profile.thumbnail_data': '', 'profile.thumbnail_url': '', 'profile.thumbnail_version': ''}})
        for url in (card['thumbnail_url'], profile['image_url'] + '&variant=thumbnail'):
            self.assertEqual(self.http.get(url, headers=self.headers['child-a']).status_code, 200)
        self.assertEqual(maintain(self.database, 'backfill')['missing_thumbnails'], 2)
        report = maintain(self.database, 'backfill', apply=True, confirm_database=self.name, writers_stopped=True)
        self.assertEqual(report['changed'], 2)
        self.assertEqual(self.database.card_submissions.find_one({'_id': card['id']})['original_image'], original)
        self.assertEqual(maintain(self.database, 'backfill', apply=True, confirm_database=self.name, writers_stopped=True)['changed'], 0)


if __name__ == '__main__':
    unittest.main()
