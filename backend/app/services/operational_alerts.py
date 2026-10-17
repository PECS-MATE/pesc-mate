"""On-demand operator alerts built from aggregate evidence, never personal rows."""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.database import database as _database
from app.services.tts_metrics import tts_report


REPEATED_FAILURES = 3
REVIEW_WAIT_HOURS = 24


def review_queue():
    try:
        rows = list(_database().card_submissions.aggregate([
            {'$match': {'visibility': 'shared', 'status': 'pending'}},
            {'$group': {'_id': None, 'pending': {'$sum': 1}, 'oldest': {'$min': {
                '$cond': [{'$eq': [{'$type': '$created_at'}, 'date']}, '$created_at', None],
            }}}},
        ], maxTimeMS=2000))
        count = rows[0]['pending'] if rows else 0
        oldest = rows[0].get('oldest') if rows else None
        if oldest is not None and oldest.tzinfo is None:
            oldest = oldest.replace(tzinfo=timezone.utc)
        return {'status': 'ok', 'pending': count, 'oldest_at': oldest.isoformat() if oldest else None}
    except PyMongoError as exc:
        raise HTTPException(503, '공용 카드 대기 상태를 확인하지 못했습니다.') from exc


def operational_report(api_metrics, sync_metrics, now=None):
    now = now or datetime.now(timezone.utc)
    sources = {}
    alerts = []

    def add(code, title, message, count=None, severity='warning', action='investigate'):
        alerts.append({'code': code, 'severity': severity, 'title': title,
                       'message': message, 'count': count, 'action': action})

    def unavailable(source, title):
        sources[source] = {'status': 'unavailable'}
        add(f'{source}_unavailable', title, '현재 상태를 확인하지 못했습니다. 정상으로 판정하지 않고 다시 확인해 주세요.')

    try:
        queue = review_queue()
        sources['review_queue'] = queue
        if queue['pending']:
            oldest = datetime.fromisoformat(queue['oldest_at']) if queue['oldest_at'] else None
            stale = oldest is not None and oldest <= now - timedelta(hours=REVIEW_WAIT_HOURS)
            add('review_pending', '공용 카드 검수 대기',
                '24시간 이상 기다린 공개 요청이 있습니다.' if stale else '공개 요청을 검토해 주세요.',
                queue['pending'], 'warning' if stale else 'info', 'review')
    except HTTPException:
        unavailable('review_queue', '공용 카드 대기 상태 확인 필요')

    try:
        snapshot = api_metrics.snapshot()
        totals = snapshot['totals']
        failures = totals['server_errors'] + totals['transfer_errors']
        sources['api'] = {'status': 'ok', 'scope': 'process', 'window_seconds': snapshot['window_seconds'],
                          'failures': failures, 'requests': totals['requests']}
        if failures >= REPEATED_FAILURES:
            add('api_repeated_failure', 'API 반복 실패',
                '최근 프로세스 집계에서 서버·응답 전송 오류가 반복됐습니다. 요청 ID 로그를 확인해 주세요.', failures)
    except Exception:
        unavailable('api', 'API 지표 확인 필요')

    try:
        report = tts_report(hours=1, now=now)
        totals = report['totals']
        sources['tts'] = {'status': 'ok', 'scope': 'stored_events', 'window_seconds': 3600,
                          'failures': totals['failed'], 'resolved': totals['resolved']}
        if totals['failed'] >= REPEATED_FAILURES:
            add('tts_repeated_failure', '음성 재생 반복 실패',
                '최근 1시간에 요청한 음성 중 최종 실패 보고가 반복됐습니다. 기기 음성과 대체 재생을 점검해 주세요.', totals['failed'])
    except HTTPException:
        unavailable('tts', '음성 재생 지표 확인 필요')

    try:
        snapshot = sync_metrics.snapshot()
        totals = snapshot['totals']
        sources['offline_sync'] = {'status': 'ok', 'scope': 'process', 'window_seconds': snapshot['window_seconds'],
                                   'failures': totals['failed_operations'], 'operations': totals['operations']}
        if totals['failed_operations'] >= REPEATED_FAILURES:
            add('offline_sync_repeated_failure', '오프라인 동기화 반복 실패',
                '최근 프로세스 집계에서 동기화 요청 실패가 반복됐습니다. 남은 기록과 동기화 지표를 확인해 주세요.', totals['failed_operations'])
    except Exception:
        unavailable('offline_sync', '동기화 지표 확인 필요')

    return {
        'generated_at': now.isoformat(),
        'status': 'partial' if any(value['status'] != 'ok' for value in sources.values()) else 'ok',
        'thresholds': {'repeated_failures': REPEATED_FAILURES, 'review_wait_hours': REVIEW_WAIT_HOURS},
        'sources': sources, 'alerts': alerts,
    }
