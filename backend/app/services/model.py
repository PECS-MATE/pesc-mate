"""Ollama-backed Korean sentence generation with a safe local fallback."""
import json
import logging
import os
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.services.sentence_policy import policy_versions, system_prompt

logger = logging.getLogger('uvicorn.error')

SELF_REFERENCE = re.compile(r'(?<![가-힣])(나|저)(는|가|를|도)(?![가-힣])')


def enabled():
    return os.environ.get('OLLAMA_ENABLED', 'false').lower() in {'1', 'true', 'yes', 'on'}


def _valid_response(text, labels):
    if not text or len(text) > 150 or '\n' in text or '/' in text:
        return False
    has_self_card = any(label.strip() in {'나', '저'} for label in labels)
    return has_self_card or not SELF_REFERENCE.search(text)


def generate_sentence(labels, fallback):
    if not enabled():
        return fallback, 'rule'
    base_url = os.environ.get('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').rstrip('/')
    model = os.environ.get('OLLAMA_MODEL', 'qwen2.5:0.5b')
    payload = json.dumps({
        'model': model, 'stream': False, 'think': False, 'keep_alive': '10m',
        'system': system_prompt(),
        'prompt': (
            '카드를 단순히 이어 붙이지 말고 전체 의도를 자연스러운 한국어 한 문장으로 표현하세요.\n'
            '문법에 필요하면 카드 순서를 바꾸거나 활용해도 되지만 각 카드의 의미는 유지하세요.\n'
            '나 또는 저 카드가 없으면 나, 저, 나는, 저는 같은 주어를 새로 추가하지 마세요.\n'
            '규칙 기반 참고 문장이 이미 자연스러우면 내용을 바꾸지 말고 그대로 출력하세요.\n'
            '예시 1: 나 → 물 → 마시다 / 저는 물을 마시고 싶어요.\n'
            '예시 2: 싫어요 → 먹다 → 마시다 → 싫어요 / 먹거나 마시는 게 싫어요.\n'
            f"선택 카드: {' → '.join(labels)}\n규칙 기반 참고 문장: {fallback}\n최종 문장:"
        ),
        'options': {'temperature': 0.1, 'num_predict': 60},
    }, ensure_ascii=False).encode('utf-8')
    request = Request(f'{base_url}/api/generate', data=payload,
                      headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urlopen(request, timeout=float(os.environ.get('OLLAMA_TIMEOUT_SECONDS', '10'))) as response:
            result = json.load(response)
        text = str(result.get('response', '')).strip().strip('"')
        if not _valid_response(text, labels):
            raise ValueError('유효하지 않은 모델 응답')
        return text, 'ollama'
    except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError, OSError) as exc:
        logger.warning('MODEL | FALLBACK | 규칙 기반 문장 사용 (%s)', type(exc).__name__)
        return fallback, 'rule'


def status():
    return {'enabled': enabled(), 'model': os.environ.get('OLLAMA_MODEL', 'qwen2.5:0.5b'),
            'policy_versions': policy_versions()}
