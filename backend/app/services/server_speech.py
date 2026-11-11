"""Local speech proxy: private text in memory, public vocabulary optionally on disk."""
from io import BytesIO
from http.client import HTTPException as HTTPClientError
import json
import math
import os
from functools import lru_cache
from threading import BoundedSemaphore
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import wave

from fastapi import HTTPException
from app.services.speech_cache import SpeechCache
from app.services.speech_runtime import speech_runtime
from app.services.public_speech_cache import PublicSpeechCache

_gate = BoundedSemaphore(1)
_waiting = BoundedSemaphore(4)
MAX_AUDIO_BYTES = 12 * 1024 * 1024
_cache = SpeechCache()


@lru_cache(maxsize=1)
def _public_labels():
    from app.services.communication import CARDS
    return frozenset(card['label'] for card in CARDS)


@lru_cache(maxsize=1)
def _disk_cache(directory):
    return PublicSpeechCache(directory)


def synthesize_speech(text, rate, *, account_id=None, voice='girl'):
    text = text.strip()
    if voice not in {'girl', 'boy'}:
        raise HTTPException(422, '지원하지 않는 음색입니다.')
    base, provider = speech_runtime()
    if not base:
        raise HTTPException(503, '로컬 음성 서버가 설정되지 않았습니다.')
    # Authentication is still checked by the route before every cache lookup.
    # A model/voice change must bump this version, even at the same worker URL.
    version = os.environ.get('TTS_CACHE_VERSION', 'melotts-kr-v1')
    key = (str(account_id), base, provider, version, voice, text, rate) if account_id else None
    directory = os.environ.get('PUBLIC_SPEECH_CACHE_DIR', '')
    # Only the shipped catalog, never private uploads or generated sentences.
    disk = _disk_cache(directory) if directory and text in _public_labels() else None
    public_key = (base, provider, version, voice, text, rate)
    if key is not None:
        hit = _cache.get(key)
        if hit is not None:
            return hit
    if disk is not None:
        hit = disk.get(public_key)
        if hit is not None:
            if key is not None:
                _cache.put(key, hit)
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
        if disk is not None:
            hit = disk.get(public_key)
            if hit is not None:
                if key is not None:
                    _cache.put(key, hit)
                return hit
        payload = {'text': text, 'rate': rate}
        if provider == 'qwen3-tts':
            payload['voice'] = voice
        request = Request(f'{base}/speech', method='POST',
                          data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                          headers={'Content-Type': 'application/json'})
        try:
            try:
                timeout = float(os.environ.get('SPEECH_TIMEOUT_SECONDS', '35'))
                if not math.isfinite(timeout) or not 5 <= timeout <= 120:
                    raise ValueError('timeout range')
            except ValueError:
                timeout = 35
            with urlopen(request, timeout=timeout) as response:
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
            if disk is not None:
                disk.put(public_key, data)
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
