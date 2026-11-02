"""Explicit, temporary local OCR; never registers or persists cards."""
import csv
from io import BytesIO, StringIO
import os
from pathlib import Path
import re
import shutil
import subprocess
from tempfile import TemporaryDirectory
from threading import BoundedSemaphore
import unicodedata

from fastapi import HTTPException
from PIL import Image

from app.services.card_submissions import _normalize_image

_slots = BoundedSemaphore(1)


def recognize_card(image_data: bytes, content_type: str) -> dict:
    if not _slots.acquire(blocking=False):
        raise HTTPException(429, '다른 사진의 글자를 읽고 있습니다. 잠시 후 다시 시도해 주세요.')
    try:
        binary = shutil.which('tesseract')
        if not binary:
            raise HTTPException(503, '글자 인식 도구가 없습니다. 백엔드 이미지를 다시 빌드해 주세요.')
        # Reuse upload signature, size, resolution, decoder and metadata checks.
        normalized, _ = _normalize_image(image_data, content_type)
        with TemporaryDirectory(prefix='pecsmate-ocr-') as directory:
            image_path = Path(directory) / 'input.png'
            with Image.open(BytesIO(normalized)) as image:
                rgba = image.convert('RGBA')
                background = Image.new('RGB', rgba.size, 'white')
                background.paste(rgba, mask=rgba.getchannel('A'))
                background.save(image_path, format='PNG')
            try:
                result = subprocess.run(
                    [binary, str(image_path), 'stdout', '-l', 'kor+eng', '--psm', '11', 'tsv'],
                    capture_output=True, text=True, encoding='utf-8', errors='replace',
                    timeout=20, check=True, env={**os.environ, 'OMP_THREAD_LIMIT': '1'},
                )
            except subprocess.TimeoutExpired as exc:
                raise HTTPException(504, '글자 인식 시간이 초과되었습니다. 글자 부분을 크게 촬영해 주세요.') from exc
            except (OSError, subprocess.CalledProcessError) as exc:
                raise HTTPException(503, '글자를 읽지 못했습니다. 인식 도구와 한국어 언어팩을 확인해 주세요.') from exc
        lines = {}
        for row in csv.DictReader(StringIO(result.stdout), delimiter='\t'):
            text = unicodedata.normalize('NFKC', row.get('text') or '').strip()
            if not text or row.get('level') != '5':
                continue
            key = tuple(row.get(field) for field in ('page_num', 'block_num', 'par_num', 'line_num'))
            lines.setdefault(key, []).append(text)
        candidates = []
        for words in lines.values():
            label = re.sub(r'[^가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ]', '', ' '.join(words))
            label = re.sub(r'\s+', ' ', label).strip()[:30]
            if label and label not in candidates:
                candidates.append(label)
        return {'suggested_label': candidates[0] if candidates else '', 'candidates': candidates[:8]}
    finally:
        _slots.release()
