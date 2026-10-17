"""MongoDB-backed card categories with an idempotent default seed."""
import re
from uuid import uuid4

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.services.database import database, log_crud
from app.services.schema_versions import SCHEMA_VERSION

DEFAULT_CATEGORIES = [
    {'id': 'people', 'name': '사람', 'display_order': 1, 'active': True},
    {'id': 'food', 'name': '음식', 'display_order': 2, 'active': True},
    {'id': 'actions', 'name': '행동', 'display_order': 3, 'active': True},
    {'id': 'places', 'name': '장소', 'display_order': 4, 'active': True},
    {'id': 'emotions', 'name': '감정', 'display_order': 5, 'active': True},
    {'id': 'furniture', 'name': '가구', 'display_order': 6, 'active': True},
    {'id': 'household-items', 'name': '생활용품', 'display_order': 7, 'active': True},
    {'id': 'learning', 'name': '학습', 'display_order': 8, 'active': True},
    {'id': 'user-cards', 'name': '사용자 카드', 'display_order': 9, 'active': True},
]
CATEGORY_NAME_PATTERN = re.compile(r'^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ]+$')


def _collection():
    return database().card_categories


def _public(document):
    result = dict(document)
    result.pop('schema_version', None)
    result['id'] = str(result.pop('_id'))
    return result


def ensure_default_categories(collection=None):
    if collection is None:
        collection = _collection()
    if collection.count_documents({}, limit=1):
        return
    collection.create_index('name', unique=True)
    for category in DEFAULT_CATEGORIES:
        document = {'schema_version': SCHEMA_VERSION, **category}
        category_id = document.pop('id')
        collection.update_one({'_id': category_id}, {'$setOnInsert': document}, upsert=True)
    log_crud('CREATE', 'card_categories', '기본 카테고리 초기화')


def _validate_name(name):
    name = name.strip()
    if not name or not CATEGORY_NAME_PATTERN.fullmatch(name):
        raise HTTPException(422, '카테고리 이름은 한글, 영문, 숫자와 공백만 사용할 수 있습니다.')
    return name


def categories_for_admin():
    try:
        collection = _collection()
        ensure_default_categories(collection)
        rows = collection.find({}).sort('display_order', 1)
        log_crud('READ', 'card_categories', '운영 담당자 카테고리 조회')
        return [_public(row) for row in rows]
    except PyMongoError as exc:
        raise HTTPException(503, '카테고리를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.') from exc


def active_categories():
    try:
        collection = _collection()
        ensure_default_categories(collection)
        rows = collection.find({'active': True}).sort('display_order', 1)
        log_crud('READ', 'card_categories', '활성 카테고리 조회')
        return [_public(row) for row in rows]
    except PyMongoError as exc:
        raise HTTPException(503, '카테고리를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.') from exc


def active_category_names():
    return {category['name'] for category in active_categories()}


def create_category(name, display_order):
    name = _validate_name(name)
    try:
        collection = _collection()
        ensure_default_categories(collection)
        document = {'schema_version': SCHEMA_VERSION, '_id': str(uuid4()), 'name': name, 'display_order': display_order, 'active': True}
        collection.insert_one(document)
        log_crud('CREATE', 'card_categories', '카테고리 추가')
        return _public(document)
    except DuplicateKeyError as exc:
        raise HTTPException(409, '같은 이름의 카테고리가 이미 있습니다.') from exc
    except PyMongoError as exc:
        raise HTTPException(503, '카테고리를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') from exc


def update_category(category_id, name, display_order, active):
    name = _validate_name(name)
    try:
        collection = _collection()
        ensure_default_categories(collection)
        document = collection.find_one({'_id': category_id})
        if not document:
            raise HTTPException(404, '카테고리를 찾을 수 없습니다.')
        changes = {'name': name, 'display_order': display_order, 'active': active}
        collection.update_one({'_id': category_id}, {'$set': changes})
        log_crud('UPDATE', 'card_categories', '카테고리 수정')
        return _public(document | changes)
    except DuplicateKeyError as exc:
        raise HTTPException(409, '같은 이름의 카테고리가 이미 있습니다.') from exc
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '카테고리를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.') from exc
