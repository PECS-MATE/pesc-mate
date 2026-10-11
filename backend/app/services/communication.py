"""Curated PECS cards, rule-based sentences, and MongoDB history."""
from collections import Counter
from datetime import datetime, timedelta, timezone
import logging
from types import SimpleNamespace

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError, PyMongoError
from app.services.card_metadata import with_inferred_metadata
from app.services.database import database, log_crud
from app.services.model import generate_sentence, status as model_status
from app.services.sentence_policy import policy_versions
from app.services.sentence_validation import validate_safety, validate_semantics

logger = logging.getLogger('uvicorn.error')

CARDS = [with_inferred_metadata(dict(id=key, label=label, symbol=symbol, category=category,
                                      meaning=meaning, part_of_speech=part_of_speech,
                                      sentence_role=sentence_role,
                                      image_index=index if index < 18 else None))
         for index, (key, label, symbol, category, meaning, part_of_speech, sentence_role) in enumerate([
    ('me', '나', '🙋', '사람', '말하는 사용자 자신', 'pronoun', 'subject'),
    ('mom', '엄마', '👩', '사람', '사용자의 어머니', 'noun', 'subject'),
    ('water', '물', '💧', '음식', '마시는 물', 'noun', 'object'),
    ('rice', '밥', '🍚', '음식', '먹는 밥', 'noun', 'object'),
    ('apple', '사과', '🍎', '음식', '과일 사과', 'noun', 'object'),
    ('milk', '우유', '🥛', '음식', '마시는 우유', 'noun', 'object'),
    ('drink', '마시다', '🥤', '행동', '음료를 마시는 행동', 'verb', 'predicate'),
    ('eat', '먹다', '🍽️', '행동', '음식을 먹는 행동', 'verb', 'predicate'),
    ('go', '가다', '🚶', '행동', '장소로 이동하는 행동', 'verb', 'predicate'),
    ('rest', '쉬다', '🛋️', '행동', '휴식을 취하는 행동', 'verb', 'predicate'),
    ('play', '놀다', '🧸', '행동', '놀이를 하는 행동', 'verb', 'predicate'),
    ('help', '도와주세요', '🤝', '행동', '다른 사람에게 도움을 요청함', 'verb', 'predicate'),
    ('toilet', '화장실', '🚻', '장소', '화장실 장소', 'noun', 'destination'),
    ('home', '집', '🏠', '장소', '사용자가 생활하는 집', 'noun', 'destination'),
    ('happy', '좋아요', '😊', '감정', '좋거나 만족스러운 감정', 'adjective', 'predicate'),
    ('hurt', '아파요', '🤕', '감정', '몸이 아픈 상태', 'adjective', 'predicate'),
    ('no', '싫어요', '🙅', '감정', '원하지 않거나 거절하는 표현', 'adjective', 'predicate'),
    ('yes', '네', '👍', '감정', '동의하거나 긍정하는 표현', 'interjection', 'response'),
    ('stop', '그만', '✋', '행동', '현재 행동이나 상황을 중단해 달라는 표현', 'interjection', 'response'),
    ('more', '더', '➕', '행동', '원하는 것을 더 요청하는 표현', 'adverb', 'predicate'),
    ('again', '다시', '🔁', '행동', '같은 행동을 다시 요청하는 표현', 'adverb', 'predicate'),
    ('wait', '기다려 주세요', '⏳', '행동', '잠시 기다려 달라는 요청', 'verb', 'predicate'),
    ('unknown', '모르겠어요', '❓', '감정', '알지 못하거나 선택하기 어려운 상태', 'adjective', 'predicate'),
    ('other', '다른 것', '🔀', '행동', '현재 선택과 다른 대상을 요청하는 표현', 'noun', 'object'),
    ('head', '머리', '🧑', '사람', '머리 신체 부위', 'noun', 'object'),
    ('stomach', '배', '🫃', '사람', '배 신체 부위', 'noun', 'object'),
    ('hand', '손', '✋', '사람', '손 신체 부위', 'noun', 'object'),
    ('leg', '다리', '🦵', '사람', '다리 신체 부위', 'noun', 'object'),
    ('here_hurts', '여기가 아파요', '🩹', '감정', '가리키는 신체 부위가 아픈 상태', 'adjective', 'predicate'),
    ('uncomfortable', '불편해요', '😣', '감정', '몸이나 상황이 편하지 않은 상태', 'adjective', 'predicate'),
    ('scared', '무서워요', '😨', '감정', '두렵거나 무서운 감정', 'adjective', 'predicate'),
    ('noisy', '시끄러워요', '🔊', '감정', '소리가 크거나 시끄러워 힘든 감각 상태', 'adjective', 'predicate'),
    ('snack', '간식', '🍪', '음식', '간단히 먹는 음식', 'noun', 'object'),
])]

