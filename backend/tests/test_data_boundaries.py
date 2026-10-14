import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.services.authentication import current_user


USER_A = {'id': 'user-a', 'username': 'user-a', 'name': '사용자 A', 'role': 'user'}
OPERATOR = {
    'id': 'operator', 'username': 'operator', 'name': '운영 담당자',
    'role': 'support_staff', 'account_permissions': ['content_manage'],
}


class SubmissionCollection:
    def find_one(self, query):
        if query.get('_id') != 'private-card-b':
            return None
        return {
            '_id': 'private-card-b', 'owner_id': 'user-b', 'visibility': 'private',
            'status': 'approved', 'image': {'data': b'private', 'content_type': 'image/webp'},
        }


class DataBoundaryTests(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[current_user] = lambda: USER_A
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()
        self.client.close()

    def test_user_cannot_request_another_users_scoped_routes(self):
        requests = [
            ('get', '/api/dashboard?user_id=user-b', None),
            ('get', '/api/tts/settings?user_id=user-b', None),
            ('get', '/api/accessibility/settings?user_id=user-b', None),
            ('get', '/api/board/layout?user_id=user-b', None),
            ('get', '/api/board/layout/audit?user_id=user-b', None),
            ('get', '/api/learning/settings?user_id=user-b', None),
            ('get', '/api/learning/progress?user_id=user-b', None),
            ('get', '/api/learning/audit?user_id=user-b', None),
            ('get', '/api/cards/submissions?user_id=user-b', None),
            ('put', '/api/care/notes/00000000-0000-0000-0000-000000000002',
             {'user_id': 'user-b', 'content': '메모'}),
        ]

        for method, path, body in requests:
            with self.subTest(path=path):
                response = getattr(self.client, method)(path, json=body) if body else getattr(
                    self.client, method)(path)
                self.assertEqual(response.status_code, 403)

    @patch('app.services.card_submissions._collection', return_value=SubmissionCollection())
    def test_user_cannot_fetch_another_users_private_card_image(self, _collection):
        response = self.client.get('/api/cards/submissions/private-card-b/image')

        self.assertEqual(response.status_code, 403)

    def test_user_cannot_fetch_another_users_profile_image(self):
        response = self.client.get('/api/profile/user-b/image')

        self.assertEqual(response.status_code, 403)

    @patch('app.services.authentication.linked_users', return_value=[])
    @patch('app.services.support_links.link_for', return_value=None)
    @patch('app.services.card_submissions._collection', return_value=SubmissionCollection())
    def test_content_operator_permission_does_not_grant_private_child_access(
            self, _collection, _link_for, _linked_users):
        app.dependency_overrides[current_user] = lambda: OPERATOR

        dashboard = self.client.get('/api/dashboard?user_id=user-b')
        profile = self.client.get('/api/profile/user-b/image')
        private_card = self.client.get('/api/cards/submissions/private-card-b/image')

        self.assertIn(dashboard.status_code, {403, 404})
        self.assertIn(profile.status_code, {403, 404})
        self.assertEqual(private_card.status_code, 403)


if __name__ == '__main__':
    unittest.main()
