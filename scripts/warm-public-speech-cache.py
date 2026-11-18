"""Run inside the backend container to seed its cache from published public WAVs."""
import json
import os
from pathlib import Path
import re
from urllib.request import urlopen

from app.services.public_speech_cache import PublicSpeechCache, valid_wav
from app.services.server_speech import _public_labels
from app.services.speech_runtime import speech_runtime


def main():
    base, provider = speech_runtime()
    if provider != 'qwen3-tts':
        raise RuntimeError('Published clips require the local Qwen provider')
    assets = Path('/tmp/card-speech-assets').as_uri()
    with urlopen(assets + '/manifest.json', timeout=15) as response:
        catalog = json.load(response)
    with urlopen(base + '/health', timeout=15) as response:
        health = json.load(response)
    if (catalog.get('provider') != provider or catalog.get('rate') != 1
            or not health.get('voice_version')
            or catalog.get('voice_version') != health['voice_version']):
        raise RuntimeError('Published voice version does not match the running worker')
    cache = PublicSpeechCache(os.environ['PUBLIC_SPEECH_CACHE_DIR'])
    version = os.environ.get('TTS_CACHE_VERSION', 'melotts-kr-v1')
    saved = existing = 0
    for voice in ('girl', 'boy'):
        for entry in catalog['entries']:
            text, filename = entry['text'], entry['file']
            if text not in _public_labels() or not re.fullmatch(r'[a-z0-9_-]+\.wav', filename):
                raise ValueError('Invalid public vocabulary entry')
            key = (base, provider, version, voice, text, 1.0)
            if cache.get(key) is not None:
                existing += 1
                continue
            with urlopen(f'{assets}/{voice}/{filename}', timeout=15) as response:
                data = response.read(1024 * 1024 + 1)
            if not valid_wav(data):
                raise ValueError('Invalid published WAV')
            cache.put(key, data)
            if cache.get(key) != data:
                raise RuntimeError('Cache write verification failed')
            saved += 1
    print(json.dumps({'saved': saved, 'existing': existing, 'total': saved + existing}), flush=True)


if __name__ == '__main__':
    main()
