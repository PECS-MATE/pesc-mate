"""MongoDB-backed card categories with an idempotent default seed."""
from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.database import database, log_crud

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


def _collection():
    return database().card_categories


def _public(document):
    result = dict(document)
    result['id'] = str(result.pop('_id'))
    return result


def ensure_default_categories(collection=None):
    if collection is None:
        collection = _collection()
    if collection.count_documents({}, limit=1):
        return
    collection.create_index('name', unique=True)
    for category in DEFAULT_CATEGORIES:
        document = dict(category)
        category_id = document.pop('id')
        collection.update_one({'_id': category_id}, {'$setOnInsert': document}, upsert=True)
    log_crud('CREATE', 'card_categories', '기본 카테고리 초기화')


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
