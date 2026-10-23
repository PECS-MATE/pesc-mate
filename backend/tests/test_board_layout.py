import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError
from pydantic import ValidationError

from app.services.board_layout import (
    layout_for, save_quick_expressions, save_recovery_expressions, save_slots, save_locks, change_situations,
)
from app.api.router import _require_support_manager, BoardCardIdsRequest, BoardRecoveryIdsRequest, BoardLocksRequest, SituationBoardRequest


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
        self.assertEqual(result['revision'], 0)
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

    @patch('app.services.board_layout._available_cards', return_value=CARDS)
    @patch('app.services.board_layout._database')
    def test_quick_and_slot_changes_audit_target_actor_and_values(
            self, mocked_database, _available):
        database = MagicMock()
        database.board_layouts.update_one.return_value.matched_count = 1
        database.board_layouts.find_one.side_effect = [None, {
            'user_id': 'child', 'quick_expression_ids': ['help'],
            'slots': [{'position': 1, 'card_id': 'help'}],
        }]
        mocked_database.return_value = database

        save_quick_expressions('child', 'staff', ['stop', 'help'])
        save_slots('child', 'staff', ['water', 'help'])

        audits = [call.args[0] for call in database.board_audit_logs.insert_one.call_args_list]
        self.assertEqual(audits[0]['action'], 'quick_expressions_changed')
        self.assertEqual(audits[1]['action'], 'board_slots_changed')
        self.assertTrue(all(row['target_user_id'] == 'child' and row['actor_id'] == 'staff'
                            and row['created_at'] for row in audits))
        self.assertEqual(audits[1]['after'][0], {'position': 1, 'card_id': 'water'})
        self.assertEqual(audits[0]['before_revision'], 0)
        self.assertEqual(audits[0]['after_revision'], 1)

    @patch('app.services.board_layout._available_cards', return_value=CARDS)
    def test_duplicate_or_unknown_cards_are_rejected(self, _available):
        with self.assertRaises(HTTPException):
            save_slots('child', 'staff', ['help', 'help'])
        with self.assertRaises(HTTPException):
            save_quick_expressions('child', 'staff', ['missing'])

    @patch('app.services.board_layout._available_cards', return_value=CARDS)
    @patch('app.services.board_layout._database')
    def test_recovery_expressions_are_fixed_presets_and_audited(
            self, mocked_database, _available):
        database = MagicMock()
        database.board_layouts.find_one.return_value = None
        mocked_database.return_value = database
        result = save_recovery_expressions('child', 'caregiver', ['wrong_tap', 'not_that', 'say_again'])
        self.assertEqual(result['revision'], 1)

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

    @patch('app.services.board_layout._available_cards', return_value=CARDS)
    @patch('app.services.board_layout._database')
    def test_stale_revision_never_overwrites_or_audits(self, mocked_database, _available):
        db = mocked_database.return_value
        db.board_layouts.find_one.return_value = {'user_id': 'child', 'revision': 2}
        with self.assertRaises(HTTPException) as caught:
            save_slots('child', 'staff', ['help'], expected_revision=1)
        self.assertEqual(caught.exception.status_code, 409)
        db.board_layouts.update_one.assert_not_called()
        db.board_layouts.insert_one.assert_not_called()
        db.board_audit_logs.insert_one.assert_not_called()

    @patch('app.services.board_layout._available_cards', return_value=CARDS)
    @patch('app.services.board_layout._database')
    def test_revision_is_compared_atomically_and_response_is_the_committed_version(self, mocked_database, _available):
        db = mocked_database.return_value
        db.board_layouts.find_one.return_value = {'user_id': 'child', 'revision': 2}
        db.board_layouts.update_one.return_value.matched_count = 1
        result = save_slots('child', 'staff', ['water'], expected_revision=2)
        self.assertEqual(db.board_layouts.update_one.call_args.args[0], {'_id': 'child', 'revision': 2})
        self.assertEqual(result['revision'], 3)
        self.assertEqual(result['slots'], [{'position': 1, 'card_id': 'water'}])
        self.assertEqual(db.board_layouts.find_one.call_count, 1)

    @patch('app.services.board_layout._available_cards', return_value=CARDS)
    @patch('app.services.board_layout._database')
    def test_losing_atomic_update_conflicts_without_a_success_audit(self, mocked_database, _available):
        db = mocked_database.return_value
        db.board_layouts.find_one.return_value = {'user_id': 'child', 'revision': 1}
        db.board_layouts.update_one.return_value.matched_count = 0
        with self.assertRaises(HTTPException) as caught:
            save_slots('child', 'staff', ['water'], expected_revision=1)
        self.assertEqual(caught.exception.status_code, 409)
        db.board_audit_logs.insert_one.assert_not_called()

    @patch('app.services.board_layout._available_cards', return_value=CARDS)
    @patch('app.services.board_layout._database')
    def test_competing_first_insert_conflicts_and_legacy_revision_is_zero(self, mocked_database, _available):
        db = mocked_database.return_value
        db.board_layouts.find_one.return_value = None
        db.board_layouts.insert_one.side_effect = DuplicateKeyError('concurrent first save')
        with self.assertRaises(HTTPException) as caught:
            save_slots('child', 'staff', ['water'], expected_revision=0)
        self.assertEqual(caught.exception.status_code, 409)
        db.board_audit_logs.insert_one.assert_not_called()
        db.board_layouts.find_one.return_value = {'user_id': 'child'}
        db.board_layouts.update_one.return_value.matched_count = 1
        self.assertEqual(save_slots('child', 'staff', ['water'], expected_revision=0)['revision'], 1)
        self.assertIn('$or', db.board_layouts.update_one.call_args.args[0])

    def test_api_requires_a_nonnegative_revision_for_every_board_write(self):
        for model, values in ((BoardCardIdsRequest, {'card_ids': ['help']}),
                              (BoardRecoveryIdsRequest, {'expression_ids': ['wrong_tap', 'not_that']})):
            with self.assertRaises(ValidationError):
                model(**values)
            with self.assertRaises(ValidationError):
                model(**values, expected_revision=-1)

    @patch('app.services.board_layout._available_cards', return_value=CARDS)
    @patch('app.services.board_layout._database')
    def test_locked_slots_cannot_move_or_disappear_including_neighbor_shifts(self, mocked_database, _available):
        db = mocked_database.return_value
        slots = [{'position': index + 1, 'card_id': card['id']} for index, card in enumerate(CARDS)]
        db.board_layouts.find_one.return_value = {'user_id': 'child', 'revision': 2,
            'slots': slots, 'locked_card_ids': ['water']}
        for ids in (['help', 'stop'], ['water', 'help', 'stop'], ['help', 'stop', 'water'], ['water', 'stop']):
            with self.subTest(ids=ids), self.assertRaises(HTTPException) as caught:
                save_slots('child', 'staff', ids, 2)
            self.assertEqual(caught.exception.status_code, 409)
        db.board_layouts.update_one.assert_not_called()
        db.board_audit_logs.insert_one.assert_not_called()
        db.board_layouts.update_one.return_value.matched_count = 1
        saved = save_slots('child', 'staff', ['stop', 'water', 'help'], 2)
        self.assertEqual(saved['locked_card_ids'], ['water'])

    @patch('app.services.board_layout._available_cards', return_value=CARDS)
    @patch('app.services.board_layout._database')
    @patch('app.services.support_links.require_link_permission')
    @patch('app.services.image_storage.image_write_lock')
    @patch('app.services.image_storage.check_deletion_race')
    def test_locks_use_shared_image_lock_latest_slots_cas_and_can_be_cleared(self, deletion, lock, permission, mocked_database, _available):
        db = mocked_database.return_value
        db.board_layouts.find_one.return_value = {'user_id': 'child', 'revision': 3,
            'slots': [{'position': 1, 'card_id': 'help'}], 'locked_card_ids': ['help']}
        db.board_layouts.update_one.return_value.matched_count = 1
        requester = {'id': 'staff', 'role': 'support_staff'}
        saved = save_locks('child', requester, [], 3)
        self.assertEqual(saved['locked_card_ids'], [])
        self.assertEqual(saved['slots'], [{'position': 1, 'card_id': 'help'}])
        self.assertEqual(saved['revision'], 4)
        lock.assert_called_once_with(db); deletion.assert_called_once()
        self.assertEqual(permission.call_count, 2)
        self.assertEqual(db.board_layouts.update_one.call_args.args[0], {'_id': 'child', 'revision': 3})
        audit = db.board_audit_logs.insert_one.call_args.args[0]
        self.assertEqual((audit['action'], audit['before'], audit['after']), ('core_card_locks_changed', ['help'], []))
        with self.assertRaises(HTTPException) as caught:
            save_locks('child', requester, ['water'], 3)
        self.assertEqual(caught.exception.status_code, 422)

    def test_new_lock_api_rejects_missing_bool_and_negative_revision_and_aac_writer(self):
        self.assertEqual(BoardLocksRequest(card_ids=[], expected_revision=0).card_ids, [])
        for value in (True, -1, 0.0, '0'):
            with self.assertRaises(ValidationError):
                BoardLocksRequest(card_ids=[], expected_revision=value)
        with self.assertRaises(ValidationError):
            BoardLocksRequest(card_ids=[])
        with self.assertRaises(HTTPException) as caught:
            save_locks('child', {'id': 'child', 'role': 'user'}, [], 0)
        self.assertEqual(caught.exception.status_code, 403)

    def test_situation_request_shape_is_strict_and_does_not_accept_foreign_target_fields(self):
        SituationBoardRequest(expected_revision=0, operation='create', name='집')
        SituationBoardRequest(expected_revision=1, operation='copy', name='학교', source_id='synthetic')
        SituationBoardRequest(expected_revision=2, operation='delete', situation_id='synthetic')
        cases = [dict(operation='update', situation_id='s'), dict(operation='delete'),
                 dict(operation='copy', name='집'), dict(operation='create', name=' '),
                 dict(operation='create', name='학교', situation_id='foreign'),
                 dict(operation='create', name='집', owner_id='other'),
                 dict(operation='delete', situation_id='s', name='바꾸기'),
                 dict(operation='create', name='집', card_ids=['help'])]
        for values in cases:
            with self.subTest(values=values), self.assertRaises(ValidationError):
                SituationBoardRequest(expected_revision=0, **values)
        with self.assertRaises(HTTPException) as caught:
            change_situations('child', {'id': 'child', 'role': 'user'}, 0, 'create', name='집')
        self.assertEqual(caught.exception.status_code, 403)

    @patch('app.services.board_layout._available_cards', return_value=CARDS)
    @patch('app.services.board_layout._database')
    @patch('app.services.support_links.require_link_permission')
    @patch('app.services.image_storage.image_write_lock')
    @patch('app.services.image_storage.check_deletion_race')
    def test_situations_are_transformed_from_same_cas_snapshot_and_keep_default_slots(self, deletion, lock, permission, mocked_database, _available):
        db = mocked_database.return_value
        original = [{'position': 1, 'card_id': 'help'}]
        db.board_layouts.find_one.return_value = {'user_id': 'child', 'revision': 3, 'slots': original}
        db.board_layouts.update_one.return_value.matched_count = 1
        result = change_situations('child', {'id': 'staff', 'role': 'support_staff'}, 3, 'create', name='집')
        self.assertEqual(result['slots'], original)
        self.assertEqual(result['situations'][0]['slots'], original)
        self.assertEqual(result['situations'][0]['name'], '집')
        self.assertEqual(result['revision'], 4)
        self.assertEqual(db.board_layouts.find_one.call_count, 1)
        self.assertEqual(db.board_layouts.update_one.call_args.args[0], {'_id': 'child', 'revision': 3})
        self.assertEqual(db.board_audit_logs.insert_one.call_args.args[0]['action'], 'situation_create')


if __name__ == '__main__':
    unittest.main()
