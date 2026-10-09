"""User card submissions waiting for administrator review."""
from datetime import datetime, timezone
from io import BytesIO
from uuid import uuid4
import re
import unicodedata
import warnings

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.services.card_metadata import with_inferred_metadata
from app.services.database import database, log_crud
from app.services.categories import active_category_names
from app.services.image_safety import check_image_safety
from app.services.language_review import review_language

ALLOWED_IMAGE_TYPES = {'image/jpeg', 'image/png', 'image/webp'}
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MIN_IMAGE_EDGE = 128
MAX_IMAGE_EDGE = 4096
MAX_IMAGE_PIXELS = 16_000_000
IMAGE_FORMAT_TYPES = {'JPEG': 'image/jpeg', 'PNG': 'image/png', 'WEBP': 'image/webp'}
PROHIBITED_EXPRESSIONS = {'시발', '씨발', '병신', '개새끼'}
LABEL_PATTERN = re.compile(r'^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ]+$')
MEANING_PATTERN = re.compile(r'''^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9\s.,!?\-'"()·]+$''')


def _collection():
    return database().card_submissions


def _audit_collection():
    return database().card_audit_logs


def _public(document):
    return {
        'id': str(document['_id']),
        'label': document['label'],
        'meaning': document['meaning'],
        'category': document['category'],
        'visibility': document['visibility'],
        'owner_id': document['owner_id'],
        'status': document['status'],
        'image_filename': document['image']['filename'],
        'image_content_type': document['image']['content_type'],
        'image_url': f"/api/cards/submissions/{document['_id']}/image",
        'review_reason': document.get('review_reason'),
        'reviewer_id': document.get('reviewer_id'),
        'reviewed_at': document.get('reviewed_at'),
        'language_flags': document.get('language_flags', []),
        'image_safety': document.get('image_safety', {
            'status': 'manual_review', 'provider': 'administrator',
            'reasons': ['기존 이미지는 관리자 수동 검토가 필요합니다.'],
        }),
        'created_at': document['created_at'],
    }


def _compact_text(value):
    normalized = unicodedata.normalize('NFKC', value).casefold()
    return ''.join(character for character in normalized if character.isalnum())


def _validate_text(label, meaning):
    if not 1 <= len(label) <= 30 or not 1 <= len(meaning) <= 120:
        raise HTTPException(422, '카드명은 1~30자, 뜻은 1~120자로 입력해 주세요.')
    if not LABEL_PATTERN.fullmatch(label) or not MEANING_PATTERN.fullmatch(meaning):
        raise HTTPException(422, '카드명 또는 뜻에 허용되지 않는 문자가 있습니다.')
    compact = _compact_text(f'{label} {meaning}')
    if any(word in compact for word in PROHIBITED_EXPRESSIONS):
        raise HTTPException(422, '적절하지 않은 표현은 카드에 사용할 수 없습니다.')


def _ensure_unique_label(collection, normalized_label, exclude_id=None):
    from app.services.communication import CARDS
    if normalized_label in {_compact_text(card['label']) for card in CARDS}:
        raise HTTPException(409, '이미 등록된 카드명입니다.')
    duplicate = next((row for row in collection.find({})
                      if row['_id'] != exclude_id
                      and row.get('status') != 'rejected'
                      and _compact_text(row['label']) == normalized_label), None)
    if duplicate:
        raise HTTPException(409, '이미 등록되었거나 승인 대기 중인 카드명입니다.')


