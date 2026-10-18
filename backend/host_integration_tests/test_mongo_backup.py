"""Explicit opt-in host tests: Docker Compose must already have MongoDB running.

Only UUID-named synthetic databases and this test's own backup artifacts are removed.
"""
import json
from pathlib import Path
import re
import shutil
import sys
import unittest
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import mongo_backup as backup


class LocalBackupIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.source = 'pesc_mate_backup_test_' + uuid4().hex
        self.target = 'pesc_mate_restore_' + uuid4().hex
        self.backup_ids = []
        self.addCleanup(self.cleanup_owned_fixtures)
        backup._shell(self.source, '''
d.createCollection('users', {validator:{name:{$type:'string'}}});
d.users.createIndex({name:1, role:-1}, {unique:true, name:'name_role'});
d.users.insertOne({_id:ObjectId('000000000000000000000001'), name:'합성 사용자', role:'aac',
    image:BinData(0,'AAEC/w=='), revision:NumberLong('9007199254740993'),
    at:ISODate('2026-10-18T01:02:03Z'), nested:{card:['사과','가다']}});
d.empty_cards.insertOne({_id:'temporary'}); d.empty_cards.deleteMany({});
d.auth_sessions.createIndex({expires_at:1}, {expireAfterSeconds:0});
d.auth_sessions.insertOne({_id:'synthetic-session', expires_at:ISODate('2099-01-01T00:00:00Z')});
print(JSON.stringify({seeded:true}));
''')

    def cleanup_owned_fixtures(self):
        for database, pattern in ((self.source, r'pesc_mate_backup_test_[a-f0-9]{32}'),
                                  (self.target, backup.RESTORE_PATTERN)):
            if not re.fullmatch(pattern, database) or database == 'pesc_mate':
                raise AssertionError('Unsafe fixture cleanup')
            backup._shell(database, 'd.dropDatabase(); print(JSON.stringify({removed:true}));')
        for identity in self.backup_ids:
            directory = backup._directory(identity)
            if directory.parent != backup.BACKUP_ROOT or not re.fullmatch(backup.BACKUP_PATTERN, directory.name):
                raise AssertionError('Unsafe artifact cleanup')
            shutil.rmtree(directory)  # Only this test's exact generated backup directory.

    def create_backup(self):
        result = backup.create(self.source, apply=True, confirm_database=self.source, writers_stopped=True)
        self.backup_ids.append(result['backup_id'])
        self.assertEqual(result['status'], 'created_not_restore_verified')
        self.assertTrue(result['container_temporary_removed'])
        return result['backup_id']

    def test_bson_indexes_options_and_empty_collection_restore_without_source_overwrite(self):
        original = backup.fingerprint(self.source)
        identity = self.create_backup()
        backup._shell(self.source, '''
d.users.updateOne({}, {$set:{schema_version:1, revision:NumberLong('9007199254740994')}});
d.schema_migrations.insertOne({_id:'synthetic-failed-migration', status:'failed'});
print(JSON.stringify({changed:true}));
''')
        changed = backup.fingerprint(self.source)
        self.assertNotEqual(original, changed)
        plan = backup.restore(identity, self.target)
        self.assertEqual(plan['mode'], 'dry_run')
        result = backup.restore(identity, self.target, apply=True, confirm_database=self.target)
        self.assertEqual(result['status'], 'restore_verified')
        self.assertTrue(result['container_temporary_removed'])
        self.assertEqual(backup.fingerprint(self.target), original)
        self.assertEqual(backup.fingerprint(self.source), changed)
        with self.assertRaises(backup.BackupError) as caught:
            backup.restore(identity, self.target, apply=True, confirm_database=self.target)
        self.assertEqual(caught.exception.code, 'restore_target_not_empty')
        receipt = backup._directory(identity) / (self.target + '.verified.json')
        self.assertEqual(json.loads(receipt.read_text())['fingerprint'], original)

    def test_corruption_blocks_before_target_creation_and_never_changes_source(self):
        identity = self.create_backup()
        before = backup.fingerprint(self.source)
        archive = backup._directory(identity) / 'database.archive.gz'
        with archive.open('ab') as stream:
            stream.write(b'synthetic corruption')
        with self.assertRaises(backup.BackupError) as caught:
            backup.restore(identity, self.target, apply=True, confirm_database=self.target)
        self.assertEqual(caught.exception.code, 'archive_checksum_mismatch')
        self.assertEqual(backup.fingerprint(self.source), before)
        self.assertEqual(backup.fingerprint(self.target)['collections'], 0)

    def test_existing_target_and_source_are_never_restored_into(self):
        identity = self.create_backup()
        backup._shell(self.target, "d.sentinel.insertOne({_id:'preserve'}); print(JSON.stringify({seeded:true}));")
        before = backup.fingerprint(self.target)
        for target in (self.source, 'pesc_mate', self.target):
            with self.assertRaises(backup.BackupError):
                backup.restore(identity, target, apply=True, confirm_database=target)
        self.assertEqual(backup.fingerprint(self.target), before)

    def test_failed_verification_keeps_target_quarantined_without_receipt(self):
        identity = self.create_backup()
        before = backup.fingerprint(self.source)
        directory = backup._directory(identity)
        manifest_path = directory / 'manifest.json'
        manifest = json.loads(manifest_path.read_text())
        # Deliberately wrong expected fingerprint, while archive checksum stays valid.
        manifest['fingerprint']['sha256'] = '0' * 64
        manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
        with self.assertRaises(backup.BackupError) as caught:
            backup.restore(identity, self.target, apply=True, confirm_database=self.target)
        self.assertEqual(caught.exception.code, 'restored_fingerprint_mismatch')
        result = backup._shell(self.target, '''
print(JSON.stringify({locked:d.getCollection('_pesc_mate_restore_lock').countDocuments({}) === 1,
                     restored:d.users.countDocuments({}) === 1}));
''')
        self.assertEqual(result, {'locked': True, 'restored': True})
        self.assertFalse((directory / (self.target + '.verified.json')).exists())
        with self.assertRaises(backup.BackupError) as caught:
            backup.restore(identity, self.target, apply=True, confirm_database=self.target)
        self.assertEqual(caught.exception.code, 'restore_target_not_empty')
        self.assertEqual(backup.fingerprint(self.source), before)


if __name__ == '__main__':
    unittest.main()
