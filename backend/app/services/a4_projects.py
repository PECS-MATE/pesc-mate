"""Account-owned A4 copies and explicitly moderated caregiver sharing."""
import base64
from datetime import datetime, timezone
from functools import wraps
from hashlib import sha256
from io import BytesIO
import re
from threading import BoundedSemaphore
from typing import Literal
from uuid import UUID

from bson import BSON
from fastapi import HTTPException
from PIL import Image, ImageDraw, ImageFont, ImageOps
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.services.card_submissions import _normalize_image
from app.services.database import database
from app.services import image_storage as storage
from app.services.schema_versions import SCHEMA_VERSION

TOPICS = ('일상', '식사', '감정', '외출', '학교', '기타')
MAX_REQUEST_BYTES = 12 * 1024 * 1024
_image_gate = BoundedSemaphore(1)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Settings(StrictModel):
    orientation: Literal['portrait', 'landscape']
    columns: int = Field(ge=1, le=8, strict=True)
    rows: int = Field(ge=1, le=10, strict=True)
    margin: float = Field(ge=5, le=20)
    gap: float = Field(ge=0, le=10)
    size: Literal[0, 40, 50, 60]
    labels: bool = Field(strict=True)


class Slot(StrictModel):
    rowId: str = Field(pattern=r'^c[1-9][0-9]{0,2}$')
    label: str = Field(max_length=30)
    zoom: float = Field(ge=1, le=2)
    fontSize: float = Field(ge=8, le=24)
    fit: Literal['contain', 'cover']


class Layout(StrictModel):
    settings: Settings
    slots: list[Slot | None] = Field(min_length=1, max_length=400)


class Card(StrictModel):
    id: str = Field(pattern=r'^c[1-9][0-9]{0,2}$')
    label: str = Field(max_length=30)
    image: str = Field(max_length=7 * 1024 * 1024)


class Project(StrictModel):
    format: Literal['pecsmate-a4-share']
    version: Literal[1]
    duplex: bool = Field(default=False, strict=True)
    cards: list[Card] = Field(min_length=1, max_length=60)
    layout: Layout

    @model_validator(mode='after')
    def check_layout(self):
        s = self.layout.settings
        width, height = (210, 297) if s.orientation == 'portrait' else (297, 210)
        cw = s.size or (width - 2 * s.margin - s.gap * (s.columns - 1)) / s.columns
        ch = s.size or (height - 2 * s.margin - s.gap * (s.rows - 1)) / s.rows
        capacity = s.columns * s.rows
        if (min(cw, ch) < 15 or s.columns * cw + (s.columns - 1) * s.gap > width - 2 * s.margin + .01
                or s.rows * ch + (s.rows - 1) * s.gap > height - 2 * s.margin + .01
                or len(self.layout.slots) % capacity or len(self.layout.slots) > capacity * 5):
            raise ValueError('A4 배치가 용지 범위를 벗어납니다.')
        ids = {card.id for card in self.cards}
        used = {slot.rowId for slot in self.layout.slots if slot}
        if len(ids) != len(self.cards) or ids != used:
            raise ValueError('배치한 카드만 포함해야 합니다.')
        return self


class SaveRequest(StrictModel):
    request_id: UUID
    title: str = Field(min_length=1, max_length=60)
    description: str = Field(default='', max_length=240)
    topic: Literal['일상', '식사', '감정', '외출', '학교', '기타'] = '기타'
    publish: bool = Field(default=False, strict=True)
    rights_confirmed: bool = Field(default=False, strict=True)
    privacy_confirmed: bool = Field(default=False, strict=True)
    project: Project


def _moderator(user):
    return user.get('role') == 'admin' or (user.get('role') == 'support_staff'
                                         and 'content_manage' in user.get('account_permissions', []))


def require_access(user):
    if user.get('role') != 'caregiver' and not _moderator(user):
        raise HTTPException(403, '보호자 또는 콘텐츠 운영 담당자만 이용할 수 있습니다.')


