"""Opt-in image previews with persistent quota; no automatic retries or image saving."""
import base64
from datetime import datetime, timedelta, timezone
from collections import OrderedDict
from contextlib import contextmanager
from importlib.util import find_spec
from io import BytesIO
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory
from threading import BoundedSemaphore, Lock
from time import monotonic
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPRedirectHandler

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, PyMongoError
from PIL import Image
from app.services.database import database
from app.services.image_guidelines import card_image_prompt
from app.services.card_submissions import _normalize_image, MAX_IMAGE_BYTES

_slots = BoundedSemaphore(1)
_lock = Lock()
_usage = OrderedDict()
PROMPT_VERSION = 'aac-reference-v3'


def daily_limit():
    try:
        return max(0, min(30, int(os.getenv('IMAGE_GENERATION_DAILY_LIMIT', '30'))))
    except ValueError:
        return 30


def daily_identity():
    # One shared counter per Korean calendar day, across processes and restarts.
    return datetime.now(timezone(timedelta(hours=9))).strftime('%Y-%m-%d')


def generation_quota(reserve=False):
    limit = daily_limit()
    try:
        collection = database().image_generation_usage
        identity = daily_identity()
        if reserve:
            if limit == 0:
                raise HTTPException(429, '오늘의 그림 생성 한도에 도달했습니다.')
            try:
                collection.update_one({'_id': identity}, {'$setOnInsert': {'attempts': 0}}, upsert=True)
            except DuplicateKeyError:
                pass
            row = collection.find_one_and_update({'_id': identity, 'attempts': {'$lt': limit}},
                {'$inc': {'attempts': 1}}, return_document=ReturnDocument.AFTER)
            if row is None:
                raise HTTPException(429, '오늘의 그림 생성 한도에 도달했습니다.')
        else:
            row = collection.find_one({'_id': identity}) or {}
        used = row.get('attempts', 0)
        return {'date': identity, 'limit': limit, 'used': used, 'remaining': max(0, limit - used)}
    except PyMongoError:
        raise HTTPException(503, '생성 횟수를 확인할 수 없어 그림 생성을 중단했습니다.') from None


def status():
    backend = os.getenv('IMAGE_GENERATION_PROVIDER', 'openrouter').strip().lower()
    if backend == 'huggingface':
        model = os.getenv('HF_IMAGE_MODEL', 'black-forest-labs/FLUX.1-schnell').strip()
        provider = os.getenv('HF_IMAGE_PROVIDER', 'fal-ai').strip()
        ready = bool(os.getenv('HF_TOKEN', '').strip().startswith('hf_') and
                     re.fullmatch(r'[A-Za-z0-9_-]+/[A-Za-z0-9._-]+', model) and
                     provider in {'fal-ai', 'hf-inference', 'together'} and find_spec('huggingface_hub'))
        name, recipient = 'Hugging Face', 'Hugging Face 및 선택한 추론 제공업체'
    elif backend == 'gemini':
        model = os.getenv('GEMINI_IMAGE_MODEL', 'gemini-2.5-flash-image').strip()
        ready = bool(os.getenv('GEMINI_API_KEY') and re.fullmatch(r'[a-zA-Z0-9._-]{1,100}', model))
        provider, name, recipient = 'google', 'Gemini', 'Google'
    elif backend == 'openrouter':
        model = os.getenv('OPENROUTER_IMAGE_MODEL', 'google/gemini-2.5-flash-image').strip()
        ready = bool(os.getenv('OPENROUTER_API_KEY', '').strip() and
                     re.fullmatch(r'google/[a-zA-Z0-9._-]*image[a-zA-Z0-9._-]*', model))
        provider, name, recipient = 'google', 'Gemini · OpenRouter', 'OpenRouter 및 Google'
    else:
        model, provider, name, recipient, ready = '', '', '미설정', '외부 이미지 서비스', False
    return {'generation_ready': ready, 'generation_backend': backend,
            'generation_provider': name, 'inference_provider': provider,
            'generation_recipient': recipient, 'model': model,
            'background_ready': bool(os.getenv('REMBG_MODEL_PATH') and
                Path(os.environ['REMBG_MODEL_PATH']).is_file() and find_spec('rembg')),
            'background_provider': 'rembg · 서버 내부 처리'}


