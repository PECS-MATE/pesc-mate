"""Optional bounded disk cache for built-in, public vocabulary ONLY."""
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import re
from threading import Lock
from time import time
import uuid
import wave

MAX_AUDIO_BYTES = 12 * 1024 * 1024
_NAME = re.compile(r'^[0-9a-f]{64}\.wav$')


def valid_wav(data):
    try:
        if len(data) > MAX_AUDIO_BYTES:
            return False
        with wave.open(BytesIO(data), 'rb') as wav:
            return (wav.getnchannels() == 1 and wav.getsampwidth() == 2
                    and wav.getnframes() > 0
                    and len(wav.readframes(wav.getnframes())) == wav.getnframes() * 2)
    except (ValueError, wave.Error, EOFError):
        return False


class PublicSpeechCache:
    def __init__(self, directory, *, max_bytes=128 * 1024 * 1024, max_entries=512,
                 ttl=7 * 86400, clock=time):
        self.root = Path(directory)
        self.max_bytes, self.max_entries, self.ttl = max_bytes, max_entries, ttl
        self.clock, self.lock = clock, Lock()

    def _path(self, key):
        digest = hashlib.sha256(json.dumps(key, ensure_ascii=False,
                                          separators=(',', ':')).encode()).hexdigest()
        return self.root / (digest + '.wav')

    def _entries(self):
        # Never recurse or touch files outside this cache's hash-named WAVs.
        rows = []
        for path in self.root.iterdir():
            if _NAME.fullmatch(path.name) and not path.is_symlink() and path.is_file():
                stat = path.stat()
                rows.append((stat.st_mtime, stat.st_size, path))
        return sorted(rows)

    def _trim(self):
        rows = self._entries()
        size, count = sum(row[1] for row in rows), len(rows)
        for modified, length, path in rows:
            if (self.clock() - modified >= self.ttl or size > self.max_bytes
                    or count > self.max_entries):
                path.unlink(missing_ok=True)
                size -= length
                count -= 1

    def get(self, key):
        with self.lock:
            try:
                path = self._path(key)
                if path.is_symlink() or not path.is_file():
                    return None
                stat = path.stat()
                if self.clock() - stat.st_mtime >= self.ttl or stat.st_size > MAX_AUDIO_BYTES:
                    path.unlink(missing_ok=True)
                    return None
                data = path.read_bytes()
                if not valid_wav(data):
                    path.unlink(missing_ok=True)
                    return None
                return data
            except OSError:
                return None  # A cache failure must not disable speech.

    def put(self, key, data):
        if not valid_wav(data) or len(data) > self.max_bytes:
            return
        with self.lock:
            temporary = None
            try:
                self.root.mkdir(parents=True, exist_ok=True)
                temporary = self.root / ('.writing-' + uuid.uuid4().hex)
                with temporary.open('xb') as output:
                    output.write(data)
                os.utime(temporary, (self.clock(), self.clock()))
                os.replace(temporary, self._path(key))
                self._trim()
            except OSError:
                pass
            finally:
                if temporary is not None:
                    try:
                        temporary.unlink(missing_ok=True)
                    except OSError:
                        pass
