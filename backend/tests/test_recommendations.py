import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services import recommendations as service


class RecommendationTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 21, 3, tzinfo=timezone.utc)
        self.cards = [{'id': str(index), 'category': 'category-' + str(index // 3), 'label': str(index)}
                      for index in range(15)]
        self.settings = {**service.DEFAULTS, 'revision': 0}

    def rank(self, **kwargs):
        return service.rank_cards(self.cards, kwargs.pop('sessions', []), kwargs.pop('activities', []),
            kwargs.pop('batches', []), kwargs.pop('settings', self.settings),
            kwargs.pop('selected', []), kwargs.pop('hour', 12), kwargs.pop('offset', -540), self.now)

    def session(self, ids, days=0, **kwargs):
        return {'cards': ids, 'created_at': self.now - timedelta(days=days), **kwargs}

    def test_frequency_is_per_original_session_recency_and_combination_are_explainable(self):
        rows = [self.session(['0', '3', '3']), self.session(['6'], 6),
                self.session(['9'], 20), self.session(['12'], 40),
                self.session(['9'], regeneration_of='original')]
        cards, _ = self.rank(sessions=rows, selected=['0'])
        by_id = {card['id']: card for card in cards}
        self.assertEqual(cards[0]['id'], '3')
        self.assertEqual(by_id['3']['evidence']['frequency'], 2)
        self.assertEqual(by_id['3']['evidence']['combination'], 4)
        self.assertEqual(by_id['6']['evidence']['recency'], 8)
        self.assertEqual(by_id['9']['evidence']['recency'], 3)
        self.assertEqual(by_id['12']['evidence']['recency'], 0)
        self.assertIn('함께 저장한 기록', cards[0]['reason'])
        self.assertTrue(all(card['algorithm_version'] == service.VERSION for card in cards))

    def test_local_time_offset_and_guardian_situation_use_only_matching_observations(self):
        settings = {**self.settings, 'situation': 'school'}
        cards, _ = self.rank(settings=settings, sessions=[self.session(['6'])], activities=[
            {'situation': 'school', 'card_ids': ['6', '6']}, {'situation': 'home', 'card_ids': ['9']}])
        self.assertEqual(cards[0]['id'], '6')
        self.assertEqual(cards[0]['evidence']['time_of_day'], 2)  # 03 UTC => 12 KST
        self.assertEqual(cards[0]['evidence']['situation'], 3)
        disabled, _ = self.rank(settings={**settings, 'use_time_of_day': False}, sessions=[self.session(['6'])])
        self.assertEqual(disabled[0]['evidence']['time_of_day'], 0)
        utc, _ = self.rank(sessions=[self.session(['6'])], offset=0)
        self.assertEqual(utc[0]['evidence']['time_of_day'], 0)

    def test_evidence_has_caps_and_categories_remain_diverse_and_deterministic(self):
        rows = [self.session(['0', '1', '2', '3'])] * 50
        cards, diagnostics = self.rank(sessions=rows, selected=['3'])
        self.assertEqual(len(cards), 6)
        self.assertEqual(cards, self.rank(sessions=rows, selected=['3'])[0])
        self.assertEqual(cards[0]['evidence']['frequency'], 20)
        self.assertEqual(cards[0]['evidence']['combination'], 20)
        self.assertEqual(cards[0]['evidence']['time_of_day'], 10)
        self.assertLessEqual(max(diagnostics['category_counts'].values()), 2)

    def test_hidden_selected_disabled_and_approval_policy_never_expand_to_fill_six(self):
        settings = {**self.settings, 'mode': 'approval', 'approved_card_ids': ['0', '3', '6'], 'hidden_card_ids': ['6']}
        cards, _ = self.rank(settings=settings, selected=['0'])
        self.assertEqual([card['id'] for card in cards], ['3'])
        self.assertEqual(self.rank(settings={**settings, 'approved_card_ids': []})[0], [])
        self.assertEqual(self.rank(settings={**settings, 'enabled': False})[0], [])

    def test_repeated_exposure_rests_only_within_allowed_candidates_and_never_blanks_only_choice(self):
        batches = [{'exposed_card_ids': ['0']}] * 3
        cards, diagnostics = self.rank(batches=batches)
        self.assertNotIn('0', [card['id'] for card in cards])
        self.assertEqual(diagnostics['repeated_card_ids'], ['0'])
        approved = {**self.settings, 'mode': 'approval', 'approved_card_ids': ['0']}
        cards, _ = self.rank(settings=approved, batches=batches)
        self.assertEqual([card['id'] for card in cards], ['0'])
        self.assertEqual(cards[0]['evidence']['repetition_penalty'], -6)
        fetched_only, _ = self.rank(batches=[{'exposed_card_ids': []}] * 3)
        self.assertEqual(fetched_only[0]['id'], '0')

    @patch('app.services.recommendations.database')
    @patch('app.services.recommendations.available_cards')
    def test_settings_cas_and_audit_do_not_mutate_fixed_board_or_other_domains(self, available, database):
        available.return_value = self.cards
        db = database.return_value
        db.recommendation_settings.find_one.return_value = None
        result = service.save_settings('child', 'guardian', service.DEFAULTS, 0)
        self.assertEqual(result['revision'], 1)
        self.assertEqual(db.board_audit_logs.insert_one.call_args.args[0]['action'], 'recommendation_settings_changed')
        db.board_layouts.update_one.assert_not_called()
        db.learning_attempts.find.assert_not_called()
        db.communication_sessions.insert_one.assert_not_called()
        db.recommendation_settings.find_one.return_value = {'revision': 1}
        with self.assertRaises(HTTPException) as caught:
            service.save_settings('child', 'guardian', service.DEFAULTS, 0)
        self.assertEqual(caught.exception.status_code, 409)
        db.recommendation_settings.update_one.return_value.matched_count = 0
        with self.assertRaises(HTTPException) as caught:
            service.save_settings('child', 'guardian', service.DEFAULTS, 1)
        self.assertEqual(caught.exception.status_code, 409)

    @patch('app.services.recommendations.database')
    @patch('app.services.recommendations.available_cards')
    def test_settings_reject_unknown_duplicate_and_conflicting_cards(self, available, database):
        available.return_value = self.cards
        database.return_value.recommendation_settings.find_one.return_value = None
        for values in ({'hidden_card_ids': ['unknown']}, {'approved_card_ids': ['0', '0']},
                       {'hidden_card_ids': ['0'], 'approved_card_ids': ['0']}):
            with self.subTest(values=values), self.assertRaises(HTTPException) as caught:
                service.save_settings('child', 'guardian', {**service.DEFAULTS, **values}, 0)
            self.assertEqual(caught.exception.status_code, 422)
        database.return_value.recommendation_settings.insert_one.assert_not_called()

    @patch('app.services.recommendations.database')
    @patch('app.services.recommendations.available_cards')
    def test_no_consent_does_not_read_history_or_write_batches(self, available, database):
        available.return_value = self.cards
        db = database.return_value
        db.recommendation_settings.find_one.return_value = None
        db.recommendation_batches.find_one.return_value = None
        for privacy in ({}, {'guardian_consent': False}, {'guardian_consent': True, 'deletion_status': 'failed'}):
            db.privacy_settings.find_one.return_value = privacy
            result = service.create_feed('child', 'request', [], 12, -540)
            self.assertIsNone(result['batch_id'])
            self.assertFalse(result['diagnostics']['personal_history_used'])
        db.communication_sessions.find.assert_not_called()
        db.offline_events.find.assert_not_called()
        db.recommendation_batches.find.assert_not_called()
        db.recommendation_batches.insert_one.assert_not_called()

    @patch('app.services.recommendations.database')
    def test_database_errors_are_isolated_as_503(self, database):
        database.side_effect = PyMongoError('synthetic unavailable')
        for operation in (lambda: service.settings_for('child'), lambda: service.preview('child'),
                          lambda: service.create_feed('child', 'request', [], 12, 0),
                          lambda: service.record_interaction('child', 'batch', ['0']),
                          lambda: service.monitoring_for('child')):
            with self.assertRaises(HTTPException) as caught:
                operation()
            self.assertEqual(caught.exception.status_code, 503)


if __name__ == '__main__':
    unittest.main()
