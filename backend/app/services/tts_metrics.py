"""Aggregate existing client-reported TTS events without exposing individual records."""
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from math import ceil

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.database import database as _database


CONTENT_TYPES = ('card', 'sentence', 'recovery', 'preview')
STATUSES = ('requested', 'succeeded', 'failed', 'cancelled')
TERMINAL_STATUSES = ('succeeded', 'failed', 'cancelled')
STARTUP_LIMITS_MS = (100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000)
ERROR_CODES = (
    'not-allowed', 'start-timeout', 'unsupported', 'volume-zero',
    'language-unavailable', 'voice-unavailable', 'audio-unavailable',
    'speech-unavailable', 'playback-unavailable', 'synthesis-failed',
    'synthesis-unavailable', 'network', 'audio-busy', 'audio-hardware',
    'text-too-long', 'invalid-argument',
)


def _known(field_name, values, fallback):
    return {'$cond': [{'$in': [f'${field_name}', list(values)]}, f'${field_name}', fallback]}


def _pipeline(start, end):
    valid_startup = {'$and': [
        {'$isNumber': '$startup_ms'}, {'$gte': ['$startup_ms', 0]},
        {'$lte': ['$startup_ms', 60000]}, {'$in': ['$status', list(TERMINAL_STATUSES)]},
    ]}
    return [
        {'$match': {'requested_at': {'$gte': start, '$lte': end}}},
        {'$project': {
            '_id': 0,
            'content_type': _known('content_type', CONTENT_TYPES, 'other'),
            'status': _known('status', STATUSES, 'other'),
            'error_code': _known('error_code', ERROR_CODES, 'other'),
            'startup_ms': {'$cond': [valid_startup, {'$toDouble': '$startup_ms'}, None]},
        }},
        {'$group': {
            '_id': {
                'content_type': '$content_type', 'status': '$status', 'error_code': '$error_code',
                'startup_bucket': {'$switch': {
                    'branches': [
                        {'case': {'$eq': ['$startup_ms', None]}, 'then': None},
                        *[{'case': {'$lte': ['$startup_ms', limit]}, 'then': limit}
                          for limit in STARTUP_LIMITS_MS],
                    ], 'default': None,
                }},
            },
            'count': {'$sum': 1},
            'startup_sum': {'$sum': '$startup_ms'},
            'startup_max': {'$max': '$startup_ms'},
        }},
    ]


@dataclass
class TtsStats:
    statuses: dict = field(default_factory=lambda: dict.fromkeys((*STATUSES, 'other'), 0))
    startup_samples: int = 0
    startup_sum: float = 0
    startup_max: float = 0
    histogram: dict = field(default_factory=lambda: dict.fromkeys(STARTUP_LIMITS_MS, 0))

    def add(self, row):
        group = row['_id']
        count = row['count']
        self.statuses[group['status']] += count
        bucket = group['startup_bucket']
        if bucket is not None:
            self.startup_samples += count
            self.startup_sum += row['startup_sum']
            self.startup_max = max(self.startup_max, row['startup_max'])
            self.histogram[bucket] += count

    def public(self):
        requests = sum(self.statuses.values())
        resolved = self.statuses['succeeded'] + self.statuses['failed']
        cumulative = 0
        buckets = []
        for limit, count in self.histogram.items():
            cumulative += count
            buckets.append({'le_ms': limit, 'count': cumulative})

        def percentile(fraction):
            if not self.startup_samples:
                return None
            rank = ceil(self.startup_samples * fraction)
            return next(bucket['le_ms'] for bucket in buckets if bucket['count'] >= rank)

        return {
            'requests': requests, **self.statuses, 'resolved': resolved,
            'success_rate': round(self.statuses['succeeded'] / resolved, 6) if resolved else None,
            'failure_rate': round(self.statuses['failed'] / resolved, 6) if resolved else None,
            'startup_ms': {
                'samples': self.startup_samples,
                'mean': round(self.startup_sum / self.startup_samples, 2) if self.startup_samples else None,
                'max': self.startup_max if self.startup_samples else None,
                'p50_upper_bound': percentile(0.5), 'p95_upper_bound': percentile(0.95),
                'buckets': buckets,
            },
        }


def tts_report(hours=24, now=None):
    if not 1 <= hours <= 168:
        raise HTTPException(422, '조회 기간은 1~168시간으로 선택해 주세요.')
    end = now or datetime.now(timezone.utc)
    start = end - timedelta(hours=hours)
    totals = TtsStats()
    content = {}
    failure_codes = {}
    try:
        rows = _database().tts_events.aggregate(_pipeline(start, end), maxTimeMS=2000)
        for row in rows:
            group = row['_id']
            totals.add(row)
            content.setdefault(group['content_type'], TtsStats()).add(row)
            if group['status'] == 'failed':
                code = group['error_code']
                failure_codes[code] = failure_codes.get(code, 0) + row['count']
    except PyMongoError as exc:
        raise HTTPException(503, '음성 재생 지표를 불러오지 못했습니다.') from exc
    return {
        'scope': 'stored_events', 'source': 'client_reported', 'window_hours': hours,
        'requested_from': start.isoformat(), 'requested_until': end.isoformat(),
        'totals': totals.public(),
        'by_content_type': [{'content_type': kind, **stats.public()} for kind, stats in sorted(content.items())],
        'failure_codes': [{'code': code, 'count': count} for code, count in sorted(failure_codes.items())],
    }
