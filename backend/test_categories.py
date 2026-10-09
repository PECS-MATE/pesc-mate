import unittest
from copy import deepcopy
from unittest.mock import patch

from app.api.router import CategoryResponse
from app.services.categories import active_categories, active_category_names, ensure_default_categories


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
        if query['_id'] not in self.documents and upsert:
            self.documents[query['_id']] = deepcopy(query | update['$setOnInsert'])

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


if __name__ == '__main__':
    unittest.main()
