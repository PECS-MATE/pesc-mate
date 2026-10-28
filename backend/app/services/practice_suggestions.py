"""Bounded, consented learning activity candidates independent of AAC card recommendations."""
from collections import Counter
from datetime import datetime, timedelta, timezone
import os

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.services.categories import active_categories
from app.services.database import database
from app.services.learning import DEFAULT_SETTINGS, settings_for
from app.services.privacy import privacy_for
from app.services.recommendations import available_cards
from app.services.schema_versions import SCHEMA_VERSION

WINDOW_DAYS = 14
MAX_SELECTIONS = 500
MAX_ATTEMPTS = 100
RULE_VERSION = 'practice-candidates-v1'
EXAMPLES = (
    ('water-drink', ('water', 'drink')), ('rice-eat', ('rice', 'eat')),
    ('apple-eat', ('apple', 'eat')), ('snack-eat', ('snack', 'eat')),
    ('toilet-go', ('toilet', 'go')), ('me-rest', ('me', 'rest')),
    ('me-water-drink', ('me', 'water', 'drink')),
    ('me-rice-eat', ('me', 'rice', 'eat')),
    ('me-apple-eat', ('me', 'apple', 'eat')),
    ('me-toilet-go', ('me', 'toilet', 'go')),
)


def _threshold(name, default):
    try:
        return min(100, max(1, int(os.environ.get(name, default))))
    except (TypeError, ValueError):
        return default


def _authorized_privacy(user_id):
    state = privacy_for(user_id)
    return state['guardian_consent'] and state['deletion_status'] not in {'in_progress', 'failed', 'completed'}


def personalization_for(user_id):
    try:
        row = database().practice_suggestion_settings.find_one({'_id': user_id})
        return {'enabled': bool(row and row.get('enabled')), 'revision': row.get('revision', 0) if row else 0}
    except PyMongoError as exc:
        raise HTTPException(503, '연습 제안 설정을 불러오지 못했습니다.') from exc


def set_personalization(user_id, enabled, expected_revision):
    if enabled and not _authorized_privacy(user_id):
        raise HTTPException(403, '기록 동의가 유효할 때만 개인화 연습을 켤 수 있습니다.')
    try:
        db = database()
        row = db.practice_suggestion_settings.find_one({'_id': user_id})
        revision = row.get('revision', 0) if row else 0
        if revision != expected_revision:
            raise HTTPException(409, '연습 제안 설정이 변경되었습니다. 다시 확인해 주세요.')
        result = db.practice_suggestion_settings.update_one(
            {'_id': user_id, 'revision': revision} if row else {'_id': user_id},
            {'$set': {'enabled': enabled, 'revision': revision + 1, 'updated_at': datetime.now(timezone.utc)},
             '$setOnInsert': {'schema_version': SCHEMA_VERSION, 'user_id': user_id}}, upsert=not bool(row))
        if not result.matched_count and not result.upserted_id:
            raise HTTPException(409, '연습 제안 설정이 변경되었습니다. 다시 확인해 주세요.')
        return {'enabled': enabled, 'revision': revision + 1}
    except DuplicateKeyError as exc:
        raise HTTPException(409, '연습 제안 설정이 변경되었습니다. 다시 확인해 주세요.') from exc
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '연습 제안 설정을 저장하지 못했습니다.') from exc