def _normalize_image(image_data, declared_content_type):
    if declared_content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(422, 'JPG, PNG, WebP 이미지만 등록할 수 있습니다.')
    if not image_data or len(image_data) > MAX_IMAGE_BYTES:
        raise HTTPException(422, '이미지는 5MB 이하로 등록해 주세요.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(image_data)) as probe:
                actual_content_type = IMAGE_FORMAT_TYPES.get(probe.format)
                width, height = probe.size
                probe.verify()
        if actual_content_type != declared_content_type:
            raise HTTPException(422, '파일 형식과 이미지 내용이 일치하지 않습니다.')
        if (min(width, height) < MIN_IMAGE_EDGE or max(width, height) > MAX_IMAGE_EDGE
                or width * height > MAX_IMAGE_PIXELS):
            raise HTTPException(422, '이미지 해상도는 가로·세로 128~4096px 범위여야 합니다.')
        with Image.open(BytesIO(image_data)) as source:
            source.seek(0)
            normalized = ImageOps.exif_transpose(source)
            normalized.load()
            normalized = normalized.convert('RGBA' if 'A' in normalized.getbands() else 'RGB')
            output = BytesIO()
            normalized.save(output, format='WEBP', quality=88, method=4)
            return output.getvalue(), 'image/webp'
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as exc:
        raise HTTPException(422, '손상되었거나 안전하게 처리할 수 없는 이미지입니다.') from exc


def create_submission(owner_id, label, meaning, category, visibility,
                      image_filename, image_content_type, image_data,
                      submission_mode='submit'):
    label = label.strip()
    meaning = meaning.strip()
    category = category.strip()
    if not label or not meaning or not category:
        raise HTTPException(422, '카드명과 뜻, 카테고리를 모두 입력해 주세요.')
    if category not in active_category_names():
        raise HTTPException(422, '사용할 수 없는 카드 카테고리입니다.')
    _validate_text(label, meaning)
    if visibility not in {'private', 'shared'}:
        raise HTTPException(422, '공개 범위가 올바르지 않습니다.')
    if submission_mode not in {'draft', 'submit'}:
        raise HTTPException(422, '저장 방식이 올바르지 않습니다.')
    safe_image_data, safe_content_type = _normalize_image(image_data, image_content_type)
    image_safety = check_image_safety(safe_image_data, safe_content_type)
    if image_safety['status'] == 'blocked':
        raise HTTPException(422, '안전성 검사를 통과하지 못한 이미지는 등록할 수 없습니다.')

    normalized_label = _compact_text(label)
    document = {
        '_id': str(uuid4()),
        'label': label,
        'normalized_label': normalized_label,
        'meaning': meaning,
        'language_flags': review_language(label, meaning),
        'image_safety': image_safety,
        'category': category,
        'visibility': visibility,
        'owner_id': owner_id,
        'status': 'draft' if submission_mode == 'draft' else 'pending',
        'image': {
            'filename': 'card-image.webp',
            'original_filename': image_filename or 'card-image',
            'content_type': safe_content_type,
            'data': safe_image_data,
        },
        'created_at': datetime.now(timezone.utc),
    }
    try:
        collection = _collection()
        collection.create_index(
            'normalized_label', unique=True,
            partialFilterExpression={'status': {'$in': ['draft', 'pending', 'approved']}},
        )
        _ensure_unique_label(collection, normalized_label)
        collection.insert_one(document)
        _audit_collection().insert_one({
            '_id': str(uuid4()), 'card_submission_id': document['_id'],
            'actor_id': owner_id, 'action': document['status'],
            'reason': None, 'created_at': document['created_at'],
        })
        log_crud('CREATE', 'card_submissions', '카드 승인 요청 저장')
        log_crud('CREATE', 'card_audit_logs', '카드 등록 작업 기록')
        return _public(document)
    except DuplicateKeyError as exc:
        raise HTTPException(409, '이미 등록되었거나 승인 대기 중인 카드명입니다.') from exc
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '카드 등록 요청을 저장하지 못했습니다.') from exc


def submissions_for(owner_id):
    try:
        rows = _collection().find({'owner_id': owner_id}).sort('created_at', -1)
        log_crud('READ', 'card_submissions', '본인 카드 요청 조회')
        return [_public(row) for row in rows]
    except PyMongoError as exc:
        raise HTTPException(503, '카드 등록 내역을 불러오지 못했습니다.') from exc


def submissions_for_review():
    try:
        rows = _collection().find({}).sort('created_at', -1)
        log_crud('READ', 'card_submissions', '관리자 승인 목록 조회')
        return [_public(row) for row in rows if row['status'] != 'draft']
    except PyMongoError as exc:
        raise HTTPException(503, '카드 승인 목록을 불러오지 못했습니다.') from exc


def review_submission(submission_id, reviewer_id, decision, reason=''):
    if decision not in {'approved', 'rejected', 'inactive'}:
        raise HTTPException(422, '승인, 반려 또는 비활성만 선택할 수 있습니다.')
    reason = reason.strip()
    if decision == 'rejected' and not reason:
        raise HTTPException(422, '반려 사유를 입력해 주세요.')
    try:
        collection = _collection()
        document = collection.find_one({'_id': submission_id})
        if not document:
            raise HTTPException(404, '카드 등록 요청을 찾을 수 없습니다.')
        allowed = {
            'pending': {'approved', 'rejected'},
            'approved': {'inactive'},
            'inactive': {'approved'},
        }
        if decision not in allowed.get(document['status'], set()):
            raise HTTPException(409, '현재 상태에서 요청한 상태로 변경할 수 없습니다.')
        reviewed_at = datetime.now(timezone.utc)
        changes = {'status': decision, 'review_reason': reason or None,
                   'reviewer_id': reviewer_id, 'reviewed_at': reviewed_at}
        collection.update_one({'_id': submission_id, 'status': document['status']}, {'$set': changes})
        _audit_collection().insert_one({
            '_id': str(uuid4()), 'card_submission_id': submission_id,
            'actor_id': reviewer_id, 'action': decision,
            'reason': reason or None, 'created_at': reviewed_at,
        })
        log_crud('UPDATE', 'card_submissions', f'카드 {decision}')
        log_crud('CREATE', 'card_audit_logs', '카드 승인 작업 기록')
        return _public(document | changes)
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '카드 승인 결과를 저장하지 못했습니다.') from exc


