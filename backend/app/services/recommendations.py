"""Optional, explainable candidate cards. Never writes board layouts or learning data."""
from collections import Counter
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.services.communication import CARDS
from app.services.card_submissions import approved_cards_for
from app.services.database import database
from app.services.schema_versions import SCHEMA_VERSION

VERSION = 'aac-candidates-v1'
DEFAULTS = {'enabled': True, 'mode': 'automatic', 'approved_card_ids': [], 'hidden_card_ids': [],
            'situation': 'unspecified', 'use_time_of_day': True}
SITUATIONS = {'unspecified', 'home', 'school', 'therapy', 'outside', 'meal', 'hospital'}
MAX_HISTORY = 200
MAX_ACTIVITY = 500


def available_cards(user_id):
    return CARDS + approved_cards_for(user_id)


def _utc(value):
    return value.replace(tzinfo=value.tzinfo or timezone.utc) if isinstance(value, datetime) else value


def _public(document, user_id):
    return {'user_id': user_id, **{key: (document or {}).get(key, value) for key, value in DEFAULTS.items()},
            'revision': (document or {}).get('revision', 0),
            'updated_by': (document or {}).get('updated_by'), 'updated_at': _utc((document or {}).get('updated_at'))}


def settings_for(user_id):
    try:
        return _public(database().recommendation_settings.find_one({'_id': user_id}), user_id)
    except PyMongoError as exc:
        raise HTTPException(503, '추천 설정을 조회하지 못했습니다.') from exc


def save_settings(user_id, actor_id, values, expected_revision):
    try:
        db = database()
        before = db.recommendation_settings.find_one({'_id': user_id})
        current = _public(before, user_id)
        if current['revision'] != expected_revision:
            raise HTTPException(409, '다른 기기에서 추천 설정을 변경했습니다. 초안을 유지하고 최신 설정을 다시 확인해 주세요.')
        allowed = {card['id'] for card in available_cards(user_id)} | set(current['hidden_card_ids']) | set(current['approved_card_ids'])
        for key in ('approved_card_ids', 'hidden_card_ids'):
            if len(values[key]) != len(set(values[key])) or set(values[key]) - allowed:
                raise HTTPException(422, '중복되거나 사용할 수 없는 카드가 포함되어 있습니다.')
        if set(values['approved_card_ids']) & set(values['hidden_card_ids']):
            raise HTTPException(422, '같은 카드를 추천 승인과 숨김에 함께 지정할 수 없습니다.')
        now = datetime.now(timezone.utc)
        changes = {**values, 'user_id': user_id, 'updated_by': actor_id, 'updated_at': now, 'revision': expected_revision + 1}
        if before is None:
            db.recommendation_settings.insert_one({'schema_version': SCHEMA_VERSION, '_id': user_id, 'created_at': now, **changes})
        else:
            query = {'_id': user_id, 'revision': expected_revision}
            if expected_revision == 0:
                query = {'_id': user_id, '$or': [{'revision': 0}, {'revision': {'$exists': False}}]}
            if db.recommendation_settings.update_one(query, {'$set': changes}).matched_count != 1:
                raise HTTPException(409, '다른 기기에서 추천 설정을 변경했습니다. 최신 설정을 다시 확인해 주세요.')
        db.board_audit_logs.insert_one({'schema_version': SCHEMA_VERSION, '_id': str(uuid4()),
            'target_user_id': user_id, 'actor_id': actor_id, 'action': 'recommendation_settings_changed',
            'before': {key: current[key] for key in DEFAULTS}, 'after': values,
            'before_revision': expected_revision, 'after_revision': expected_revision + 1, 'created_at': now})
        return _public(changes, user_id)
    except DuplicateKeyError as exc:
        raise HTTPException(409, '다른 기기에서 추천 설정을 먼저 저장했습니다. 최신 설정을 다시 확인해 주세요.') from exc
    except PyMongoError as exc:
        raise HTTPException(503, '추천 설정을 저장하지 못했습니다. 최신 상태를 다시 확인해 주세요.') from exc


