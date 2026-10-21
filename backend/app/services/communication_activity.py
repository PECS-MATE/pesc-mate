"""Observed AAC interaction events, not learning scores or inferred intent."""
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.database import database

SITUATIONS = {
    'unspecified': '상황 미지정', 'home': '집', 'school': '학교', 'therapy': '치료실',
    'outside': '외출', 'meal': '식사', 'hospital': '병원',
}
ACTIVITY_FIELDS = ('event_type', 'card_ids', 'occurred_at', 'situation', 'stream_id', 'sequence',
                   'selection_id', 'session_id', 'speech_status', 'completed_at', 'recovery_id')
MAX_ACTIVITY_ROWS = 10000


def speech_for_sessions(user_id, session_ids):
    if not session_ids:
        return {}
    try:
        results = defaultdict(list)
        collection = database().offline_events
        for session_id in session_ids[:10]:
            rows = collection.find({'user_id': user_id, 'session_id': session_id,
                                    'event_type': 'speech_result'}).sort('occurred_at', -1).limit(10)
            results[session_id] = [public_event(row) for row in rows]
        return dict(results)
    except PyMongoError as exc:
        raise HTTPException(503, '문장 재생 결과를 조회하지 못했습니다.') from exc


def public_event(document):
    result = {'id': str(document['_id'])}
    for key in ACTIVITY_FIELDS:
        value = document.get(key)
        if isinstance(value, datetime):
            value = value.replace(tzinfo=value.tzinfo or timezone.utc).isoformat()
        result[key] = value
    result['situation'] = result['situation'] or 'unspecified'
    return result


def activity_report(user_id, days=None, now=None):
    reference = now or datetime.now(timezone.utc)
    query = {'user_id': user_id, 'occurred_at': {'$lte': reference}}
    if days is not None:
        query['occurred_at']['$gte'] = reference - timedelta(days=days)
    try:
        rows = [public_event(row) for row in database().offline_events.find(query)
                .sort([('occurred_at', -1), ('sequence', -1), ('_id', 1)]).limit(MAX_ACTIVITY_ROWS + 1)]
    except PyMongoError as exc:
        raise HTTPException(503, '의사소통 활동을 조회하지 못했습니다.') from exc
    if len(rows) > MAX_ACTIVITY_ROWS:
        raise HTTPException(413, '활동 기록이 10,000개를 초과합니다. 조회 기간을 줄여 주세요.')
    totals = defaultdict(Counter)
    daily = defaultdict(Counter)
    for row in rows:
        kind = 'selections' if row['event_type'] == 'card_selection' else 'speech_results' if row['speech_status'] else 'legacy_requests'
        totals[row['situation']][kind] += 1
        daily[(row['occurred_at'][:10], row['situation'])][kind] += 1
        if row['speech_status']:
            totals[row['situation']][row['speech_status']] += 1
    # Only neighbouring events from the same page/device stream within five minutes.
    streams = defaultdict(list)
    for row in reversed(rows):
        if row['stream_id']:
            streams[row['stream_id']].append(row)
    flows = []
    for events in streams.values():
        events.sort(key=lambda row: (row['sequence'] or 0, row['occurred_at'], row['id']))
        for index, row in enumerate(events):
            if row['event_type'] != 'recovery_speech':
                continue
            def neighbour(position):
                if not 0 <= position < len(events):
                    return None
                candidate = events[position]
                elapsed = abs((datetime.fromisoformat(candidate['occurred_at']) - datetime.fromisoformat(row['occurred_at'])).total_seconds())
                return candidate if elapsed <= 300 else None
            flows.append({'recovery': row, 'before': neighbour(index - 1), 'after': neighbour(index + 1)})
    flows.sort(key=lambda flow: flow['recovery']['occurred_at'], reverse=True)
    return {
        'user_id': user_id, 'period_days': days, 'total': len(rows),
        'recent': rows[:100], 'recent_limit': 100,
        'situations': [{'situation': key, 'label': SITUATIONS.get(key, SITUATIONS['unspecified']),
                        **{field: totals[key][field] for field in ('selections', 'speech_results', 'succeeded', 'failed', 'cancelled', 'legacy_requests')}}
                       for key in sorted(totals)],
        'daily': [{'date': date, 'situation': situation, **dict(counts)}
                  for (date, situation), counts in sorted(daily.items(), reverse=True)],
        'recovery_flows': flows[:20],
    }
