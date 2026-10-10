import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.api.router import LearningSettingsRequest, put_learning_settings
from app.services.learning import progress_for, record_attempt, save_settings, settings_for


class LearningTests(unittest.TestCase):
    @patch('app.services.learning._database')
    def test_new_user_settings_are_separate_defaults(self, mocked_database):
        database = MagicMock()
        database.learning_settings.find_one.return_value = None
        mocked_database.return_value = database

        result = settings_for('child')

        self.assertEqual(result['question_count'], 10)
        self.assertEqual(result['category_ids'], [])
        database.communication_sessions.assert_not_called()

    @patch('app.services.learning._database')
    def test_supporter_setting_change_records_target_actor_and_values(self, mocked_database):
        database = MagicMock()
        database.learning_settings.find_one.return_value = None
        mocked_database.return_value = database

        result = save_settings('child', 'staff', ['food'], 10, 60, True)

        self.assertEqual(result['updated_by'], 'staff')
        audit = database.learning_audit_logs.insert_one.call_args.args[0]
        self.assertEqual(audit['target_user_id'], 'child')
        self.assertEqual(audit['actor_id'], 'staff')
        self.assertEqual(audit['after']['category_ids'], ['food'])

    @patch('app.services.learning._database')
    def test_attempt_score_is_derived_and_idempotent(self, mocked_database):
        database = MagicMock()
        database.learning_attempts.find_one.side_effect = [None, {
            '_id': 'request-1', 'user_id': 'child', 'record_type': 'learning_attempt',
            'activity_type': 'word_picture_match', 'category_id': 'food',
            'total_questions': 10, 'correct_answers': 8, 'incorrect_answers': 2,
            'score': 80, 'duration_seconds': 42, 'completed_at': datetime.now(timezone.utc),
        }]
        mocked_database.return_value = database

        first = record_attempt('child', 'request-1', 'word_picture_match', 'food', 10, 8, 42)
        second = record_attempt('child', 'request-1', 'word_picture_match', 'food', 10, 8, 42)

        self.assertEqual(first['score'], 80)
        self.assertEqual(second['score'], 80)
        database.learning_attempts.insert_one.assert_called_once()
        database.communication_sessions.assert_not_called()

    @patch('app.services.learning._database')
    def test_progress_aggregates_only_learning_attempts(self, mocked_database):
        now = datetime.now(timezone.utc)
        rows = [{
            '_id': 'a', 'user_id': 'child', 'record_type': 'learning_attempt',
            'activity_type': 'word_picture_match', 'category_id': 'food',
            'total_questions': 10, 'correct_answers': 8, 'incorrect_answers': 2,
            'score': 80, 'duration_seconds': 40, 'completed_at': now,
        }, {
            '_id': 'b', 'user_id': 'child', 'record_type': 'learning_attempt',
            'activity_type': 'word_picture_match', 'category_id': 'food',
            'total_questions': 10, 'correct_answers': 10, 'incorrect_answers': 0,
            'score': 100, 'duration_seconds': 30, 'completed_at': now,
        }]
        database = MagicMock()
        database.learning_attempts.find.return_value.sort.return_value = rows
        mocked_database.return_value = database

        result = progress_for('child')

        self.assertEqual(result['attempts'], 2)
        self.assertEqual(result['average_score'], 90)
        self.assertEqual(result['categories']['food']['correct_answers'], 18)
        query = database.learning_attempts.find.call_args.args[0]
        self.assertEqual(query['record_type'], 'learning_attempt')

    def test_aac_user_cannot_modify_learning_settings(self):
        request = LearningSettingsRequest(
            category_ids=['food'], question_count=10, time_limit_seconds=60,
            retry_enabled=True,
        )
        with self.assertRaises(HTTPException) as caught:
            put_learning_settings(request, user_id='child', user={'id': 'child', 'role': 'user'})
        self.assertEqual(caught.exception.status_code, 403)


if __name__ == '__main__':
    unittest.main()
