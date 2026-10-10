import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.services.authentication import _public_user, dashboard_user, register, require_account_permission


class AuthorizationTests(unittest.TestCase):
    @patch('app.services.authentication.login')
    @patch('app.services.authentication._database')
    def test_register_creates_user_and_logs_in(self, mocked_database, mocked_login):
        database = MagicMock()
        database.users.find_one.return_value = None
        mocked_database.return_value = database
        mocked_login.return_value = {'access_token': 'token'}
        result = register('new_user', 'password123', '새 사용자')
        self.assertEqual(result['access_token'], 'token')
        document = database.users.insert_one.call_args.args[0]
        self.assertEqual(document['role'], 'user')
        self.assertNotEqual(document['password_hash'], 'password123')

    @patch('app.services.authentication._database')
    def test_register_rejects_duplicate_username(self, mocked_database):
        database = MagicMock()
        database.users.find_one.return_value = {'_id': 'demo'}
        mocked_database.return_value = database
        with self.assertRaises(HTTPException) as caught:
            register('demo', 'password123', '사용자')
        self.assertEqual(caught.exception.status_code, 409)

    def test_user_can_only_read_own_dashboard(self):
        user = {'id': 'demo', 'role': 'user'}
        self.assertEqual(dashboard_user(user), 'demo')
        with self.assertRaises(HTTPException) as caught:
            dashboard_user(user, 'another')
        self.assertEqual(caught.exception.status_code, 403)

    @patch('app.services.authentication.linked_users')
    def test_caregiver_can_only_read_linked_user(self, mocked):
        mocked.return_value = [{'id': 'demo', 'permissions': ['records_read']}]
        caregiver = {'id': 'caregiver', 'role': 'caregiver'}
        self.assertEqual(dashboard_user(caregiver), 'demo')
        with self.assertRaises(HTTPException) as caught:
            dashboard_user(caregiver, 'another')
        self.assertEqual(caught.exception.status_code, 403)

    @patch('app.services.authentication.linked_users')
    def test_same_role_with_different_permissions_gets_different_access(self, mocked):
        supporter = {'id': 'staff', 'role': 'support_staff'}
        mocked.return_value = [{'id': 'demo', 'permissions': ['voice_access_manage']}]
        with self.assertRaises(HTTPException) as caught:
            dashboard_user(supporter, 'demo', 'records_read')
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(dashboard_user(supporter, 'demo', 'voice_access_manage'), 'demo')

    def test_only_staff_with_content_permission_can_operate_shared_content(self):
        operator = {'id': 'operator', 'role': 'support_staff', 'account_permissions': ['content_manage']}
        self.assertEqual(require_account_permission(operator, 'content_manage'), operator)
        with self.assertRaises(HTTPException) as caught:
            require_account_permission({'id': 'staff', 'role': 'support_staff'}, 'content_manage')
        self.assertEqual(caught.exception.status_code, 403)

    @patch('app.services.profiles.public_profile', return_value=None)
    def test_legacy_admin_is_exposed_as_operating_staff(self, _mocked_profile):
        public = _public_user({'_id': 'admin', 'username': 'admin', 'name': '운영자', 'role': 'admin'})
        self.assertEqual(public['role'], 'support_staff')
        self.assertEqual(public['account_permissions'], ['content_manage'])


if __name__ == '__main__':
    unittest.main()
