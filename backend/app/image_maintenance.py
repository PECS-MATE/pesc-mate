"""Local embedded-image audit/backfill; read-only unless --apply and confirmations are supplied."""
import argparse
from datetime import datetime, timezone
import json
import re

from fastapi import HTTPException

from app.services.database import client
from app.services import image_storage as storage
from app.services.card_submissions import _normalize_image


def maintain(db, command='audit', *, apply=False, confirm_database=None, writers_stopped=False,
             lock_token=None, batch_size=100):
    if (not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,62}', db.name)
            or db.name.lower() in {'admin', 'config', 'local'}):
        raise ValueError('invalid_database')
    if apply and (confirm_database != db.name or not writers_stopped):
        raise ValueError('database_and_stopped_writers_confirmation_required')
    if not 1 <= batch_size <= 500:
        raise ValueError('invalid_batch_size')
    lock = db.image_storage_state.find_one({'_id': storage.LOCK_ID})
    if command == 'clear-lock':
        if apply:
            if not lock or not lock_token or lock.get('token') != lock_token:
                raise ValueError('exact_lock_token_required')
            removed = db.image_storage_state.delete_one({'_id': storage.LOCK_ID, 'token': lock_token}).deleted_count
            return {'mode': 'apply', 'locks_removed': removed}
        return {'mode': 'dry_run', 'lock_present': bool(lock), 'lock_token': (lock or {}).get('token')}
    if command not in {'audit', 'backfill'}:
        raise ValueError('unknown_command')
    if not apply:
        return _run(db, command, False, batch_size, bool(lock))
    with storage.image_write_lock(db):
        return _run(db, command, True, batch_size, False)


def _run(db, command, apply, batch_size, locked):
    report = {'mode': 'apply' if apply else 'dry_run', 'file_storage': 'embedded_no_external_files',
              'limit': batch_size, 'lock_present': locked, 'orphan_cards': 0, 'stale_preset_images': 0,
              'missing_thumbnails': 0, 'changed': 0, 'skipped': 0}
    # Only IDs and metadata are scanned, never print names, image bytes or local paths.
    orphans = list(db.card_submissions.aggregate([
        {'$project': {'_id': 1, 'owner_id': 1}},
        {'$lookup': {'from': 'users', 'localField': 'owner_id', 'foreignField': '_id',
                     'pipeline': [{'$project': {'_id': 1}}], 'as': 'owner'}},
        {'$match': {'owner': {'$size': 0}}}, {'$project': {'_id': 1, 'owner_id': 1}},
        {'$sort': {'_id': 1}}, {'$limit': batch_size},
    ], maxTimeMS=3000))
    report['orphan_cards'] = len(orphans)
    stale = list(db.users.find({'profile.kind': 'preset', '$or': [
        {'profile.image_data': {'$exists': True}}, {'profile.original_image': {'$exists': True}},
        {'profile.thumbnail_data': {'$exists': True}},
    ]}, {'_id': 1}).sort('_id', 1).limit(batch_size))
    report['stale_preset_images'] = len(stale)
    if command == 'audit' and apply:
        if orphans or stale:
            storage.deletion_watermark(db)  # Saved before any deletion; failure is fail-closed.
        for row in orphans:
            # Recheck under the image write lock; no broad filesystem or collection deletion.
            if not db.users.find_one({'_id': row.get('owner_id')}, {'_id': 1}):
                report['changed'] += db.card_submissions.delete_one({'_id': row['_id'], 'owner_id': row.get('owner_id')}).deleted_count
        for row in stale:
            report['changed'] += db.users.update_one({'_id': row['_id'], 'profile.kind': 'preset'}, {'$unset': {
                'profile.image_data': '', 'profile.original_image': '', 'profile.thumbnail_data': '',
                'profile.thumbnail_version': '', 'profile.image_url': '', 'profile.thumbnail_url': '',
                'profile.content_type': ''}}).modified_count
    for name, condition, projection in (
        ('card_submissions', {'thumbnail': {'$exists': False}}, {'_id': 1, 'owner_id': 1, 'image': 1}),
        ('users', {'profile.kind': 'custom', 'profile.thumbnail_data': {'$exists': False}}, {'_id': 1, 'profile': 1}),
    ):
        rows = db[name].find(condition, projection).sort('_id', 1).limit(batch_size)
        for row in rows:
            report['missing_thumbnails'] += 1
            if command != 'backfill' or not apply:
                continue
            is_card = name == 'card_submissions'
            previous = row.get('image') if is_card else row.get('profile')
            try:
                display, _ = _normalize_image(previous['data' if is_card else 'image_data'], previous['content_type'],
                    max_edge=storage.DISPLAY_EDGE if is_card else storage.PROFILE_EDGE)
                thumb = storage.thumbnail(display, storage.THUMB_EDGE if is_card else storage.PROFILE_THUMB_EDGE)
                owner = row['owner_id'] if is_card else row['_id']
                if not db.users.find_one({'_id': owner}, {'_id': 1}):
                    report['skipped'] += 1
                    continue
                # Backfill adds only a thumbnail and keeps the existing display/original untouched.
                storage.check_capacity(db, owner, len(thumb['data']))
                changes = {'thumbnail': thumb} if is_card else {
                    'profile.thumbnail_data': thumb['data'], 'profile.thumbnail_version': thumb['version'],
                    'profile.thumbnail_url': previous['image_url'] + '&variant=thumbnail&t=' + thumb['version']}
                result = db[name].update_one({'_id': row['_id'], **condition}, {'$set': changes})
                report['changed'] += result.modified_count
            except (HTTPException, KeyError, TypeError):
                report['skipped'] += 1  # Corrupt legacy bytes or quota rejection are not rewritten.
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['audit', 'backfill', 'clear-lock'])
    parser.add_argument('--database', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--confirm-database')
    parser.add_argument('--writers-stopped', action='store_true')
    parser.add_argument('--lock-token')
    parser.add_argument('--batch-size', type=int, default=100)
    args = parser.parse_args(argv)
    try:
        if (not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,62}', args.database)
                or args.database.lower() in {'admin', 'config', 'local'}):
            raise ValueError('invalid_database')
        result = maintain(client()[args.database], args.command, apply=args.apply,
            confirm_database=args.confirm_database, writers_stopped=args.writers_stopped,
            lock_token=args.lock_token, batch_size=args.batch_size)
    except Exception:
        print(json.dumps({'status': 'failed', 'error': 'image_maintenance_failed'}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
