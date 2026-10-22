from datetime import datetime, timedelta, timezone
from io import BytesIO
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from PIL import Image
from pymongo.errors import DuplicateKeyError

from app.services import image_storage as storage
from app.services.card_submissions import _normalize_image
from app.image_maintenance import maintain


class ImageStorageTests(unittest.TestCase):
    def maintenance_database(self, card_rows=(), profile_rows=()):
        db = MagicMock()
        db.name = 'pesc_mate_fixture'
        db.__getitem__.side_effect = lambda name: getattr(db, name)
        db.image_storage_state.find_one.return_value = None
        db.card_submissions.aggregate.return_value = []
        for collection, rows in ((db.card_submissions, card_rows), (db.users, profile_rows)):
            cursor = collection.find.return_value
            cursor.sort.return_value = cursor
            cursor.limit.return_value = cursor
            cursor.batch_size.return_value = cursor
            cursor.__iter__.side_effect = lambda rows=rows: iter(rows)
            collection.update_one.return_value.modified_count = 1
        db.users.find_one.return_value = {'_id': 'child'}
        return db

    def test_maintenance_dry_run_reads_only_ids_and_never_decodes_images(self):
        for command in ('audit', 'backfill'):
            with self.subTest(command=command):
                db = self.maintenance_database([{'_id': 'card'}], [{'_id': 'child'}])
                with patch('app.image_maintenance._normalize_image') as normalize:
                    report = maintain(db, command)
                self.assertEqual(report['missing_thumbnails'], 2)
                for collection in (db.card_submissions, db.users):
                    for call in collection.find.call_args_list:
                        self.assertEqual(call.args[1], {'_id': 1})
                    collection.update_one.assert_not_called()
                db.image_storage_state.insert_one.assert_not_called()
                normalize.assert_not_called()

    def test_backfill_reads_only_display_fields_not_originals_or_account_data(self):
        db = self.maintenance_database()
        maintain(db, 'backfill', apply=True, confirm_database=db.name, writers_stopped=True)
        self.assertEqual(db.card_submissions.find.call_args.args[1], {
            '_id': 1, 'owner_id': 1, 'image.data': 1, 'image.content_type': 1})
        self.assertEqual(db.users.find.call_args.args[1], {
            '_id': 1, 'profile.image_data': 1, 'profile.content_type': 1, 'profile.image_url': 1})
        for collection in (db.card_submissions, db.users):
            collection.find.return_value.batch_size.assert_called_once_with(1)

    @patch.object(storage, 'check_capacity')
    def test_backfill_accepts_thin_sanitized_derivatives_without_relaxing_upload_rules(self, capacity):
        for size in ((4096, 128), (128, 4096)):
            with self.subTest(size=size):
                source = BytesIO()
                Image.new('RGBA', size, (20, 30, 40, 64)).save(source, format='PNG')
                card, mime = _normalize_image(source.getvalue(), 'image/png')
                profile, _ = _normalize_image(source.getvalue(), 'image/png', max_edge=storage.PROFILE_EDGE)
                # These are valid outputs of the upload path, not new undersized uploads.
                for display in (card, profile):
                    with self.assertRaises(HTTPException) as caught:
                        _normalize_image(display, mime)
                    self.assertEqual(caught.exception.status_code, 422)
                db = self.maintenance_database(
                    [{'_id': 'card', 'owner_id': 'child', 'image': {'data': card, 'content_type': mime}}],
                    [{'_id': 'child', 'profile': {'image_data': profile, 'content_type': mime,
                        'image_url': '/api/profile/child/image?v=synthetic'}}])
                report = maintain(db, 'backfill', apply=True, confirm_database=db.name, writers_stopped=True)
                self.assertEqual((report['changed'], report['skipped']), (2, 0))
                for collection, field, bounds in ((db.card_submissions, 'thumbnail', (256, 8)),
                        (db.users, 'profile.thumbnail_data', (128, 4))):
                    changes = collection.update_one.call_args.args[1]['$set']
                    self.assertEqual(set(changes), {'thumbnail'} if field == 'thumbnail' else {
                        'profile.thumbnail_data', 'profile.thumbnail_version', 'profile.thumbnail_url'})
                    content = changes[field]['data'] if field == 'thumbnail' else changes[field]
                    with Image.open(BytesIO(content)) as image:
                        self.assertEqual(image.size, bounds if size[0] > size[1] else bounds[::-1])
                        self.assertEqual(image.getpixel((0, 0))[3], 64)
                        self.assertFalse(image.getexif())

    def test_thumbnail_has_bounded_aspect_ratio_alpha_and_no_metadata(self):
        original = BytesIO()
        Image.new('RGBA', (800, 400), (20, 30, 40, 64)).save(original, format='WEBP')
        result = storage.thumbnail(original.getvalue())
        with Image.open(BytesIO(result['data'])) as image:
            self.assertEqual(image.size, (256, 128))
            self.assertEqual(image.getpixel((0, 0))[3], 64)
            self.assertFalse(image.getexif())
            self.assertNotIn('xmp', image.info)
        self.assertEqual(len(result['version']), 64)

    def test_byte_count_counts_all_three_variants_not_metadata(self):
        self.assertEqual(storage.byte_count({'image': {'data': b'123'}, 'thumbnail': {'data': b'4'},
            'original_image': {'data': b'567'}, 'label': 'not bytes'}), 7)
        self.assertEqual(storage.byte_count({'image_data': b'123', 'thumbnail_data': b'4',
            'original_image': {'data': b'56'}}), 6)

    @patch.dict('os.environ', IMAGE_USER_LIMIT_MIB='1', IMAGE_TOTAL_LIMIT_MIB='2')
    @patch.object(storage, 'usage')
    def test_quota_replacement_delta_global_limit_and_over_limit_shrink(self, usage):
        db = MagicMock()
        usage.return_value = {'user_bytes': 1024 * 1024, 'total_bytes': 1024 * 1024}
        with self.assertRaises(HTTPException) as caught:
            storage.check_capacity(db, 'child', 1)
        self.assertEqual(caught.exception.status_code, 413)
        storage.check_capacity(db, 'child', 50, 100)
        usage.return_value = {'user_bytes': 0, 'total_bytes': 2 * 1024 * 1024}
        with self.assertRaises(HTTPException):
            storage.check_capacity(db, 'child', 1)

    def test_invalid_quota_configuration_fails_closed(self):
        for user, total in [('0', '1'), ('3', '2'), ('bad', '10')]:
            with patch.dict('os.environ', IMAGE_USER_LIMIT_MIB=user, IMAGE_TOTAL_LIMIT_MIB=total):
                with self.assertRaises(HTTPException) as caught:
                    storage.limits()
                self.assertEqual(caught.exception.status_code, 503)

    def test_lock_is_unique_non_expiring_and_released_on_failure_with_own_token(self):
        db = MagicMock()
        with self.assertRaises(ValueError):
            with storage.image_write_lock(db):
                raise ValueError('synthetic failure')
        inserted = db.image_storage_state.insert_one.call_args.args[0]
        self.assertNotIn('expires_at', inserted)
        db.image_storage_state.delete_one.assert_called_once_with({'_id': storage.LOCK_ID, 'token': inserted['token']})
        db.image_storage_state.insert_one.side_effect = DuplicateKeyError('busy')
        with self.assertRaises(HTTPException) as caught:
            with storage.image_write_lock(db):
                self.fail('A second writer entered the lock')
        self.assertEqual(caught.exception.status_code, 409)

    def test_inflight_upload_and_missing_consent_cannot_recreate_deleted_images(self):
        db = MagicMock()
        now = datetime.now(timezone.utc)
        db.privacy_settings.find_one.return_value = {'image_deleted_before': now, 'guardian_consent': True}
        with self.assertRaises(HTTPException) as caught:
            storage.check_deletion_race(db, 'child', now - timedelta(seconds=1))
        self.assertEqual(caught.exception.status_code, 409)
        db.privacy_settings.find_one.return_value = {'guardian_consent': False}
        with self.assertRaises(HTTPException) as caught:
            storage.check_deletion_race(db, 'child', now, require_consent=True)
        self.assertEqual(caught.exception.status_code, 403)

    def test_maintenance_requires_explicit_database_and_stopped_writers_and_exact_lock_token(self):
        db = MagicMock(); db.name = 'pesc_mate_fixture'
        db.image_storage_state.find_one.return_value = {'token': 'owned-token'}
        for options in ({'apply': True}, {'apply': True, 'confirm_database': db.name}):
            with self.assertRaises(ValueError):
                maintain(db, **options)
        report = maintain(db, 'clear-lock')
        self.assertTrue(report['lock_present'])
        db.image_storage_state.delete_one.assert_not_called()
        with self.assertRaises(ValueError):
            maintain(db, 'clear-lock', apply=True, confirm_database=db.name, writers_stopped=True, lock_token='wrong')
        maintain(db, 'clear-lock', apply=True, confirm_database=db.name, writers_stopped=True, lock_token='owned-token')
        db.image_storage_state.delete_one.assert_called_once_with({'_id': storage.LOCK_ID, 'token': 'owned-token'})
        db.name = 'admin'
        with self.assertRaises(ValueError):
            maintain(db)
