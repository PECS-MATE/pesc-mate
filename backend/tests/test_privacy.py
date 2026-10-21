import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
from pymongo.errors import PyMongoError

from fastapi import HTTPException

from app.services.privacy import (
    DEFAULT_PRIVACY, delete_personal_data, privacy_for, save_privacy,
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
    def test_delete_clears_user_content_and_keeps_receipt(self, mocked_database):
        database = MagicMock()
        database.card_submissions.find.return_value = [{'_id': 'card'}]
        mocked_database.return_value = database

        receipt = delete_personal_data('demo')

        self.assertEqual(receipt['deletion_status'], 'completed')
        database.communication_sessions.delete_many.assert_called_once_with({'user_id': 'demo'})
        database.privacy_audit_logs.delete_many.assert_called_once_with({'user_id': 'demo'})
        self.assertEqual(database.privacy_audit_logs.insert_one.call_args.args[0]['action'], 'personal_data_deleted')
        database.users.update_one.assert_called_once_with({'_id': 'demo'}, {'$unset': {'profile': ''}})
        self.assertTrue(database.privacy_settings.update_one.call_args.kwargs['upsert'])

    @patch('app.services.privacy._database')
    def test_deletion_failure_keeps_partial_counts_and_never_reports_completed(self, mocked_database):
        database = mocked_database.return_value
        database.card_submissions.find.return_value = []
        database.communication_sessions.delete_many.return_value.deleted_count = 3
        database.tts_events.delete_many.side_effect = PyMongoError('synthetic failure')
        with self.assertRaises(HTTPException) as caught:
            delete_personal_data('child')
        self.assertEqual(caught.exception.status_code, 503)
        update = database.privacy_settings.update_one.call_args.args[1]['$set']
        self.assertEqual(update['deletion_status'], 'failed')
        self.assertEqual(update['deletion_receipt']['status'], 'failed')
        self.assertEqual(update['deletion_receipt']['counts'], {'communication_sessions': 3,
            'recommendation_settings': 0, 'recommendation_batches': 0})
        self.assertFalse(update['guardian_consent'])

    @patch('app.services.privacy._database')
    def test_persisted_receipt_utc_times_keep_timezone(self, mocked_database):
        mocked_database.return_value.privacy_settings.find_one.return_value = {
            'deleted_at': datetime(2026, 10, 21),
            'deletion_receipt': {'requested_at': datetime(2026, 10, 21), 'finished_at': datetime(2026, 10, 21, 0, 1)},
        }
        result = privacy_for('child')
        self.assertEqual(result['deleted_at'].tzinfo, timezone.utc)
        self.assertEqual(result['deletion_receipt']['requested_at'].tzinfo, timezone.utc)
        self.assertEqual(result['deletion_receipt']['finished_at'].tzinfo, timezone.utc)


if __name__ == '__main__':
    unittest.main()
