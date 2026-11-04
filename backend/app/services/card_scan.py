"""Temporary sheet detection and perspective crops; no database or OCR writes."""
from base64 import b64encode
from io import BytesIO
import json
import math
from threading import BoundedSemaphore

from fastapi import HTTPException
from PIL import Image

from app.services.card_submissions import _normalize_image

_slots = BoundedSemaphore(1)
MAX_REGIONS = 20


def _tools():
    try:
        import cv2
        import numpy as np
        return cv2, np
    except ImportError as exc:
        raise HTTPException(503, '카드 분리 도구가 없습니다. 백엔드 이미지를 다시 빌드해 주세요.') from exc


def _source(data, content_type):
    content, _ = _normalize_image(data, content_type, max_edge=2048)
    with Image.open(BytesIO(content)) as source:
        rgba = source.convert('RGBA')
        image = Image.new('RGB', rgba.size, 'white')
        image.paste(rgba, mask=rgba.getchannel('A'))
        return image


def detect_card_regions(data, content_type):
    if not _slots.acquire(blocking=False):
        raise HTTPException(429, '다른 카드 사진을 분리하고 있습니다. 잠시 후 다시 시도해 주세요.')
    try:
        cv, np = _tools()
        image = _source(data, content_type)
        width, height = image.size
        gray = cv.cvtColor(np.array(image), cv.COLOR_RGB2GRAY)
        blurred = cv.GaussianBlur(gray, (5, 5), 0)
        edges = cv.morphologyEx(cv.Canny(blurred, 35, 110), cv.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        _, whites = cv.threshold(blurred, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU)
        candidates = []
        for mask in (edges, whites):
            contours, _ = cv.findContours(mask, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
            for contour in sorted(contours, key=cv.contourArea, reverse=True)[:400]:
                area = cv.contourArea(contour)
                if not .008 * width * height <= area <= .97 * width * height:
                    continue
                polygon = cv.approxPolyDP(contour, .025 * cv.arcLength(contour, True), True)
                if len(polygon) != 4 or not cv.isContourConvex(polygon):
                    continue
                points = polygon.reshape(4, 2).astype(float)
                center = points.mean(axis=0)
                points = points[np.argsort(np.arctan2(points[:, 1] - center[1], points[:, 0] - center[0]))]
                points = np.roll(points, -int(np.argmin(points.sum(axis=1))), axis=0)
                x, y, w, h = cv.boundingRect(polygon)
                if min(w, h) < 64 or not .35 <= w / h <= 2.8:
                    continue
                # Suppress the two edges of the same physical border.
                if any(abs(x - item['box'][0]) < 12 and abs(y - item['box'][1]) < 12
                       and abs(w - item['box'][2]) < 24 and abs(h - item['box'][3]) < 24 for item in candidates):
                    continue
                candidates.append({'points': points.tolist(), 'box': (x, y, w, h), 'area': area})
        def contains(outer, inner):
            x, y, w, h = outer['box']; a, b, c, d = inner['box']
            return outer['area'] > inner['area'] * 1.25 and x <= a and y <= b and x + w >= a + c and y + h >= b + d
        # Ignore a binder/page frame enclosing several separate card candidates.
        frames = [item for item in candidates if sum(contains(item, other) for other in candidates) >= 2]
        remaining = [item for item in candidates if item not in frames]
        remaining = [item for item in remaining if not any(contains(other, item) for other in remaining)]
        remaining.sort(key=lambda item: (round(item['box'][1] / max(1, height * .07)), item['box'][0]))
        return {'regions': [{'corners': [[round(x / width, 6), round(y / height, 6)] for x, y in item['points']]}
                            for item in remaining[:MAX_REGIONS]],
                'width': width, 'height': height, 'truncated': len(remaining) > MAX_REGIONS}
    finally:
        _slots.release()


def crop_card_regions(data, content_type, serialized_regions):
    try:
        regions = json.loads(serialized_regions)
        if not isinstance(regions, list) or not 1 <= len(regions) <= MAX_REGIONS:
            raise ValueError()
        for region in regions:
            if not isinstance(region, dict) or set(region) != {'corners'} or len(region['corners']) != 4:
                raise ValueError()
            for point in region['corners']:
                if len(point) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in point):
                    raise ValueError()
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(422, '카드 영역은 사진 안의 네 꼭짓점으로 최대 20개까지 지정해 주세요.') from exc
    if not _slots.acquire(blocking=False):
        raise HTTPException(429, '다른 카드 사진을 분리하고 있습니다. 잠시 후 다시 시도해 주세요.')
    try:
        cv, np = _tools()
        image = _source(data, content_type)
        width, height = image.size
        pixels = np.array(image)
        result = []
        for region in regions:
            points = np.array(region['corners'], dtype=np.float32) * [width - 1, height - 1]
            if not cv.isContourConvex(points.astype(np.float32)) or cv.contourArea(points.astype(np.float32), oriented=True) <= 0:
                raise HTTPException(422, '영역의 꼭짓점을 왼쪽 위부터 시계 방향으로 지정해 주세요.')
            w = max(np.linalg.norm(points[1] - points[0]), np.linalg.norm(points[2] - points[3]))
            h = max(np.linalg.norm(points[3] - points[0]), np.linalg.norm(points[2] - points[1]))
            if min(w, h) < 32 or max(w, h) / min(w, h) > 8:
                raise HTTPException(422, '너무 작거나 가느다란 영역입니다. 카드 전체를 선택해 주세요.')
            ratio = min(1024 / max(w, h), max(1, 128 / min(w, h)))
            w, h = max(128, round(w * ratio)), max(128, round(h * ratio))
            destination = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
            matrix = cv.getPerspectiveTransform(points.astype(np.float32), destination)
            cropped = Image.fromarray(cv.warpPerspective(pixels, matrix, (w, h), borderValue=(255, 255, 255)))
            output = BytesIO(); cropped.save(output, format='JPEG', quality=93)
            result.append({'image': 'data:image/jpeg;base64,' + b64encode(output.getvalue()).decode('ascii')})
        return {'cards': result}
    finally:
        _slots.release()
