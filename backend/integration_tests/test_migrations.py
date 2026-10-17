"""Real MongoDB tests; each test owns and deletes only a UUID-named scratch DB."""
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
import re
import unittest
from uuid import uuid4
from unittest.mock import patch

from bson import Binary, Int64
from pymongo import MongoClient

from app.migrations import JOURNAL, MIGRATION_ID, MigrationError, migrate, plan
from app.services.schema_versions import VERSIONED_COLLECTIONS


class RealMigrationTests(unittest.TestCase):
    def setUp(self):
        self.client = MongoClient(os.environ.get('MONGODB_URI', 'mongodb://127.0.0.1:27017'), serverSelectionTimeoutMS=3000)
        self.name = f'pesc_mate_migration_test_{uuid4().hex}'
        self.database = self.client[self.name]
        self.options = dict(apply=True, confirm_database=self.name,
                            writers_stopped=True, backup_ref='reproducible-test-fixture')

    def tearDown(self):
        # Never derive cleanup from a configured production/application name.
        try:
            if (not re.fullmatch(r'pesc_mate_migration_test_[a-f0-9]{32}', self.name)
                    or self.name == os.environ.get('MONGODB_DATABASE')):
                raise RuntimeError('Refusing unsafe scratch database cleanup')
            self.client.drop_database(self.name)
        finally:
            self.client.close()

    def test_dry_run_has_no_writes_and_apply_only_adds_version_then_is_idempotent(self):
        originals = {}
        for name in VERSIONED_COLLECTIONS:
            original = {'_id': 'fixture', 'revision': 7, 'private': 'not-for-metric-output',
                        'nested': {'bytes': Binary(b'fixture-image'), 'values': ['one', 'two']},
                        'created_at': datetime(2026, 10, 17, tzinfo=timezone.utc)}
            if name == 'users':
                original['schema_version'] = Int64(0)
            self.database[name].insert_one(deepcopy(original))
            originals[name] = self.database[name].find_one({'_id': 'fixture'})
        before_names = sorted(self.database.list_collection_names())
        preview = migrate(self.database)
        self.assertEqual(preview['totals']['legacy'], len(VERSIONED_COLLECTIONS))
        self.assertEqual(before_names, sorted(self.database.list_collection_names()))
        self.assertNotIn('not-for-metric-output', json.dumps(preview))
        for name in VERSIONED_COLLECTIONS:
            self.assertEqual(self.database[name].find_one(), originals[name])
        result = migrate(self.database, **self.options, batch_size=2)
        self.assertEqual(result['modified'], len(VERSIONED_COLLECTIONS))
        for name, original in originals.items():
            self.assertEqual(self.database[name].find_one(), {**original, 'schema_version': 1})
        self.assertEqual(migrate(self.database, **self.options)['modified'], 0)
        self.assertEqual(self.database[JOURNAL].find_one({'_id': MIGRATION_ID})['status'], 'completed')

    def test_invalid_and_future_versions_block_all_writes_including_journal(self):
        values = [2, Int64(9), None, False, 1.0, 'private-invalid-version', [0], {'private': 'value'}, -1]
        self.database.users.insert_many([{'_id': str(index), 'schema_version': value} for index, value in enumerate(values)])
        self.database.users.insert_one({'_id': 'legacy'})
        result = plan(self.database)
        self.assertEqual(result['totals'], {'legacy': 1, 'current': 0, 'future': 2, 'invalid': 7})
        self.assertNotIn('private', json.dumps(result))
        with self.assertRaises(MigrationError) as caught:
            migrate(self.database, **self.options)
        self.assertEqual(caught.exception.code, 'unsupported_versions')
        self.assertNotIn(JOURNAL, self.database.list_collection_names())
        self.assertNotIn('schema_version', self.database.users.find_one({'_id': 'legacy'}))

    def test_partial_failure_keeps_original_values_and_resumes_from_remaining_documents(self):
        self.database.users.insert_one({'_id': 'a', 'revision': 9})
        self.database.offline_events.insert_one({'_id': 'b', 'card_ids': ['help']})
        with self.assertRaises(MigrationError) as caught:
            migrate(self.database, **self.options, batch_size=2, max_batches=1)
        self.assertEqual(caught.exception.code, 'batch_budget_exceeded')
        self.assertEqual(self.database[JOURNAL].find_one()['status'], 'failed')
        self.assertEqual(self.database.users.find_one()['revision'], 9)
        self.assertEqual(migrate(self.database, **self.options)['modified'], 1)
        self.assertEqual(plan(self.database)['totals']['legacy'], 0)

    def test_running_lock_is_not_stolen_even_when_old(self):
        self.database.users.insert_one({'_id': 'fixture'})
        self.database[JOURNAL].insert_one({'_id': MIGRATION_ID, 'schema_version': 1, 'status': 'running',
                                         'started_at': datetime(2000, 1, 1), 'run_id': 'another-run'})
        with self.assertRaises(MigrationError) as caught:
            migrate(self.database, **self.options)
        self.assertEqual(caught.exception.code, 'migration_locked')
        self.assertNotIn('schema_version', self.database.users.find_one())
        self.assertEqual(self.database[JOURNAL].find_one()['run_id'], 'another-run')

    def test_new_events_and_learning_are_versioned_without_changing_replay_or_public_contract(self):
        from app.services.learning import record_attempt
        from app.services.offline_events import sync_events
        from app.services.tts_events import start_event, finish_event
        with patch('app.services.learning._database', return_value=self.database), \
             patch('app.services.offline_events._database', return_value=self.database), \
             patch('app.services.tts_events._database', return_value=self.database):
            record_attempt('fixture-child', 'attempt', 'word_picture_match', 'food', 1, 1, 3)
            record_attempt('fixture-child', 'attempt', 'word_picture_match', 'food', 1, 1, 3)
            item = {'id': 'event', 'event_type': 'immediate_speech', 'card_ids': ['help'],
                    'occurred_at': datetime.now(timezone.utc)}
            sync_events('fixture-child', [item])
            sync_events('fixture-child', [item])
            self.assertNotIn('schema_version', start_event('fixture-child', 'tts', 'card', 3))
            finish_event('fixture-child', 'tts', 'succeeded', startup_ms=0)
        for name in ('learning_attempts', 'offline_events', 'tts_events'):
            self.assertEqual(self.database[name].count_documents({}), 1)
            self.assertEqual(self.database[name].find_one()['schema_version'], 1)