@contextmanager
def capacity(actor):
    # Single-process protection, not a provider spending limit.
    if not _slots.acquire(blocking=False):
        raise HTTPException(429, '다른 이미지를 처리 중입니다. 잠시 후 다시 시도해 주세요.')
    try:
        with _lock:
            now = monotonic()
            history = [at for at in _usage.get(actor, []) if now - at < 3600]
            if len(history) >= 20:
                raise HTTPException(429, '시간당 이미지 처리 횟수를 초과했습니다.')
            _usage[actor] = history + [now]
            _usage.move_to_end(actor)
            while len(_usage) > 2000:
                _usage.popitem(last=False)
        yield
    finally:
        _slots.release()


def preview(data, mime, provider):
    normalized, mime = _normalize_image(data, mime)
    return {'data_url': f'data:{mime};base64,' + base64.b64encode(normalized).decode(),
            'provider': provider, 'prompt_version': PROMPT_VERSION,
            'review_required': True}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def generate(label, accepted, description='', category=''):
    if not accepted:
        raise HTTPException(422, '외부 전송과 API 비용 안내를 확인해 주세요.')
    configuration = status()
    if not configuration['generation_ready']:
        raise HTTPException(503, '서버의 이미지 서비스 토큰·모델·필수 패키지 설정을 확인해 주세요.')
    model = configuration['model']
    prompt, context = card_image_prompt(label, description, category)
    def referenced(result):
        return result | {'guideline_version': context['version'], 'reference_ids': context['reference_ids']}
    # Reserve before contacting the provider. Failed/time-out requests may still be billed;
    # never refund automatically or retry a paid request.
    generation_quota(reserve=True)
    if configuration['generation_backend'] == 'huggingface':
        return referenced(generate_huggingface(prompt, model, configuration['inference_provider']))
    if configuration['generation_backend'] == 'openrouter':
        return referenced(generate_openrouter(prompt, model))
    body = {'contents': [{'parts': [{'text': prompt}]}],
            'generationConfig': {'responseModalities': ['TEXT', 'IMAGE']}}
    req = Request(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
        data=json.dumps(body).encode(), headers={'Content-Type': 'application/json',
        'x-goog-api-key': os.environ['GEMINI_API_KEY']}, method='POST')
    try:
        with build_opener(NoRedirect()).open(req, timeout=60) as response:
            raw = response.read(8 * 1024 * 1024 + 1)
        if len(raw) > 8 * 1024 * 1024:
            raise ValueError('oversized response')
        result = json.loads(raw)
        for candidate in result.get('candidates', []):
            for part in candidate.get('content', {}).get('parts', []):
                image = part.get('inlineData') or part.get('inline_data')
                if image and not part.get('thought'):
                    data = base64.b64decode(image['data'], validate=True)
                    return referenced(preview(data, image.get('mimeType') or image.get('mime_type'), 'Gemini / ' + model))
        raise HTTPException(422, '그림이 반환되지 않았습니다. 이름을 확인해 주세요. 자동 재시도하지 않습니다.')
    except HTTPException:
        raise
    except (TimeoutError, URLError, HTTPError, ValueError, KeyError, TypeError, AttributeError):
        # Never forward vendor bodies, credentials or prompts to clients/logs.
        raise HTTPException(502, '이미지를 생성하지 못했습니다. 모델·한도·결제 설정을 확인하세요. 재시도 시 비용이 발생할 수 있습니다.') from None


