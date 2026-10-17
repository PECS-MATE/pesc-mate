import ast
from contextlib import redirect_stdout
from io import StringIO
import json
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

from pymongo.errors import DuplicateKeyError, PyMongoError

from app.migrations import JOURNAL, MIGRATION_ID, MigrationError, _claim, legacy_filter, main, migrate, plan, version_pipeline
from app.services.schema_versions import SCHEMA_VERSION, VERSIONED_COLLECTIONS


def snapshot(legacy=0, current=0, future=0, invalid=0):
    return {'migration': MIGRATION_ID, 'target_version': SCHEMA_VERSION,
            'status': 'blocked' if future or invalid else 'ready',
            'totals': dict(legacy=legacy, current=current, future=future, invalid=invalid), 'collections': []}


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.database = MagicMock()
        self.database.name = 'pesc_mate_test'
        self.journal = MagicMock()
        self.collection = MagicMock()
        self.database.__getitem__.side_effect = lambda name: self.journal if name == JOURNAL else self.collection
        self.collection.find.return_value.limit.return_value.max_time_ms.return_value = []
        self.journal.update_one.return_value.matched_count = 1
        self.options = dict(apply=True, confirm_database=self.database.name,
                            writers_stopped=True, backup_ref='verified-fixture')

    def assert_error(self, expected, **options):
        with self.assertRaises(MigrationError) as caught:
            migrate(self.database, **options)
        self.assertEqual(caught.exception.code, expected)

    def test_plan_has_fixed_labels_allowlist_and_time_limit_without_creating_journal(self):
        self.collection.aggregate.return_value = [{'_id': 'legacy', 'count': 2}]
        result = plan(self.database)
        self.assertEqual(result['totals']['legacy'], len(VERSIONED_COLLECTIONS) * 2)
        self.assertEqual([row['collection'] for row in result['collections']], list(VERSIONED_COLLECTIONS))
        self.collection.aggregate.assert_called_with(version_pipeline(), maxTimeMS=2000)
        self.journal.insert_one.assert_not_called()
        self.assertNotIn('schema_migrations', VERSIONED_COLLECTIONS)
        self.assertNotIn('image', json.dumps(version_pipeline()))

    @patch('app.migrations.SCHEMA_VERSION', 2)
    def test_released_baseline_cannot_silently_change_its_target_version(self):
        with self.assertRaises(MigrationError) as caught:
            plan(self.database)
        self.assertEqual(caught.exception.code, 'migration_definition_mismatch')
        self.database.__getitem__.assert_not_called()

    @patch('app.migrations.plan', return_value=snapshot(legacy=5))
    def test_default_is_dry_run_and_never_writes(self, _plan):
        self.assertEqual(migrate(self.database)['mode'], 'dry_run')
        self.collection.update_many.assert_not_called()
        self.journal.insert_one.assert_not_called()
        self.journal.update_one.assert_not_called()

    @patch('app.migrations.plan')
    def test_apply_requires_exact_database_writer_and_backup_confirmations_before_query(self, plan_mock):
        for options, error in [
            ({**self.options, 'confirm_database': 'another_db'}, 'database_confirmation_required'),
            ({**self.options, 'writers_stopped': False}, 'writers_stopped_confirmation_required'),
            ({**self.options, 'backup_ref': None}, 'backup_reference_required'),
            ({**self.options, 'backup_ref': 'mongodb://secret'}, 'backup_reference_required'),
        ]:
            self.assert_error(error, **options)
        plan_mock.assert_not_called()
        self.journal.insert_one.assert_not_called()

    @patch('app.migrations.plan', return_value=snapshot(future=1))
    def test_unknown_or_invalid_versions_block_before_lock_or_writes(self, _plan):
        self.assert_error('unsupported_versions', **self.options)
        self.collection.update_many.assert_not_called()
        self.journal.insert_one.assert_not_called()

    @patch('app.migrations.plan', return_value=snapshot(legacy=3))
    def test_budget_precheck_prevents_partial_work_when_known_count_is_too_large(self, _plan):
        self.assert_error('batch_budget_exceeded', **self.options, batch_size=1, max_batches=2)
        self.journal.insert_one.assert_not_called()

    def test_batch_limits_reject_boolean_zero_and_excessive_values(self):
        for value in (True, 0, 1001):
            self.assert_error('invalid_batch_limits', batch_size=value)

    def test_programmatic_entry_point_also_refuses_administrative_databases(self):
        self.database.name = 'admin'
        self.assert_error('invalid_database')
        self.database.__getitem__.assert_not_called()

    @patch('app.migrations.VERSIONED_COLLECTIONS', ('users',))
    @patch('app.migrations.plan', side_effect=[snapshot(legacy=1), snapshot(current=1)])
    def test_batches_change_only_version_and_recheck_predicate(self, _plan):
        self.collection.find.return_value.limit.return_value.max_time_ms.side_effect = [[{'_id': 'private-id'}], []]
        self.collection.update_many.return_value.modified_count = 1
        result = migrate(self.database, **self.options, batch_size=1)
        query, update = self.collection.update_many.call_args.args
        self.assertEqual(query['$and'][0], legacy_filter())
        self.assertEqual(query['$and'][1], {'_id': {'$in': ['private-id']}})
        self.assertEqual(update, {'$set': {'schema_version': 1}})
        self.assertEqual((result['modified'], result['batches']), (1, 1))
        self.assertNotIn('private-id', json.dumps(result))
        self.assertEqual(self.journal.update_one.call_args.args[1]['$set']['status'], 'completed')

    @patch('app.migrations.plan', return_value=snapshot())
    def test_completed_reexecution_writes_no_user_documents(self, _plan):
        result = migrate(self.database, **self.options)
        self.assertEqual(result['modified'], 0)
        self.collection.update_many.assert_not_called()

    def test_running_or_unknown_journal_is_not_stolen(self):
        self.journal.insert_one.side_effect = DuplicateKeyError('private-lock')
        self.journal.find_one_and_update.return_value = None
        with self.assertRaises(MigrationError) as caught:
            _claim(self.database, 'run', 'backup')
        self.assertEqual(caught.exception.code, 'migration_locked')
        query = self.journal.find_one_and_update.call_args.args[0]
        self.assertEqual(query['status'], {'$in': ['failed', 'completed']})
        self.assertEqual(query['schema_version'], 1)

    def test_failed_or_completed_journal_can_be_claimed_atomically(self):
        self.journal.insert_one.side_effect = DuplicateKeyError('private-lock')
        self.journal.find_one_and_update.return_value = {'status': 'running'}
        _claim(self.database, 'next-run', 'backup')
        self.assertEqual(self.journal.find_one_and_update.call_args.args[1]['$set']['run_id'], 'next-run')

    @patch('app.migrations.VERSIONED_COLLECTIONS', ('users',))
    @patch('app.migrations.plan', return_value=snapshot(legacy=1))
    def test_database_failure_is_recorded_without_raw_error(self, _plan):
        self.collection.find.side_effect = PyMongoError('private-password-uri')
        self.assert_error('database_error', **self.options)
        values = self.journal.update_one.call_args.args[1]['$set']
        self.assertEqual(values['status'], 'failed')
        self.assertNotIn('private-password-uri', json.dumps(values, default=str))

    @patch('app.migrations.VERSIONED_COLLECTIONS', ('users',))
    @patch('app.migrations.plan', side_effect=[snapshot(), snapshot(future=1)])
    def test_postcheck_cannot_mark_unexpected_versions_complete(self, _plan):
        self.assert_error('postcheck_failed', **self.options)
        self.assertEqual(self.journal.update_one.call_args.args[1]['$set']['status'], 'failed')

    @patch('app.migrations.VERSIONED_COLLECTIONS', ('users',))
    @patch('app.migrations.plan', return_value=snapshot(legacy=1))
    def test_no_progress_stops_instead_of_looping(self, _plan):
        self.collection.find.return_value.limit.return_value.max_time_ms.return_value = [{'_id': 'private-id'}]
        self.collection.update_many.return_value.modified_count = 0
        self.assert_error('no_progress', **self.options)

    @patch('app.migrations.client')
    def test_cli_does_not_connect_without_explicit_application_database(self, client_mock):
        for argv in ([], ['--database', 'admin'], ['--database', 'ADMIN'], ['--database', 'local'], ['--database', '../db']):
            with self.assertRaises(SystemExit), redirect_stdout(StringIO()):
                main(argv)
        client_mock.assert_not_called()

    @patch('app.migrations.migrate', side_effect=PyMongoError('private-uri-token'))
    @patch('app.migrations.client')
    def test_cli_failure_has_no_traceback_or_connection_string(self, _client, _migrate):
        output = StringIO()
        with redirect_stdout(output):
            status = main(['--database', 'pesc_mate_test'])
        self.assertEqual(status, 1)
        self.assertEqual(json.loads(output.getvalue()), {'status': 'failed', 'error': 'database_error'})

    @patch('app.migrations.migrate', side_effect=RuntimeError('private-field-value'))
    @patch('app.migrations.client')
    def test_cli_unexpected_failure_is_also_safe(self, _client, _migrate):
        output = StringIO()
        with redirect_stdout(output):
            self.assertEqual(main(['--database', 'pesc_mate_test']), 1)
        self.assertEqual(json.loads(output.getvalue()), {'status': 'failed', 'error': 'internal_error'})


