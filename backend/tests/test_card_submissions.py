import unittest
from copy import deepcopy
from io import BytesIO
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from PIL import Image

from app.api.router import _card_owner
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
        self.database = MagicMock()

    def insert_one(self, document):
        self.documents.append(deepcopy(document))

    def create_index(self, *_args, **_kwargs):
        return 'normalized_label_1'

    def find_one(self, query, projection=None):
        return next((deepcopy(document) for document in self.documents
                     if all(document.get(key) == value for key, value in query.items())), None)

    def update_one(self, query, update):
        for document in self.documents:
            if all(document.get(key) == value for key, value in query.items()):
                document.update(deepcopy(update['$set']))
                return

    def find(self, query, projection=None):
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
        self.category_mock = patch(
            'app.services.card_submissions.active_category_names',
            return_value={'사람', '음식', '행동', '장소', '감정', '가구', '생활용품', '학습', '사용자 카드'},
        )
        self.mock.start()
        self.audit_mock.start()
        self.category_mock.start()
        output = BytesIO()
        Image.new('RGB', (256, 256), '#ffffff').save(output, format='PNG')
        self.image = output.getvalue()

    def tearDown(self):
        self.mock.stop()
        self.audit_mock.stop()
        self.category_mock.stop()

    @patch('app.api.router.require_link_permission', return_value='child')
    def test_supporter_card_owner_requires_explicit_link_permission(self, mocked_permission):
        supporter = {'id': 'caregiver', 'role': 'caregiver'}

        self.assertEqual(_card_owner(supporter, 'child'), 'child')
        mocked_permission.assert_called_once_with(supporter, 'child', 'cards_manage')
        with self.assertRaises(HTTPException) as missing:
            _card_owner(supporter)
        self.assertEqual(missing.exception.status_code, 422)

    def test_supporter_card_change_keeps_child_owner_and_supporter_actor(self):
        saved = create_submission(
            'child', '연필', '글을 쓰는 도구', '학습', 'private',
            'pencil.png', 'image/png', self.image, actor_id='caregiver',
        )

        self.assertEqual(saved['owner_id'], 'child')
        self.assertEqual(self.audit_collection.documents[0]['actor_id'], 'caregiver')

    @patch('app.services.card_submissions.check_image_safety')
    def test_edits_cannot_hide_a_blocked_full_frame_or_store_a_blocked_edited_frame(self, safety):
        for outcomes in ([{'status': 'blocked'}], [{'status': 'passed'}, {'status': 'blocked'}]):
            safety.reset_mock(); safety.side_effect = outcomes
            with self.assertRaises(HTTPException) as caught:
                create_submission('child', '검증 사진', '합성 사진', '음식', 'private', 'raw.png',
                                  'image/png', self.image, image_edits={'crop': 'square'})
            self.assertEqual(caught.exception.status_code, 422)
            self.assertEqual(safety.call_count, len(outcomes))
            self.assertEqual(self.collection.documents, [])
            self.assertEqual(self.audit_collection.documents, [])

    @patch('app.services.card_submissions.check_image_safety')
    def test_full_frame_manual_review_is_not_upgraded_by_an_edited_pass(self, safety):
        safety.side_effect = [{'status': 'manual_review', 'provider': 'synthetic', 'reasons': []},
                              {'status': 'passed', 'provider': 'synthetic', 'reasons': []}]
        saved = create_submission('child', '검증 사진', '합성 사진', '음식', 'private', 'raw.png',
                                  'image/png', self.image, image_edits={'brightness': 110})
        self.assertEqual(saved['image_safety']['status'], 'manual_review')
        self.assertEqual(self.collection.documents[0]['original_image']['data'], self.image)
        self.assertEqual(self.collection.documents[0]['image_edits'], {
            'version': 'card-image-edit-v1', 'crop': 'none', 'rotation': 0, 'brightness': 110})

    @patch('app.services.support_links.require_link_permission', return_value='child')
    def test_card_manager_can_view_linked_private_image(self, mocked_permission):
        saved = create_submission(
            'child', '연필', '글을 쓰는 도구', '학습', 'private',
            'pencil.png', 'image/png', self.image,
        )

        image, content_type = image_for(saved['id'], {'id': 'caregiver', 'role': 'caregiver'})

        self.assertTrue(image.startswith(b'RIFF'))
        self.assertEqual(content_type, 'image/webp')
        mocked_permission.assert_called_once_with(
            {'id': 'caregiver', 'role': 'caregiver'}, 'child', 'cards_manage',
        )

    def test_private_submission_is_immediately_active_and_scoped_to_owner(self):
        saved = create_submission(
            'demo', '연필', '글을 쓰는 도구', '학습', 'private',
            'pencil.png', 'image/png', self.image,
        )
        self.assertEqual(saved['status'], 'approved')
        self.assertFalse(saved['requires_review'])
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
        cards = approved_cards_for('demo')
        self.assertEqual(cards[0]['label'], '연필')
        self.assertEqual(approved_cards_for('another-user'), [])
        image, content_type = image_for(saved['id'], {'id': 'demo', 'role': 'user'})
        self.assertTrue(image.startswith(b'RIFF'))
        self.assertEqual(content_type, 'image/webp')
        self.assertEqual(len(self.audit_collection.documents), 1)

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
        approved = submit_draft(draft['id'], 'demo')
        self.assertEqual(approved['status'], 'approved')
        with self.assertRaises(HTTPException) as private_review:
            review_submission(draft['id'], 'admin', 'inactive', '운영자 비활성')
        self.assertEqual(private_review.exception.status_code, 403)
        shared = create_submission('demo', '공책', '글을 쓰는 책', '학습', 'shared',
                                   'notebook.png', 'image/png', self.image)
        review_submission(shared['id'], 'admin', 'approved')
        inactive = review_submission(shared['id'], 'admin', 'inactive', '운영자 비활성')
        self.assertEqual(inactive['status'], 'inactive')
        self.assertEqual(len(approved_cards_for('demo')), 1)
        restored = review_submission(shared['id'], 'admin', 'approved', '재활성')
        self.assertEqual(restored['status'], 'approved')
        self.assertEqual(len(self.audit_collection.documents), 7)
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
            create_submission('demo', '안녕', '씨 ! 발', '감정', 'shared',
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
        create_submission('another', '연 필', '개인 학습 도구', '학습', 'shared',
                          'card.png', 'image/png', self.image)
        with self.assertRaises(HTTPException) as pending_duplicate:
            create_submission('third', '연 필', '공개 학습 도구', '학습', 'shared',
                              'card.png', 'image/png', self.image)
        self.assertEqual(pending_duplicate.exception.status_code, 409)

    def test_private_expression_is_allowed_but_never_enters_public_review(self):
        private = create_submission('demo', '싫은 말', '씨 ! 발이라고 말하기', '사용자 카드', 'private',
                                    'card.png', 'image/png', self.image)
        self.assertEqual(private['status'], 'approved')
        self.assertEqual(submissions_for_review(), [])
        with self.assertRaises(HTTPException) as hidden:
            image_for(private['id'], {'id': 'admin', 'role': 'admin'})
        self.assertEqual(hidden.exception.status_code, 403)

    def test_legacy_pending_private_card_remains_available_only_to_owner(self):
        saved = create_submission('demo', '사진', '개인 사진', '사용자 카드', 'private',
                                  'card.png', 'image/png', self.image)
        self.collection.documents[0]['status'] = 'pending'
        self.assertEqual(submissions_for('demo')[0]['status'], 'approved')
        self.assertEqual(approved_cards_for('demo')[0]['label'], saved['label'])
        self.assertEqual(approved_cards_for('other'), [])

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
