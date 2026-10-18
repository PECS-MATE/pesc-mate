from contextlib import redirect_stdout
import hashlib
from io import StringIO
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from app import mongo_backup as backup


ID = 'backup_' + 'a' * 32
TARGET = 'pesc_mate_restore_' + 'b' * 32
FINGERPRINT = {'sha256': 'c' * 64, 'collections': 2, 'documents': 3}


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve() / '.local-backups'
        self.root_patch = patch.object(backup, 'BACKUP_ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def fixture(self):
        directory = backup._directory(ID, create=True)
        archive = directory / 'database.archive.gz'
        archive.write_bytes(b'synthetic archive, not private data')
        manifest = {'format': 1, 'backup_id': ID, 'source_database': 'fixture',
                    'archive_sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
                    'archive_bytes': archive.stat().st_size, 'fingerprint': FINGERPRINT}
        backup._write_json(directory / 'manifest.json', manifest)
        return directory, manifest

    def error(self, expected, function, *args, **kwargs):
        with self.assertRaises(backup.BackupError) as caught:
            function(*args, **kwargs)
        self.assertEqual(caught.exception.code, expected)

    @patch.object(backup, '_run')
    def test_create_defaults_to_plan_without_docker_or_local_writes(self, run):
        result = backup.create('fixture')
        self.assertEqual(result['mode'], 'dry_run')
        self.assertFalse(self.root.exists())
        run.assert_not_called()

    @patch.object(backup, '_run')
    def test_create_requires_all_confirmations_before_any_access(self, run):
        self.error('database_confirmation_required', backup.create, 'fixture', apply=True)
        self.error('writers_stopped_confirmation_required', backup.create, 'fixture',
                   apply=True, confirm_database='fixture')
        run.assert_not_called()
        self.assertFalse(self.root.exists())

    def test_database_backup_and_target_names_are_strict(self):
        for name in ('admin', 'ADMIN', 'config', 'local', '', '../fixture', 'db.*', 'db;exit()', None):
            self.error('invalid_database', backup.create, name)
        for name in ('../backup', ID + '/child', 'a' * 32, None):
            self.error('invalid_backup_id', backup.inspect, name)
        for name in ('fixture', 'pesc_mate', TARGET + 'x', None):
            self.error('isolated_restore_database_required', backup._target, name, 'fixture')
        self.error('isolated_restore_database_required', backup._target, TARGET, TARGET)

    def test_manifest_hash_size_and_exclusive_creation(self):
        directory, expected = self.fixture()
        self.assertEqual(backup.inspect(ID), expected)
        with self.assertRaises(FileExistsError):
            backup._write_json(directory / 'manifest.json', {})
        (directory / 'database.archive.gz').write_bytes(b'tampered archive')
        self.error('archive_checksum_mismatch', backup.inspect, ID)

    def test_invalid_manifest_cannot_supply_archive_path_or_fingerprint(self):
        directory, manifest = self.fixture()
        for changes in ({'format': True}, {'archive_bytes': True}, {'backup_id': '../elsewhere'},
                        {'source_database': 'admin'}, {'fingerprint': []},
                        {'fingerprint': {**FINGERPRINT, 'documents': True}}):
            (directory / 'manifest.json').write_text(json.dumps({**manifest, **changes}), encoding='utf-8')
            with self.assertRaises(backup.BackupError):
                backup.inspect(ID)

    def test_symlink_root_and_archive_are_rejected(self):
        directory, _ = self.fixture()
        link = Path(self.temporary.name) / 'linked'
        try:
            link.symlink_to(self.root, target_is_directory=True)
        except OSError:
            self.skipTest('Host does not permit symlinks')
        with patch.object(backup, 'BACKUP_ROOT', link):
            self.error('unsafe_backup_path', backup.inspect, ID)
        archive = directory / 'database.archive.gz'
        archive.unlink()
        archive.symlink_to(directory / 'manifest.json')
        self.error('unsafe_or_missing_backup_file', backup.inspect, ID)

    @patch.object(backup, '_shell', return_value={'empty': False})
    def test_existing_restore_target_is_never_touched(self, shell):
        self.fixture()
        self.error('restore_target_not_empty', backup.restore, ID, TARGET, apply=True, confirm_database=TARGET)
        self.assertEqual(shell.call_count, 1)

    @patch.object(backup, '_shell')
    def test_corrupt_archive_fails_before_any_database_access(self, shell):
        directory, _ = self.fixture()
        (directory / 'database.archive.gz').write_bytes(b'bad')
        self.error('archive_checksum_mismatch', backup.restore, ID, TARGET, apply=True, confirm_database=TARGET)
        shell.assert_not_called()

    @patch.object(backup, '_shell', return_value={'empty': True})
    def test_restore_plan_does_not_reserve_or_write(self, shell):
        directory, _ = self.fixture()
        self.assertEqual(backup.restore(ID, TARGET)['mode'], 'dry_run')
        self.assertEqual(shell.call_count, 1)
        self.assertEqual(len(list(directory.iterdir())), 2)
        self.error('database_confirmation_required', backup.restore, ID, TARGET, apply=True)

    @patch.object(backup, '_cleanup', return_value=True)
    @patch.object(backup, '_container', return_value='d' * 64)
    @patch.object(backup, '_run')
    @patch.object(backup, '_compose')
    @patch.object(backup, 'fingerprint', return_value=FINGERPRINT)
    @patch.object(backup, '_shell', side_effect=[{'empty': True}, {'reserved': True}, {'released': True}])
    def test_restore_maps_only_source_to_fresh_target_and_writes_receipt(self, shell, fingerprint, compose, run, container, cleanup):
        directory, _ = self.fixture()
        result = backup.restore(ID, TARGET, apply=True, confirm_database=TARGET)
        self.assertEqual(result['status'], 'restore_verified')
        command = compose.call_args.args
        self.assertIn('--nsInclude=fixture.*', command)
        self.assertIn('--nsFrom=fixture.*', command)
        self.assertIn('--nsTo=' + TARGET + '.*', command)
        self.assertIn('--stopOnError', command)
        self.assertNotIn('--drop', command)
        self.assertIn("_id:'reservation'", shell.call_args_list[1].args[1])
        fingerprint.assert_called_once_with(TARGET, ignore_lock=True)
        receipt = json.loads((directory / (TARGET + '.verified.json')).read_text())
        self.assertEqual(receipt['fingerprint'], FINGERPRINT)
        cleanup.assert_called_once()

    @patch.object(backup, '_cleanup', return_value=True)
    @patch.object(backup, '_container', return_value='d' * 64)
    @patch.object(backup, '_run')
    @patch.object(backup, '_compose')
    @patch.object(backup, 'fingerprint', return_value={**FINGERPRINT, 'documents': 1})
    @patch.object(backup, '_shell', side_effect=[{'empty': True}, {'reserved': True}])
    def test_failed_restore_preserves_quarantine_and_has_no_success_receipt(self, shell, fingerprint, compose, run, container, cleanup):
        directory, _ = self.fixture()
        self.error('restored_fingerprint_mismatch', backup.restore, ID, TARGET, apply=True, confirm_database=TARGET)
        self.assertEqual(shell.call_count, 2)  # No lock drop, no database drop.
        self.assertEqual(len(list(directory.iterdir())), 2)
        cleanup.assert_called_once()

    @patch.object(backup, '_cleanup', return_value=True)
    @patch.object(backup, '_container', return_value='d' * 64)
    @patch.object(backup, '_run')
    @patch.object(backup, '_compose')
    @patch.object(backup, 'fingerprint', side_effect=[FINGERPRINT, {**FINGERPRINT, 'documents': 4}])
    def test_changed_source_never_produces_valid_manifest(self, fingerprint, compose, run, container, cleanup):
        self.error('source_changed_during_backup', backup.create, 'fixture', apply=True,
                   confirm_database='fixture', writers_stopped=True)
        self.assertEqual(list(self.root.glob('*/manifest.json')), [])
        cleanup.assert_called_once()

    @patch.object(backup, 'fingerprint', return_value={**FINGERPRINT, 'collections': 0})
    def test_empty_database_cannot_become_false_success(self, fingerprint):
        self.error('source_database_empty_or_missing', backup.create, 'fixture', apply=True,
                   confirm_database='fixture', writers_stopped=True)
        self.assertFalse(self.root.exists())

    @patch.object(backup, '_run')
    def test_only_owned_container_temporary_paths_can_be_removed(self, run):
        for path in ('/tmp', '/', '/tmp/../data/db', '/tmp/backup.gz'):
            self.error('unsafe_temporary_path', backup._cleanup, path)
        run.assert_not_called()

    @patch.object(backup, '_run', return_value='ok')
    def test_compose_project_and_configuration_are_explicit(self, run):
        self.assertEqual(backup._compose('ps', '-q', 'mongodb'), 'ok')
        command = run.call_args.args[0]
        self.assertEqual(command[:4], ['docker', 'compose', '--project-name', 'pesc-mate'])
        self.assertEqual(command[4:6], ['-f', str(backup.REPO / 'compose.yaml')])

    @patch('app.mongo_backup.subprocess.run')
    def test_subprocess_has_deadline_no_shell_and_never_exposes_stderr(self, run):
        run.return_value = subprocess.CompletedProcess([], 1, stdout='private row', stderr='secret URI')
        self.error('tool_failed', backup._run, ['docker', 'compose', 'ps'])
        self.assertNotIn('shell', run.call_args.kwargs)
        self.assertEqual(run.call_args.kwargs['timeout'], 300)
        run.side_effect = subprocess.TimeoutExpired('private command', 300)
        self.error('tool_unavailable_or_timeout', backup._run, [])

    @patch.object(backup, 'create', side_effect=RuntimeError('private user image URI'))
    def test_cli_redacts_unexpected_errors(self, create):
        output = StringIO()
        with redirect_stdout(output):
            self.assertEqual(backup.main(['create', '--database', 'fixture']), 1)
        self.assertEqual(json.loads(output.getvalue()), {'status': 'failed', 'error': 'local_io_or_internal_error'})


if __name__ == '__main__':
    unittest.main()
