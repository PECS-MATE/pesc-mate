"""Bounded process-local synchronization counters without record identifiers."""
from contextlib import contextmanager
from dataclasses import dataclass
import logging
from threading import Lock
from time import monotonic

from fastapi import HTTPException


WINDOW_BUCKETS = 15
BUCKET_SECONDS = 60
KINDS = ('communication', 'learning')
COUNTERS = ('operations', 'failed_operations', 'received', 'retried', 'inserted',
            'duplicates', 'failed', 'unprocessed')
ERRORS = ('conflict', 'database', 'validation', 'internal')
logger = logging.getLogger('uvicorn.error')


@dataclass
class SyncObservation:
    received: int
    retried: int
    inserted: int = 0
    duplicates: int = 0

    def accepted(self, inserted):
        if inserted:
            self.inserted += 1
        else:
            self.duplicates += 1


class OfflineSyncMetrics:
    def __init__(self, clock=monotonic):
        self._clock = clock
        self._buckets = {}
        self._lock = Lock()

    def _expire(self, tick):
        for expired in [key for key in self._buckets if key < tick - WINDOW_BUCKETS + 1]:
            del self._buckets[expired]

    @contextmanager
    def measure(self, kind, received, retried=0):
        observation = SyncObservation(received, retried)
        error = None
        try:
            yield observation
        except Exception as exc:
            status = exc.status_code if isinstance(exc, HTTPException) else 500
            error = {409: 'conflict', 422: 'validation', 503: 'database'}.get(status, 'internal')
            raise
        finally:
            try:
                self.record(kind, observation, error)
            except Exception:
                # A telemetry failure must not turn a saved result into a retry.
                logger.warning('Offline sync metrics collection failed')

    def record(self, kind, observation, error=None):
        if kind not in KINDS or (error is not None and error not in ERRORS):
            raise ValueError('Unknown synchronization metric dimension')
        remaining = observation.received - observation.inserted - observation.duplicates
        failed = int(error is not None and remaining > 0)
        values = {
            'operations': 1, 'failed_operations': int(error is not None),
            'received': observation.received, 'retried': observation.retried,
            'inserted': observation.inserted, 'duplicates': observation.duplicates,
            'failed': failed, 'unprocessed': remaining - failed,
        }
        with self._lock:
            tick = int(self._clock() // BUCKET_SECONDS)
            self._expire(tick)
            bucket = self._buckets.setdefault(tick, {})
            stats = bucket.setdefault(kind, dict.fromkeys((*COUNTERS, *ERRORS), 0))
            for key, value in values.items():
                stats[key] += value
            if error:
                stats[error] += 1

    def snapshot(self):
        with self._lock:
            self._expire(int(self._clock() // BUCKET_SECONDS))
            kinds = {kind: dict.fromkeys((*COUNTERS, *ERRORS), 0) for kind in KINDS}
            for bucket in self._buckets.values():
                for kind, stats in bucket.items():
                    for key, value in stats.items():
                        kinds[kind][key] += value

        def public(stats):
            return {**{key: stats[key] for key in COUNTERS},
                    'errors': {key: stats[key] for key in ERRORS},
                    'operation_failure_rate': round(stats['failed_operations'] / stats['operations'], 6)
                    if stats['operations'] else None}

        totals = {key: sum(stats[key] for stats in kinds.values()) for key in (*COUNTERS, *ERRORS)}
        return {
            'scope': 'process', 'source': 'server_observed', 'retry_source': 'client_marked',
            'reset_on_restart': True,
            'window_seconds': WINDOW_BUCKETS * BUCKET_SECONDS, 'bucket_seconds': BUCKET_SECONDS,
            'totals': public(totals),
            'by_kind': [{'kind': kind, **public(stats)} for kind, stats in kinds.items()],
        }
