"""Explicit, resumable baseline migration. Default invocation never writes."""
import argparse
from datetime import datetime, timezone
import json
import re
from uuid import uuid4

from pymongo import ReturnDocument, timeout
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.services.database import client
from app.services.schema_versions import SCHEMA_VERSION, VERSIONED_COLLECTIONS


MIGRATION_ID = '0001_schema_version_baseline'
JOURNAL = 'schema_migrations'
STATES = ('legacy', 'current', 'future', 'invalid')


class MigrationError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def legacy_filter():
    return {'$or': [
        {'schema_version': {'$exists': False}},
        {'$expr': {'$and': [
            {'$in': [{'$type': '$schema_version'}, ['int', 'long']]},
            {'$eq': ['$schema_version', 0]},
        ]}},
    ]}


def version_pipeline():
    integer = {'$in': [{'$type': '$schema_version'}, ['int', 'long']]}
    # Group into four fixed labels, never by arbitrary stored field values.
    return [{'$group': {'_id': {'$switch': {'branches': [
        {'case': {'$eq': [{'$type': '$schema_version'}, 'missing']}, 'then': 'legacy'},
        {'case': {'$and': [integer, {'$eq': ['$schema_version', 0]}]}, 'then': 'legacy'},
        {'case': {'$and': [integer, {'$eq': ['$schema_version', SCHEMA_VERSION]}]}, 'then': 'current'},
        {'case': {'$and': [integer, {'$gt': ['$schema_version', SCHEMA_VERSION]}]}, 'then': 'future'},
    ], 'default': 'invalid'}}, 'count': {'$sum': 1}}}]


def plan(database):
    if SCHEMA_VERSION != 1:
        # A released migration ID must never silently acquire a new target.
        raise MigrationError('migration_definition_mismatch')
    collections = []
    totals = dict.fromkeys(STATES, 0)
    for name in VERSIONED_COLLECTIONS:
        counts = dict.fromkeys(STATES, 0)
        for row in database[name].aggregate(version_pipeline(), maxTimeMS=2000):
            counts[row['_id']] += row['count']
        for key in STATES:
            totals[key] += counts[key]
        collections.append({'collection': name, **counts})
    return {'migration': MIGRATION_ID, 'target_version': SCHEMA_VERSION,
            'status': 'blocked' if totals['future'] or totals['invalid'] else 'ready',
            'totals': totals, 'collections': collections}


def _claim(database, run_id, backup_ref):
    values = {'schema_version': SCHEMA_VERSION, 'status': 'running', 'run_id': run_id,
              'backup_ref': backup_ref, 'started_at': datetime.now(timezone.utc)}
    collection = database[JOURNAL]
    try:
        collection.insert_one({'_id': MIGRATION_ID, **values})
    except DuplicateKeyError:
        document = collection.find_one_and_update(
            {'_id': MIGRATION_ID, 'schema_version': SCHEMA_VERSION,
             'status': {'$in': ['failed', 'completed']}},
            {'$set': values, '$unset': {'finished_at': '', 'error': '', 'modified': ''}},
            return_document=ReturnDocument.AFTER,
        )
        if document is None:
            raise MigrationError('migration_locked') from None


def migrate(database, *, apply=False, confirm_database=None, writers_stopped=False,
            backup_ref=None, batch_size=500, max_batches=1000):
    if (not isinstance(database.name, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,62}', database.name)
            or database.name.lower() in {'admin', 'config', 'local'}):
        raise MigrationError('invalid_database')
    if (type(batch_size) is not int or not 1 <= batch_size <= 1000
            or type(max_batches) is not int or not 1 <= max_batches <= 10000):
        raise MigrationError('invalid_batch_limits')
    if apply:
        if confirm_database != database.name:
            raise MigrationError('database_confirmation_required')
        if not writers_stopped:
            raise MigrationError('writers_stopped_confirmation_required')
        if not isinstance(backup_ref, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', backup_ref):
            raise MigrationError('backup_reference_required')
    before = plan(database)
    if not apply:
        return {'mode': 'dry_run', **before}
    if before['status'] == 'blocked':
        raise MigrationError('unsupported_versions')
    if before['totals']['legacy'] > batch_size * max_batches:
        raise MigrationError('batch_budget_exceeded')

    run_id = str(uuid4())
    _claim(database, run_id, backup_ref)
    modified = dict.fromkeys(VERSIONED_COLLECTIONS, 0)
    batches = 0
    try:
        for name in VERSIONED_COLLECTIONS:
            collection = database[name]
            while True:
                with timeout(10):
                    documents = list(collection.find(legacy_filter(), {'_id': 1})
                                     .limit(batch_size).max_time_ms(2000))
                    if not documents:
                        break
                    if batches >= max_batches:
                        raise MigrationError('batch_budget_exceeded')
                    result = collection.update_many(
                        {'$and': [legacy_filter(), {'_id': {'$in': [row['_id'] for row in documents]}}]},
                        {'$set': {'schema_version': SCHEMA_VERSION}},
                    )
                    batches += 1
                    modified[name] += result.modified_count
                    if result.modified_count == 0:
                        raise MigrationError('no_progress')
        after = plan(database)
        if after['status'] != 'ready' or after['totals']['legacy']:
            raise MigrationError('postcheck_failed')
        result = database[JOURNAL].update_one(
            {'_id': MIGRATION_ID, 'run_id': run_id, 'status': 'running'},
            {'$set': {'status': 'completed', 'finished_at': datetime.now(timezone.utc), 'modified': modified}},
        )
        if result.matched_count != 1:
            raise MigrationError('journal_update_failed')
        return {'mode': 'apply', **after, 'status': 'completed',
                'modified': sum(modified.values()), 'batches': batches}
    except Exception as exc:
        code = exc.code if isinstance(exc, MigrationError) else 'database_error' if isinstance(exc, PyMongoError) else 'internal_error'
        try:
            database[JOURNAL].update_one(
                {'_id': MIGRATION_ID, 'run_id': run_id, 'status': 'running'},
                {'$set': {'status': 'failed', 'finished_at': datetime.now(timezone.utc),
                          'error': code, 'modified': modified}},
            )
        except PyMongoError:
            pass  # A lost process/connection may leave a lock; never steal it automatically.
        raise MigrationError(code) from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True, help='Explicit target database; credentials use MONGODB_URI only')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--dry-run', action='store_true')
    parser.add_argument('--confirm-database')
    parser.add_argument('--writers-stopped', action='store_true')
    parser.add_argument('--backup-ref')
    parser.add_argument('--batch-size', type=int, default=500)
    parser.add_argument('--max-batches', type=int, default=1000)
    args = parser.parse_args(argv)
    if (not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,62}', args.database)
            or args.database.lower() in {'admin', 'config', 'local'}):
        parser.error('Use an explicit application database name, not an administrative database')
    try:
        result = migrate(client()[args.database], apply=args.apply, confirm_database=args.confirm_database,
                         writers_stopped=args.writers_stopped, backup_ref=args.backup_ref,
                         batch_size=args.batch_size, max_batches=args.max_batches)
    except Exception as exc:
        code = exc.code if isinstance(exc, MigrationError) else 'database_error' if isinstance(exc, PyMongoError) else 'internal_error'
        print(json.dumps({'status': 'failed', 'error': code}))
        return 1
    print(json.dumps(result, separators=(',', ':')))
    return 2 if result['status'] == 'blocked' else 0


if __name__ == '__main__':
    raise SystemExit(main())
