"""Bounded proxy to private local speech workers; no text persistence."""
from io import BytesIO
from http.client import HTTPException as HTTPClientError
import json
import os
from threading import BoundedSemaphore
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import wave

from fastapi import HTTPException
from app.services.speech_cache import SpeechCache
from app.services.speech_runtime import speech_runtime

_gate = BoundedSemaphore(1)
_waiting = BoundedSemaphore(4)
MAX_AUDIO_BYTES = 12 * 1024 * 1024
_cache = SpeechCache()


def synthesize_speech(text, rate, *, account_id=None):
    base, provider = speech_runtime()
    if not base:
        raise HTTPException(503, '로컬 음성 서버가 설정되지 않았습니다.')
    # Authentication is still checked by the route before every cache lookup.
    # A model/voice change must bump this version, even at the same worker URL.
    version = os.environ.get('TTS_CACHE_VERSION', 'melotts-kr-v1')
    key = (str(account_id), base, provider, version, text, rate) if account_id else None
    if key is not None:
        hit = _cache.get(key)
        if hit is not None:
            return hit
    if not _waiting.acquire(blocking=False):
        raise HTTPException(429, '음성 요청이 많습니다. 잠시 후 다시 눌러 주세요.')
    acquired = False
    try:
        acquired = _gate.acquire(timeout=10)
        if not acquired:
            raise HTTPException(429, '음성 대기 시간이 길어졌습니다. 잠시 후 다시 눌러 주세요.')
        if key is not None:
            hit = _cache.get(key)
            if hit is not None:
                return hit
        request = Request(f'{base}/speech', method='POST',
                          data=json.dumps({'text': text, 'rate': rate}, ensure_ascii=False).encode('utf-8'),
                          headers={'Content-Type': 'application/json'})
        try:
            with urlopen(request, timeout=35) as response:
                data = response.read(MAX_AUDIO_BYTES + 1)
            if len(data) > MAX_AUDIO_BYTES:
                raise ValueError('oversized audio')
            with wave.open(BytesIO(data), 'rb') as wav:
                if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getnframes() <= 0:
                    raise ValueError('invalid PCM audio')
                if len(wav.readframes(wav.getnframes())) != wav.getnframes() * 2:
                    raise ValueError('truncated audio')
            if key is not None:
                _cache.put(key, data)
            return data
        except HTTPError as error:
            if error.code == 429:
                raise HTTPException(429, '음성 서버가 사용 중입니다. 잠시 후 다시 눌러 주세요.') from None
            raise HTTPException(503, '로컬 음성 서버를 준비 중이거나 합성에 실패했습니다.') from None
        except (HTTPClientError, TimeoutError, OSError, URLError, ValueError, wave.Error, EOFError):
            raise HTTPException(503, '로컬 음성 서버를 확인해 주세요. 첫 실행은 모델 준비에 시간이 필요합니다.') from None
    finally:
        if acquired:
            _gate.release()
        _waiting.release()
