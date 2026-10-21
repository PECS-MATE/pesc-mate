"""Bounded, explicitly scoped downloads; never combine learning and communication."""
import csv
import io
import json
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.communication import session_cards
from app.services.communication_activity import ACTIVITY_FIELDS, public_event
from app.services.database import database

MAX_EXPORT_ROWS = 10000
COMMUNICATION_FIELDS = (
    'id', 'saved_at', 'cards', 'card_labels', 'sentence', 'generation_source',
    'generation_attempt', 'regeneration_of', 'card_selected_at', 'speech_status',
)
LEARNING_FIELDS = (
    'id', 'completed_at', 'activity_type', 'category_id', 'total_questions',
    'correct_answers', 'duration_seconds', 'items',
)


def _timestamp(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=value.tzinfo or timezone.utc).isoformat()
    return value


def export_records(user_id, domain, days=None, now=None):
    reference = now or datetime.now(timezone.utc)
    if domain not in {'communication', 'learning', 'activity'}:
        raise ValueError('Unknown record domain')
    timestamp = {'communication': 'created_at', 'learning': 'completed_at', 'activity': 'occurred_at'}[domain]
    query = {'user_id': user_id, timestamp: {'$lte': reference}}
    if days is not None:
        query[timestamp]['$gte'] = reference - timedelta(days=days)
    if domain == 'learning':
        query['record_type'] = 'learning_attempt'
    try:
        collection = getattr(database(), {'communication': 'communication_sessions', 'learning': 'learning_attempts',
                                           'activity': 'offline_events'}[domain])
        # Read at most one sentinel beyond the limit. Never silently export only the recent UI rows.
        documents = list(collection.find(query).sort([(timestamp, -1), ('_id', 1)]).limit(MAX_EXPORT_ROWS + 1))
    except PyMongoError as exc:
        raise HTTPException(503, '기록을 내보내지 못했습니다. 잠시 후 다시 시도해 주세요.') from exc
    if len(documents) > MAX_EXPORT_ROWS:
        raise HTTPException(413, '내보낼 기록이 10,000개를 초과합니다. 조회 기간을 줄여 주세요.')
    rows = []
    for document in documents:
        if domain == 'communication':
            row = {key: document.get(key) for key in (
                'sentence', 'generation_source', 'regeneration_of',
            )}
            row.update(id=str(document['_id']), saved_at=_timestamp(document['created_at']),
                       cards=document['cards'], card_labels=[card['label'] for card in session_cards(document)],
                       generation_attempt=document.get('generation_attempt', 1),
                       card_selected_at=[_timestamp(value) for value in document['card_selected_at']]
                       if document.get('card_selected_at') is not None else None, speech_status='unknown')
        elif domain == 'learning':
            row = {key: document.get(key) for key in LEARNING_FIELDS if key not in {'id', 'items', 'completed_at'}}
            # Do not export unrecognised stored fields or another feature's private notes.
            row.update(id=str(document['_id']), completed_at=_timestamp(document['completed_at']),
                       items=[{key: item.get(key) for key in ('card_id', 'label', 'first_try_correct')}
                              for item in document.get('items', [])])
        else:
            row = public_event(document)
        rows.append(row)
    return {
        'export_version': 1, 'domain': domain, 'user_id': user_id,
        'period_days': days, 'from_inclusive': _timestamp(reference - timedelta(days=days)) if days else None,
        'to_inclusive': _timestamp(reference), 'count': len(rows),
        'scope_note': '저장한 문장 기준. 카드 선택 시각과 실제 발화 여부는 확인되지 않습니다.'
        if domain == 'communication' else '완료한 연습 기준. 의사소통 능력의 평가나 진단이 아닙니다.'
        if domain == 'learning' else '기기에서 기록한 선택·재생 결과. 상황은 직접 선택한 값이며 실제 청취나 의도를 추정하지 않습니다.',
        'records': rows,
    }


def _csv_cell(value):
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False)
    text = '' if value is None else str(value)
    # Quoting alone does not stop spreadsheet formula execution, including leading whitespace.
    if text.lstrip().startswith(('=', '+', '-', '@')) or text.startswith(('\t', '\r', '\n')):
        text = "'" + text
    return text


def records_csv(exported):
    stream = io.StringIO(newline='')
    writer = csv.writer(stream)
    fields = {'communication': COMMUNICATION_FIELDS, 'learning': LEARNING_FIELDS,
              'activity': ('id', *ACTIVITY_FIELDS)}[exported['domain']]
    writer.writerow(fields)
    writer.writerows([_csv_cell(row.get(key)) for key in fields] for row in exported['records'])
    # UTF-8 BOM keeps Korean labels readable when opened directly in Excel.
    return '\ufeff' + stream.getvalue()
