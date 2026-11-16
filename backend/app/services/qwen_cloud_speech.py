"""Qwen3-TTS-Flash Singapore API; credentials and signed URLs stay server-side."""
import json
import os
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener

ENDPOINT = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
MAX_AUDIO_BYTES = 12 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def configuration():
    return (os.environ.get('QWEN_API_MODEL', 'qwen3-tts-flash'),
            os.environ.get('QWEN_API_GIRL_VOICE', 'Cherry'),
            os.environ.get('QWEN_API_BOY_VOICE', 'Ethan'))


def synthesize(text, voice, timeout):
    key = os.environ.get('DASHSCOPE_API_KEY', '').strip()
    if not key:
        raise ValueError('Qwen API key is not configured')
    model, girl, boy = configuration()
    payload = {'model': model, 'input': {
        'text': text, 'voice': boy if voice == 'boy' else girl,
        'language_type': 'Korean',
    }}
    opener = build_opener(NoRedirect())
    request = Request(ENDPOINT, data=json.dumps(payload).encode(), headers={
        'Authorization': f'Bearer {key}', 'Content-Type': 'application/json',
    })
    with opener.open(request, timeout=timeout) as response:
        body = response.read(65537)
    if len(body) > 65536:
        raise ValueError('Oversized Qwen response')
    result = json.loads(body)
    audio_url = result.get('output', {}).get('audio', {}).get('url')
    if not isinstance(audio_url, str):
        raise ValueError('Missing Qwen audio URL')
    url = urlsplit(audio_url)
    # Only download Alibaba OSS output, without credentials or redirect following.
    if (url.scheme not in {'http', 'https'} or url.username or url.password
            or url.port not in {None, 80, 443}
            or not (url.hostname or '').endswith('.aliyuncs.com')
            or not any(part.startswith('oss-') for part in (url.hostname or '').split('.'))):
        raise ValueError('Invalid Qwen audio URL')
    secure_url = urlunsplit(('https', url.netloc, url.path, url.query, ''))
    with opener.open(Request(secure_url), timeout=timeout) as response:
        audio = response.read(MAX_AUDIO_BYTES + 1)
    if len(audio) > MAX_AUDIO_BYTES:
        raise ValueError('Oversized Qwen audio')
    return audio