SEMANTIC_GROUPS = {
    'happy': 'emotion', 'scared': 'emotion',
    'hurt': 'physical_state', 'here_hurts': 'physical_state', 'uncomfortable': 'physical_state',
    'noisy': 'sensory_state', 'no': 'rejection', 'yes': 'affirmation',
    'head': 'body_part', 'stomach': 'body_part', 'hand': 'body_part', 'leg': 'body_part',
    'stop': 'core', 'more': 'core', 'again': 'core', 'wait': 'core',
    'unknown': 'uncertainty', 'other': 'core',
}
SAFETY_RELEVANT_IDS = {
    'hurt', 'here_hurts', 'uncomfortable', 'scared', 'noisy', 'help', 'toilet', 'no', 'stop',
}
for card in CARDS:
    card['semantic_group'] = SEMANTIC_GROUPS.get(card['id'])
    card['safety_relevant'] = card['id'] in SAFETY_RELEVANT_IDS
INDEX = {card['id']: card for card in CARDS}

PARTICLES = {
    'topic': ('은', '는'),
    'subject': ('이', '가'),
    'object': ('을', '를'),
    'with': ('과', '와'),
}

PREDICATE_PHRASES = {
    'drink': '마시고 싶어요.',
    'eat': '먹고 싶어요.',
    'go': '가고 싶어요.',
    'rest': '쉬고 싶어요.',
    'play': '놀고 싶어요.',
    'help': '도와주세요.',
    'happy': '좋아요.',
    'hurt': '아파요.',
    'no': '싫어요.',
    'yes': '네.',
    'stop': '그만해 주세요.',
    'more': '더 주세요.',
    'again': '다시 해 주세요.',
    'wait': '기다려 주세요.',
    'unknown': '모르겠어요.',
    'other': '다른 것을 원해요.',
    'here_hurts': '여기가 아파요.',
    'uncomfortable': '불편해요.',
    'scared': '무서워요.',
    'noisy': '시끄러워요.',
}

NEGATIVE_ACTIONS = {
    'drink': ('마시거나', '마시는'),
    'eat': ('먹거나', '먹는'),
    'go': ('가거나', '가는'),
    'rest': ('쉬거나', '쉬는'),
    'play': ('놀거나', '노는'),
    'help': ('도움을 요청하거나', '도움을 요청하는'),
}


def _collection():
    return database().communication_sessions


def _public(document):
    result = dict(document)
    result['id'] = str(result.pop('_id'))
    created_at = result.get('created_at')
    if isinstance(created_at, datetime):
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        result['created_at'] = created_at.isoformat()
    return result


def attach_particle(card, kind):
    if kind == 'location':
        return f"{card['label']}에"
    batchim_particle, vowel_particle = PARTICLES[kind]
    return f"{card['label']}{batchim_particle if card['has_batchim'] else vowel_particle}"


