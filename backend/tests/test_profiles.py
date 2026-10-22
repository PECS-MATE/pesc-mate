import unittest
from io import BytesIO
from unittest.mock import MagicMock, patch
from fastapi import HTTPException
from PIL import Image
from app.services.profiles import PRESETS, public_profile, save_profile, profile_image
from app.services.authentication import _public_user
from app.api.router import UserResponse


class ProfileTests(unittest.TestCase):
    @patch('app.services.support_links._database')
    @patch('app.services.authentication._database')
    @patch('app.services.profiles.database')
    def test_saved_profile_survives_new_authenticated_session(self, profile_db, auth_db, support_db):
        from datetime import datetime, timedelta, timezone
        from fastapi.security import HTTPAuthorizationCredentials
        from app.services.authentication import current_user, linked_users
        stored = dict(_id='u', username='u', name='User', role='user')
        database = MagicMock()
        profile_db.return_value = auth_db.return_value = support_db.return_value = database
        def update(query, changes):
            stored.update(changes['$set'])
            return MagicMock(matched_count=1)
        database.users.update_one.side_effect = update
        database.users.find_one.side_effect = lambda query, projection=None: dict(stored)
        database.auth_sessions.find_one.return_value = dict(user_id='u', expires_at=datetime.now(timezone.utc)+timedelta(hours=1))
        save_profile('u', preset='pink')
        for token in ('first-device', 'second-device'):
            account = current_user(HTTPAuthorizationCredentials(scheme='Bearer', credentials=token))
            self.assertEqual(account['profile'], dict(kind='preset', preset='pink'))
        database.users.find_one.assert_called_with({'_id': 'u'}, {'profile.image_data': 0, 'profile.thumbnail_data': 0, 'profile.original_image': 0})
        database.caregiver_links.find.return_value = [dict(user_id='u', permissions=['records_read'])]
        self.assertEqual(linked_users('caregiver')[0]['profile'], account['profile'])

    def test_presets_include_profile_images(self):
        self.assertEqual(PRESETS, [
            dict(id='pink', label='핑크'),
            dict(id='orange', label='오렌지'),
            dict(id='sky', label='하늘'),
            dict(id='cream', label='크림'),
            dict(id='green', label='그린'),
            dict(id='blue', label='블루'),
            dict(id='space', label='우주'),
        ])

    def test_legacy_user_and_response_preserve_profile(self):
        user = dict(_id='u', username='u', name='User', role='user')
        self.assertIsNone(_public_user(user)['profile'])
        user['profile'] = dict(kind='preset', preset='sky')
        self.assertEqual(UserResponse(**_public_user(user)).profile.preset, 'sky')

    @patch('app.services.profiles.database')
    def test_save_scopes_update_and_replaces_previous_image(self, db):
        self.assertEqual(save_profile('u', preset='orange'), dict(kind='preset', preset='orange'))
        db().users.update_one.assert_called_once_with({'_id': 'u'}, {'$set': {'profile': dict(kind='preset', preset='orange')}})

    @patch('app.services.profiles.database')
    def test_unknown_preset_does_not_write(self, db):
        with self.assertRaises(HTTPException):
            save_profile('u', preset='invalid')
        db.assert_not_called()

    @patch('app.services.profiles.database')
    @patch('app.services.profiles.check_image_safety')
    def test_custom_image_only_publishes_when_safe(self, safety, db):
        out = BytesIO()
        Image.new('RGB', (128, 128)).save(out, format='PNG')
        for status in ('blocked', 'manual_review'):
            safety.return_value = {'status': status}
            with self.assertRaises(HTTPException):
                save_profile('u', image_data=out.getvalue(), content_type='image/png')
        db.assert_not_called()
        safety.return_value = {'status': 'passed'}
        result = save_profile('u', image_data=out.getvalue(), content_type='image/png')
        self.assertEqual(result['kind'], 'custom')
        self.assertNotIn('image_data', result)
        stored = db().users.update_one.call_args.args[1]['$set']['profile']
        self.assertEqual(stored['content_type'], 'image/webp')
        self.assertEqual(stored['original_image']['data'], out.getvalue())
        self.assertEqual(stored['original_image']['content_type'], 'image/png')
        self.assertEqual(public_profile({'profile': stored}), result)

    @patch('app.services.profiles.check_image_safety')
    def test_invalid_image_rejected_before_safety_check(self, safety):
        for content, mime in [(b'bad', 'image/png'), (b'x' * (5*1024*1024+1), 'image/png'), (b'bad', 'image/svg+xml')]:
            with self.assertRaises(HTTPException):
                save_profile('u', image_data=content, content_type=mime)
        out = BytesIO()
        Image.new('RGB', (32, 32)).save(out, format='PNG')
        with self.assertRaises(HTTPException):
            save_profile('u', image_data=out.getvalue(), content_type='image/png')
        safety.assert_not_called()

    @patch('app.services.profiles.database')
    def test_other_user_and_admin_cannot_read_image(self, db):
        for role in ('user', 'admin'):
            with self.assertRaises(HTTPException) as error:
                profile_image('u', dict(id='other', role=role))
            self.assertEqual(error.exception.status_code, 403)
        db.assert_not_called()

    @patch('app.services.authentication.linked_users')
    @patch('app.services.profiles.database')
    def test_owner_and_linked_caregiver_can_read(self, db, linked):
        db().users.find_one.return_value = {'profile': dict(kind='custom', image_data=b'webp', content_type='image/webp')}
        self.assertEqual(profile_image('u', dict(id='u', role='user')), (b'webp', 'image/webp'))
        linked.return_value = [dict(id='u', permissions=['records_read'])]
        self.assertEqual(profile_image('u', dict(id='c', role='caregiver')), (b'webp', 'image/webp'))
        linked.return_value = [dict(id='other', permissions=['records_read'])]
        with self.assertRaises(HTTPException):
            profile_image('u', dict(id='c', role='caregiver'))


if __name__ == '__main__':
    unittest.main()
