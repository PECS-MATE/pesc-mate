"""Measure synthetic AI generation and same-account reuse in a disposable test DB.

Explicit opt-in tool: no real account content, model downloads or paid providers.
Only this invocation's uniquely named database is removed on exit.
"""
import argparse
import json
import os
from pathlib import Path
import re
import sys
from time import perf_counter
from types import SimpleNamespace
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--uri', required=True)
    parser.add_argument('--database-prefix', default='pesc_mate_test_ai_latency')
    parser.add_argument('--warmup', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'pesc_mate_test_[A-Za-z0-9_]{1,25}', args.database_prefix):
        parser.error('database prefix must be a pesc_mate_test_ test prefix, at most 40 characters')
    from pymongo import MongoClient
    from app.services import communication, model, recording_guard

    os.environ['OLLAMA_ENABLED'] = 'true'  # This explicit benchmark process only.
    client = MongoClient(args.uri, serverSelectionTimeoutMS=3000, connectTimeoutMS=3000, tz_aware=True)
    name = args.database_prefix + '_' + uuid4().hex[:12]
    created = False
    original_communication_db, original_guard_db = communication.database, recording_guard.database
    try:
        client.admin.command('ping')
        if name in client.list_database_names():
            raise RuntimeError('refuse an existing database')
        db = client[name]
        db.privacy_settings.insert_one({'_id': 'synthetic', 'guardian_consent': True, 'recording_revision': 1})
        created = True
        db.communication_sessions.create_index([('user_id', 1), ('created_at', -1)], name='user_recent_sessions')
        communication.database = lambda: db
        recording_guard.database = lambda: db
        if args.warmup:
            started = perf_counter()
            ready = model.warmup()
            print(json.dumps({'phase': 'warmup', 'ready': ready,
                'elapsed_ms': round((perf_counter() - started) * 1000, 1)}), flush=True)
        for phase in ('first_request', 'same_combination'):
            started = perf_counter()
            result = communication.save_session(SimpleNamespace(
                cards=['me', 'water', 'drink'], request_id=uuid4(), selected_at=None), 'synthetic')
            print(json.dumps({'phase': phase, 'source': result['generation_source'],
                'sentence': result['sentence'], 'performance': result['generation']['performance'],
                'request_ms': round((perf_counter() - started) * 1000, 1)}, ensure_ascii=True), flush=True)
    finally:
        communication.database, recording_guard.database = original_communication_db, original_guard_db
        if created:
            client.drop_database(name)
        client.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