def generate_openrouter(prompt, model):
    request = Request('https://openrouter.ai/api/v1/images', method='POST',
        data=json.dumps({'model': model, 'prompt': prompt, 'n': 1, 'aspect_ratio': '1:1',
                         'provider': {'allow_fallbacks': False}}).encode(),
        headers={'Content-Type': 'application/json',
                 'Authorization': 'Bearer ' + os.environ['OPENROUTER_API_KEY'].strip()})
    try:
        with build_opener(NoRedirect()).open(request, timeout=80) as response:
            raw = response.read(8 * 1024 * 1024 + 1)
        if len(raw) > 8 * 1024 * 1024:
            raise ValueError('oversized response')
        result = json.loads(raw)
        images = result.get('data') if isinstance(result, dict) else None
        if not isinstance(images, list) or not images or not isinstance(images[0], dict):
            raise ValueError('missing image')
        image = images[0]
        data = base64.b64decode(image['b64_json'], validate=True)
        # Do not fetch arbitrary response URLs or expose provider errors.
        return preview(data, image.get('media_type') or 'image/png', 'Gemini · OpenRouter / ' + model)
    except HTTPError as exc:
        if exc.code == 402:
            message = 'OpenRouter 크레딧을 충전한 뒤 다시 생성해 주세요.'
        elif exc.code in {401, 403}:
            message = 'OpenRouter 키의 이미지 모델 사용 권한을 확인해 주세요.'
        elif exc.code == 429:
            message = '이미지 생성 요청이 많습니다. 잠시 후 다시 시도해 주세요.'
        else:
            message = '그림을 생성하지 못했습니다. OpenRouter 모델 상태를 확인해 주세요.'
        raise HTTPException(502, message) from None
    except (TimeoutError, URLError, HTTPError, ValueError, KeyError, TypeError, AttributeError):
        raise HTTPException(502, '그림을 생성하지 못했습니다. OpenRouter 잔액과 모델을 확인해 주세요. 자동 재시도하지 않습니다.') from None


def generate_huggingface(prompt, model, provider):
    # Bound the entire SDK operation (metadata lookup + generation + image fetch).
    # One explicit provider, no automatic provider fallback or app-level retries.
    with TemporaryDirectory(prefix='pecsmate-hf-') as directory:
        output = Path(directory) / 'output.png'
        try:
            result = subprocess.run([sys.executable, '-m', 'app.services.card_hf_worker',
                                    str(output), model, provider], input=prompt.encode('utf-8'),
                capture_output=True, timeout=80, cwd=Path(__file__).resolve().parents[2],
                env={**os.environ, 'HF_HUB_DISABLE_TELEMETRY': '1', 'HF_HUB_DISABLE_PROGRESS_BARS': '1'})
            if result.returncode:
                messages = {10: '허깅페이스 토큰과 Inference Providers 권한을 확인하세요.',
                            11: '허깅페이스 결제·크레딧 설정을 확인하세요.',
                            12: '허깅페이스 요청 한도에 도달했습니다. 잠시 후 확인하세요.',
                            13: '선택한 모델·추론 제공업체의 지원 여부와 모델 이용 동의를 확인하세요.'}
                raise HTTPException(502, messages.get(result.returncode, '허깅페이스 이미지 생성에 실패했습니다.') +
                                    ' 자동 재시도하지 않습니다. 다시 요청하면 비용이 발생할 수 있습니다.')
            if output.stat().st_size > MAX_IMAGE_BYTES:
                raise ValueError('oversized result')
            return preview(output.read_bytes(), 'image/png', f'Hugging Face / {provider} / {model}')
        except subprocess.TimeoutExpired:
            raise HTTPException(504, '허깅페이스 응답 시간이 초과됐습니다. 과금됐을 수 있으므로 자동 재시도하지 않습니다.') from None
        except (OSError, ValueError):
            raise HTTPException(502, '허깅페이스 이미지 응답을 처리하지 못했습니다.') from None


def cutout(data, mime):
    if not status()['background_ready']:
        raise HTTPException(503, '서버에 rembg와 사전 준비한 모델이 필요합니다.')
    normalized, _ = _normalize_image(data, mime)
    with TemporaryDirectory(prefix='pecsmate-cutout-') as directory:
        source, target = Path(directory) / 'input.png', Path(directory) / 'output.png'
        with Image.open(BytesIO(normalized)) as image:
            image.save(source, 'PNG')
        try:
            subprocess.run([sys.executable, '-m', 'app.services.card_cutout_worker',
                            str(source), str(target)], check=True, capture_output=True,
                           timeout=45, cwd=Path(__file__).resolve().parents[2],
                           env={**os.environ, 'OMP_NUM_THREADS': '1'})
            if target.stat().st_size > MAX_IMAGE_BYTES:
                raise ValueError('oversized result')
            return preview(target.read_bytes(), 'image/png', 'rembg / u2netp')
        except (OSError, ValueError, subprocess.SubprocessError):
            raise HTTPException(503, '배경을 제거하지 못했습니다. 모델 파일과 서버 설정을 확인해 주세요.') from None