def _format_group(cards, final_particle):
    if not cards:
        return ''
    connected = [attach_particle(card, 'with') for card in cards[:-1]]
    return ' '.join(connected + [attach_particle(cards[-1], final_particle)])


def _predicate_phrase(card):
    if card['id'] in PREDICATE_PHRASES:
        return PREDICATE_PHRASES[card['id']]
    label = card['label']
    if card['part_of_speech'] == 'verb' and label.endswith('다'):
        return f'{label[:-1]}고 싶어요.'
    return f"{label}{'' if label.endswith(('.', '!', '?')) else '.'}"


def _negative_sentence(selected):
    if not any(card['id'] == 'no' for card in selected):
        return None
    meaningful = []
    seen = set()
    for card in selected:
        if card['id'] != 'no' and card['id'] not in seen:
            meaningful.append(card)
            seen.add(card['id'])
    if not meaningful:
        return '싫어요.'
    if all(card['id'] in NEGATIVE_ACTIONS for card in meaningful):
        phrases = [NEGATIVE_ACTIONS[card['id']][0] for card in meaningful[:-1]]
        phrases.append(f"{NEGATIVE_ACTIONS[meaningful[-1]['id']][1]} 게 싫어요.")
        return ' '.join(phrases)
    if all(card['sentence_role'] == 'object' for card in meaningful):
        return f"{_format_group(meaningful, 'subject')} 싫어요."
    return None


def sentence(ids, card_index=None):
    cards = card_index or INDEX
    if any(key not in cards for key in ids):
        raise HTTPException(422, '알 수 없는 카드가 포함되어 있습니다.')
    selected = [with_inferred_metadata(cards[key]) for key in ids]
    negative_sentence = _negative_sentence(selected)
    if negative_sentence:
        return negative_sentence
    if selected and selected[-1]['id'] == 'here_hurts':
        body_parts = selected[:-1]
        if body_parts and all(card.get('semantic_group') == 'body_part' for card in body_parts):
            return f"{_format_group(body_parts, 'subject')} 아파요."
    if selected and selected[-1]['sentence_role'] in {'predicate', 'response'}:
        predicate = selected[-1]
        arguments = selected[:-1]
        subjects = [card for card in arguments if card['sentence_role'] == 'subject']
        objects = [card for card in arguments if card['sentence_role'] == 'object']
        destinations = [card for card in arguments if card['sentence_role'] == 'destination']
        parts = []
        if subjects:
            if len(subjects) == 1 and subjects[0]['id'] == 'me':
                parts.append(attach_particle(subjects[0] | {'label': '저', 'has_batchim': False}, 'topic'))
            else:
                parts.append(_format_group(subjects, 'subject'))
        if objects:
            object_particle = 'subject' if predicate['part_of_speech'] == 'adjective' else 'object'
            parts.append(_format_group(objects, object_particle))
        if destinations:
            parts.append(_format_group(destinations, 'location'))
        if len(subjects) + len(objects) + len(destinations) == len(arguments):
            parts.append(_predicate_phrase(predicate))
            return ' '.join(parts)
    return ' · '.join(cards[key]['label'] for key in ids)