class VersionedWriteCoverageTests(unittest.TestCase):
    def test_all_document_creation_functions_stamp_version_at_creation(self):
        # A regression guard alongside runtime/API tests; existing-document
        # updates intentionally must not upgrade or downgrade schema versions.
        functions = {
            'authentication': ('_ensure_user', 'ensure_demo_users', 'login', 'register'),
            'accessibility_settings': ('save_settings',), 'tts_settings': ('save_settings',),
            'caregiver_notes': ('save_note',), 'board_layout': ('_save',),
            'card_submissions': ('create_submission', 'review_submission', 'submit_draft', 'update_submission'),
            'categories': ('ensure_default_categories', 'create_category'),
            'communication': ('save_session', 'ensure_demo_history'),
            'learning': ('save_settings', 'record_attempt', '_audit'),
            'login_throttle': ('record_login_failure',), 'offline_events': ('sync_events',),
            'privacy': ('save_privacy', 'delete_personal_data', '_audit'),
            'support_links': ('grant_support', '_audit'), 'tts_events': ('start_event',),
        }
        root = Path(__file__).resolve().parents[1] / 'app' / 'services'
        for module, names in functions.items():
            tree = ast.parse((root / f'{module}.py').read_text(encoding='utf-8'))
            selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
            self.assertEqual({node.name for node in selected}, set(names), module)
            for function in selected:
                with self.subTest(module=module, function=function.name):
                    self.assertTrue(any(
                        isinstance(key, ast.Constant) and key.value == 'schema_version'
                        and isinstance(value, ast.Name) and value.id == 'SCHEMA_VERSION'
                        for node in ast.walk(function) if isinstance(node, ast.Dict)
                        for key, value in zip(node.keys, node.values)
                    ))
