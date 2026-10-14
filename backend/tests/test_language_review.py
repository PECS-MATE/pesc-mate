import unittest

from app.services.language_review import review_language


class LanguageReviewTests(unittest.TestCase):
    def test_known_slang_and_abbreviation_include_reference(self):
        results = review_language('TMI', '얼죽아를 설명해요')
        self.assertEqual({item['term'] for item in results}, {'TMI', '얼죽아'})
        self.assertTrue(all(item['source'] for item in results))

    def test_unknown_uppercase_word_is_flagged_for_manual_review(self):
        result = review_language('ABC', '새로운 줄임말')[0]
        self.assertEqual(result['kind'], '약어 후보')
        self.assertIn('확인', result['meaning'])

    def test_regular_expression_has_no_review_flags(self):
        self.assertEqual(review_language('연필', '글을 쓰는 도구'), [])


if __name__ == '__main__':
    unittest.main()