def rank_cards(cards, sessions, activities, batches, settings, selected_ids, hour, offset, now):
    """Integer, capped evidence scores; a fixed order resolves ties reproducibly."""
    selected = set(selected_ids)
    hidden = set(settings['hidden_card_ids'])
    approved = set(settings['approved_card_ids'])
    candidates = [card for card in cards if card['id'] not in hidden | selected
                  and (settings['mode'] != 'approval' or card['id'] in approved)] if settings['enabled'] else []
    frequency, together, same_time, contextual, shown = (Counter() for _ in range(5))
    last = {}
    for row in sessions:
        if row.get('regeneration_of'):
            continue
        ids = set(row['cards'])
        created = _utc(row['created_at'])
        frequency.update(ids)
        for key in ids:
            last[key] = max(last.get(key, created), created)
        if selected & ids:
            together.update(ids - selected)
        local = created - timedelta(minutes=offset)
        if settings['use_time_of_day'] and local.hour // 6 == hour // 6:
            same_time.update(ids)
    if settings['situation'] != 'unspecified':
        for event in activities:
            if event.get('situation') == settings['situation']:
                contextual.update(set(event.get('card_ids', [])))
    for batch in batches:
        shown.update(batch.get('exposed_card_ids', []))
    repeated = set.intersection(*(set(batch.get('exposed_card_ids', [])) for batch in batches[:3])) if len(batches) >= 3 else set()
    scored = []
    for index, card in enumerate(candidates):
        key = card['id']
        age = (now - last[key]).total_seconds() / 86400 if key in last else None
        evidence = {'frequency': min(frequency[key], 10) * 2,
                    'recency': 12 if age is not None and age <= 1 else 8 if age is not None and age <= 7 else 3 if age is not None and age <= 30 else 0,
                    'combination': min(together[key], 5) * 4, 'time_of_day': min(same_time[key], 5) * 2,
                    'situation': min(contextual[key], 5) * 3,
                    'repetition_penalty': -min(shown[key], 10) * 2}
        reasons = [label for name, label in (('combination', '선택한 카드와 함께 저장한 기록'),
                   ('situation', '보호자가 지정한 상황의 사용 기록'), ('recency', '최근 저장한 문장에 포함'),
                   ('frequency', '저장한 문장에 자주 포함'), ('time_of_day', '비슷한 시간대의 저장 기록')) if evidence[name] > 0]
        scored.append({'card': card, 'score': sum(evidence.values()), 'evidence': evidence,
                       'reason': ' · '.join(reasons[:2]) if reasons else '다른 표현도 살펴보기', 'index': index})
    scored.sort(key=lambda item: (-item['score'], item['index']))
    # Give an over-exposed card one refresh off only when alternatives exist within guardian policy.
    rested = [item for item in scored if item['card']['id'] not in repeated]
    pool = rested if rested else scored
    chosen, categories = [], Counter()
    for item in pool:
        category = item['card']['category']
        if categories[category] < 2:
            chosen.append(item)
            categories[category] += 1
        if len(chosen) == 6:
            break
    result = [{**item['card'], 'reason': item['reason'], 'algorithm_version': VERSION,
               'evidence': item['evidence']} for item in chosen]
    return result, {'category_counts': dict(categories), 'repeated_card_ids': sorted(repeated),
                    'eligible_cards': len(candidates), 'category_limit': 2, 'history_limit': MAX_HISTORY,
                    'activity_limit': MAX_ACTIVITY, 'exposure_window': 20,
                    'notice': '기록 기반 후보이며 의도·필요·능력을 판단하지 않습니다.'}


def _build(user_id, selected_ids, hour, offset, now):
    db = database()
    settings = settings_for(user_id)
    consent = db.privacy_settings.find_one({'_id': user_id}) or {}
    use_records = bool(consent.get('guardian_consent')) and consent.get('deletion_status') not in {'in_progress', 'failed', 'completed'}
    sessions, activities, batches = [], [], []
    if use_records and settings['enabled']:
        time_query = {'$gte': now - timedelta(days=90), '$lte': now}
        sessions = list(db.communication_sessions.find({'user_id': user_id, 'created_at': time_query})
                        .sort([('created_at', -1), ('_id', 1)]).limit(MAX_HISTORY))
        if settings['situation'] != 'unspecified':
            activities = list(db.offline_events.find({'user_id': user_id, 'situation': settings['situation'],
                'event_type': 'card_selection', 'occurred_at': time_query}).sort('occurred_at', -1).limit(MAX_ACTIVITY))
        batches = list(db.recommendation_batches.find({'user_id': user_id, 'exposed_card_ids': {'$ne': []},
            'created_at': time_query}).sort([('created_at', -1), ('_id', 1)]).limit(20))
    cards, diagnostics = rank_cards(available_cards(user_id), sessions, activities, batches,
                                    settings, selected_ids, hour, offset, now)
    diagnostics.update(sampled_sessions=len(sessions), sampled_activities=len(activities),
                       sampled_exposures=len(batches), history_days=90, personal_history_used=use_records)
    return {'algorithm_version': VERSION, 'cards': cards, 'diagnostics': diagnostics,
            'enabled': settings['enabled'], 'settings_revision': settings['revision'],
            'mode': settings['mode'], 'situation': settings['situation']}, use_records


def preview(user_id):
    try:
        return _build(user_id, [], 0, 0, datetime.now(timezone.utc))[0]['cards']
    except PyMongoError as exc:
        raise HTTPException(503, '추천을 조회하지 못했습니다. 전체 카드에서 계속 선택해 주세요.') from exc


