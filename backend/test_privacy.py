import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.services.privacy import (
    DEFAULT_PRIVACY, connect_caregiver, delete_personal_data, disconnect_caregiver,
    privacy_for, save_privacy,
)
from app.api.router import require_guardian_consent


class PrivacyTests(unittest.TestCase):
    @patch('app.api.router.privacy_for')
    def test_sensitive_storage_requires_guardian_consent(self, mocked_privacy):
        mocked_privacy.return_value = DEFAULT_PRIVACY
        with self.assertRaises(HTTPException) as caught:
            require_guardian_consent({'id': 'demo', 'role': 'user'})
        self.assertEqual(caught.exception.status_code, 403)

    @patch('app.services.privacy._database')
    def test_defaults_and_retention_are_user_scoped(self, mocked_database):
        database = MagicMock()
        database.privacy_settings.find_one.return_value = None
        mocked_database.return_value = database
        self.assertEqual(privacy_for('demo'), DEFAULT_PRIVACY)

        saved = save_privacy('demo', True, 90)
        self.assertTrue(saved['guardian_consent'])
        query, update = database.privacy_settings.update_one.call_args.args[:2]
        self.assertEqual(query, {'_id': 'demo'})
        self.assertEqual(update['$set']['retention_days'], 90)
        database.communication_sessions.delete_many.assert_called_once()
        database.caregiver_notes.delete_many.assert_called_once()

    @patch('app.services.privacy._database')
    def test_connect_and_disconnect_caregiver_are_audited(self, mocked_database):
        database = MagicMock()
        database.users.find_one.return_value = {
            '_id': 'caregiver', 'username': 'caregiver', 'name': '보호자', 'role': 'caregiver',
        }
        database.caregiver_links.find.return_value = []
        database.caregiver_links.delete_one.return_value.deleted_count = 1
        mocked_database.return_value = database

        connect_caregiver('demo', 'caregiver')
        database.caregiver_links.update_one.assert_called_once()
        disconnect_caregiver('demo', 'caregiver')
        self.assertEqual(database.privacy_audit_logs.insert_one.call_count, 2)

    @patch('app.services.privacy._database')
    def test_unknown_caregiver_is_rejected(self, mocked_database):
        database = MagicMock()
        database.users.find_one.return_value = None
        mocked_database.return_value = database
        with self.assertRaises(HTTPException) as caught:
            connect_caregiver('demo', 'missing')
        self.assertEqual(caught.exception.status_code, 404)

    @patch('app.services.privacy._database')
    def test_delete_clears_user_content_and_keeps_receipt(self, mocked_database):
        database = MagicMock()
        database.card_submissions.find.return_value = [{'_id': 'card'}]
        mocked_database.return_value = database

        receipt = delete_personal_data('demo')

        self.assertEqual(receipt['deletion_status'], 'completed')
        database.communication_sessions.delete_many.assert_called_once_with({'user_id': 'demo'})
        database.users.update_one.assert_called_once_with({'_id': 'demo'}, {'$unset': {'profile': ''}})
        self.assertTrue(database.privacy_settings.update_one.call_args.kwargs['upsert'])


if __name__ == '__main__':
    unittest.main()
