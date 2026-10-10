import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.services.board_layout import (
    layout_for, save_quick_expressions, save_recovery_expressions, save_slots,
)
from app.api.router import _require_support_manager


CARDS = [
    {'id': 'help', 'label': '도와주세요'},
    {'id': 'water', 'label': '물'},
    {'id': 'stop', 'label': '그만'},
]


class BoardLayoutTests(unittest.TestCase):
    @patch('app.services.board_layout._available_cards', return_value=CARDS)
    @patch('app.services.board_layout._database')
    def test_default_layout_has_stable_numbered_slots(self, mocked_database, _available):
        database = MagicMock()
        database.board_layouts.find_one.return_value = None
        mocked_database.return_value = database

        result = layout_for('child')

        self.assertEqual(result['quick_expression_ids'], ['help', 'stop'])
        self.assertEqual(result['recovery_expression_ids'], [
            'wrong_tap', 'not_that', 'hold_on', 'say_again',
        ])
        self.assertEqual(result['slots'], [
            {'position': 1, 'card_id': 'help'},
            {'position': 2, 'card_id': 'water'},
            {'position': 3, 'card_id': 'stop'},
        ])

    @patch('app.services.board_layout._available_cards', return_value=CARDS)
    @patch('app.services.board_layout._database')
    def test_legacy_layout_restores_missing_fixed_recovery_phrases(
            self, mocked_database, _available):
        database = MagicMock()
        database.board_layouts.find_one.return_value = {
            'user_id': 'child', 'recovery_expression_ids': ['say_again', 'yes'],
        }
        mocked_database.return_value = database

        result = layout_for('child')

        self.assertEqual(result['recovery_expression_ids'], [
            'wrong_tap', 'not_that', 'say_again', 'yes',
        ])

    @patch('app.services.board_layout.layout_for')
    @patch('app.services.board_layout._available_cards', return_value=CARDS)
    @patch('app.services.board_layout._database')
    def test_quick_and_slot_changes_audit_target_actor_and_values(
            self, mocked_database, _available, mocked_layout):
        database = MagicMock()
        database.board_layouts.find_one.side_effect = [None, {
            'user_id': 'child', 'quick_expression_ids': ['help'],
            'slots': [{'position': 1, 'card_id': 'help'}],
        }]
        mocked_database.return_value = database
        mocked_layout.return_value = {'user_id': 'child'}

        save_quick_expressions('child', 'staff', ['stop', 'help'])
        save_slots('child', 'staff', ['water', 'help'])

        audits = [call.args[0] for call in database.board_audit_logs.insert_one.call_args_list]
        self.assertEqual(audits[0]['action'], 'quick_expressions_changed')
        self.assertEqual(audits[1]['action'], 'board_slots_changed')
        self.assertTrue(all(row['target_user_id'] == 'child' and row['actor_id'] == 'staff'
                            and row['created_at'] for row in audits))
        self.assertEqual(audits[1]['after'][0], {'position': 1, 'card_id': 'water'})

    @patch('app.services.board_layout._available_cards', return_value=CARDS)
    def test_duplicate_or_unknown_cards_are_rejected(self, _available):
        with self.assertRaises(HTTPException):
            save_slots('child', 'staff', ['help', 'help'])
        with self.assertRaises(HTTPException):
            save_quick_expressions('child', 'staff', ['missing'])

    @patch('app.services.board_layout.layout_for')
    @patch('app.services.board_layout._available_cards', return_value=CARDS)
    @patch('app.services.board_layout._database')
    def test_recovery_expressions_are_fixed_presets_and_audited(
            self, mocked_database, _available, mocked_layout):
        database = MagicMock()
        database.board_layouts.find_one.return_value = None
        mocked_database.return_value = database
        mocked_layout.return_value = {'user_id': 'child'}

        save_recovery_expressions('child', 'caregiver', ['wrong_tap', 'not_that', 'say_again'])

        audit = database.board_audit_logs.insert_one.call_args.args[0]
        self.assertEqual(audit['action'], 'recovery_expressions_changed')
        self.assertEqual(audit['after'], ['wrong_tap', 'not_that', 'say_again'])
        with self.assertRaises(HTTPException):
            save_recovery_expressions('child', 'caregiver', ['wrong_tap'])
        with self.assertRaises(HTTPException):
            save_recovery_expressions('child', 'caregiver', ['wrong_tap', 'custom_text'])
        with self.assertRaises(HTTPException):
            save_recovery_expressions('child', 'caregiver', ['wrong_tap', 'say_again'])

    def test_aac_user_cannot_change_fixed_layout_even_for_self(self):
        with self.assertRaises(HTTPException) as caught:
            _require_support_manager({'id': 'child', 'role': 'user'}, 'child', 'board_manage')
        self.assertEqual(caught.exception.status_code, 403)


if __name__ == '__main__':
    unittest.main()
