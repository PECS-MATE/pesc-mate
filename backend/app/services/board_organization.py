"""Read-only, caregiver-reviewed activity board candidates from successful speech."""
from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.board_layout import layout_for, MAX_BOARD_SLOTS
from app.services.database import database
from app.services.support_links import require_link_permission

VERSION = 'board-organization-v1'
MAX_EVENTS = 500
PERIOD_DAYS = 30
MIN_EVENTS = 3
MAX_CANDIDATE_CARDS = 12


def _authorize(user_id, requester):
    if requester.get('role') != 'caregiver':
        raise HTTPException(403, '보호자 계정에서만 카드판 정리 추천을 볼 수 있습니다.')
    require_link_permission(requester, user_id, 'board_manage')
    require_link_permission(requester, user_id, 'records_read')


def _consented(document):
    return bool(document and document.get('guardian_consent')) and document.get('deletion_status') not in {
        'in_progress', 'failed', 'completed',
    }


def _proposal_slots(layout, candidates):
    """Keep existing relative order and the full prefix needed by locked positions."""
    available = [card['id'] for card in layout['available_cards']]
    slots = sorted(layout['slots'], key=lambda slot: slot['position'])
    locked = set(layout.get('locked_card_ids', []))
    if locked - {slot['card_id'] for slot in slots}:
        return None
    last_locked = max((slot['position'] for slot in slots if slot['card_id'] in locked), default=0)
    prefix = [slot['card_id'] for slot in slots if slot['position'] <= last_locked]
    if any(slot['position'] != index + 1 for index, slot in enumerate(slots[:len(prefix)])):
        return None
    order = list(dict.fromkeys([slot['card_id'] for slot in slots] + available))
    ids = prefix + [key for key in order if key in candidates and key not in prefix]
    if len(ids) > MAX_BOARD_SLOTS or not candidates.issubset(ids):
        return None
    return ids


def _candidates(layout, events, settings):
    available = {card['id'] for card in layout['available_cards']}
    available -= set(settings.get('hidden_card_ids', []))
    if settings.get('mode') == 'approval':
        available &= set(settings.get('approved_card_ids', []))
    observed, seen = [], set()
    for row in events:
        key = str(row.get('selection_id') or row['_id'])
        if key in seen:
            continue
        seen.add(key)
        ids = set(row.get('card_ids', [])) & available
        if ids:
            observed.append((ids, row.get('situation', 'unspecified')))
    groups = [
        ('meal', '식사·간식', '식사로 표시했거나 먹다·마시다 카드가 포함된 발화',
         [ids for ids, situation in observed if situation == 'meal' or ids & {'eat', 'drink'}]),
        ('outside', '이동·외출', '외출로 표시했거나 가다 카드가 포함된 발화',
         [ids for ids, situation in observed if situation == 'outside' or 'go' in ids]),
        ('play', '놀이', '놀다 카드가 포함된 발화',
         [ids for ids, _ in observed if 'play' in ids]),
        ('frequent', '자주 쓰는 표현', '같은 선택의 반복 재생을 제외한 성공 발화',
         [ids for ids, _ in observed]),
    ]
    existing = {tuple(slot['card_id'] for slot in item['slots']) for item in layout.get('situations', [])}
    proposals, blocked = [], False
    for key, name, reason, rows in groups:
        counts = Counter(card_id for ids in rows for card_id in ids)
        frequent = sorted((card_id for card_id, count in counts.items() if count >= 2),
                          key=lambda card_id: (-counts[card_id], card_id))[:MAX_CANDIDATE_CARDS]
        if len(rows) < MIN_EVENTS or len(frequent) < 2:
            continue
        ids = _proposal_slots(layout, set(frequent))
        if ids is None or set(ids) - available:
            blocked = True
            continue
        if tuple(ids) in existing:
            continue
        existing.add(tuple(ids))
        proposals.append({
            'id': key, 'name': name, 'card_ids': ids, 'reason': reason,
            'event_count': len(rows),
            'cards': [{'card_id': card_id, 'usage_count': counts[card_id],
                       'included_for_position': card_id not in frequent} for card_id in ids],
        })
    return proposals, len(observed), blocked


def suggestions_for(user_id, requester):
    _authorize(user_id, requester)
    try:
        db = database()
        consent = db.privacy_settings.find_one({'_id': user_id})
        layout = layout_for(user_id)
        result = {'algorithm_version': VERSION, 'user_id': user_id,
                  'layout_revision': layout['revision'], 'period_days': PERIOD_DAYS,
                  'sample_limit': MAX_EVENTS, 'sampled_events': 0, 'truncated': False,
                  'personal_history_used': False, 'candidates': [],
                  'notice': '추천은 보호자가 저장하기 전에는 적용되지 않습니다.'}
        if not _consented(consent):
            result['notice'] = '기록 이용 동의가 없거나 삭제 처리 상태라 사용 기록 기반 추천을 제공하지 않습니다.'
            return result
        settings = db.recommendation_settings.find_one({'_id': user_id}) or {}
        if not settings.get('enabled', True):
            result['notice'] = '추천 기능이 꺼져 있습니다. 보호자 추천 설정을 확인해 주세요.'
            return result
        now = datetime.now(timezone.utc)
        query = {'user_id': user_id, 'occurred_at': {'$gte': now - timedelta(days=PERIOD_DAYS), '$lte': now},
                 'event_type': {'$in': ['speech_result', 'immediate_speech', 'selection_speech']},
                 'speech_status': 'succeeded'}
        events = list(db.offline_events.find(query, {
            '_id': 1, 'selection_id': 1, 'card_ids': 1, 'situation': 1,
        }).sort([('occurred_at', -1), ('_id', 1)]).limit(MAX_EVENTS + 1))
        candidates, observed, blocked = _candidates(layout, events[:MAX_EVENTS], settings)
        # A late withdrawal/revocation must not return a previously built personal feed.
        _authorize(user_id, requester)
        if not _consented(db.privacy_settings.find_one({'_id': user_id})):
            raise HTTPException(409, '기록 이용 상태가 변경되었습니다. 최신 상태를 확인해 주세요.')
        latest_settings = db.recommendation_settings.find_one({'_id': user_id}) or {}
        if (not latest_settings.get('enabled', True)
                or latest_settings.get('revision', 0) != settings.get('revision', 0)):
            raise HTTPException(409, '추천 설정이 변경되었습니다. 후보를 다시 불러와 주세요.')
        result.update(candidates=candidates, sampled_events=observed,
                      personal_history_used=True, truncated=len(events) > MAX_EVENTS,
                      notice='추천은 새 카드판 초안입니다. 보호자가 검토하고 저장하기 전에는 적용되지 않습니다.')
        if not candidates:
            result['notice'] = ('핵심 잠금 위치·추천 정책을 지킨 후보를 만들기 어렵습니다. 기존 구성을 확인해 주세요.'
                                if blocked else '반복 사용 근거가 부족하거나 같은 카드판이 이미 있습니다. 자동 정리하지 않습니다.')
        return result
    except PyMongoError as exc:
        raise HTTPException(503, '카드판 정리 추천을 불러오지 못했습니다. 기존 카드판은 유지됩니다.') from exc
