import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.account_permissions import (can_manage_account_permissions, change_content_permission,
                                              permission_revision, require_manager)


class AccountPermissionTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict('os.environ', ACCOUNT_PERMISSION_MANAGER_IDS=' manager , backup ')
        environment.start()
        self.addCleanup(environment.stop)
        self.actor = {'id': 'manager', 'role': 'support_staff', 'permission_revision': 0}

    def test_custodian_requires_exact_configured_id_and_staff_role_not_content_permission(self):
        self.assertTrue(can_manage_account_permissions(self.actor))
        self.assertTrue(can_manage_account_permissions({'_id': 'backup', 'role': 'support_staff'}))
        for actor in ({'id': 'manage', 'role': 'support_staff'},
                      {'id': 'manager', 'role': 'user'}, {'id': 'manager', 'role': 'caregiver'},
                      {'id': 'operator', 'role': 'support_staff', 'account_permissions': ['content_manage']},
                      {'id': 'admin', 'role': 'admin'}):
            with self.assertRaises(HTTPException) as caught:
                require_manager(actor)
            self.assertEqual(caught.exception.status_code, 403)

    @patch.dict('os.environ', ACCOUNT_PERMISSION_MANAGER_IDS='')
    def test_missing_configuration_never_grants_management_authority(self):
        self.assertFalse(can_manage_account_permissions(self.actor))

    def test_missing_revision_is_legacy_zero_and_malformed_revisions_fail_closed(self):
        self.assertEqual(permission_revision({}), 0)
        self.assertEqual(permission_revision({'permission_revision': 7}), 7)
        for value in (True, False, -1, '1', None, 1.0):
            with self.assertRaises(HTTPException) as caught:
                permission_revision({'permission_revision': value})
            self.assertEqual(caught.exception.status_code, 503)

    def database(self):
        db = MagicMock()
        db.users.find_one.side_effect = [
            {'_id': 'manager', 'role': 'support_staff', 'username': 'manager',
             'password_salt': 'salt', 'password_hash': 'verified'},
            {'_id': 'staff', 'role': 'support_staff', 'username': 'staff', 'name': '합성 담당자'},
        ]
        db.users.update_one.return_value.modified_count = 1
        return db

    def change(self, db):
        with patch('app.services.account_permissions._database', return_value=db), \
             patch('app.services.authentication._password_hash', return_value=('salt', 'verified')), \
             patch('app.services.login_throttle.ensure_login_allowed'), \
             patch('app.services.login_throttle.clear_login_failures'):
            return change_content_permission(self.actor, 'staff', True, 0, 'never-log-this', '합성 검증')

    def test_intent_failure_does_not_modify_permissions(self):
        db = self.database()
        db.account_permission_audit_logs.insert_one.side_effect = PyMongoError('private-error')
        with self.assertRaises(HTTPException) as caught:
            self.change(db)
        self.assertEqual(caught.exception.status_code, 503)
        db.users.update_one.assert_not_called()
        self.assertNotIn('private-error', caught.exception.detail)

    def test_authoritative_write_failure_keeps_a_prepared_record(self):
        db = self.database()
        db.users.update_one.side_effect = PyMongoError('private-error')
        with self.assertRaises(HTTPException):
            self.change(db)
        event = db.account_permission_audit_logs.insert_one.call_args.args[0]
        self.assertEqual(event['status'], 'prepared')
        self.assertNotIn('never-log-this', str(event))
        db.account_permission_audit_logs.update_one.assert_not_called()

    def test_finalization_failure_is_reported_as_unknown_not_as_rolled_back(self):
        db = self.database()
        db.account_permission_audit_logs.update_one.side_effect = PyMongoError('private-error')
        with self.assertRaises(HTTPException) as caught:
            self.change(db)
        self.assertEqual(caught.exception.status_code, 503)
        self.assertIn('다시 조회', caught.exception.detail)
        db.users.update_one.assert_called_once()

    def test_permissions_session_version_and_audit_marker_use_one_compare_and_set(self):
        db = self.database()
        result = self.change(db)
        query, update = db.users.update_one.call_args.args
        self.assertEqual(query['role'], 'support_staff')
        self.assertIn('$or', query)
        self.assertEqual(update['$set']['account_permissions'], ['content_manage'])
        self.assertEqual(update['$set']['permission_revision'], 1)
        self.assertEqual(update['$set']['last_account_permission_change'], result['audit_id'])
        self.assertTrue(result['changed'])
