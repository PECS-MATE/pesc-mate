"""Bounded, account-isolated, process-memory-only WAV cache. No database/disk writes."""
from collections import OrderedDict
from threading import Lock
from time import monotonic


class SpeechCache:
    def __init__(self, max_entries=256, max_bytes=64 * 1024 * 1024,
                 ttl=1800, clock=monotonic):
        self.rows = OrderedDict()
        self.lock = Lock()
        self.size = 0
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self.ttl = ttl
        self.clock = clock

    def _remove(self, key):
        _at, data = self.rows.pop(key)
        self.size -= len(data)

    def _expire(self, now):
        for key, (at, _data) in list(self.rows.items()):
            if now - at >= self.ttl:
                self._remove(key)

    def get(self, key):
        with self.lock:
            self._expire(self.clock())
            row = self.rows.get(key)
            if row is None:
                return None
            self.rows.move_to_end(key)
            return row[1]

    def put(self, key, data):
        with self.lock:
            self._expire(self.clock())
            if key in self.rows:
                self._remove(key)
            if not data or len(data) > self.max_bytes:
                return
            self.rows[key] = (self.clock(), data)
            self.size += len(data)
            while self.rows and (len(self.rows) > self.max_entries or self.size > self.max_bytes):
                self._remove(next(iter(self.rows)))
