import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.reauthentication import reauthenticate_content_operator


class ReauthenticationTests(unittest.TestCase):
    def setUp(self):
        self.actor = {'id': 'operator', 'role': 'support_staff', 'account_permissions': ['content_manage']}
        self.account = {'_id': 'operator', 'username': 'operator', 'role': 'support_staff',
                        'account_permissions': ['content_manage'], 'password_salt': 'salt', 'password_hash': 'verified'}
        self.db = MagicMock()
        self.db.users.find_one.return_value = self.account
        for target, options in (
            ('app.services.reauthentication._database', {'return_value': self.db}),
            ('app.services.authentication._password_hash', {'return_value': ('salt', 'verified')}),
            ('app.services.login_throttle.ensure_login_allowed', {}),
            ('app.services.login_throttle.clear_login_failures', {}),
            ('app.services.login_throttle.record_login_failure', {}),
        ):
            mocked = patch(target, **options)
            setattr(self, target.rsplit('.', 1)[-1], mocked.start())
            self.addCleanup(mocked.stop)

    def verify(self):
        return reauthenticate_content_operator(self.actor, 'never-log-this', '127.0.0.1')

    def test_success_rechecks_database_and_only_clears_separate_failure_scope(self):
        self.verify()
        self.db.users.find_one.assert_called_once_with({'_id': 'operator'})
        self.ensure_login_allowed.assert_called_once_with('content-operation:operator', '127.0.0.1')
        self.clear_login_failures.assert_called_once_with('content-operation:operator', '127.0.0.1')
        self.db.auth_sessions.insert_one.assert_not_called()
        self.db.users.update_one.assert_not_called()

    def test_wrong_password_records_failure_and_never_clears_it(self):
        self._password_hash.return_value = ('salt', 'wrong')
        with self.assertRaises(HTTPException) as caught:
            self.verify()
        self.assertEqual(caught.exception.status_code, 403)
        self.assertNotIn('never-log-this', caught.exception.detail)
        self.record_login_failure.assert_called_once()
        self.clear_login_failures.assert_not_called()

    def test_locked_scope_stops_before_password_verification(self):
        self.ensure_login_allowed.side_effect = HTTPException(429, '잠시 후 다시 시도해 주세요.')
        with self.assertRaises(HTTPException) as caught:
            self.verify()
        self.assertEqual(caught.exception.status_code, 429)
        self._password_hash.assert_not_called()

    def test_fresh_access_revision_or_permission_change_denies_before_password_check(self):
        for changes, status in (({'account_active': False}, 401), ({'permission_revision': 1}, 401),
                                ({'account_permissions': []}, 403), ({'role': 'caregiver'}, 403)):
            with self.subTest(changes=changes):
                self.db.users.find_one.return_value = self.account | changes
                with self.assertRaises(HTTPException) as caught:
                    self.verify()
                self.assertEqual(caught.exception.status_code, status)
        self._password_hash.assert_not_called()

    def test_missing_account_and_database_failure_never_authenticate(self):
        self.db.users.find_one.return_value = None
        with self.assertRaises(HTTPException) as caught:
            self.verify()
        self.assertEqual(caught.exception.status_code, 401)
        self.db.users.find_one.side_effect = PyMongoError('private-connection-detail')
        with self.assertRaises(HTTPException) as caught:
            self.verify()
        self.assertEqual(caught.exception.status_code, 503)
        self.assertNotIn('private-connection-detail', caught.exception.detail)
        self._password_hash.assert_not_called()

    def test_claimed_permission_is_not_sufficient_and_unprivileged_actor_never_reads_secrets(self):
        self.actor['account_permissions'] = []
        with self.assertRaises(HTTPException) as caught:
            self.verify()
        self.assertEqual(caught.exception.status_code, 403)
        self.db.users.find_one.assert_not_called()