def save_session(request, user_id, custom_cards=None, regeneration_of=None, generation_attempt=1):
    card_ids = list(request.cards)
    custom_index = {card['id']: with_inferred_metadata(card) for card in (custom_cards or [])}
    card_index = INDEX | custom_index
    fallback = sentence(card_ids, card_index)
    result, generation_source = generate_sentence([card_index[key]['label'] for key in card_ids], fallback)
    initial_source = generation_source
    validation = validate_semantics([card_index[key] for key in card_ids], result)
    safety = validate_safety(result)
    fallback_reasons = []
    if generation_source == 'ollama' and (not validation['passed'] or not safety['passed']):
        fallback_reasons = validation['missing_card_ids'] + safety['flags']
        logger.warning('MODEL | FALLBACK | 문장 검증 실패 (%s)', ','.join(fallback_reasons))
        result, generation_source = fallback, 'rule'
    fallback_safety = validate_safety(result)
    if not fallback_safety['passed']:
        logger.warning('MODEL | BLOCKED | 안전하지 않은 문장 차단 (%s)', ','.join(fallback_safety['flags']))
        raise HTTPException(422, '안전한 문장을 만들지 못했습니다. 다른 카드를 선택해 주세요.')
    request_id = str(request.request_id)
    try:
        collection = _collection()
        existing = collection.find_one({'_id': request_id, 'user_id': user_id})
        log_crud('READ', 'communication_sessions', '중복 요청 확인')
        if existing:
            if (existing['cards'] != card_ids or
                    existing.get('regeneration_of') != regeneration_of):
                raise HTTPException(409, '같은 요청 번호에 다른 카드가 전달되었습니다.')
            return _public(existing)
        snapshots = {key: {field: card_index[key].get(field) for field in (
            'id', 'label', 'symbol', 'category', 'meaning', 'part_of_speech', 'has_batchim',
            'sentence_role', 'semantic_group', 'safety_relevant')}
                     for key in card_ids if key in custom_index}
        versions = policy_versions()
        generation = {
            'source': generation_source,
            'initial_source': initial_source,
            'model': model_status()['model'] if initial_source == 'ollama' else None,
            'versions': versions,
            'validation': {
                'semantics': validation,
                'initial_safety': safety,
                'final_safety': fallback_safety,
            },
            'fallback': {
                'applied': initial_source != generation_source,
                'reasons': fallback_reasons,
            },
        }
        document = {'_id': request_id, 'user_id': user_id, 'cards': card_ids, 'card_metadata': snapshots,
                    'sentence': result,
                    'generation_source': generation_source, 'generation': generation,
                    'regeneration_of': regeneration_of, 'generation_attempt': generation_attempt,
                    'created_at': datetime.now(timezone.utc)}
        try:
            collection.insert_one(document)
            log_crud('CREATE', 'communication_sessions', '문장 기록 저장')
        except DuplicateKeyError:
            existing = collection.find_one({'_id': request_id, 'user_id': user_id})
            log_crud('READ', 'communication_sessions', '동시 요청 결과 확인')
            if (not existing or existing['cards'] != card_ids or
                    existing.get('regeneration_of') != regeneration_of):
                raise HTTPException(409, '같은 요청 번호에 다른 카드가 전달되었습니다.')
            return _public(existing)
        return _public(document)
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, 'MongoDB에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.') from exc


def regenerate_session(session_id, request_id, user_id, custom_cards=None):
    """Generate a new history row while preserving the original session."""
    session_id = str(session_id)
    request_id = str(request_id)
    try:
        collection = _collection()
        previous = collection.find_one({'_id': session_id, 'user_id': user_id})
        log_crud('READ', 'communication_sessions', '재생성 대상 조회')
        if not previous:
            raise HTTPException(404, '재생성할 문장 기록을 찾을 수 없습니다.')
        root_id = previous.get('regeneration_of') or session_id
        existing = collection.find_one({'_id': request_id, 'user_id': user_id})
        log_crud('READ', 'communication_sessions', '재생성 중복 요청 확인')
        if existing:
            if existing.get('regeneration_of') != root_id or existing.get('cards') != previous['cards']:
                raise HTTPException(409, '같은 요청 번호가 다른 문장 재생성에 사용되었습니다.')
            return _public(existing)
        attempt = collection.count_documents({'user_id': user_id, 'regeneration_of': root_id}) + 2
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, 'MongoDB에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.') from exc
    available_custom_cards = {card['id']: card for card in (custom_cards or [])}
    available_custom_cards.update(previous.get('card_metadata') or {})
    request = SimpleNamespace(cards=previous['cards'], request_id=request_id)
    return save_session(request, user_id, list(available_custom_cards.values()), regeneration_of=root_id,
                        generation_attempt=attempt)


