"""Embedded image derivatives and serialized, measured local storage admission."""
from contextlib import contextmanager
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import os
from uuid import uuid4

from fastapi import HTTPException
from PIL import Image
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.services.schema_versions import SCHEMA_VERSION

DISPLAY_EDGE = 1280
PROFILE_EDGE = 512
THUMB_EDGE = 256
PROFILE_THUMB_EDGE = 128
LOCK_ID = 'image-writes'


def thumbnail(content, edge=THUMB_EDGE):
    # Only the already decoded, sanitized display derivative enters here.
    with Image.open(BytesIO(content)) as image:
        image.thumbnail((edge, edge), Image.Resampling.LANCZOS)
        image.info.clear()
        image.getexif().clear()
        output = BytesIO()
        image.save(output, format='WEBP', quality=82, method=4, exif=b'', icc_profile=b'', xmp=b'')
        data = output.getvalue()
    return {'data': data, 'content_type': 'image/webp', 'version': sha256(data).hexdigest()}


def byte_count(document):
    return sum(len(value) for value in (document.get('image_data'), document.get('thumbnail_data'),
        (document.get('image') or {}).get('data'), (document.get('thumbnail') or {}).get('data'),
        (document.get('original_image') or {}).get('data')) if isinstance(value, bytes))


def _binary_size(field):
    return {'$cond': [{'$eq': [{'$type': '$' + field}, 'binData']}, {'$binarySize': '$' + field}, 0]}


def usage(db, user_id):
    total, owned = 0, 0
    for name, owner, fields in (
        ('card_submissions', 'owner_id', ('image.data', 'thumbnail.data', 'original_image.data')),
        ('users', '_id', ('profile.image_data', 'profile.thumbnail_data', 'profile.original_image.data')),
    ):
        rows = list(db[name].aggregate([
            {'$project': {'bytes': {'$add': [_binary_size(field) for field in fields]}, 'owner': '$' + owner}},
            {'$group': {'_id': None, 'total': {'$sum': '$bytes'},
                        'owned': {'$sum': {'$cond': [{'$eq': ['$owner', user_id]}, '$bytes', 0]}}}},
        ], maxTimeMS=3000))
        if rows:
            total += rows[0]['total']; owned += rows[0]['owned']
    return {'total_bytes': total, 'user_bytes': owned}


def limits():
    try:
        user = int(os.environ.get('IMAGE_USER_LIMIT_MIB', '200')) * 1024 * 1024
        total = int(os.environ.get('IMAGE_TOTAL_LIMIT_MIB', '2048')) * 1024 * 1024
        if not 0 < user <= total <= 1024 ** 4:
            raise ValueError()
        return user, total
    except ValueError as exc:
        raise HTTPException(503, '이미지 저장 한도 설정을 확인해 주세요.') from exc


@contextmanager
def image_write_lock(db):
    token = uuid4().hex
    try:
        db.image_storage_state.insert_one({'_id': LOCK_ID, 'schema_version': SCHEMA_VERSION,
            'token': token, 'created_at': datetime.now(timezone.utc)})
    except DuplicateKeyError as exc:
        raise HTTPException(409, '다른 이미지 저장·삭제 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.') from exc
    except PyMongoError as exc:
        raise HTTPException(503, '이미지 저장소를 확인하지 못했습니다.') from exc
    # No expiring lease: a stopped writer can never wake up and overspend a new writer's quota.
    # A process crash leaves a recoverable lock; the maintenance CLI requires writers stopped + token.
    try:
        yield
    finally:
        db.image_storage_state.delete_one({'_id': LOCK_ID, 'token': token})


def deletion_watermark(db):
    db.image_storage_state.update_one({'_id': 'deletion-cutoff'}, {
        '$max': {'image_deleted_before': datetime.now(timezone.utc)},
        '$setOnInsert': {'schema_version': SCHEMA_VERSION}}, upsert=True)


def check_capacity(db, user_id, new_bytes, old_bytes=0):
    user_limit, total_limit = limits()
    delta = new_bytes - old_bytes
    if delta <= 0:
        return  # Allow reducing already-over-limit legacy data.
    measured = usage(db, user_id)
    if measured['user_bytes'] + delta > user_limit or measured['total_bytes'] + delta > total_limit:
        raise HTTPException(413, '이미지 저장 한도에 도달했습니다. 불필요한 이미지를 삭제하거나 저장 한도를 조정해 주세요.')


def check_deletion_race(db, user_id, started, *, require_consent=False):
    privacy = db.privacy_settings.find_one({'_id': user_id}) or {}
    cutoff = privacy.get('image_deleted_before')
    if isinstance(cutoff, datetime):
        cutoff = cutoff.replace(tzinfo=cutoff.tzinfo or timezone.utc)
        # MongoDB dates have millisecond precision. Conservatively retry same-millisecond uploads.
        if cutoff >= started.replace(microsecond=started.microsecond // 1000 * 1000):
            raise HTTPException(409, '이미지 삭제 이후 새 요청으로 다시 등록해 주세요.')
    if privacy.get('deletion_status') in {'in_progress', 'failed'}:
        raise HTTPException(409, '개인정보 삭제 상태를 먼저 확인해 주세요.')
    if require_consent and not privacy.get('guardian_consent'):
        raise HTTPException(403, '보호자 동의를 다시 확인해 주세요.')
