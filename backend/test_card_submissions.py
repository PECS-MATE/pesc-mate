import unittest
from copy import deepcopy
from io import BytesIO
from unittest.mock import patch

from fastapi import HTTPException
from PIL import Image

from app.services.card_submissions import (
    approved_cards_for, create_submission, image_for, review_submission,
    submissions_for, submissions_for_review, submit_draft, update_submission,
)


class Cursor(list):
    def sort(self, key, direction):
        return Cursor(sorted(self, key=lambda row: row[key], reverse=direction < 0))


class Collection:
    def __init__(self):
        self.documents = []

    def insert_one(self, document):
        self.documents.append(deepcopy(document))

    def create_index(self, *_args, **_kwargs):
        return 'normalized_label_1'

    def find_one(self, query):
        return next((deepcopy(document) for document in self.documents
                     if all(document.get(key) == value for key, value in query.items())), None)

    def update_one(self, query, update):
        for document in self.documents:
            if all(document.get(key) == value for key, value in query.items()):
                document.update(deepcopy(update['$set']))
                return

    def find(self, query):
        return Cursor(deepcopy([
            document for document in self.documents
            if all(document.get(key) == value for key, value in query.items())
        ]))


class CardSubmissionTests(unittest.TestCase):
    def setUp(self):
        self.collection = Collection()
        self.audit_collection = Collection()
        self.mock = patch('app.services.card_submissions._collection', return_value=self.collection)
        self.audit_mock = patch('app.services.card_submissions._audit_collection', return_value=self.audit_collection)
        self.mock.start()
        self.audit_mock.start()
        output = BytesIO()
        Image.new('RGB', (256, 256), '#ffffff').save(output, format='PNG')
        self.image = output.getvalue()

    def tearDown(self):
        self.mock.stop()
        self.audit_mock.stop()

    def test_submission_is_pending_and_scoped_to_owner(self):
        saved = create_submission(
            'demo', '연필', '글을 쓰는 도구', '학습', 'private',
            'pencil.png', 'image/png', self.image,
        )
        self.assertEqual(saved['status'], 'pending')
        self.assertEqual(saved['owner_id'], 'demo')
        self.assertEqual(len(submissions_for('demo')), 1)
        self.assertEqual(submissions_for('another-user'), [])

    def test_submission_rejects_invalid_image_and_visibility(self):
        with self.assertRaises(HTTPException) as image_error:
            create_submission('demo', '연필', '뜻', '학습', 'private', 'x.svg', 'image/svg+xml', b'x')
        self.assertEqual(image_error.exception.status_code, 422)
        with self.assertRaises(HTTPException) as visibility_error:
            create_submission('demo', '연필', '뜻', '학습', 'public', 'x.png', 'image/png', b'x')
        self.assertEqual(visibility_error.exception.status_code, 422)
        with self.assertRaises(HTTPException) as category_error:
            create_submission('demo', '연필', '뜻', '임의 분류', 'private',
                              'x.png', 'image/png', self.image)
        self.assertEqual(category_error.exception.status_code, 422)

    def test_admin_approval_exposes_card_without_removing_defaults(self):
        saved = create_submission('demo', '연필', '글을 쓰는 도구', '학습', 'private',
                                  'pencil.png', 'image/png', self.image)
        approved = review_submission(saved['id'], 'admin', 'approved', '')
        self.assertEqual(approved['status'], 'approved')
        cards = approved_cards_for('demo')
        self.assertEqual(cards[0]['label'], '연필')
        self.assertEqual(approved_cards_for('another-user'), [])
        image, content_type = image_for(saved['id'], {'id': 'demo', 'role': 'user'})
        self.assertTrue(image.startswith(b'RIFF'))
        self.assertEqual(content_type, 'image/webp')
        self.assertEqual(len(self.audit_collection.documents), 2)

    def test_rejection_requires_reason_and_prevents_second_review(self):
        saved = create_submission('demo', '연필', '뜻', '학습', 'shared',
                                  'pencil.png', 'image/png', self.image)
        with self.assertRaises(HTTPException):
            review_submission(saved['id'], 'admin', 'rejected', '')
        review_submission(saved['id'], 'admin', 'rejected', '이미지를 확인해 주세요.')
        with self.assertRaises(HTTPException) as caught:
            review_submission(saved['id'], 'admin', 'approved', '')
        self.assertEqual(caught.exception.status_code, 409)

    def test_draft_submit_and_inactive_state_flow(self):
        draft = create_submission('demo', '연필', '글을 쓰는 도구', '학습', 'private',
                                  'pencil.png', 'image/png', self.image, 'draft')
        self.assertEqual(draft['status'], 'draft')
        self.assertEqual(submissions_for_review(), [])
        edited = update_submission(draft['id'], 'demo', '색연필', '색을 칠하는 도구', '학습', 'private')
        self.assertEqual(edited['label'], '색연필')
        self.assertEqual(edited['status'], 'draft')
        pending = submit_draft(draft['id'], 'demo')
        self.assertEqual(pending['status'], 'pending')
        approved = review_submission(draft['id'], 'admin', 'approved')
        self.assertEqual(approved['status'], 'approved')
        inactive = review_submission(draft['id'], 'admin', 'inactive', '운영자 비활성')
        self.assertEqual(inactive['status'], 'inactive')
        self.assertEqual(approved_cards_for('demo'), [])
        restored = review_submission(draft['id'], 'admin', 'approved', '재활성')
        self.assertEqual(restored['status'], 'approved')
        self.assertEqual(len(self.audit_collection.documents), 6)
        with self.assertRaises(HTTPException) as approved_edit:
            update_submission(draft['id'], 'demo', '연필', '뜻', '학습', 'private')
        self.assertEqual(approved_edit.exception.status_code, 409)

    def test_image_content_and_resolution_are_verified(self):
        with self.assertRaises(HTTPException) as mismatch:
            create_submission('demo', '연필', '뜻', '학습', 'private',
                              'pencil.jpg', 'image/jpeg', self.image)
        self.assertEqual(mismatch.exception.status_code, 422)
        small = BytesIO()
        Image.new('RGB', (64, 64)).save(small, format='PNG')
        with self.assertRaises(HTTPException) as resolution:
            create_submission('demo', '연필', '뜻', '학습', 'private',
                              'small.png', 'image/png', small.getvalue())
        self.assertEqual(resolution.exception.status_code, 422)
        with self.assertRaises(HTTPException) as corrupt:
            create_submission('demo', '연필', '뜻', '학습', 'private',
                              'fake.png', 'image/png', b'not an image')
        self.assertEqual(corrupt.exception.status_code, 422)

    def test_prohibited_variants_invalid_characters_and_duplicates_are_rejected(self):
        with self.assertRaises(HTTPException) as prohibited:
            create_submission('demo', '안녕', '씨 ! 발', '감정', 'private',
                              'card.png', 'image/png', self.image)
        self.assertEqual(prohibited.exception.status_code, 422)
        with self.assertRaises(HTTPException) as invalid_character:
            create_submission('demo', '연필😀', '뜻', '학습', 'private',
                              'card.png', 'image/png', self.image)
        self.assertEqual(invalid_character.exception.status_code, 422)
        with self.assertRaises(HTTPException) as default_duplicate:
            create_submission('demo', '사 과', '과일', '음식', 'private',
                              'card.png', 'image/png', self.image)
        self.assertEqual(default_duplicate.exception.status_code, 409)
        create_submission('demo', '연필', '글을 쓰는 도구', '학습', 'private',
                          'card.png', 'image/png', self.image)
        with self.assertRaises(HTTPException) as pending_duplicate:
            create_submission('another', '연 필', '학습 도구', '학습', 'shared',
                              'card.png', 'image/png', self.image)
        self.assertEqual(pending_duplicate.exception.status_code, 409)

    def test_language_review_flags_are_saved_with_submission(self):
        saved = create_submission('demo', 'TMI', '지나친 정보', '사용자 카드', 'private',
                                  'card.png', 'image/png', self.image)
        self.assertEqual(saved['language_flags'][0]['term'], 'TMI')
        self.assertTrue(saved['language_flags'][0]['source'])

    @patch('app.services.card_submissions.check_image_safety')
    def test_safety_blocked_image_cannot_be_submitted(self, safety_check):
        safety_check.return_value = {
            'status': 'blocked', 'provider': 'test-provider', 'reasons': ['unsafe'],
        }
        with self.assertRaises(HTTPException) as caught:
            create_submission('demo', '연필', '글을 쓰는 도구', '학습', 'private',
                              'card.png', 'image/png', self.image)
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(self.collection.documents, [])


if __name__ == '__main__':
    unittest.main()
