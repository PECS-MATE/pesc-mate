import unittest
from copy import deepcopy
from unittest.mock import patch

from app.api.router import CategoryResponse
from app.services.categories import (active_categories, active_category_names, categories_for_admin,
                                     create_category, ensure_default_categories, update_category)
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError


class Cursor(list):
    def sort(self, key, direction):
        return Cursor(sorted(self, key=lambda row: row[key], reverse=direction < 0))


class Collection:
    def __init__(self):
        self.documents = {}
        self.indexes = []

    def count_documents(self, query, limit=0):
        count = len(self.documents) if not query else len(self.find(query))
        return min(count, limit) if limit else count

    def create_index(self, key, **options):
        self.indexes.append((key, options))

    def update_one(self, query, update, upsert=False):
        category_id = query['_id']
        if category_id not in self.documents and upsert:
            self.documents[category_id] = deepcopy(query | update['$setOnInsert'])
        elif category_id in self.documents and '$set' in update:
            next_name = update['$set'].get('name')
            if next_name and any(row['_id'] != category_id and row['name'] == next_name
                                 for row in self.documents.values()):
                raise DuplicateKeyError('duplicate name')
            self.documents[category_id].update(deepcopy(update['$set']))

    def insert_one(self, document):
        if any(row['name'] == document['name'] for row in self.documents.values()):
            raise DuplicateKeyError('duplicate name')
        self.documents[document['_id']] = deepcopy(document)

    def find_one(self, query):
        return next((deepcopy(document) for document in self.documents.values()
                     if all(document.get(key) == value for key, value in query.items())), None)

    def find(self, query):
        return Cursor(deepcopy([
            document for document in self.documents.values()
            if all(document.get(key) == value for key, value in query.items())
        ]))


class CategoryTests(unittest.TestCase):
    def setUp(self):
        self.collection = Collection()
        self.mock = patch('app.services.categories._collection', return_value=self.collection)
        self.mock.start()

    def tearDown(self):
        self.mock.stop()

    def test_default_categories_include_new_groups_in_display_order(self):
        categories = active_categories()
        names = [category['name'] for category in categories]

        self.assertEqual(names, [
            '사람', '음식', '행동', '장소', '감정', '가구', '생활용품', '학습', '사용자 카드',
        ])
        self.assertEqual(active_category_names(), set(names))
        self.assertEqual([category['display_order'] for category in categories], list(range(1, 10)))
        self.assertTrue(all(category['active'] for category in categories))
        self.assertEqual(CategoryResponse(**categories[-1]).id, 'user-cards')

    def test_categories_are_seeded_once_and_db_changes_are_respected(self):
        ensure_default_categories()
        self.assertEqual(len(self.collection.documents), 9)
        self.assertEqual(self.collection.indexes, [('name', {'unique': True})])
        ensure_default_categories()
        self.assertEqual(len(self.collection.indexes), 1)

        self.collection.documents['food']['active'] = False
        self.collection.documents['furniture']['name'] = '우리 집 가구'
        self.collection.documents['furniture']['display_order'] = 1
        categories = active_categories()

        self.assertNotIn('음식', [category['name'] for category in categories])
        self.assertEqual(categories[0]['name'], '사람')
        self.assertEqual(categories[1]['name'], '우리 집 가구')

    def test_admin_can_create_update_and_deactivate_category(self):
        created = create_category('운동', 10)
        self.assertEqual(created['name'], '운동')
        self.assertTrue(created['active'])
        updated = update_category(created['id'], '신체 활동', 2, False)
        self.assertEqual(updated['display_order'], 2)
        self.assertFalse(updated['active'])
        self.assertNotIn('신체 활동', active_category_names())
        self.assertIn('신체 활동', [category['name'] for category in categories_for_admin()])

    def test_category_admin_rejects_duplicate_invalid_and_unknown(self):
        ensure_default_categories()
        with self.assertRaises(HTTPException) as duplicate:
            create_category('사람', 10)
        self.assertEqual(duplicate.exception.status_code, 409)
        with self.assertRaises(HTTPException) as invalid:
            create_category('학습!', 10)
        self.assertEqual(invalid.exception.status_code, 422)
        with self.assertRaises(HTTPException) as missing:
            update_category('missing', '운동', 10, True)
        self.assertEqual(missing.exception.status_code, 404)


if __name__ == '__main__':
    unittest.main()
