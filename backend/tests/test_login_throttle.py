import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.services.authentication import login
from app.services.login_throttle import (_key, clear_login_failures, ensure_login_allowed,
                                         record_login_failure)

NOW = datetime(2026, 10, 15, 9, 0, tzinfo=timezone.utc)


class LoginThrottleTests(unittest.TestCase):
    def setUp(self):
        patcher = patch('app.services.login_throttle._database')
        self.database = MagicMock()
        patcher.start().return_value = self.database
        self.addCleanup(patcher.stop)

    def test_key_hashes_username_and_client_without_storing_raw_values(self):
        key = _key('Demo', '10.0.0.1')
        self.assertEqual(key, _key('demo', '10.0.0.1'))
        self.assertNotEqual(key, _key('demo', '10.0.0.2'))
        self.assertNotIn('demo', key)
        self.assertEqual(len(key), 64)

    def test_allows_login_without_recent_failures(self):
        self.database.login_attempts.find_one.return_value = None
        ensure_login_allowed('demo', '10.0.0.1', now=NOW)

    def test_allows_login_below_failure_limit(self):
        self.database.login_attempts.find_one.return_value = {
            'failures': 4, 'expires_at': NOW + timedelta(minutes=10)}
        ensure_login_allowed('demo', '10.0.0.1', now=NOW)

    @patch.dict('os.environ', {'LOGIN_MAX_FAILURES': '5'})
    def test_blocks_login_at_failure_limit_until_window_ends(self):
        self.database.login_attempts.find_one.return_value = {
            'failures': 5, 'expires_at': NOW + timedelta(minutes=9, seconds=30)}
        with self.assertRaises(HTTPException) as caught:
            ensure_login_allowed('demo', '10.0.0.1', now=NOW)
        self.assertEqual(caught.exception.status_code, 429)
        self.assertIn('10분', caught.exception.detail)
        self.assertEqual(caught.exception.headers['Retry-After'], '571')

    def test_allows_login_after_window_expires_before_ttl_cleanup(self):
        self.database.login_attempts.find_one.return_value = {
            'failures': 9, 'expires_at': (NOW - timedelta(seconds=1)).replace(tzinfo=None)}
        ensure_login_allowed('demo', '10.0.0.1', now=NOW)

    @patch.dict('os.environ', {'LOGIN_LOCK_MINUTES': '15'})
    def test_failure_increments_count_and_extends_window(self):
        self.database.login_attempts.find_one.return_value = None
        record_login_failure('demo', '10.0.0.1', now=NOW)
        query, update = self.database.login_attempts.update_one.call_args.args
        self.assertEqual(query, {'_id': _key('demo', '10.0.0.1')})
        self.assertEqual(update['$inc'], {'failures': 1})
        self.assertEqual(update['$set']['expires_at'], NOW + timedelta(minutes=15))
        self.assertTrue(self.database.login_attempts.update_one.call_args.kwargs['upsert'])
        self.database.login_attempts.delete_one.assert_not_called()

    def test_failure_after_expired_window_starts_a_new_count(self):
        expired = NOW - timedelta(minutes=1)
        self.database.login_attempts.find_one.return_value = {'failures': 5, 'expires_at': expired}
        record_login_failure('demo', '10.0.0.1', now=NOW)
        self.database.login_attempts.delete_one.assert_called_once_with(
            {'_id': _key('demo', '10.0.0.1'), 'expires_at': expired})

    def test_success_clears_failures(self):
        clear_login_failures('demo', '10.0.0.1')
        self.database.login_attempts.delete_one.assert_called_once_with({'_id': _key('demo', '10.0.0.1')})


@patch.dict('os.environ', {'DEMO_ACCOUNTS_ENABLED': ''})
class LoginFlowThrottleTests(unittest.TestCase):
    @patch('app.services.authentication.record_login_failure')
    @patch('app.services.authentication.ensure_login_allowed')
    @patch('app.services.authentication._database')
    def test_unknown_user_counts_as_failure(self, mocked_database, _allowed, mocked_failure):
        mocked_database.return_value.users.find_one.return_value = None
        with self.assertRaises(HTTPException) as caught:
            login('nobody', 'password123', '10.0.0.1')
        self.assertEqual(caught.exception.status_code, 401)
        mocked_failure.assert_called_once_with('nobody', '10.0.0.1')

    @patch('app.services.authentication._password_hash', return_value=('salt', 'other-hash'))
    @patch('app.services.authentication.record_login_failure')
    @patch('app.services.authentication.ensure_login_allowed')
    @patch('app.services.authentication._database')
    def test_wrong_password_counts_as_failure(self, mocked_database, _allowed, mocked_failure, _hash):
        mocked_database.return_value.users.find_one.return_value = {
            '_id': 'demo', 'password_salt': 'salt', 'password_hash': 'stored-hash'}
        with self.assertRaises(HTTPException) as caught:
            login('demo', 'wrong-password', '10.0.0.1')
        self.assertEqual(caught.exception.status_code, 401)
        mocked_failure.assert_called_once_with('demo', '10.0.0.1')

    @patch('app.services.authentication._password_hash')
    @patch('app.services.authentication.ensure_login_allowed',
           side_effect=HTTPException(429, '로그인 시도가 너무 많습니다.'))
    @patch('app.services.authentication._database')
    def test_locked_login_does_not_check_password(self, mocked_database, _allowed, mocked_hash):
        with self.assertRaises(HTTPException) as caught:
            login('demo', 'demo1234', '10.0.0.1')
        self.assertEqual(caught.exception.status_code, 429)
        mocked_hash.assert_not_called()
        mocked_database.return_value.users.find_one.assert_not_called()


if __name__ == '__main__':
    unittest.main()
