"""Run ONLY in the UUID-owned authenticated validation stack, never a real database."""
import json
import os
from pathlib import Path
import re
import unittest
from urllib.request import Request, urlopen
from uuid import uuid4

from pymongo import MongoClient
from pymongo.errors import OperationFailure

from app.services.database import database
from app.services.database_config import connection_options
from app.services.indexes import INDEXES, ensure_indexes


class AuthenticatedMongoDBTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        name = os.environ.get('MONGODB_DATABASE', '')
        if not re.fullmatch(r'pesc_mate_auth_test_[a-f0-9]{32}', name):
            raise RuntimeError('Refusing authenticated fixture writes outside the owned test database')
        cls.db = database()
        cls.options = connection_options()

    def denied(self, action):
        with self.assertRaises(OperationFailure) as caught:
            action()
        self.assertEqual(caught.exception.code, 13)

    def test_application_has_exactly_one_database_scoped_readwrite_role(self):
        state = self.db.command('connectionStatus')['authInfo']
        self.assertEqual(state['authenticatedUserRoles'], [{'role': 'readWrite', 'db': self.db.name}])
        self.assertEqual(len(state['authenticatedUsers']), 1)
        self.assertEqual(state['authenticatedUsers'][0]['db'], self.db.name)

    def test_application_crud_and_all_required_indexes_work(self):
        self.assertEqual(ensure_indexes(), len(INDEXES))
        identity = 'synthetic-' + uuid4().hex
        self.db.security_fixture.insert_one({'_id': identity, 'value': 'synthetic'})
        self.assertEqual(self.db.security_fixture.find_one({'_id': identity})['value'], 'synthetic')
        self.assertEqual(self.db.security_fixture.update_one({'_id': identity}, {'$set': {'value': 'updated'}}).modified_count, 1)
        self.assertEqual(self.db.security_fixture.delete_one({'_id': identity}).deleted_count, 1)
        self.assertIn('username_unique', self.db.users.index_information())
        self.assertIn('session_expiry_ttl', self.db.auth_sessions.index_information())

    def test_anonymous_connection_cannot_read_or_write(self):
        with MongoClient('mongodb', serverSelectionTimeoutMS=3000) as anonymous:
            self.denied(lambda: anonymous[self.db.name].users.find_one({}))
            self.denied(lambda: anonymous[self.db.name].security_fixture.insert_one({'_id': 'anonymous-denied'}))

    def test_wrong_password_is_rejected_without_anonymous_fallback(self):
        with MongoClient(**(self.options | {'password': 'invalid-synthetic-password-' + 'x' * 40}), serverSelectionTimeoutMS=3000) as wrong:
            with self.assertRaises(OperationFailure) as caught:
                wrong[self.db.name].security_fixture.find_one({})
            self.assertEqual(caught.exception.code, 18)

    def test_other_database_and_admin_user_management_are_denied(self):
        other = self.db.client['pesc_mate_forbidden_test_' + uuid4().hex]
        self.denied(lambda: other.security_fixture.insert_one({'_id': 'cross-db-denied'}))
        self.denied(lambda: self.db.client.admin.command('usersInfo'))
        self.denied(lambda: self.db.command({'createUser': 'forbidden-synthetic-user', 'pwd': 'x' * 40,
                                            'roles': [{'role': 'readWrite', 'db': self.db.name}]}))

    def test_root_credentials_are_not_mounted_in_application_container(self):
        for name in ('mongodb_root_username', 'mongodb_root_password'):
            self.assertFalse(Path('/run/secrets', name).exists())
        self.assertTrue(Path(os.environ['MONGODB_PASSWORD_FILE']).is_file())
        self.assertNotIn('MONGO_INITDB_ROOT_PASSWORD', os.environ)
        self.assertNotIn('MONGODB_URI', os.environ)

    def test_actual_api_registers_and_authenticates_without_demo_accounts(self):
        with urlopen('http://backend:8000/api/health', timeout=10) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(json.load(response)['checks']['mongodb']['status'], 'ok')
        self.assertEqual(self.db.users.count_documents({'username': {'$in': ['demo', 'admin', 'caregiver', 'support']}}), 0)
        body = json.dumps({'username': 'synthetic_' + uuid4().hex[:16], 'name': '합성 인증 검증',
                           'password': 'Synthetic-api-password-123', 'guardian_consent': True}).encode()
        request = Request('http://backend:8000/api/auth/register', data=body, headers={'Content-Type': 'application/json'})
        with urlopen(request, timeout=10) as response:
            self.assertEqual(response.status, 201)
            session = json.load(response)
        request = Request('http://backend:8000/api/auth/me', headers={'Authorization': 'Bearer ' + session['access_token']})
        with urlopen(request, timeout=10) as response:
            self.assertEqual(json.load(response)['id'], session['user']['id'])
