from contextlib import redirect_stdout
from datetime import datetime, timezone
from io import StringIO
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import MagicMock, patch

from app import audit
from app.services.indexes import INDEXES


NOW = datetime(2026, 10, 18, 1, 2, 3, tzinfo=timezone.utc)
ROWS = {name: {'count': 1, 'sha256': 'a' * 64} for name in audit.COLLECTIONS}


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.store = Path(self.temporary.name).resolve() / '.local-audit'
        environment = patch.dict(os.environ, AUDIT_STORE_DIR=str(self.store),
                                 AUDIT_HMAC_KEY_FILE=str(self.store / 'signing.key'))
        environment.start()
        self.addCleanup(environment.stop)
        self.database = MagicMock()
        self.database.name = 'fixture'
        self.database.__getitem__.return_value.count_documents.return_value = 0
        self.options = dict(apply=True, confirm_database='fixture', writers_stopped=True, now=NOW)

    def error(self, code, function, *args, **kwargs):
        with self.assertRaises(audit.AuditError) as caught:
            function(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)

    def fixture(self):
        audit.keygen(apply=True)
        with patch.object(audit, '_stable_snapshot', return_value=ROWS):
            return audit.seal(self.database, **self.options)['seal_id']

    def test_key_and_seal_default_plans_do_not_write_or_query(self):
        self.assertEqual(audit.keygen()['mode'], 'dry_run')
        self.assertEqual(audit.seal(self.database)['mode'], 'dry_run')
        self.assertFalse(self.store.exists())
        self.database.__getitem__.assert_not_called()

    def test_key_is_random_binary_never_overwritten_or_exposed(self):
        result = audit.keygen(apply=True)
        path = Path(result['key_file'])
        self.assertEqual(len(path.read_bytes()), 32)
        self.assertNotIn(path.read_bytes().hex(), json.dumps(result))
        with self.assertRaises(FileExistsError):
            audit.keygen(apply=True)

    def test_seal_confirmation_and_key_are_required_before_database_reads(self):
        self.error('database_confirmation_required', audit.seal, self.database, apply=True)
        self.error('writers_stopped_confirmation_required', audit.seal, self.database,
                   apply=True, confirm_database='fixture')
        self.error('valid_external_key_required', audit.seal, self.database, **self.options)
        self.database.__getitem__.assert_not_called()

    def test_names_periods_and_batch_limits_cannot_widen_scope(self):
        for name in ('admin', 'CONFIG', 'local', '../fixture', 'db.*', None):
            self.database.name = name
            self.error('invalid_database', audit.seal, self.database)
        self.database.name = 'fixture'
        for days in (None, True, 0, 7, 99999):
            self.error('explicit_retention_days_required', audit.retain, self.database, days)
        self.error('invalid_batch_limits', audit.retain, self.database, 90, batch_size=0)
        self.database.__getitem__.assert_not_called()

    def test_retention_plan_only_counts_fixed_collections_without_key_or_files(self):
        result = audit.retain(self.database, 90, now=NOW)
        self.assertEqual(result['mode'], 'dry_run')
        self.assertEqual(set(result['candidates']), set(audit.COLLECTIONS))
        self.assertEqual(result['cutoff'], '2026-07-20T01:02:03+00:00')
        self.database.__getitem__.return_value.delete_many.assert_not_called()
        self.assertFalse(self.store.exists())

    def test_signed_checkpoint_authenticates_before_any_database_query(self):
        identity = self.fixture()
        self.database.reset_mock()
        with patch.object(audit, '_stable_snapshot', return_value=ROWS):
            self.assertEqual(audit.verify(self.database, identity)['status'], 'verified')
        path = self.store / (identity + '.json')
        manifest = json.loads(path.read_text())
        manifest['collections']['board_audit_logs']['count'] = 999
        path.write_text(json.dumps(manifest))
        self.error('checkpoint_authentication_failed', audit.verify, self.database, identity)
        self.database.__getitem__.assert_not_called()

    def test_wrong_key_database_and_traversal_do_not_pass(self):
        identity = self.fixture()
        self.database.name = 'other'
        self.error('invalid_checkpoint', audit.verify, self.database, identity)
        self.database.name = 'fixture'
        self.error('invalid_seal_id', audit.verify, self.database, '../signing.key')
        (self.store / 'signing.key').write_bytes(b'not-the-original-key'.ljust(32, b'!'))
        self.error('checkpoint_authentication_failed', audit.verify, self.database, identity)

    def test_missing_or_changed_records_are_not_reported_verified(self):
        identity = self.fixture()
        changed = {**ROWS, 'privacy_audit_logs': {'count': 0, 'sha256': 'b' * 64}}
        with patch.object(audit, '_stable_snapshot', return_value=changed):
            self.error('audit_checkpoint_mismatch', audit.verify, self.database, identity)

    def test_unstable_scan_and_record_limit_stop_without_checkpoint(self):
        with patch.object(audit, '_snapshot', side_effect=[ROWS, {}]):
            self.error('audit_changed_during_scan', audit._stable_snapshot, self.database, NOW)
        self.database.__getitem__.return_value.find.return_value.sort.return_value.max_time_ms.return_value = [
            {'_id': 'synthetic', 'created_at': NOW}]
        with patch.object(audit, 'MAX_RECORDS', 0):
            self.error('checkpoint_record_limit_exceeded', audit._snapshot, self.database, NOW)

    def test_invalid_timestamp_and_future_date_are_not_silently_signed(self):
        self.database.__getitem__.return_value.count_documents.return_value = 1
        self.error('invalid_audit_timestamp', audit.retain, self.database, 90)
        audit.keygen(apply=True)
        self.error('future_audit_timestamp', audit.seal, self.database, **self.options)

    def test_retention_requires_backup_and_authenticated_checkpoint(self):
        self.error('backup_reference_required', audit.retain, self.database, 90, **self.options)
        self.error('invalid_seal_id', audit.retain, self.database, 90, backup_ref='verified-fixture', **self.options)
        self.database.__getitem__.return_value.delete_many.assert_not_called()

    def test_audit_retention_indexes_are_non_ttl(self):
        for name in audit.COLLECTIONS:
            selected = [options for collection, keys, options in INDEXES if collection == name
                        and keys == [('created_at', 1)]]
            self.assertEqual(selected, [{'name': 'audit_retention_scan'}])
        self.assertFalse(any('expireAfterSeconds' in options for name, _, options in INDEXES
                             if name in audit.COLLECTIONS))

    def test_store_cannot_be_relative_or_a_symlink(self):
        with patch.dict(os.environ, AUDIT_STORE_DIR='../somewhere'):
            self.error('safe_absolute_store_required', audit.keygen, apply=True)
        with patch.dict(os.environ, AUDIT_STORE_DIR=self.temporary.name):
            self.error('safe_absolute_store_required', audit.keygen, apply=True)
        target = Path(self.temporary.name) / 'target'
        target.mkdir()
        try:
            self.store.symlink_to(target, target_is_directory=True)
        except OSError:
            self.skipTest('Host does not permit symlinks')
        self.error('safe_absolute_store_required', audit.keygen, apply=True)

    @patch.object(audit, 'client', side_effect=RuntimeError('secret URI and private audit content'))
    def test_cli_never_prints_exception_or_record_content(self, client):
        output = StringIO()
        with redirect_stdout(output):
            self.assertEqual(audit.main(['verify', '--database', 'fixture', '--seal-id', 'invalid']), 1)
        self.assertEqual(json.loads(output.getvalue()), {'status': 'failed', 'error': 'local_io_or_internal_error'})


if __name__ == '__main__':
    unittest.main()
