"""Bounded, process-local HTTP metrics containing only route templates."""
from dataclasses import dataclass, field
from math import ceil, isfinite
from threading import Lock
from time import monotonic


BUCKET_SECONDS = 60
WINDOW_BUCKETS = 15
MAX_SERIES = 128
DURATION_LIMITS_MS = (10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000)
METHODS = frozenset({'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT'})


@dataclass
class RequestStats:
    requests: int = 0
    client_errors: int = 0
    server_errors: int = 0
    transfer_errors: int = 0
    duration_sum: float = 0.0
    duration_max: float = 0.0
    durations: list[int] = field(default_factory=lambda: [0] * (len(DURATION_LIMITS_MS) + 1))

    def observe(self, status, duration_ms, failed):
        self.requests += 1
        self.client_errors += 400 <= status < 500
        self.server_errors += status >= 500
        # Headers can already be 2xx when a streaming response fails.
        self.transfer_errors += bool(failed and status < 400)
        self.duration_sum += duration_ms
        self.duration_max = max(self.duration_max, duration_ms)
        index = next((index for index, limit in enumerate(DURATION_LIMITS_MS)
                      if duration_ms <= limit), len(DURATION_LIMITS_MS))
        self.durations[index] += 1

    def merge(self, other):
        self.requests += other.requests
        self.client_errors += other.client_errors
        self.server_errors += other.server_errors
        self.transfer_errors += other.transfer_errors
        self.duration_sum += other.duration_sum
        self.duration_max = max(self.duration_max, other.duration_max)
        self.durations = [left + right for left, right in zip(self.durations, other.durations)]

    def public(self):
        cumulative = 0
        histogram = []
        for limit, count in zip((*DURATION_LIMITS_MS, None), self.durations):
            cumulative += count
            histogram.append({'le_ms': limit, 'count': cumulative})

        def percentile_bound(fraction):
            if not self.requests:
                return None
            rank = ceil(self.requests * fraction)
            return next(bucket['le_ms'] for bucket in histogram if bucket['count'] >= rank)

        errors = self.client_errors + self.server_errors + self.transfer_errors
        return {
            'requests': self.requests,
            'client_errors': self.client_errors, 'server_errors': self.server_errors,
            'transfer_errors': self.transfer_errors, 'errors': errors,
            'error_rate': round(errors / self.requests, 6) if self.requests else 0.0,
            'server_error_rate': round((self.server_errors + self.transfer_errors) / self.requests, 6)
            if self.requests else 0.0,
            'duration_ms': {
                'sum': round(self.duration_sum, 2),
                'mean': round(self.duration_sum / self.requests, 2) if self.requests else None,
                'max': round(self.duration_max, 2) if self.requests else None,
                'p50_upper_bound': percentile_bound(0.5),
                'p95_upper_bound': percentile_bound(0.95),
                'buckets': histogram,
            },
        }


class ApiMetrics:
    """One-minute buckets; no individual samples or user identifiers are retained."""

    def __init__(self, clock=monotonic, max_series=MAX_SERIES):
        self._clock = clock
        self._started_at = clock()
        self._max_series = max_series
        self._series = set()
        self._buckets = {}
        self._lock = Lock()

    def _expire(self, tick):
        oldest = tick - WINDOW_BUCKETS + 1
        for expired in [value for value in self._buckets if value < oldest]:
            del self._buckets[expired]

    def record(self, method, route, status, duration_ms, failed=False):
        method = method if method in METHODS else 'UNKNOWN'
        route = route if isinstance(route, str) and len(route) <= 200 else 'other'
        duration_ms = duration_ms if isfinite(duration_ms) and duration_ms >= 0 else 0.0
        with self._lock:
            tick = int(self._clock() // BUCKET_SECONDS)
            self._expire(tick)
            key = (method, route)
            if key not in self._series:
                if len(self._series) >= self._max_series:
                    key = ('OTHER', 'other')
                else:
                    self._series.add(key)
            bucket = self._buckets.setdefault(tick, {})
            bucket.setdefault(key, RequestStats()).observe(status, duration_ms, failed)

    def snapshot(self):
        with self._lock:
            now = self._clock()
            self._expire(int(now // BUCKET_SECONDS))
            routes = {}
            totals = RequestStats()
            for bucket in self._buckets.values():
                for key, stats in bucket.items():
                    routes.setdefault(key, RequestStats()).merge(stats)
                    totals.merge(stats)
            return {
                'scope': 'process', 'reset_on_restart': True,
                'window_seconds': BUCKET_SECONDS * WINDOW_BUCKETS,
                'bucket_seconds': BUCKET_SECONDS,
                'uptime_seconds': round(max(0.0, now - self._started_at), 2),
                'totals': totals.public(),
                'routes': [{'method': method, 'route': route, **stats.public()}
                           for (method, route), stats in sorted(routes.items())],
            }
