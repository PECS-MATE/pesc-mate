import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import HTTPException

from app.services.account_access import account_access_allowed, public_access_state
from app.services.account_permissions import can_manage_account_permissions


class AccountAccessTests(unittest.TestCase):
    def test_legacy_accounts_are_active_without_deadline(self):
        self.assertTrue(account_access_allowed({}))
        self.assertEqual(public_access_state({}), {'account_active': True, 'access_expires_at': None})

    def test_disabled_is_denied_even_before_deadline(self):
        self.assertFalse(account_access_allowed({'account_active': False}))
        self.assertFalse(account_access_allowed({'account_active': False,
                                               'access_expires_at': datetime.now(timezone.utc) + timedelta(days=1)}))

    def test_deadline_boundary_and_mongodb_naive_utc(self):
        deadline = datetime(2030, 1, 1, tzinfo=timezone.utc)
        for value in (deadline, deadline.replace(tzinfo=None), deadline.astimezone(timezone(timedelta(hours=9)))):
            user = {'access_expires_at': value}
            self.assertTrue(account_access_allowed(user, deadline - timedelta(milliseconds=1)))
            self.assertFalse(account_access_allowed(user, deadline))
            self.assertFalse(account_access_allowed(user, deadline + timedelta(milliseconds=1)))
            self.assertEqual(public_access_state(user)['access_expires_at'], deadline.isoformat())

    def test_malformed_database_access_fields_fail_closed(self):
        for user in ({'account_active': None}, {'account_active': 1}, {'account_active': 'true'},
                     {'access_expires_at': '2030-01-01T00:00:00Z'}, {'access_expires_at': 0}):
            with self.subTest(user=user), self.assertRaises(HTTPException) as caught:
                account_access_allowed(user)
            self.assertEqual(caught.exception.status_code, 503)

    @patch.dict('os.environ', ACCOUNT_PERMISSION_MANAGER_IDS='manager')
    def test_disabled_or_expired_configured_manager_has_no_authority(self):
        user = {'_id': 'manager', 'role': 'support_staff'}
        self.assertFalse(can_manage_account_permissions(user | {'account_active': False}))
        self.assertFalse(can_manage_account_permissions(user | {'access_expires_at': datetime(2000, 1, 1)}))
