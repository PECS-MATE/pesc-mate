"""Explicit local-only synthetic usage insertion; never invoked by app startup."""
import argparse
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
import json
import random
import re
from uuid import NAMESPACE_URL, uuid5

from app.services.communication import INDEX, sentence
from app.services.database import database
from app.services.schema_versions import SCHEMA_VERSION

KST = timezone(timedelta(hours=9))
COLLECTIONS = ('communication_sessions', 'offline_events', 'tts_events')
SCENARIOS = [
    ('meal', ['me', 'water', 'drink']), ('meal', ['rice', 'eat']),
    ('meal', ['apple', 'eat']), ('meal', ['milk', 'drink']),
    ('home', ['me', 'play']), ('home', ['mom', 'play']),
    ('outside', ['home', 'go']), ('school', ['toilet', 'go']),
    ('home', ['rest']), ('home', ['help']), ('home', ['happy']),
    ('school', ['no']), ('home', ['again']),
]


def identifier(user_id, batch_id, key):
    return str(uuid5(NAMESPACE_URL, f'pecs-mate:synthetic-usage:{user_id}:{batch_id}:{key}'))


def build(user_id, batch_id, end_date, now):
    rng = random.Random(f'{user_id}:{batch_id}:{end_date.isoformat()}')
    common = {'schema_version': SCHEMA_VERSION, 'user_id': user_id, 'synthetic': True,
              'synthetic_batch_id': batch_id, 'synthetic_kind': 'usage-month-v1'}
    records = {name: [] for name in COLLECTIONS}
    for day_index in range(30):
        day = end_date - timedelta(days=29 - day_index)
        stream_id = identifier(user_id, batch_id, f'stream:{day}')
        sequence = 0
        for index in range(rng.randint(8, 14)):
            at = (datetime.combine(day, time(9), KST) + timedelta(minutes=45 * index)).astimezone(timezone.utc)
            # No future activity, even if run before the end of today's schedule.
            if at + timedelta(minutes=1) > now:
                continue
            situation, cards = rng.choices(SCENARIOS, weights=[7, 5, 3, 3, 4, 2, 2, 2, 2, 1, 2, 1, 1])[0]
            assert all(key in INDEX for key in cards)
            key = f'{day}:{index}'
            session_id = identifier(user_id, batch_id, f'session:{key}')
            selection_id = identifier(user_id, batch_id, f'selection:{key}')
            text = sentence(cards)
            records['communication_sessions'].append({**common, '_id': session_id,
                'cards': cards, 'card_metadata': {}, 'card_selected_at': [at] * len(cards),
                'sentence': f'[테스트] {text}', 'generation_source': 'rule',
                'generation_attempt': 1, 'regeneration_of': None, 'created_at': at,
                'source': 'synthetic-usage-month'})
            sequence += 1
            base = {**common, 'card_ids': cards, 'situation': situation,
                    'stream_id': stream_id, 'selection_id': selection_id}
            records['offline_events'].append({**base, '_id': selection_id,
                'event_type': 'card_selection', 'occurred_at': at, 'sequence': sequence})
            status = rng.choices(['succeeded', 'cancelled', 'failed'], weights=[92, 5, 3])[0]

            def speech(suffix, content, content_type, outcome, when, recovery_id=None):
                nonlocal sequence
                sequence += 1
                event_id = identifier(user_id, batch_id, f'{suffix}:{key}')
                finished = when + timedelta(seconds=3)
                error = 'synthesis-failed' if outcome == 'failed' else 'user-stopped' if outcome == 'cancelled' else None
                records['offline_events'].append({**base, '_id': event_id,
                    'event_type': 'recovery_speech' if recovery_id else 'speech_result',
                    'card_ids': [] if recovery_id else cards,
                    'session_id': session_id, 'occurred_at': when, 'completed_at': finished,
                    'speech_status': outcome, 'recovery_id': recovery_id, 'sequence': sequence})
                records['tts_events'].append({**common, '_id': event_id,
                    'content_type': content_type, 'char_count': len(content),
                    'status': outcome, 'error_code': error,
                    'requested_at': when, 'completed_at': finished, 'startup_ms': rng.randint(90, 650)})

            speech('speech', text, 'sentence', status, at + timedelta(seconds=8))
            if status != 'succeeded':
                speech('recovery', '다시 말할게요', 'recovery', 'succeeded', at + timedelta(seconds=16), 'say_again')
                speech('retry', text, 'sentence', 'succeeded', at + timedelta(seconds=24))
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--user-id', required=True)
    parser.add_argument('--confirm-user-id', help='Must match --user-id for all writes')
    parser.add_argument('--batch-id', required=True)
    parser.add_argument('--end-date', type=date.fromisoformat, help='KST date; required for insertion')
    parser.add_argument('--apply', action='store_true', help='Default is read-only preview')
    parser.add_argument('--delete', action='store_true', help='Remove only this tagged synthetic batch')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', args.batch_id):
        parser.error('batch-id must be 1-80 ASCII letters, digits, hyphens or underscores')
    if args.apply and args.confirm_user_id != args.user_id:
        parser.error('Writes require --confirm-user-id matching --user-id')
    db = database()
    user = db.users.find_one({'_id': args.user_id, 'role': 'user'}, {'_id': 1})
    if not user:
        parser.error('Target child account does not exist')
    scope = {'user_id': args.user_id, 'synthetic': True, 'synthetic_batch_id': args.batch_id,
             'synthetic_kind': 'usage-month-v1'}
    before = {name: db[name].count_documents(scope) for name in COLLECTIONS}
    report = {'user_id': args.user_id, 'batch_id': args.batch_id,
              'mode': 'apply' if args.apply else 'preview', 'existing_batch': before}
    if args.delete:
        report['action'] = 'delete_synthetic_batch'
        if args.apply:
            report['deleted'] = {name: db[name].delete_many(scope).deleted_count for name in COLLECTIONS}
    else:
        now = datetime.now(timezone.utc)
        if not args.end_date or args.end_date > now.astimezone(KST).date():
            parser.error('Insertion requires a non-future --end-date YYYY-MM-DD')
        consent = db.privacy_settings.find_one({'_id': args.user_id}) or {}
        if not consent.get('guardian_consent') or consent.get('deletion_status') in {'in_progress', 'failed', 'completed'}:
            parser.error('Active existing guardian consent is required; the tool never grants consent')
        records = build(args.user_id, args.batch_id, args.end_date, now)
        report.update({'action': 'insert_synthetic_usage', 'end_date_kst': str(args.end_date),
            'planned': {name: len(rows) for name, rows in records.items()},
            'days': len({row['created_at'].astimezone(KST).date() for row in records['communication_sessions']}),
            'speech_outcomes': dict(Counter(row['status'] for row in records['tts_events']))})
        if args.apply:
            inserted = {}
            for name, rows in records.items():
                count = 0
                for row in rows:
                    # Insert only; preserve existing rows and safely resume partial batches.
                    result = db[name].update_one({'_id': row['_id'], **scope}, {'$setOnInsert': row}, upsert=True)
                    count += result.upserted_id is not None
                inserted[name] = count
            report['inserted'] = inserted
    report['remaining_batch'] = {name: db[name].count_documents(scope) for name in COLLECTIONS}
    print(json.dumps(report, ensure_ascii=False, default=str))


if __name__ == '__main__':
    main()