def candidates_for(user_id):
    setting = personalization_for(user_id)
    if not _authorized_privacy(user_id):
        return {'status': 'consent_required', 'personalization': setting, 'candidates': []}
    if not setting['enabled']:
        return {'status': 'disabled', 'personalization': setting, 'candidates': []}
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=WINDOW_DAYS)
    try:
        db = database()
        selections = list(db.offline_events.find({'user_id': user_id, 'event_type': 'card_selection',
            'occurred_at': {'$gte': since, '$lte': now}}).sort('occurred_at', -1).limit(MAX_SELECTIONS + 1))
        attempts = list(db.learning_attempts.find({'user_id': user_id, 'record_type': 'learning_attempt',
            'completed_at': {'$gte': since, '$lte': now}}).sort('completed_at', -1).limit(MAX_ATTEMPTS + 1))
    except PyMongoError as exc:
        raise HTTPException(503, '연습 제안 근거를 불러오지 못했습니다.') from exc
    selections = selections[:MAX_SELECTIONS]
    attempts = attempts[:MAX_ATTEMPTS]
    samples = {'window_days': WINDOW_DAYS, 'selection_events': len(selections), 'learning_attempts': len(attempts),
               'selection_limit': MAX_SELECTIONS, 'attempt_limit': MAX_ATTEMPTS,
               'since': since.isoformat(), 'until': now.isoformat()}
    min_selections = _threshold('PRACTICE_MIN_SELECTION_EVENTS', 10)
    min_attempts = _threshold('PRACTICE_MIN_ATTEMPTS', 3)
    thresholds = {'selection_events': min_selections, 'learning_attempts': min_attempts}
    if len(selections) < min_selections and len(attempts) < min_attempts:
        return {'status': 'insufficient', 'personalization': setting, 'samples': samples,
                'thresholds': thresholds, 'candidates': []}
    cards = available_cards(user_id)
    by_id = {card['id']: card for card in cards}
    categories = active_categories()
    settings = settings_for(user_id)
    allowed = set(settings['category_ids']) if settings['category_ids'] else {row['id'] for row in categories}
    counts = Counter(card_id for event in selections for card_id in set(event.get('card_ids') or []) if card_id in by_id)
    activity_counts = Counter(row['activity_type'] for row in attempts)
    category_rows = []
    for category in categories:
        if category['id'] not in allowed:
            continue
        members = [card for card in cards if card.get('category') == category['name']]
        if len(members) >= settings['option_count']:
            member_ids = {card['id'] for card in members}
            category_rows.append((category, members, sum(bool(member_ids.intersection(event.get('card_ids') or []))
                for event in selections)))
    category_rows.sort(key=lambda row: (-row[2], row[0].get('display_order', 0)))
    candidates = []
    for activity, row in zip(('word_picture_match', 'sound_picture_match'), category_rows[:2]):
        category, members, interest = row
        candidates.append({'candidate_id': f'{activity}:{category["id"]}', 'activity_type': activity,
            'category_id': category['id'], 'card_ids': [card['id'] for card in members[:4]],
            'card_labels': [card['label'] for card in members[:4]],
            'settings': {key: settings.get(key, value) for key, value in DEFAULT_SETTINGS.items()},
            'evidence': [{'id': f'selection:{category["id"]}', 'kind': 'interest',
                          'text': f'최근 {WINDOW_DAYS}일 카드 선택 {interest}건에서 본 소재입니다.'},
                         {'id': f'learning:{activity}', 'kind': 'participation',
                          'text': f'이 유형의 완료된 연습 {activity_counts[activity]}회가 있습니다.'}]})
    for example_id, example_cards in EXAMPLES:
        if all(card_id in by_id for card_id in example_cards):
            category_names = {by_id[card_id].get('category') for card_id in example_cards}
            allowed_names = {row['name'] for row in categories if row['id'] in allowed}
            if not category_names.issubset(allowed_names):
                continue
            candidates.append({'candidate_id': f'sentence_card_order:{example_id}',
                'activity_type': 'sentence_card_order', 'category_id': 'all', 'card_ids': list(example_cards),
                'card_labels': [by_id[card_id]['label'] for card_id in example_cards],
                'content_id': example_id,
                'settings': {key: settings.get(key, value) for key, value in DEFAULT_SETTINGS.items()},
                'evidence': [{'id': f'selection:{example_id}', 'kind': 'interest',
                              'text': f'최근 {WINDOW_DAYS}일 이 예문 카드 선택 {sum(counts[card_id] for card_id in example_cards)}회가 있습니다.'},
                             {'id': 'learning:sentence_card_order', 'kind': 'participation',
                              'text': f'문장 순서 연습을 완료한 기록 {activity_counts["sentence_card_order"]}회가 있습니다.'}]})
            break
    return {'status': 'ready' if candidates else 'no_supported_candidates', 'personalization': setting,
            'samples': samples, 'thresholds': thresholds, 'rule_version': RULE_VERSION,
            'candidates': candidates[:3]}


def approve_candidate(user_id, actor_id, candidate_id, request_id, overrides):
    result = candidates_for(user_id)
    candidate = next((row for row in result['candidates'] if row['candidate_id'] == candidate_id), None)
    if not candidate:
        raise HTTPException(409, '현재 제공 가능한 연습 후보가 아닙니다. 목록을 다시 확인해 주세요.')
    candidate = {**candidate, 'settings': {**candidate['settings'], **overrides}}
    now = datetime.now(timezone.utc)
    document = {'_id': request_id, 'schema_version': SCHEMA_VERSION, 'user_id': user_id,
                'actor_id': actor_id, 'candidate': candidate, 'rule_version': RULE_VERSION,
                'created_at': now, 'expires_at': now + timedelta(days=WINDOW_DAYS)}
    try:
        collection = database().practice_suggestion_plans
        existing = collection.find_one({'_id': request_id})
        if existing:
            if existing.get('user_id') != user_id or existing.get('candidate', {}).get('candidate_id') != candidate_id:
                raise HTTPException(409, '이미 사용된 요청 번호입니다.')
            document = existing
        else:
            try:
                collection.insert_one(document)
            except DuplicateKeyError:
                existing = collection.find_one({'_id': request_id})
                if not existing or existing.get('user_id') != user_id or existing.get('candidate', {}).get('candidate_id') != candidate_id:
                    raise HTTPException(409, '이미 사용된 요청 번호입니다.')
                document = existing
        return {'id': str(document['_id']), 'candidate': document['candidate'],
                'created_at': document['created_at'], 'expires_at': document['expires_at']}
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '연습 시작 설정을 저장하지 못했습니다.') from exc


def active_plan(user_id):
    if not _authorized_privacy(user_id) or not personalization_for(user_id)['enabled']:
        return None
    try:
        row = database().practice_suggestion_plans.find_one(
            {'user_id': user_id, 'expires_at': {'$gt': datetime.now(timezone.utc)}},
            sort=[('created_at', -1)])
    except PyMongoError as exc:
        raise HTTPException(503, '연습 시작 설정을 불러오지 못했습니다.') from exc
    if not row:
        return None
    # Recheck current categories, cards and settings before showing an older plan.
    fresh = candidates_for(user_id)
    candidate = next((item for item in fresh.get('candidates', [])
                      if item['candidate_id'] == row['candidate']['candidate_id']), None)
    if not candidate:
        return None
    candidate = {key: value for key, value in candidate.items() if key != 'evidence'}
    candidate = {**candidate, 'settings': {**candidate['settings'], **{
        key: row['candidate']['settings'][key] for key in
        ('question_count', 'option_count', 'repeat_frequency', 'retry_enabled')}}}
    return {'id': str(row['_id']), 'candidate': candidate,
            'created_at': row['created_at'], 'expires_at': row['expires_at']}