def storage_errors(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        try:
            return function(*args, **kwargs)
        except PyMongoError:
            raise HTTPException(503, '카드판 보관함을 불러오지 못했습니다. 잠시 후 확인해 주세요.') from None
    return wrapped


def _collection():
    collection = database().a4_projects
    collection.create_index([('owner_id', 1), ('created_at', -1)])
    collection.create_index([('status', 1), ('created_at', -1)])
    return collection


def _text(value):
    if any(ord(char) < 32 and char not in '\n\t' for char in value):
        raise HTTPException(422, '문구에 허용되지 않는 제어 문자가 있습니다.')
    return value.strip()


def _summary(row, user):
    return {key: row[key] for key in ('title', 'description', 'topic', 'status', 'version', 'card_count', 'pages', 'preview')} | {
        'id': row['_id'], 'mine': row['owner_id'] == user['id'],
        'created_at': row['created_at'].isoformat(),
        'review_reason': row.get('review_reason', '') if row['owner_id'] == user['id'] or _moderator(user) else '',
        'source_title': row.get('source_title', ''),
    }


def _visible(row, user):
    return row and row['status'] != 'deleted' and (row['owner_id'] == user['id'] or row['status'] == 'approved'
                    or (_moderator(user) and row['publication_requested']))


def _load(project_id, user):
    row = _collection().find_one({'_id': project_id})
    if not _visible(row, user):
        raise HTTPException(404, '볼 수 있는 카드판이 없습니다. 공유가 중단됐을 수 있습니다.')
    return row


def _canonical(project):
    result = project.model_dump()
    images = {}
    for card in result['cards']:
        match = re.fullmatch(r'data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})', card['image'])
        if not match:
            raise HTTPException(422, '카드 이미지는 JPG·PNG·WebP만 사용할 수 있습니다.')
        try:
            data = base64.b64decode(match[2], validate=True)
        except ValueError:
            raise HTTPException(422, '이미지 인코딩을 확인해 주세요.') from None
        data, _ = _normalize_image(data, match[1], max_edge=768, min_input_edge=1)
        card['image'] = 'data:image/webp;base64,' + base64.b64encode(data).decode('ascii')
        # Hidden source names are not part of a print preview and must not leak.
        card['label'] = next((_text(slot['label']) for slot in result['layout']['slots']
                              if slot and slot['rowId'] == card['id'] and slot['label']), '') if result['layout']['settings']['labels'] or result['duplex'] else ''
        images[card['id']] = data
    for slot in result['layout']['slots']:
        if slot:
            slot['label'] = _text(slot['label']) if result['layout']['settings']['labels'] or result['duplex'] else ''
    if len(BSON.encode(result)) > 8 * 1024 * 1024:
        raise HTTPException(422, '공유 카드판은 처리 후 8MiB 이하로 줄여 주세요.')
    return result, _preview(result, images)


def _preview(project, images):
    """Small first-page illustration; the editable detail uses the browser A4 renderer."""
    s = project['layout']['settings']
    width, height = (210, 297) if s['orientation'] == 'portrait' else (297, 210)
    scale = 2
    canvas = Image.new('RGB', (width * scale, height * scale), 'white')
    draw = ImageDraw.Draw(canvas)
    cw = s['size'] or (width - 2 * s['margin'] - s['gap'] * (s['columns'] - 1)) / s['columns']
    ch = s['size'] or (height - 2 * s['margin'] - s['gap'] * (s['rows'] - 1)) / s['rows']
    for index, slot in enumerate(project['layout']['slots'][:s['columns'] * s['rows']]):
        if not slot:
            continue
        x = round((s['margin'] + index % s['columns'] * (cw + s['gap'])) * scale)
        y = round((s['margin'] + index // s['columns'] * (ch + s['gap'])) * scale)
        w, h = round(cw * scale), round(ch * scale)
        label = slot['label'] if s['labels'] else ''
        font_size = max(6, round(slot['fontSize'] * 25.4 / 72 * scale))
        try:
            font = ImageFont.truetype('/usr/share/fonts/truetype/nanum/NanumGothic.ttf', font_size)
        except OSError:
            font = ImageFont.load_default(size=font_size)
        iw, ih = max(1, w - 8), max(1, h - 8 - (font_size + 3 if label else 0))
        with Image.open(BytesIO(images[slot['rowId']])) as source:
            source = source.convert('RGBA')
            fit = ImageOps.contain if slot['fit'] == 'contain' else ImageOps.fit
            fitted = fit(source, (iw, ih), Image.Resampling.LANCZOS)
            fitted = fitted.resize((max(1, round(fitted.width * slot['zoom'])), max(1, round(fitted.height * slot['zoom']))))
            window = Image.new('RGBA', (iw, ih), 'white')
            window.paste(fitted, ((iw - fitted.width) // 2, (ih - fitted.height) // 2), fitted)
            canvas.paste(window.convert('RGB'), (x + 4, y + 4))
        draw.rectangle((x, y, x + w - 1, y + h - 1), outline='#718c83')
        if label:
            # Thumbnail labels are clipped to their own card, never other cells.
            text_layer = Image.new('RGB', (iw, font_size + 3), 'white')
            ImageDraw.Draw(text_layer).text((iw / 2, 0), label, font=font, fill='#344b46', anchor='mt')
            canvas.paste(text_layer, (x + 4, y + h - font_size - 5))
    output = BytesIO(); canvas.save(output, format='WEBP', quality=75)
    return 'data:image/webp;base64,' + base64.b64encode(output.getvalue()).decode('ascii')


def _insert(row, fingerprint, user, started):
    collection = _collection()
    with storage.image_write_lock(collection.database):
        storage.check_deletion_race(collection.database, user['id'], started)
        return _insert_locked(row, fingerprint, user, collection)


def _insert_locked(row, fingerprint, user, collection):
    previous = collection.find_one({'_id': row['_id']})
    if previous:
        if previous['owner_id'] != user['id'] or previous['fingerprint'] != fingerprint:
            raise HTTPException(409, '다른 작업에 사용된 요청입니다. 보관함을 확인해 주세요.')
        if previous['status'] == 'deleted':
            raise HTTPException(410, '이미 삭제한 편집본입니다. 새 저장 요청으로 다시 만들어 주세요.')
        return _summary(previous, user)
    if collection.count_documents({'owner_id': user['id'], 'status': {'$ne': 'deleted'}}, limit=100) >= 100:
        raise HTTPException(409, '보관함은 최대 100개입니다. 불필요한 편집본을 삭제해 주세요.')
    row['fingerprint'] = fingerprint
    row['schema_version'] = SCHEMA_VERSION
    row['storage_bytes'] = len(BSON.encode({'project': row['project'], 'preview': row['preview']}))
    storage.check_capacity(collection.database, user['id'], row['storage_bytes'])
    try:
        collection.insert_one(row)
    except DuplicateKeyError:
        previous = collection.find_one({'_id': row['_id'], 'owner_id': user['id'], 'fingerprint': fingerprint})
        if not previous:
            raise HTTPException(409, '중복 요청의 내용을 확인해 주세요.') from None
        row = previous
    return _summary(row, user)


@storage_errors
def save_project(payload, user):
    started = datetime.now(timezone.utc)
    require_access(user)
    if user.get('role') != 'caregiver':
        raise HTTPException(403, '보호자만 카드판을 저장·공유할 수 있습니다.')
    title = _text(payload.title)
    if not title:
        raise HTTPException(422, '제목을 입력해 주세요.')
    if payload.publish and not (payload.rights_confirmed and payload.privacy_confirmed):
        raise HTTPException(422, '공개 범위·개인정보·이미지 사용 권한을 확인해 주세요.')
    if not _image_gate.acquire(blocking=False):
        raise HTTPException(429, '다른 카드판의 사진을 처리 중입니다. 잠시 후 다시 시도해 주세요.')
    try:
        project, preview = _canonical(payload.project)
    finally:
        _image_gate.release()
    fingerprint = sha256(payload.model_dump_json().encode()).hexdigest()
    settings = project['layout']['settings']
    row = {'_id': str(payload.request_id), 'owner_id': user['id'], 'title': title,
           'description': _text(payload.description), 'topic': payload.topic,
           'status': 'pending' if payload.publish else 'private', 'version': 1,
           'publication_requested': payload.publish,
           'rights_confirmed': payload.rights_confirmed, 'privacy_confirmed': payload.privacy_confirmed,
           'created_at': datetime.now(timezone.utc), 'project': project, 'preview': preview,
           'card_count': sum(bool(slot) for slot in project['layout']['slots']),
           'pages': len(project['layout']['slots']) // (settings['columns'] * settings['rows']) * (2 if project['duplex'] else 1)}
    return _insert(row, fingerprint, user, started)


@storage_errors
def list_projects(user, scope='discover', topic='', query='', offset=0):
    require_access(user)
    collection = _collection()
    if scope == 'mine':
        selector = {'owner_id': user['id'], 'status': {'$ne': 'deleted'}}
    elif scope == 'review':
        if not _moderator(user):
            raise HTTPException(403, '콘텐츠 검토 권한이 필요합니다.')
        reported = database().a4_reports.distinct('project_id', {'resolved': {'$ne': True}})
        selector = {'$or': [{'status': 'pending'}, {'status': 'approved', '_id': {'$in': reported}}]}
    else:
        selector = {'status': 'approved'}
    if topic:
        selector['topic'] = topic
    if query:
        selector['title'] = {'$regex': re.escape(query), '$options': 'i'}
    rows = list(collection.find(selector, {'project': 0, 'fingerprint': 0}).sort([('created_at', -1), ('_id', -1)]).skip(offset).limit(13))
    return {'items': [_summary(row, user) for row in rows[:12]], 'has_more': len(rows) > 12}


@storage_errors
def project_detail(project_id, user):
    require_access(user)
    row = _load(project_id, user)
    result = _summary(row, user) | {'project': row['project']}
    if _moderator(user) and row['publication_requested']:
        result['reports'] = [{'reason': report['reason'], 'created_at': report['created_at'].isoformat()}
                             for report in database().a4_reports.find({'project_id': project_id, 'resolved': {'$ne': True}}).limit(20)]
    return result


@storage_errors
def copy_project(project_id, request_id, user):
    started = datetime.now(timezone.utc)
    require_access(user)
    if user.get('role') != 'caregiver':
        raise HTTPException(403, '보호자만 카드판을 복사할 수 있습니다.')
    previous = _collection().find_one({'_id': str(request_id), 'owner_id': user['id'], 'fingerprint': 'copy:' + project_id})
    if previous:
        return project_detail(str(request_id), user)
    source = _load(project_id, user)
    if source['status'] != 'approved':
        raise HTTPException(409, '현재 공개된 카드판만 복사할 수 있습니다.')
    # A complete independent snapshot: withdrawal never breaks existing private copies.
    row = {key: source[key] for key in ('title', 'description', 'topic', 'project', 'preview', 'card_count', 'pages')}
    row.update(_id=str(request_id), owner_id=user['id'], status='private', version=1,
               publication_requested=False, created_at=datetime.now(timezone.utc),
               source_id=project_id, source_title=source['title'])
    _insert(row, 'copy:' + project_id, user, started)
    return project_detail(str(request_id), user)


@storage_errors
def withdraw_project(project_id, expected_version, user):
    require_access(user)
    row = _load(project_id, user)
    if row['owner_id'] != user['id']:
        raise HTTPException(403, '본인이 공유한 카드판만 중단할 수 있습니다.')
    if not row['publication_requested']:
        raise HTTPException(409, '공유 요청한 카드판이 아닙니다.')
    result = _collection().update_one({'_id': project_id, 'owner_id': user['id'], 'version': expected_version},
        {'$set': {'status': 'withdrawn', 'withdrawn_at': datetime.now(timezone.utc)}, '$inc': {'version': 1}})
    if not result.modified_count:
        raise HTTPException(409, '카드판 상태가 변경됐습니다. 다시 불러와 주세요.')
    return project_detail(project_id, user)


@storage_errors
def review_project(project_id, expected_version, action, reason, user):
    require_access(user)
    if not _moderator(user):
        raise HTTPException(403, '콘텐츠 검토 권한이 필요합니다.')
    row = _load(project_id, user)
    if not row['publication_requested'] or row['status'] not in {'pending', 'approved'}:
        raise HTTPException(409, '검토 가능한 공유 카드판이 아닙니다.')
    if action in {'approve', 'reject'} and row['status'] != 'pending':
        raise HTTPException(409, '승인 대기 카드판만 승인·반려할 수 있습니다.')
    if action == 'dismiss' and row['status'] != 'approved':
        raise HTTPException(409, '공개 중인 카드판의 신고만 처리할 수 있습니다.')
    if action in {'approve', 'dismiss'} and row['owner_id'] == user['id']:
        raise HTTPException(403, '본인의 공유 요청을 직접 승인할 수 없습니다.')
    reason = _text(reason)
    report_ids = [report['_id'] for report in database().a4_reports.find(
        {'project_id': project_id, 'resolved': {'$ne': True}}, {'_id': 1})] if action == 'dismiss' else []
    if action != 'approve' and len(reason) < 3:
        raise HTTPException(422, '검토 사유를 세 글자 이상 입력해 주세요.')
    status = {'approve': 'approved', 'reject': 'rejected', 'withdraw': 'withdrawn', 'dismiss': 'approved'}[action]
    result = _collection().update_one({'_id': project_id, 'version': expected_version, 'status': row['status']},
        {'$set': {'status': status, 'review_reason': reason, 'reviewer_id': user['id'],
                  'reviewed_at': datetime.now(timezone.utc)}, '$inc': {'version': 1}})
    if not result.modified_count:
        raise HTTPException(409, '다른 검토가 반영됐습니다. 다시 불러와 주세요.')
    if action == 'dismiss':
        database().a4_reports.update_many({'_id': {'$in': report_ids}},
            {'$set': {'resolved': True, 'resolved_by': user['id'], 'resolved_at': datetime.now(timezone.utc)}})
    return project_detail(project_id, user)


@storage_errors
def report_project(project_id, reason, user):
    started = datetime.now(timezone.utc)
    require_access(user)
    row = _load(project_id, user)
    if row['status'] != 'approved' or row['owner_id'] == user['id']:
        raise HTTPException(409, '다른 보호자가 공개한 카드판만 신고할 수 있습니다.')
    reason = _text(reason)
    if len(reason) < 3:
        raise HTTPException(422, '신고 사유를 세 글자 이상 입력해 주세요.')
    key = sha256(f'{project_id}:{user["id"]}'.encode()).hexdigest()
    db = database()
    with storage.image_write_lock(db):
        storage.check_deletion_race(db, user['id'], started)
        if _load(project_id, user)['status'] != 'approved':
            raise HTTPException(409, '공유가 중단된 카드판입니다.')
        db.a4_reports.update_one({'_id': key}, {'$setOnInsert': {
            'schema_version': SCHEMA_VERSION,
            'project_id': project_id, 'reporter_id': user['id'], 'reason': reason,
            'created_at': datetime.now(timezone.utc)}}, upsert=True)
    return {'status': 'received'}


@storage_errors
def delete_project(project_id, expected_version, user):
    require_access(user)
    row = _load(project_id, user)
    if row['owner_id'] != user['id']:
        raise HTTPException(403, '본인의 보관함만 삭제할 수 있습니다.')
    if row['status'] not in {'private', 'rejected', 'withdrawn'}:
        raise HTTPException(409, '먼저 공유를 중단한 뒤 삭제해 주세요.')
    collection = _collection()
    with storage.image_write_lock(collection.database):
        # Keep only an idempotency tombstone so delayed retries cannot resurrect images.
        result = collection.update_one({'_id': project_id, 'owner_id': user['id'], 'version': expected_version}, {
            '$set': {'status': 'deleted', 'storage_bytes': 0}, '$inc': {'version': 1},
            '$unset': {key: '' for key in ('project', 'preview', 'title', 'description', 'topic', 'source_id',
                'source_title', 'review_reason', 'rights_confirmed', 'privacy_confirmed')}})
        if not result.modified_count:
            raise HTTPException(409, '카드판 상태가 변경됐습니다. 다시 불러와 주세요.')
        collection.database.a4_reports.delete_many({'project_id': project_id})
    return {'status': 'deleted'}