def create_feed(user_id, request_id, selected_ids, hour, offset, _retried=False):
    try:
        db = database()
        allowed = {card['id'] for card in available_cards(user_id)}
        if set(selected_ids) - allowed:
            raise HTTPException(422, '사용할 수 없는 선택 카드가 포함되어 있습니다.')
        existing = db.recommendation_batches.find_one({'_id': request_id})
        consent = db.privacy_settings.find_one({'_id': user_id}) or {}
        if not consent.get('guardian_consent') or consent.get('deletion_status') in {'in_progress', 'failed', 'completed'}:
            existing = None
        context = {'selected_card_ids': selected_ids, 'hour': hour, 'utc_offset_minutes': offset}
        if existing:
            if existing['user_id'] != user_id or existing['context'] != context:
                raise HTTPException(409, '이미 사용된 추천 요청 번호입니다.')
            # Never replay an old approval/hide decision after guardian settings changed.
            if existing['settings_revision'] != settings_for(user_id)['revision']:
                raise HTTPException(409, '추천 설정이 변경되었습니다. 후보를 다시 불러와 주세요.')
            if {card['id'] for card in existing['response']['cards']} - allowed:
                raise HTTPException(409, '사용 가능한 카드가 변경되었습니다. 후보를 다시 불러와 주세요.')
            return existing['response']
        now = datetime.now(timezone.utc)
        response, consent = _build(user_id, selected_ids, hour, offset, now)
        response['batch_id'] = request_id if consent and response['cards'] else None
        if response['batch_id']:
            db.recommendation_batches.insert_one({'schema_version': SCHEMA_VERSION, '_id': request_id,
                'user_id': user_id, 'created_at': now, 'context': context,
                'algorithm_version': VERSION, 'settings_revision': response['settings_revision'],
                'exposed_card_ids': [], 'selected_card_ids': [], 'response': response})
        return response
    except DuplicateKeyError:
        if _retried:
            raise HTTPException(409, '추천 요청이 충돌했습니다. 새 요청으로 다시 불러와 주세요.') from None
        return create_feed(user_id, request_id, selected_ids, hour, offset, _retried=True)
    except PyMongoError as exc:
        raise HTTPException(503, '추천을 불러오지 못했습니다. 전체 카드에서 계속 선택해 주세요.') from exc


def record_interaction(user_id, batch_id, card_ids, selected=False):
    try:
        db = database()
        batch = db.recommendation_batches.find_one({'_id': batch_id, 'user_id': user_id})
        if not batch:
            raise HTTPException(404, '추천 표시 기록을 찾을 수 없습니다.')
        settings = settings_for(user_id)
        if not settings['enabled'] or settings['revision'] != batch['settings_revision']:
            raise HTTPException(409, '추천 설정이 변경되었습니다. 후보를 다시 불러와 주세요.')
        offered = {card['id'] for card in batch['response']['cards']}
        if set(card_ids) - offered or (selected and set(card_ids) - set(batch['exposed_card_ids'])):
            raise HTTPException(422, '실제로 표시한 추천 카드만 기록할 수 있습니다.')
        field = 'selected_card_ids' if selected else 'exposed_card_ids'
        db.recommendation_batches.update_one({'_id': batch_id, 'user_id': user_id},
            {'$addToSet': {field: {'$each': card_ids}}})
        return {'recorded': True}
    except PyMongoError as exc:
        raise HTTPException(503, '추천 표시·선택 여부를 기록하지 못했습니다.') from exc


def monitoring_for(user_id):
    try:
        rows = list(database().recommendation_batches.find({'user_id': user_id,
            'created_at': {'$gte': datetime.now(timezone.utc) - timedelta(days=90)},
            'exposed_card_ids': {'$ne': []}}).sort([('created_at', -1), ('_id', 1)]).limit(50))
        exposed, selected, categories = Counter(), Counter(), Counter()
        for row in rows:
            by_id = {card['id']: card for card in row['response']['cards']}
            for key in row['exposed_card_ids']:
                exposed[key] += 1
                categories[by_id[key]['category']] += 1
            selected.update(row['selected_card_ids'])
        repeated = set.intersection(*(set(row['exposed_card_ids']) for row in rows[:3])) if len(rows) >= 3 else set()
        return {'sampled_batches': len(rows), 'window_days': 90, 'limit': 50,
                'algorithm_versions': sorted({row['algorithm_version'] for row in rows}),
                'categories': dict(categories), 'repeated_card_ids': sorted(repeated),
                'cards': [{'id': key, 'exposed_batches': count, 'selected_batches': selected[key]}
                          for key, count in sorted(exposed.items())],
                'notice': '노출·선택 기록만의 표본입니다. 미선택은 거절이나 지원 불필요를 뜻하지 않습니다.'}
    except PyMongoError as exc:
        raise HTTPException(503, '추천 반복 노출 점검을 조회하지 못했습니다.') from exc
