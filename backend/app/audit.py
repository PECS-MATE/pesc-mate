"""Explicit audit retention and external HMAC checkpoints; never runs at startup."""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
from uuid import uuid4

from bson.json_util import CANONICAL_JSON_OPTIONS, dumps
from pymongo import timeout
from pymongo.errors import PyMongoError

from app.services.database import client


LEGACY_COLLECTIONS = ('privacy_audit_logs', 'board_audit_logs', 'learning_audit_logs', 'card_audit_logs')
COLLECTIONS = (*LEGACY_COLLECTIONS, 'account_permission_audit_logs')
RETENTION_DAYS = (30, 90, 365, 1095)
MAX_RECORDS = 500000


class AuditError(Exception):
    def __init__(self, code, deleted=None, intent_seal=None):
        self.code = code
        self.deleted = deleted
        self.intent_seal = intent_seal
        super().__init__(code)


def _database(name):
    if (not isinstance(name, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,62}', name)
            or name.lower() in {'admin', 'config', 'local'}):
        raise AuditError('invalid_database')


def _utc(value=None):
    value = value or datetime.now(timezone.utc)
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise AuditError('timezone_required')
    value = value.astimezone(timezone.utc)
    return value.replace(microsecond=value.microsecond // 1000 * 1000)


def _store(create=False):
    value = os.environ.get('AUDIT_STORE_DIR', '')
    path = Path(value)
    if (not value or not path.is_absolute() or path.name != '.local-audit'
            or path.resolve() != path.absolute()):
        raise AuditError('safe_absolute_store_required')
    if create:
        path.mkdir(mode=0o700, parents=False, exist_ok=True)
    if not path.is_dir():
        raise AuditError('audit_store_not_found')
    return path


def _write(path, value):
    # No overwriting keys/checkpoints. A partial file after a crash is invalid.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())


def keygen(apply=False):
    if not apply:
        return {'mode': 'dry_run', 'status': 'planned', 'database_access': False}
    path = _store(create=True) / 'signing.key'
    _write(path, secrets.token_bytes(32))
    return {'mode': 'apply', 'status': 'key_created', 'key_file': str(path)}


def _key():
    value = os.environ.get('AUDIT_HMAC_KEY_FILE', '')
    path = Path(value)
    if (not value or not path.is_absolute() or path.resolve() != path.absolute()
            or not path.is_file() or path.is_symlink() or path.stat().st_size != 32):
        raise AuditError('valid_external_key_required')
    key = path.read_bytes()
    if len(key) != 32:
        raise AuditError('valid_external_key_required')
    return key


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')


def _snapshot(database, through, collections=None):
    rows = {}
    total = 0
    for name in COLLECTIONS if collections is None else collections:
        collection = database[name]
        # Invalid dates must not silently disappear from the integrity scope.
        invalid = collection.count_documents(
            {'$expr': {'$ne': [{'$type': '$created_at'}, 'date']}}, maxTimeMS=2000)
        if invalid:
            raise AuditError('invalid_audit_timestamp')
        digest = hashlib.sha256()
        count = 0
        cursor = collection.find({'created_at': {'$lte': through}}).sort('_id', 1).max_time_ms(2000)
        for document in cursor:
            total += 1
            if total > MAX_RECORDS:
                raise AuditError('checkpoint_record_limit_exceeded')
            digest.update(dumps(document, json_options=CANONICAL_JSON_OPTIONS,
                                sort_keys=True, separators=(',', ':')).encode('utf-8'))
            digest.update(b'\n')
            count += 1
        rows[name] = {'count': count, 'sha256': digest.hexdigest()}
    return rows


def _stable_snapshot(database, through, collections=None):
    with timeout(30):
        before = _snapshot(database, through, collections)
        if before != _snapshot(database, through, collections):
            raise AuditError('audit_changed_during_scan')
    return before


def _confirm(database, confirm_database, writers_stopped):
    if confirm_database != database.name:
        raise AuditError('database_confirmation_required')
    if not writers_stopped:
        raise AuditError('writers_stopped_confirmation_required')


def seal(database, *, apply=False, confirm_database=None, writers_stopped=False, now=None, _operation=None):
    _database(database.name)
    through = _utc(now)
    if not apply:
        return {'mode': 'dry_run', 'status': 'planned', 'database': database.name,
                'through': through.isoformat(), 'collections': list(COLLECTIONS)}
    _confirm(database, confirm_database, writers_stopped)
    key = _key()
    store = _store(create=True)
    for name in COLLECTIONS:
        if database[name].count_documents({'created_at': {'$gt': through}}, maxTimeMS=2000):
            raise AuditError('future_audit_timestamp')
    rows = _stable_snapshot(database, through)
    identity = 'seal_' + uuid4().hex
    manifest = {'format': 1, 'seal_id': identity, 'database': database.name,
                'through': through.isoformat(), 'key_id': hashlib.sha256(key).hexdigest()[:16],
                'collections': rows, 'operation': _operation}
    manifest['hmac_sha256'] = hmac.new(key, _json(manifest), hashlib.sha256).hexdigest()
    _write(store / (identity + '.json'), _json(manifest))
    return {'mode': 'apply', 'status': 'sealed', 'seal_id': identity,
            'through': manifest['through'], 'collections': rows}


def _read(identity, database_name):
    if not isinstance(identity, str) or not re.fullmatch(r'seal_[a-f0-9]{32}', identity):
        raise AuditError('invalid_seal_id')
    path = _store() / (identity + '.json')
    if (path.is_symlink() or path.resolve() != path.absolute()
            or not path.is_file() or path.stat().st_size > 16384):
        raise AuditError('unsafe_or_missing_checkpoint')
    try:
        manifest = json.loads(path.read_text(encoding='ascii'))
        if (set(manifest) != {'format', 'seal_id', 'database', 'through', 'key_id', 'collections', 'hmac_sha256', 'operation'}
                or type(manifest['format']) is not int or manifest['format'] != 1
                or manifest['seal_id'] != identity or manifest['database'] != database_name
                or set(manifest['collections']) not in (set(COLLECTIONS), set(LEGACY_COLLECTIONS))):
            raise ValueError()
        for row in manifest['collections'].values():
            if (set(row) != {'count', 'sha256'} or type(row['count']) is not int or row['count'] < 0
                    or not re.fullmatch(r'[a-f0-9]{64}', row['sha256'])):
                raise ValueError()
        through = _utc(datetime.fromisoformat(manifest['through']))
        signature = manifest['hmac_sha256']
        if not isinstance(signature, str) or not re.fullmatch(r'[a-f0-9]{64}', signature):
            raise ValueError()
    except (ValueError, TypeError, KeyError, UnicodeError):
        raise AuditError('invalid_checkpoint') from None
    key = _key()
    payload = {k: v for k, v in manifest.items() if k != 'hmac_sha256'}
    expected = hmac.new(key, _json(payload), hashlib.sha256).hexdigest()
    if manifest['key_id'] != hashlib.sha256(key).hexdigest()[:16] or not hmac.compare_digest(signature, expected):
        raise AuditError('checkpoint_authentication_failed')
    return manifest, through


def verify(database, identity):
    _database(database.name)
    manifest, through = _read(identity, database.name)  # Authenticate before querying DB.
    legacy = set(manifest['collections']) != set(COLLECTIONS)
    rows = (_stable_snapshot(database, through, tuple(manifest['collections'])) if legacy
            else _stable_snapshot(database, through))
    if rows != manifest['collections']:
        raise AuditError('audit_checkpoint_mismatch')
    return {'status': 'verified_legacy_scope' if legacy else 'verified', 'seal_id': identity,
            'through': through.isoformat(), 'collections': rows,
            'uncovered_collections': [name for name in COLLECTIONS if name not in manifest['collections']]}


def retain(database, days, *, apply=False, confirm_database=None, writers_stopped=False,
           backup_ref=None, seal_id=None, batch_size=500, max_batches=1000, now=None):
    _database(database.name)
    if type(days) is not int or days not in RETENTION_DAYS:
        raise AuditError('explicit_retention_days_required')
    if (type(batch_size) is not int or not 1 <= batch_size <= 1000
            or type(max_batches) is not int or not 1 <= max_batches <= 10000):
        raise AuditError('invalid_batch_limits')
    cutoff = _utc(now) - timedelta(days=days)
    query = {'created_at': {'$lt': cutoff}}
    if apply:
        _confirm(database, confirm_database, writers_stopped)
        if not isinstance(backup_ref, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', backup_ref):
            raise AuditError('backup_reference_required')
        manifest, through = _read(seal_id, database.name)
        if set(manifest['collections']) != set(COLLECTIONS):
            raise AuditError('checkpoint_scope_incomplete')
        if cutoff > through:
            raise AuditError('checkpoint_does_not_cover_cutoff')
        verify(database, seal_id)
    counts = {}
    for name in COLLECTIONS:
        if database[name].count_documents(
                {'$expr': {'$ne': [{'$type': '$created_at'}, 'date']}}, maxTimeMS=2000):
            raise AuditError('invalid_audit_timestamp')
        counts[name] = database[name].count_documents(query, maxTimeMS=2000)
    if not apply:
        return {'mode': 'dry_run', 'status': 'planned', 'days': days,
                'cutoff': cutoff.isoformat(), 'candidates': counts}
    if sum((count + batch_size - 1) // batch_size for count in counts.values()) > max_batches:
        raise AuditError('batch_budget_exceeded')
    deleted = dict.fromkeys(COLLECTIONS, 0)
    batches = 0
    intent = None
    try:
        # Persist authenticated intent before the first irreversible delete. If the
        # store is unwritable, no deletion happens; a crash retains this evidence.
        intent = seal(database, apply=True, confirm_database=database.name, writers_stopped=True, now=now,
                      _operation={'kind': 'retention_intent', 'days': days, 'cutoff': cutoff.isoformat(),
                                  'candidates': counts, 'backup_ref': backup_ref, 'previous_seal': seal_id})
        for name in COLLECTIONS:
            while True:
                with timeout(10):
                    ids = [row['_id'] for row in database[name].find(query, {'_id': 1})
                           .limit(batch_size).max_time_ms(2000)]
                    if not ids:
                        break
                    if batches >= max_batches:
                        raise AuditError('batch_budget_exceeded')
                    result = database[name].delete_many({'_id': {'$in': ids}, **query})
                    batches += 1
                    deleted[name] += result.deleted_count
                    if not result.deleted_count:
                        raise AuditError('no_progress')
        if deleted != counts:
            raise AuditError('retention_postcheck_failed')
        # Never replace the original evidence. A new signed checkpoint is the receipt.
        receipt = seal(database, apply=True, confirm_database=database.name, writers_stopped=True, now=now,
                       _operation={'kind': 'retention', 'days': days, 'cutoff': cutoff.isoformat(),
                                   'deleted': deleted, 'backup_ref': backup_ref, 'previous_seal': seal_id,
                                   'intent_seal': intent['seal_id']})
        return {'mode': 'apply', 'status': 'completed', 'days': days, 'cutoff': cutoff.isoformat(),
                'deleted': deleted, 'backup_ref': backup_ref, 'previous_seal': seal_id,
                'intent_seal': intent['seal_id'], 'remaining_seal': receipt['seal_id']}
    except Exception as exc:
        code = exc.code if isinstance(exc, AuditError) else 'database_error' if isinstance(exc, PyMongoError) else 'local_io_or_internal_error'
        raise AuditError(code, deleted=deleted, intent_seal=intent['seal_id'] if intent else None) from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('keygen').add_argument('--apply', action='store_true')
    for name in ('seal', 'verify', 'retain'):
        command = commands.add_parser(name)
        command.add_argument('--database', required=True)
        if name in {'verify', 'retain'}:
            command.add_argument('--seal-id', required=name == 'verify')
        if name != 'verify':
            mode = command.add_mutually_exclusive_group()
            mode.add_argument('--apply', action='store_true')
            mode.add_argument('--dry-run', action='store_true')
            command.add_argument('--confirm-database')
            command.add_argument('--writers-stopped', action='store_true')
        if name == 'retain':
            command.add_argument('--days', type=int, choices=RETENTION_DAYS, required=True)
            command.add_argument('--backup-ref')
            command.add_argument('--batch-size', type=int, default=500)
            command.add_argument('--max-batches', type=int, default=1000)
    args = parser.parse_args(argv)
    try:
        if args.command == 'keygen':
            result = keygen(args.apply)
        else:
            _database(args.database)
            database = client()[args.database]
            if args.command == 'verify':
                result = verify(database, args.seal_id)
            elif args.command == 'seal':
                result = seal(database, apply=args.apply, confirm_database=args.confirm_database,
                              writers_stopped=args.writers_stopped)
            else:
                result = retain(database, args.days, apply=args.apply, confirm_database=args.confirm_database,
                                writers_stopped=args.writers_stopped, backup_ref=args.backup_ref,
                                seal_id=args.seal_id, batch_size=args.batch_size, max_batches=args.max_batches)
    except Exception as exc:
        code = exc.code if isinstance(exc, AuditError) else 'database_error' if isinstance(exc, PyMongoError) else 'local_io_or_internal_error'
        result = {'status': 'failed', 'error': code}
        if isinstance(exc, AuditError) and exc.deleted is not None:
            result['deleted'] = exc.deleted
            result['intent_seal'] = exc.intent_seal
        print(json.dumps(result))
        return 1
    print(json.dumps(result, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
