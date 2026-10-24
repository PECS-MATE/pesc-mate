import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.api.router import LearningAttemptRequest, LearningSettingsRequest, put_learning_settings
from pydantic import ValidationError
from uuid import uuid4
from app.services.learning import progress_for, record_attempt, save_settings, settings_for


class LearningTests(unittest.TestCase):
    @patch('app.services.learning._database')
    def test_sentence_order_preserves_content_and_card_sequence_without_communication_writes(self, mocked_database):
        item = {'card_id': 'drink', 'label': '마시다', 'first_try_correct': True,
                'content_id': 'water-drink', 'card_ids': ['water', 'drink']}
        request = LearningAttemptRequest(request_id=uuid4(), activity_type='sentence_card_order',
            content_version='sentence-order-v1', category_id='mixed', total_questions=1,
            correct_answers=1, duration_seconds=3, items=[item])
        self.assertEqual(request.items[0].model_dump(), item)
        db = mocked_database.return_value
        db.learning_attempts.find_one.return_value = None
        first = record_attempt('child', str(request.request_id), request.activity_type, 'mixed', 1, 1, 3,
            [request.items[0].model_dump()], content_version=request.content_version)
        stored = db.learning_attempts.insert_one.call_args.args[0]
        self.assertEqual(first['items'], [item])
        self.assertEqual(first['content_version'], 'sentence-order-v1')
        db.learning_attempts.find_one.return_value = stored
        self.assertEqual(record_attempt('child', str(request.request_id), request.activity_type,
            'mixed', 1, 1, 3, [item], content_version=request.content_version), first)
        db.learning_attempts.insert_one.assert_called_once()
        db.communication_sessions.insert_one.assert_not_called()
        db.tts_events.insert_one.assert_not_called()

    @patch('app.services.learning._database')
    def test_sentence_order_requires_bounded_unique_cards_and_consistent_results(self, mocked_database):
        item = {'card_id': 'drink', 'label': '마시다', 'first_try_correct': True,
                'content_id': 'water-drink', 'card_ids': ['water', 'drink']}
        for items in ([], [item | {'card_ids': ['drink', 'drink']}],
                      [item | {'card_ids': ['water']}], [item | {'card_id': 'outside'}],
                      [item | {'content_id': ''}], [item | {'card_ids': ['me', 'water', 'rice', 'drink']}],
                      [item, item]):
            with self.subTest(items=items), self.assertRaises(HTTPException) as caught:
                record_attempt('child', 'request', 'sentence_card_order', 'mixed', 1, 1, 3,
                    items, content_version='sentence-order-v1')
            self.assertEqual(caught.exception.status_code, 422)
        mocked_database.assert_not_called()

    def test_invalid_sequence_metadata_does_not_silently_fall_back_to_old_item_schema(self):
        base = dict(request_id=uuid4(), activity_type='sentence_card_order',
            content_version='sentence-order-v1', category_id='mixed', total_questions=1,
            correct_answers=1, duration_seconds=3)
        item = {'card_id': 'drink', 'label': '마시다', 'first_try_correct': True,
                'content_id': 'water-drink', 'card_ids': ['water', 'drink']}
        for changes in ({'content_id': 'invalid content'}, {'card_ids': ['water']}, {'card_ids': 'water'}):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                LearningAttemptRequest(**base, items=[item | changes])
        with self.assertRaises(ValidationError):
            LearningAttemptRequest(**(base | {'activity_type': 'word_picture_match'}), items=[item])

    @patch('app.services.learning._database')
    def test_sentence_order_outcomes_count_as_participation_not_as_single_word_mastery(self, mocked_database):
        mocked_database.return_value.learning_attempts.find.return_value.sort.return_value = [{
            '_id': 'ordering', 'user_id': 'child', 'record_type': 'learning_attempt',
            'activity_type': 'sentence_card_order', 'content_version': 'sentence-order-v1', 'category_id': 'mixed',
            'total_questions': 1, 'correct_answers': 1, 'incorrect_answers': 0, 'score': 100,
            'duration_seconds': 3, 'completed_at': datetime.now(timezone.utc),
            'items': [{'card_id': 'drink', 'label': '마시다', 'first_try_correct': True,
                       'content_id': 'water-drink', 'card_ids': ['water', 'drink']}],
        }]
        result = progress_for('child')
        self.assertEqual(result['attempts'], 1)
        for key in ('familiar_words', 'practicing_words', 'repeat_words'):
            self.assertEqual(result[key], [])

    @patch('app.services.learning._database')
    def test_sound_activity_version_is_recorded_only_as_learning_and_replayed_idempotently(self, mocked_database):
        db = mocked_database.return_value
        db.learning_attempts.find_one.return_value = None
        result = record_attempt('child', 'sound-request', 'sound_picture_match', 'food', 2, 1, 10,
            content_version='sound-picture-v1')
        self.assertEqual(result['activity_type'], 'sound_picture_match')
        self.assertEqual(result['content_version'], 'sound-picture-v1')
        self.assertEqual(result['completed_at'].microsecond % 1000, 0)
        self.assertEqual(result['completed_at'].tzinfo, timezone.utc)
        stored = db.learning_attempts.insert_one.call_args.args[0]
        db.learning_attempts.find_one.return_value = stored
        self.assertEqual(record_attempt('child', 'sound-request', 'sound_picture_match', 'food', 2, 1, 10,
            content_version='sound-picture-v1'), result)
        db.learning_attempts.insert_one.assert_called_once()
        db.communication_sessions.insert_one.assert_not_called()
        db.tts_events.insert_one.assert_not_called()

    @patch('app.services.learning._database')
    def test_activity_version_mismatch_is_rejected_without_storage(self, mocked_database):
        with self.assertRaises(HTTPException) as caught:
            record_attempt('child', 'request', 'sound_picture_match', 'food', 2, 1, 10,
                content_version='word-picture-v1')
        self.assertEqual(caught.exception.status_code, 422)
        mocked_database.assert_not_called()

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

        result = save_settings('child', 'staff', ['food'], 10, 3, 2, 60, True)

        self.assertEqual(result['updated_by'], 'staff')
        self.assertEqual(result['option_count'], 3)
        self.assertEqual(result['repeat_frequency'], 2)
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
            'items': [
                {'card_id': 'apple', 'label': '사과', 'first_try_correct': True},
                {'card_id': 'water', 'label': '물', 'first_try_correct': False},
            ],
        }, {
            '_id': 'b', 'user_id': 'child', 'record_type': 'learning_attempt',
            'activity_type': 'word_picture_match', 'category_id': 'food',
            'total_questions': 10, 'correct_answers': 10, 'incorrect_answers': 0,
            'score': 100, 'duration_seconds': 30, 'completed_at': now,
            'items': [
                {'card_id': 'apple', 'label': '사과', 'first_try_correct': True},
                {'card_id': 'rice', 'label': '밥', 'first_try_correct': True},
            ],
        }]
        database = MagicMock()
        database.learning_attempts.find.return_value.sort.return_value = rows
        mocked_database.return_value = database

        result = progress_for('child')

        self.assertEqual(result['attempts'], 2)
        self.assertEqual(result['average_score'], 90)
        self.assertEqual(result['categories']['food']['correct_answers'], 18)
        self.assertEqual(result['familiar_words'][0]['label'], '사과')
        self.assertEqual(result['repeat_words'][0]['label'], '물')
        self.assertEqual(result['practicing_words'][0]['label'], '밥')
        query = database.learning_attempts.find.call_args.args[0]
        self.assertEqual(query['record_type'], 'learning_attempt')

    @patch('app.services.learning._database')
    def test_attempt_rejects_inconsistent_item_results(self, mocked_database):
        with self.assertRaises(HTTPException) as caught:
            record_attempt('child', 'request-2', 'word_picture_match', 'food', 2, 2, 20, [{
                'card_id': 'water', 'label': '물', 'first_try_correct': False,
            }])
        self.assertEqual(caught.exception.status_code, 422)
        mocked_database.assert_not_called()

    def test_aac_user_cannot_modify_learning_settings(self):
        request = LearningSettingsRequest(
            category_ids=['food'], question_count=10, time_limit_seconds=60,
            option_count=3, repeat_frequency=1, retry_enabled=True,
        )
        with self.assertRaises(HTTPException) as caught:
            put_learning_settings(request, user_id='child', user={'id': 'child', 'role': 'user'})
        self.assertEqual(caught.exception.status_code, 403)


if __name__ == '__main__':
    unittest.main()
