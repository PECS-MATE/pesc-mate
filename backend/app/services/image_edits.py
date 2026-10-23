"""Bounded, opt-in edits for display derivatives, never for archived originals."""
import json

from fastapi import HTTPException
from PIL import Image, ImageEnhance

DEFAULT_EDITS = {'crop': 'none', 'rotation': 0, 'brightness': 100}
EDIT_VERSION = 'card-image-edit-v1'


def validate_edits(value=None):
    try:
        if value is None:
            return DEFAULT_EDITS.copy()
        if isinstance(value, str):
            if len(value) > 256:
                raise ValueError()
            value = json.loads(value)
        if not isinstance(value, dict) or set(value) - DEFAULT_EDITS.keys():
            raise ValueError()
        edits = DEFAULT_EDITS | value
        if (type(edits['crop']) is not str or edits['crop'] not in {'none', 'square'}
                or type(edits['rotation']) is not int or edits['rotation'] not in {0, 90, 180, 270}
                or type(edits['brightness']) is not int or not 50 <= edits['brightness'] <= 150):
            raise ValueError()
        return edits
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, '사진 보정 설정을 확인해 주세요. 자르기·90도 단위 회전·밝기 50~150%만 사용할 수 있습니다.') from exc


def apply_edits(image, edits, max_edge):
    # EXIF orientation and RGB/RGBA conversion happen in the shared normalizer first.
    if edits['rotation']:
        image = image.transpose({90: Image.Transpose.ROTATE_270, 180: Image.Transpose.ROTATE_180,
                                 270: Image.Transpose.ROTATE_90}[edits['rotation']])
    if edits['crop'] == 'square':
        side = min(image.size)
        left, top = (image.width - side) // 2, (image.height - side) // 2
        image = image.crop((left, top, left + side, top + side))
    # Bound enhancement buffers to the display size instead of full-resolution uploads.
    image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    if edits['brightness'] != 100:
        alpha = image.getchannel('A') if image.mode == 'RGBA' else None
        image = ImageEnhance.Brightness(image.convert('RGB')).enhance(edits['brightness'] / 100)
        if alpha is not None:
            image.putalpha(alpha)
    return image
