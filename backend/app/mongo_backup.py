"""Host-only local Compose backup tool; default create/restore commands are plans.

Run from the repository: python backend/app/mongo_backup.py --help
Only the Python standard library and the running local MongoDB container are used.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
from uuid import uuid4


REPO = Path(__file__).resolve().parents[2]
BACKUP_ROOT = REPO / '.local-backups'
LOCK = '_pesc_mate_restore_lock'
BACKUP_PATTERN = r'backup_[a-f0-9]{32}'
RESTORE_PATTERN = r'pesc_mate_restore_[a-f0-9]{32}'


class BackupError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def _database(name):
    if (not isinstance(name, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,62}', name)
            or name.lower() in {'admin', 'config', 'local'}):
        raise BackupError('invalid_database')
    return name


def _run(args):
    try:
        result = subprocess.run(args, cwd=REPO, capture_output=True, text=True,
                                encoding='utf-8', errors='replace', timeout=300, check=False)
    except (OSError, subprocess.SubprocessError):
        raise BackupError('tool_unavailable_or_timeout') from None
    if result.returncode:
        # Tool stderr can contain private document values, paths or connection details.
        raise BackupError('tool_failed')
    return result.stdout.strip()


def _compose(*args):
    # Pin the same base Compose configuration, regardless of shell COMPOSE_FILE.
    return _run(['docker', 'compose', '--project-name', 'pesc-mate',
                 '-f', str(REPO / 'compose.yaml'), *args])


def _shell(database, body):
    script = 'const d = db.getSiblingDB(' + json.dumps(_database(database)) + ');\n' + body
    output = _compose('exec', '-T', 'mongodb', 'mongosh', '--quiet', '--norc', '--eval', script)
    try:
        return json.loads(output)
    except (ValueError, TypeError):
        raise BackupError('invalid_tool_response') from None


def fingerprint(database, *, ignore_lock=False):
    """Hash BSON documents, collection options and indexes without emitting rows."""
    result = _shell(database, r'''
const h = require('crypto').createHash('sha256');
const infos = d.getCollectionInfos().sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
let documents = 0, collections = 0;
function add(value) { h.update(EJSON.stringify(value, null, 0, {relaxed:false})); h.update('\n'); }
for (const info of infos) {
  if (info.name === '_pesc_mate_restore_lock') {
    if (IGNORE_LOCK) continue;
    throw Error('reserved_collection');
  }
  if (info.type !== 'collection' || info.name.startsWith('system.')) throw Error('unsupported_collection');
  add({collection:info.name, options:info.options});
  const c = d.getCollection(info.name);
  const indexes = c.getIndexes().sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const index of indexes) { delete index.ns; add(index); }
  const cursor = c.find({}).collation({locale:'simple'}).sort({_id:1}).maxTimeMS(60000);
  while (cursor.hasNext()) { add(cursor.next()); documents++; }
  collections++;
}
print(JSON.stringify({sha256:h.digest('hex'), collections, documents}));
'''.replace('IGNORE_LOCK', 'true' if ignore_lock else 'false'))
    if (not isinstance(result, dict) or set(result) != {'sha256', 'collections', 'documents'}
            or not isinstance(result['sha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', result['sha256'])
            or any(type(result[k]) is not int or result[k] < 0 for k in ('collections', 'documents'))):
        raise BackupError('invalid_fingerprint')
    return result


def _directory(backup_id, *, create=False):
    if not isinstance(backup_id, str) or not re.fullmatch(BACKUP_PATTERN, backup_id):
        raise BackupError('invalid_backup_id')
    # Refuse symlinks/junctions anywhere in the artifact path.
    if BACKUP_ROOT.resolve() != BACKUP_ROOT.absolute():
        raise BackupError('unsafe_backup_path')
    path = BACKUP_ROOT / backup_id
    if path.resolve() != path.absolute():
        raise BackupError('unsafe_backup_path')
    if create:
        BACKUP_ROOT.mkdir(mode=0o700, exist_ok=True)
        path.mkdir(mode=0o700, exist_ok=False)
    elif not path.is_dir():
        raise BackupError('backup_not_found')
    return path


def _file(path):
    if path.is_symlink() or path.resolve() != path.absolute() or not path.is_file():
        raise BackupError('unsafe_or_missing_backup_file')
    return path


def _checksum(path):
    digest = hashlib.sha256()
    with _file(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def _write_json(path, value):
    # Exclusive creation: no replacing a previous manifest or verification receipt.
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, separators=(',', ':'))
        stream.write('\n')


def _now():
    return datetime.now(timezone.utc).isoformat()


def _container():
    identity = _compose('ps', '-q', 'mongodb')
    if not re.fullmatch(r'[a-f0-9]{12,64}', identity):
        raise BackupError('mongodb_container_not_running')
    return identity


def _temporary():
    return '/tmp/pesc_mate_backup_' + uuid4().hex + '.archive.gz'


def _cleanup(temporary):
    if not re.fullmatch(r'/tmp/pesc_mate_backup_[a-f0-9]{32}\.archive\.gz', temporary):
        raise BackupError('unsafe_temporary_path')
    try:
        _compose('exec', '-T', 'mongodb', 'rm', '-f', '--', temporary)
        return True
    except BackupError:
        return False  # Never mask the backup/restore error; no broad cleanup fallback.


def create(database, *, apply=False, confirm_database=None, writers_stopped=False):
    _database(database)
    if not apply:
        return {'mode': 'dry_run', 'status': 'planned', 'database': database,
                'requires': ['confirm_database', 'writers_stopped', 'isolated_restore_verification']}
    if confirm_database != database:
        raise BackupError('database_confirmation_required')
    if not writers_stopped:
        raise BackupError('writers_stopped_confirmation_required')
    before = fingerprint(database)
    if before['collections'] == 0:
        raise BackupError('source_database_empty_or_missing')
    identity = _container()
    backup_id = 'backup_' + uuid4().hex
    directory = _directory(backup_id, create=True)
    temporary = _temporary()
    try:
        _compose('exec', '-T', 'mongodb', 'mongodump', '--db=' + database,
                 '--gzip', '--archive=' + temporary)
        archive = directory / 'database.archive.gz'
        _run(['docker', 'cp', identity + ':' + temporary, str(archive)])
        if fingerprint(database) != before:
            raise BackupError('source_changed_during_backup')
        manifest = {'format': 1, 'backup_id': backup_id, 'source_database': database,
                    'created_at': _now(), 'archive_sha256': _checksum(archive),
                    'archive_bytes': archive.stat().st_size, 'fingerprint': before}
        if manifest['archive_bytes'] == 0:
            raise BackupError('empty_archive')
        _write_json(directory / 'manifest.json', manifest)
    finally:
        cleaned = _cleanup(temporary)
    return {'mode': 'apply', 'status': 'created_not_restore_verified', 'backup_id': backup_id,
            'fingerprint': before, 'container_temporary_removed': cleaned}


def inspect(backup_id):
    directory = _directory(backup_id)
    path = _file(directory / 'manifest.json')
    if path.stat().st_size > 16384:
        raise BackupError('invalid_manifest')
    try:
        manifest = json.loads(path.read_text(encoding='utf-8'))
        if (type(manifest['format']) is not int or manifest['format'] != 1
                or manifest['backup_id'] != backup_id
                or not isinstance(manifest['archive_sha256'], str)
                or not re.fullmatch(r'[a-f0-9]{64}', manifest['archive_sha256'])
                or type(manifest['archive_bytes']) is not int or manifest['archive_bytes'] <= 0
                or not isinstance(manifest['fingerprint'], dict)
                or set(manifest['fingerprint']) != {'sha256', 'collections', 'documents'}
                or not isinstance(manifest['fingerprint']['sha256'], str)
                or not re.fullmatch(r'[a-f0-9]{64}', manifest['fingerprint']['sha256'])
                or any(type(manifest['fingerprint'][key]) is not int or manifest['fingerprint'][key] < 0
                       for key in ('collections', 'documents'))):
            raise ValueError()
        _database(manifest['source_database'])
    except (ValueError, TypeError, KeyError):
        raise BackupError('invalid_manifest') from None
    archive = _file(directory / 'database.archive.gz')
    if archive.stat().st_size != manifest['archive_bytes'] or _checksum(archive) != manifest['archive_sha256']:
        raise BackupError('archive_checksum_mismatch')
    return manifest


def _target(database, source):
    if (not isinstance(database, str) or not re.fullmatch(RESTORE_PATTERN, database)
            or database == source):
        raise BackupError('isolated_restore_database_required')
    result = _shell(database, 'print(JSON.stringify({empty:d.getCollectionInfos().length === 0}));')
    if result != {'empty': True}:
        raise BackupError('restore_target_not_empty')


def restore(backup_id, target_database, *, apply=False, confirm_database=None):
    manifest = inspect(backup_id)  # Hash check precedes all DB access, even the plan.
    source = manifest['source_database']
    _target(target_database, source)
    if not apply:
        return {'mode': 'dry_run', 'status': 'planned', 'backup_id': backup_id,
                'target_database': target_database, 'source_overwrite': False}
    if confirm_database != target_database:
        raise BackupError('database_confirmation_required')
    identity = _container()
    nonce = uuid4().hex
    temporary = _temporary()
    # Atomic namespace reservation: two invocations can never both own this target.
    reservation = _shell(target_database, '''
if (d.getCollectionInfos().length !== 0) throw Error('target_not_empty');
d.createCollection('_pesc_mate_restore_lock');
d.getCollection('_pesc_mate_restore_lock').insertOne({_id:'reservation', nonce:''' + json.dumps(nonce) + '''});
print(JSON.stringify({reserved:true}));
''')
    if reservation != {'reserved': True}:
        raise BackupError('restore_lock_not_acquired')
    try:
        _run(['docker', 'cp', str(_directory(backup_id) / 'database.archive.gz'), identity + ':' + temporary])
        _compose('exec', '-T', 'mongodb', 'mongorestore', '--gzip', '--archive=' + temporary,
                 '--nsInclude=' + source + '.*', '--nsFrom=' + source + '.*',
                 '--nsTo=' + target_database + '.*', '--stopOnError')
        restored = fingerprint(target_database, ignore_lock=True)
        if restored != manifest['fingerprint']:
            raise BackupError('restored_fingerprint_mismatch')
        result = _shell(target_database, '''
const c = d.getCollection('_pesc_mate_restore_lock');
if (c.countDocuments({}) !== 1 || !c.findOne({_id:'reservation', nonce:''' + json.dumps(nonce) + '''})) throw Error('lock_lost');
c.drop(); print(JSON.stringify({released:true}));
''')
        if result != {'released': True}:
            raise BackupError('restore_lock_lost')
        receipt = {'format': 1, 'backup_id': backup_id, 'verified_at': _now(),
                   'target_database': target_database, 'archive_sha256': manifest['archive_sha256'],
                   'fingerprint': restored}
        _write_json(_directory(backup_id) / (target_database + '.verified.json'), receipt)
    finally:
        cleaned = _cleanup(temporary)
    return {'mode': 'apply', 'status': 'restore_verified', 'backup_id': backup_id,
            'target_database': target_database, 'fingerprint': restored,
            'container_temporary_removed': cleaned}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('create', 'restore'):
        command = commands.add_parser(name)
        if name == 'create':
            command.add_argument('--database', required=True)
            command.add_argument('--writers-stopped', action='store_true')
        else:
            command.add_argument('--backup-id', required=True)
            command.add_argument('--target-database', required=True)
        mode = command.add_mutually_exclusive_group()
        mode.add_argument('--apply', action='store_true')
        mode.add_argument('--dry-run', action='store_true')
        command.add_argument('--confirm-database')
    command = commands.add_parser('inspect')
    command.add_argument('--backup-id', required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == 'create':
            result = create(args.database, apply=args.apply, confirm_database=args.confirm_database,
                            writers_stopped=args.writers_stopped)
        elif args.command == 'restore':
            result = restore(args.backup_id, args.target_database, apply=args.apply,
                             confirm_database=args.confirm_database)
        else:
            manifest = inspect(args.backup_id)
            result = {'status': 'archive_checksum_valid', 'backup_id': manifest['backup_id'],
                      'source_database': manifest['source_database'], 'fingerprint': manifest['fingerprint']}
    except Exception as exc:
        code = exc.code if isinstance(exc, BackupError) else 'local_io_or_internal_error'
        print(json.dumps({'status': 'failed', 'error': code}))
        return 1
    print(json.dumps(result, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
