"""Ollama-backed Korean sentence generation with a safe local fallback."""
import json
import logging
import math
import os
import re
from http.client import HTTPException as HTTPClientError
from threading import BoundedSemaphore, Event
from time import perf_counter
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.services.sentence_policy import policy_versions, system_prompt

logger = logging.getLogger('uvicorn.error')

SELF_REFERENCE = re.compile(r'(?<![가-힣])(나|저)(는|가|를|도)(?![가-힣])')
_model_gate = BoundedSemaphore(1)
_warming = Event()


def enabled():
    return os.environ.get('OLLAMA_ENABLED', 'false').lower() in {'1', 'true', 'yes', 'on'}


def warmup_enabled():
    return os.environ.get('OLLAMA_WARMUP_ENABLED', 'true').lower() in {'1', 'true', 'yes', 'on'}


def _integer_setting(name, default, minimum, maximum):
    try:
        return max(minimum, min(maximum, int(os.environ.get(name, str(default)))))
    except ValueError:
        return default


def _timeout(name, default):
    try:
        value = float(os.environ.get(name, str(default)))
        return value if math.isfinite(value) and 0 < value <= 120 else default
    except ValueError:
        return default


def _settings():
    keep_alive = os.environ.get('OLLAMA_KEEP_ALIVE', '30m').strip()
    if re.fullmatch(r'-?\d+', keep_alive):
        keep_alive = int(keep_alive)
    return {
        'model': os.environ.get('OLLAMA_MODEL', 'qwen2.5:0.5b'),
        'keep_alive': keep_alive,
        'num_ctx': _integer_setting('OLLAMA_NUM_CTX', 2048, 1024, 8192),
        'num_predict': _integer_setting('OLLAMA_NUM_PREDICT', 60, 32, 128),
    }


def _request(payload):
    base_url = os.environ.get('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').rstrip('/')
    return Request(f'{base_url}/api/generate',
                   data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                   headers={'Content-Type': 'application/json'}, method='POST')


def warmup():
    """Load only the configured local model; never send cards or delay API startup."""
    if not enabled() or not warmup_enabled() or not _model_gate.acquire(blocking=False):
        return False
    _warming.set()
    try:
        settings = _settings()
        payload = {'model': settings['model'], 'prompt': '', 'stream': False,
                   'keep_alive': settings['keep_alive'], 'options': {'num_ctx': settings['num_ctx']}}
        with urlopen(_request(payload), timeout=_timeout('OLLAMA_WARMUP_TIMEOUT_SECONDS', 30)) as response:
            result = json.load(response)
        if not isinstance(result, dict) or result.get('done') is not True or result.get('error'):
            raise ValueError('유효하지 않은 모델 준비 응답')
        return True
    except (HTTPClientError, HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
        logger.warning('MODEL | WARMUP | 모델 사전 준비 실패 (%s)', type(exc).__name__)
        return False
    finally:
        _warming.clear()
        _model_gate.release()


def _performance(metrics, started, status, result=None):
    if metrics is None:
        return
    metrics.update(status=status, elapsed_ms=round((perf_counter() - started) * 1000, 1))
    if not isinstance(result, dict):
        return
    for source, target in (
        ('total_duration', 'model_total_ms'), ('load_duration', 'load_ms'),
        ('prompt_eval_duration', 'prompt_ms'), ('eval_duration', 'decode_ms'),
    ):
        value = result.get(source)
        if type(value) is int and value >= 0:
            metrics[target] = round(value / 1_000_000, 1)
    for source, target in (('prompt_eval_count', 'input_tokens'), ('eval_count', 'output_tokens')):
        value = result.get(source)
        if type(value) is int and value >= 0:
            metrics[target] = value


def _valid_response(text, labels):
    if not text or len(text) > 150 or '\n' in text or '/' in text:
        return False
    has_self_card = any(label.strip() in {'나', '저'} for label in labels)
    return has_self_card or not SELF_REFERENCE.search(text)


def generate_sentence(labels, fallback, *, metrics=None):
    started = perf_counter()
    if not enabled():
        _performance(metrics, started, 'disabled')
        return fallback, 'rule'
    if not _model_gate.acquire(blocking=False):
        _performance(metrics, started, 'warming_up' if _warming.is_set() else 'busy')
        return fallback, 'rule'
    try:
        settings = _settings()
        payload = {
            'model': settings['model'], 'stream': False, 'think': False,
            'keep_alive': settings['keep_alive'], 'system': system_prompt(),
            'prompt': (
                '선택 카드의 뜻을 유지해 짧은 존댓말 한 문장만 출력하세요.\n'
                '나/저 카드가 없으면 주어를 추가하지 마세요. 참고 문장이 자연스러우면 그대로 쓰세요.\n'
                f"카드: {json.dumps(labels, ensure_ascii=False, separators=(',', ':'))}\n참고: {fallback}\n문장:"
            ),
            'options': {'temperature': 0.1, 'num_ctx': settings['num_ctx'],
                        'num_predict': settings['num_predict'], 'stop': ['\n']},
        }
        with urlopen(_request(payload), timeout=_timeout('OLLAMA_TIMEOUT_SECONDS', 10)) as response:
            result = json.load(response)
        _performance(metrics, started, 'invalid_response', result)
        if (not isinstance(result, dict) or result.get('done') is not True
                or result.get('done_reason') == 'length' or not isinstance(result.get('response'), str)):
            raise ValueError('완성되지 않은 모델 응답')
        text = result['response'].strip().strip('"')
        if not _valid_response(text, labels):
            raise ValueError('유효하지 않은 모델 응답')
        _performance(metrics, started, 'generated', result)
        return text, 'ollama'
    except (HTTPClientError, HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
        _performance(metrics, started, 'invalid_response' if isinstance(exc, ValueError) else 'unavailable')
        logger.warning('MODEL | FALLBACK | 규칙 기반 문장 사용 (%s)', type(exc).__name__)
        return fallback, 'rule'
    finally:
        _model_gate.release()


def status():
    settings = _settings()
    return {'enabled': enabled(), 'model': settings.pop('model'),
            'policy_versions': policy_versions(), 'settings': settings,
            'warmup_enabled': warmup_enabled(), 'warming_up': _warming.is_set()}