def statistics(user_id, days=None, now=None):
    reference_time = now or datetime.now(timezone.utc)
    query = {'user_id': user_id}
    if days is not None:
        query['created_at'] = {'$gte': reference_time - timedelta(days=days)}
    try:
        rows = [_public(row) for row in _collection().find(query).sort('created_at', -1)]
        period = f'최근 {days}일' if days is not None else '전체 기간'
        log_crud('READ', 'communication_sessions', f'사용자 통계 조회 ({period})')
    except PyMongoError as exc:
        raise HTTPException(503, 'MongoDB에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.') from exc
    counts = Counter(key for row in rows for key in row['cards'])
    card_index = dict(INDEX)
    for row in rows:
        card_index.update(row.get('card_metadata') or {})
    categories = Counter()
    for key, count in counts.items():
        if key in card_index:
            categories[card_index[key]['category']] += count
    today = reference_time.date()
    today_rows = [row for row in rows if datetime.fromisoformat(row['created_at']).date() == today]
    daily_counts = Counter(datetime.fromisoformat(row['created_at']).date().isoformat() for row in rows)
    daily_activity = [
        {'date': (today - timedelta(days=offset)).isoformat(),
         'sessions': daily_counts[(today - timedelta(days=offset)).isoformat()]}
        for offset in range(6, -1, -1)
    ]
    emotion_state_groups = {'emotion', 'physical_state', 'sensory_state'}
    frequent_expression_key = next((key for key, _ in counts.most_common()
                                    if card_index.get(key, {}).get('semantic_group') in emotion_state_groups), None)
    frequent_emotion_state = card_index[frequent_expression_key] if frequent_expression_key else None
    recent_safety_expressions = []
    for key, card in card_index.items():
        if not card.get('safety_relevant'):
            continue
        matching = [row for row in rows if key in row['cards']]
        if matching:
            recent_safety_expressions.append(card | {
                'count': sum(row['cards'].count(key) for row in matching),
                'last_used_at': matching[0]['created_at'],
            })
    recent_safety_expressions.sort(key=lambda item: item['last_used_at'], reverse=True)
    return dict(sessions=len(rows), selections=sum(counts.values()),
                top_cards=[card_index[key] | {'count': count} for key, count in counts.most_common() if key in card_index],
                categories=dict(categories), recent=rows[:10], period_days=days,
                today_sessions=len(today_rows),
                today_selections=sum(len(row['cards']) for row in today_rows),
                frequent_emotion_state=frequent_emotion_state,
                last_activity=rows[0]['created_at'] if rows else None,
                daily_activity=daily_activity,
                recent_safety_expressions=recent_safety_expressions)


def ensure_demo_history(user_id):
    """Create stable sample records only when the demo user has no history."""
    collection = _collection()
    privacy = database().privacy_settings.find_one({'_id': user_id})
    if not privacy or not privacy.get('guardian_consent') or privacy.get('deletion_status') == 'completed':
        return
    if collection.count_documents({'user_id': user_id}, limit=1):
        return
    now = datetime.now(timezone.utc)
    samples = [
        ('10000000-0000-4000-8000-000000000001', ['me', 'water', 'drink'], 1),
        ('10000000-0000-4000-8000-000000000002', ['me', 'rice', 'eat'], 4),
        ('10000000-0000-4000-8000-000000000003', ['toilet', 'go'], 12),
        ('10000000-0000-4000-8000-000000000004', ['help'], 38),
    ]
    for request_id, cards, days_ago in samples:
        collection.update_one(
            {'_id': request_id},
            {'$setOnInsert': {'user_id': user_id, 'cards': cards, 'sentence': sentence(cards),
                              'created_at': now - timedelta(days=days_ago), 'source': 'demo'}},
            upsert=True,
        )
    log_crud('CREATE', 'communication_sessions', '시연용 기록 생성')
