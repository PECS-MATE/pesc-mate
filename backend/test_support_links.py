import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.services.support_links import (
    LEGACY_PERMISSIONS, change_support_permissions, grant_support, require_link_permission,
    revoke_support, require_any_link_permission, validate_permissions,
)


class SupportLinkTests(unittest.TestCase):
    @patch('app.services.support_links._database')
    def test_permission_is_checked_server_side(self, mocked_database):
        database = MagicMock()
        database.caregiver_links.find_one.return_value = {
            '_id': 'staff:child', 'supporter_id': 'staff', 'user_id': 'child',
            'active': True, 'permissions': ['records_read'],
        }
        mocked_database.return_value = database
        supporter = {'id': 'staff', 'role': 'support_staff'}

        self.assertEqual(require_link_permission(supporter, 'child', 'records_read'), 'child')
        with self.assertRaises(HTTPException) as caught:
            require_link_permission(supporter, 'child', 'voice_access_manage')
        self.assertEqual(caught.exception.status_code, 403)

    @patch('app.services.support_links.support_access_for', return_value=[])
    @patch('app.services.support_links._database')
    def test_grant_change_and_revoke_record_actor_and_time(self, mocked_database, _mocked_access):
        database = MagicMock()
        database.users.find_one.return_value = {
            '_id': 'staff', 'username': 'staff', 'name': '담당자', 'role': 'support_staff',
        }
        database.caregiver_links.find_one.side_effect = [
            None,
            {'_id': 'staff:child', 'supporter_id': 'staff', 'user_id': 'child',
             'permissions': ['records_read'], 'active': True},
            {'_id': 'staff:child', 'supporter_id': 'staff', 'user_id': 'child',
             'permissions': ['records_read', 'notes_write'], 'active': True},
        ]
        mocked_database.return_value = database

        grant_support('child', 'staff', ['records_read'], 'child')
        change_support_permissions('child', 'staff', ['records_read', 'notes_write'], 'child')
        revoke_support('child', 'staff', 'child')

        audits = [call.args[0] for call in database.privacy_audit_logs.insert_one.call_args_list]
        self.assertEqual([row['action'] for row in audits], [
            'support_granted', 'support_permissions_changed', 'support_revoked',
        ])
        self.assertTrue(all(row['actor_id'] == 'child' and row['created_at'] for row in audits))

    def test_empty_or_unknown_permissions_are_rejected(self):
        self.assertEqual(validate_permissions(['cards_manage']), ['cards_manage'])
        self.assertNotIn('cards_manage', LEGACY_PERMISSIONS)
        with self.assertRaises(HTTPException):
            validate_permissions([])
        with self.assertRaises(HTTPException):
            validate_permissions(['not-a-permission'])

    @patch('app.services.support_links._database')
    def test_board_layout_read_accepts_either_management_permission(self, mocked_database):
        database = MagicMock()
        database.caregiver_links.find_one.return_value = {
            'supporter_id': 'staff', 'user_id': 'child', 'active': True,
            'permissions': ['quick_speech_manage'],
        }
        mocked_database.return_value = database
        supporter = {'id': 'staff', 'role': 'support_staff'}
        self.assertEqual(require_any_link_permission(
            supporter, 'child', {'quick_speech_manage', 'board_manage'}), 'child')

    @patch('app.services.support_links._database')
    def test_staff_access_is_scoped_to_linked_child_and_each_permission(self, mocked_database):
        database = MagicMock()
        mocked_database.return_value = database
        supporter = {'id': 'staff', 'role': 'support_staff'}

        for permission in (
            'records_read', 'notes_write', 'cards_manage', 'quick_speech_manage',
            'board_manage', 'voice_access_manage', 'learning_manage',
        ):
            database.caregiver_links.find_one.return_value = {
                '_id': 'staff:child', 'supporter_id': 'staff', 'user_id': 'child',
                'active': True, 'permissions': [permission],
            }
            self.assertEqual(require_link_permission(supporter, 'child', permission), 'child')
            other_permission = 'records_read' if permission != 'records_read' else 'learning_manage'
            with self.assertRaises(HTTPException) as denied:
                require_link_permission(supporter, 'child', other_permission)
            self.assertEqual(denied.exception.status_code, 403)

        database.caregiver_links.find_one.return_value = None
        with self.assertRaises(HTTPException) as other_child:
            require_link_permission(supporter, 'other-child', 'records_read')
        self.assertEqual(other_child.exception.status_code, 403)

    @patch('app.services.support_links._database')
    def test_revoked_link_blocks_every_permission(self, mocked_database):
        database = MagicMock()
        database.caregiver_links.find_one.return_value = {
            '_id': 'staff:child', 'supporter_id': 'staff', 'user_id': 'child',
            'active': False, 'permissions': ['records_read', 'learning_manage'],
        }
        mocked_database.return_value = database
        supporter = {'id': 'staff', 'role': 'support_staff'}

        for permission in ('records_read', 'learning_manage'):
            with self.assertRaises(HTTPException) as denied:
                require_link_permission(supporter, 'child', permission)
            self.assertEqual(denied.exception.status_code, 403)


if __name__ == '__main__':
    unittest.main()
