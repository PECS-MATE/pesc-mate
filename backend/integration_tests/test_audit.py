"""Audit integrity/retention against synthetic BSON in owned UUID databases only."""
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import MagicMock, patch
from uuid import uuid4

from bson import Binary, Int64
from pymongo import MongoClient
from pymongo.errors import PyMongoError

from app import audit
from app.services import authentication, privacy


NOW = datetime(2026, 10, 18, 1, 2, 3, tzinfo=timezone.utc)


class RealAuditTests(unittest.TestCase):
    def setUp(self):
        self.original_database = os.environ.get('MONGODB_DATABASE', 'pesc_mate')
        self.name = 'pesc_mate_audit_test_' + uuid4().hex
        self.client = MongoClient(os.environ.get('MONGODB_URI', 'mongodb://127.0.0.1:27017'),
                                  serverSelectionTimeoutMS=3000)
        self.addCleanup(self.client.close)
        self.addCleanup(self.drop_owned_database)
        self.database = self.client[self.name]
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.store = Path(temporary.name).resolve() / '.local-audit'
        environment = patch.dict(os.environ, AUDIT_STORE_DIR=str(self.store),
                                 AUDIT_HMAC_KEY_FILE=str(self.store / 'signing.key'))
        environment.start()
        self.addCleanup(environment.stop)
        audit.keygen(apply=True)
        self.options = dict(apply=True, confirm_database=self.name, writers_stopped=True, now=NOW)
        for name in audit.COLLECTIONS:
            for identity, age in (('expired', 91), ('boundary', 90), ('recent', 1)):
                self.database[name].insert_one({'_id': identity, 'user_id': 'child-a',
                    'target_user_id': 'child-a', 'card_submission_id': 'card-a', 'actor_id': 'support',
                    'action': 'synthetic-action', 'created_at': NOW - timedelta(days=age),
                    'before': {'private': 'synthetic-sensitive-value', 'bytes': Binary(b'fixture'),
                               'long': Int64(9007199254740993)}})

    def drop_owned_database(self):
        if (not re.fullmatch(r'pesc_mate_audit_test_[a-f0-9]{32}', self.name)
                or self.name == self.original_database):
            raise RuntimeError('Refusing unsafe audit fixture cleanup')
        self.client.drop_database(self.name)

    def seal(self):
        return audit.seal(self.database, **self.options)['seal_id']

    def documents(self):
        return {name: list(self.database[name].find({}).sort('_id', 1)) for name in audit.COLLECTIONS}

    def assert_error(self, code, function, *args, **kwargs):
        with self.assertRaises(audit.AuditError) as caught:
            function(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)
        return caught.exception

    def test_legacy_bson_checkpoint_is_read_only_and_later_appends_are_outside_scope(self):
        original = self.documents()
        identity = self.seal()
        self.assertEqual(audit.verify(self.database, identity)['status'], 'verified')
        self.assertEqual(self.documents(), original)
        text = (self.store / (identity + '.json')).read_text()
        for private in ('synthetic-sensitive-value', 'child-a', 'card-a', 'support', 'expired'):
            self.assertNotIn(private, text)
        self.database.privacy_audit_logs.insert_one({'_id': 'later', 'action': 'new',
                                                     'created_at': NOW + timedelta(seconds=1)})
        self.assertEqual(audit.verify(self.database, identity)['status'], 'verified')

    def test_changes_deletions_backdated_insertions_and_collection_moves_are_detected(self):
        identity = self.seal()
        collection = self.database.privacy_audit_logs
        original = collection.find_one({'_id': 'recent'})
        for changes in ({'actor_id': 'other'}, {'before': {'private': 'changed'}},
                        {'created_at': NOW + timedelta(days=1)}):
            collection.update_one({'_id': 'recent'}, {'$set': changes})
            self.assert_error('audit_checkpoint_mismatch', audit.verify, self.database, identity)
            collection.replace_one({'_id': 'recent'}, original)
        collection.delete_one({'_id': 'recent'})
        self.assert_error('audit_checkpoint_mismatch', audit.verify, self.database, identity)
        collection.insert_one(original)
        collection.insert_one({'_id': 'backdated', 'created_at': NOW - timedelta(days=1)})
        self.assert_error('audit_checkpoint_mismatch', audit.verify, self.database, identity)
        collection.delete_one({'_id': 'backdated'})
        # Moving a record to another allowed collection changes both authenticated digests.
        self.database.card_audit_logs.insert_one({**original, '_id': 'moved'})
        self.assert_error('audit_checkpoint_mismatch', audit.verify, self.database, identity)

    def test_retention_plan_and_budget_failure_do_not_change_any_documents(self):
        original = self.documents()
        result = audit.retain(self.database, 90, now=NOW)
        self.assertEqual(result['candidates'], dict.fromkeys(audit.COLLECTIONS, 1))
        self.assertEqual(self.documents(), original)
        identity = self.seal()
        self.assert_error('batch_budget_exceeded', audit.retain, self.database, 90,
                          backup_ref='verified-synthetic-fixture', seal_id=identity,
                          batch_size=2, max_batches=1, **self.options)
        self.assertEqual(self.documents(), original)

    def test_retention_only_removes_older_records_and_signs_receipt_and_new_checkpoint(self):
        for name in ('communication_sessions', 'learning_attempts'):
            self.database[name].insert_one({'_id': 'preserve', 'created_at': NOW - timedelta(days=200)})
        identity = self.seal()
        original = self.documents()
        result = audit.retain(self.database, 90, backup_ref='verified-synthetic-fixture',
                              seal_id=identity, batch_size=1, **self.options)
        self.assertEqual(result['deleted'], dict.fromkeys(audit.COLLECTIONS, 1))
        for name, rows in original.items():
            self.assertEqual(list(self.database[name].find({}).sort('_id', 1)),
                             [row for row in rows if row['_id'] != 'expired'])
        self.assertEqual(audit.verify(self.database, result['remaining_seal'])['status'], 'verified')
        self.assert_error('audit_checkpoint_mismatch', audit.verify, self.database, identity)
        receipt = json.loads((self.store / (result['remaining_seal'] + '.json')).read_text())
        self.assertEqual(receipt['operation']['previous_seal'], identity)
        self.assertEqual(receipt['operation']['deleted'], result['deleted'])
        intent = json.loads((self.store / (result['intent_seal'] + '.json')).read_text())
        self.assertEqual(intent['operation']['kind'], 'retention_intent')
        self.assertEqual(intent['operation']['candidates'], result['deleted'])
        replay = audit.retain(self.database, 90, backup_ref='verified-synthetic-fixture',
                              seal_id=result['remaining_seal'], **self.options)
        self.assertEqual(sum(replay['deleted'].values()), 0)
        for name in ('communication_sessions', 'learning_attempts'):
            self.assertEqual(self.database[name].count_documents({}), 1)

    def test_empty_post_retention_database_still_has_a_signed_zero_count_receipt(self):
        for name in audit.COLLECTIONS:
            self.database[name].update_many({}, {'$set': {'created_at': NOW - timedelta(days=40)}})
        identity = self.seal()
        result = audit.retain(self.database, 30, backup_ref='verified-synthetic-fixture',
                              seal_id=identity, **self.options)
        self.assertEqual(sum(result['deleted'].values()), 3 * len(audit.COLLECTIONS))
        verified = audit.verify(self.database, result['remaining_seal'])
        self.assertEqual(sum(row['count'] for row in verified['collections'].values()), 0)

    def test_legacy_checkpoint_keeps_its_scope_but_cannot_authorize_new_collection_retention(self):
        with patch.object(audit, 'COLLECTIONS', audit.LEGACY_COLLECTIONS):
            identity = self.seal()
        original = self.documents()
        verified = audit.verify(self.database, identity)
        self.assertEqual(verified['status'], 'verified_legacy_scope')
        self.assertEqual(verified['uncovered_collections'], ['account_permission_audit_logs'])
        self.assert_error('checkpoint_scope_incomplete', audit.retain, self.database, 90,
                          backup_ref='verified-synthetic-fixture', seal_id=identity, **self.options)
        self.assertEqual(self.documents(), original)
        self.database.board_audit_logs.update_one({'_id': 'recent'}, {'$set': {'actor_id': 'changed'}})
        self.assert_error('audit_checkpoint_mismatch', audit.verify, self.database, identity)

    def test_partial_failure_keeps_original_checkpoint_and_reports_only_fixed_counts(self):
        identity = self.seal()
        collection = MagicMock(wraps=self.database.board_audit_logs)
        collection.delete_many.side_effect = PyMongoError('synthetic secret database error')
        database = MagicMock()
        database.name = self.name
        database.__getitem__.side_effect = lambda name: collection if name == 'board_audit_logs' else self.database[name]
        error = self.assert_error('database_error', audit.retain, database, 90,
                                  backup_ref='verified-synthetic-fixture', seal_id=identity, **self.options)
        self.assertEqual(error.deleted['privacy_audit_logs'], 1)
        self.assertEqual(error.deleted['board_audit_logs'], 0)
        self.assertEqual(len(list(self.store.glob('seal_*.json'))), 2)
        self.assertIsNotNone(error.intent_seal)
        self.assert_error('audit_checkpoint_mismatch', audit.verify, self.database, identity)

    def test_unwritable_intent_store_stops_before_the_first_delete(self):
        identity = self.seal()
        original = self.documents()
        with patch.object(audit, '_write', side_effect=OSError('synthetic write failure')):
            error = self.assert_error('local_io_or_internal_error', audit.retain, self.database, 90,
                                      backup_ref='verified-synthetic-fixture', seal_id=identity, **self.options)
        self.assertEqual(sum(error.deleted.values()), 0)
        self.assertIsNone(error.intent_seal)
        self.assertEqual(self.documents(), original)
        self.assertEqual(audit.verify(self.database, identity)['status'], 'verified')

    def test_invalid_timestamps_and_tampered_checkpoint_block_deletion(self):
        identity = self.seal()
        self.database.learning_audit_logs.insert_one({'_id': 'invalid', 'created_at': None})
        original = self.documents()
        self.assert_error('invalid_audit_timestamp', audit.retain, self.database, 90,
                          backup_ref='verified-synthetic-fixture', seal_id=identity, **self.options)
        self.assertEqual(self.documents(), original)
        path = self.store / (identity + '.json')
        manifest = json.loads(path.read_text())
        manifest['collections']['privacy_audit_logs']['count'] = 0
        path.write_text(json.dumps(manifest))
        self.assert_error('checkpoint_authentication_failed', audit.retain, self.database, 90,
                          backup_ref='verified-synthetic-fixture', seal_id=identity, **self.options)
        self.assertEqual(self.documents(), original)

    def test_expired_revocation_audit_does_not_reconnect_inactive_demo_supporter(self):
        self.database.privacy_settings.insert_one({'_id': 'child-a', 'guardian_consent': True})
        self.database.caregiver_links.insert_one({'_id': 'guardian:child-a', 'user_id': 'child-a',
                                                  'supporter_id': 'guardian', 'active': False})
        self.database.privacy_audit_logs.update_one({'_id': 'expired'},
            {'$set': {'action': 'support_revoked', 'target_id': 'guardian'}})
        identity = self.seal()
        audit.retain(self.database, 90, backup_ref='verified-synthetic-fixture', seal_id=identity, **self.options)
        with patch.object(authentication, '_database', return_value=self.database), \
             patch.object(authentication, '_ensure_user'), \
             patch.dict(os.environ, DEMO_USERNAME='child-a', CAREGIVER_USERNAME='guardian'):
            authentication.ensure_demo_users()
        self.assertFalse(self.database.caregiver_links.find_one()['active'])

    def test_personal_deletion_erases_prior_privacy_audit_and_preserves_other_subject(self):
        self.database.card_submissions.insert_one({'_id': 'card-a', 'owner_id': 'child-a'})
        for name in audit.COLLECTIONS:
            self.database[name].insert_one({'_id': 'other', 'user_id': 'child-b',
                'target_user_id': 'child-b', 'card_submission_id': 'card-b', 'created_at': NOW})
        other = {name: self.database[name].find_one({'_id': 'other'}) for name in audit.COLLECTIONS}
        with patch.object(privacy, '_database', return_value=self.database):
            privacy.delete_personal_data('child-a')
        for name, document in other.items():
            self.assertEqual(self.database[name].find_one({'_id': 'other'}), document)
        receipts = list(self.database.privacy_audit_logs.find({'user_id': 'child-a'}))
        self.assertEqual(len(receipts), 1)
        self.assertEqual(receipts[0]['action'], 'personal_data_deleted')
        self.assertNotIn('before', receipts[0])
        for name in ('board_audit_logs', 'learning_audit_logs', 'card_audit_logs'):
            self.assertEqual(self.database[name].count_documents({}), 1)


if __name__ == '__main__':
    unittest.main()
