"""Constrained local model selector; the model never creates activities or explanations."""
import json
import logging
import os
import threading
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pydantic import BaseModel, ConfigDict, Field, ValidationError

logger = logging.getLogger('uvicorn.error')
_model_gate = threading.BoundedSemaphore(1)
PROMPT_VERSION = 'practice-select-v1'


class Choice(BaseModel):
    model_config = ConfigDict(extra='forbid')
    candidate_id: str = Field(min_length=1, max_length=100)
    evidence_ids: list[str] = Field(min_length=1, max_length=3)


class Decision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    choices: list[Choice] = Field(min_length=1, max_length=3)


def enabled():
    return os.environ.get('OLLAMA_LEARNING_ENABLED', 'false').lower() in {'1', 'true', 'yes', 'on'}


def choose(candidates, samples):
    if not enabled():
        return None, 'disabled'
    if not _model_gate.acquire(blocking=False):
        return None, 'busy'
    try:
        allowed = {row['candidate_id']: {item['id'] for item in row['evidence']} for row in candidates}
        input_data = {'candidates': [{'candidate_id': key, 'evidence_ids': sorted(values)}
                                     for key, values in allowed.items()],
                      'samples': {'selection_events': samples['selection_events'],
                                  'learning_attempts': samples['learning_attempts']}}
        encoded = json.dumps(input_data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        if len(encoded) > 8192:
            return None, 'input_limit'
        model = os.environ.get('OLLAMA_LEARNING_MODEL', 'qwen3:4b-instruct')
        body = json.dumps({'model': model, 'stream': False, 'think': False, 'keep_alive': '10m',
            'format': Decision.model_json_schema(),
            'messages': [{'role': 'system', 'content': '제공된 후보 ID만 선택하세요. 활동, 카드, 근거를 새로 만들지 마세요. 반드시 JSON 형식으로 답하세요.'},
                         {'role': 'user', 'content': encoded.decode('utf-8')}],
            'options': {'temperature': 0, 'num_predict': 512}}, ensure_ascii=False).encode('utf-8')
        url = os.environ.get('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').rstrip('/') + '/api/chat'
        request = Request(url, data=body, headers={'Content-Type': 'application/json'}, method='POST')
        with urlopen(request, timeout=30) as response:
            payload = json.load(response)
        decision = Decision.model_validate_json(payload['message']['content'])
        chosen = []
        seen = set()
        for item in decision.choices:
            if (item.candidate_id not in allowed or item.candidate_id in seen
                    or len(set(item.evidence_ids)) != len(item.evidence_ids)
                    or not set(item.evidence_ids).issubset(allowed[item.candidate_id])):
                return None, 'invalid_ids'
            seen.add(item.candidate_id)
            chosen.append(item.candidate_id)
        return chosen, None
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, KeyError, TypeError,
            json.JSONDecodeError, ValidationError) as exc:
        logger.warning('LEARNING MODEL | FALLBACK | %s', type(exc).__name__)
        return None, 'model_error'
    finally:
        _model_gate.release()
