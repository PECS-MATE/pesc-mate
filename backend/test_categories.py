import unittest

from app.api.router import CategoryResponse
from app.services.categories import active_categories, active_category_names


class CategoryTests(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