def submit_draft(submission_id, owner_id):
    try:
        collection = _collection()
        document = collection.find_one({'_id': submission_id, 'owner_id': owner_id})
        if not document:
            raise HTTPException(404, '임시 저장한 카드를 찾을 수 없습니다.')
        if document['status'] != 'draft':
            raise HTTPException(409, '작성 중인 카드만 승인을 요청할 수 있습니다.')
        submitted_at = datetime.now(timezone.utc)
        changes = {'status': 'pending', 'submitted_at': submitted_at}
        collection.update_one({'_id': submission_id, 'owner_id': owner_id, 'status': 'draft'},
                              {'$set': changes})
        _audit_collection().insert_one({
            '_id': str(uuid4()), 'card_submission_id': submission_id,
            'actor_id': owner_id, 'action': 'pending',
            'reason': None, 'created_at': submitted_at,
        })
        log_crud('UPDATE', 'card_submissions', '임시 저장 카드 승인 요청')
        log_crud('CREATE', 'card_audit_logs', '카드 제출 작업 기록')
        return _public(document | changes)
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '카드 승인 요청을 저장하지 못했습니다.') from exc


def update_submission(submission_id, owner_id, label, meaning, category, visibility):
    label = label.strip()
    meaning = meaning.strip()
    category = category.strip()
    if not label or not meaning or not category:
        raise HTTPException(422, '카드명과 뜻, 카테고리를 모두 입력해 주세요.')
    if category not in active_category_names():
        raise HTTPException(422, '사용할 수 없는 카드 카테고리입니다.')
    _validate_text(label, meaning)
    if visibility not in {'private', 'shared'}:
        raise HTTPException(422, '공개 범위가 올바르지 않습니다.')
    try:
        collection = _collection()
        document = collection.find_one({'_id': submission_id, 'owner_id': owner_id})
        if not document:
            raise HTTPException(404, '수정할 카드를 찾을 수 없습니다.')
        if document['status'] not in {'draft', 'rejected'}:
            raise HTTPException(409, '작성 중이거나 반려된 카드만 수정할 수 있습니다.')
        normalized_label = _compact_text(label)
        _ensure_unique_label(collection, normalized_label, submission_id)
        updated_at = datetime.now(timezone.utc)
        changes = {
            'label': label, 'normalized_label': normalized_label, 'meaning': meaning,
            'language_flags': review_language(label, meaning),
            'category': category, 'visibility': visibility, 'status': 'draft',
            'review_reason': None, 'reviewer_id': None, 'reviewed_at': None,
            'updated_at': updated_at,
        }
        collection.update_one({'_id': submission_id, 'owner_id': owner_id,
                               'status': document['status']}, {'$set': changes})
        _audit_collection().insert_one({
            '_id': str(uuid4()), 'card_submission_id': submission_id,
            'actor_id': owner_id, 'action': 'updated',
            'reason': None, 'created_at': updated_at,
        })
        log_crud('UPDATE', 'card_submissions', '카드 정보 수정')
        log_crud('CREATE', 'card_audit_logs', '카드 수정 작업 기록')
        return _public(document | changes)
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '카드 수정 내용을 저장하지 못했습니다.') from exc


def approved_cards_for(owner_id):
    try:
        rows = _collection().find({'status': 'approved'}).sort('created_at', 1)
        visible = [row for row in rows if row['visibility'] == 'shared' or row['owner_id'] == owner_id]
        return [with_inferred_metadata({
            'id': f"custom:{row['_id']}", 'label': row['label'], 'meaning': row['meaning'],
            'symbol': '🖼️', 'category': row['category'], 'image_index': None,
            'image_url': f"/api/cards/submissions/{row['_id']}/image", 'custom': True,
        }) for row in visible]
    except PyMongoError as exc:
        raise HTTPException(503, '사용자 카드를 불러오지 못했습니다.') from exc


def image_for(submission_id, requester):
    try:
        document = _collection().find_one({'_id': submission_id})
        if not document:
            raise HTTPException(404, '카드 이미지를 찾을 수 없습니다.')
        can_review = requester['role'] == 'admin'
        can_use = document['status'] == 'approved' and (
            document['visibility'] == 'shared' or document['owner_id'] == requester['id']
        )
        if not can_review and not can_use:
            raise HTTPException(403, '이 카드 이미지를 볼 수 없습니다.')
        return document['image']['data'], document['image']['content_type']
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '카드 이미지를 불러오지 못했습니다.') from exc
