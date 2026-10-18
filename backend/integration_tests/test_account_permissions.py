"""Real bearer authentication and MongoDB CAS; only UUID-owned synthetic databases."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import os
import re
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pymongo import MongoClient

from app.api.router import api_router
from app.services.authentication import _password_hash
from app.services.observability import configure_observability


class RealAccountPermissionTests(unittest.TestCase):
    def setUp(self):
        self.original_database = os.environ.get('MONGODB_DATABASE', 'pesc_mate')
        self.name = 'pesc_mate_account_test_' + uuid4().hex
        self.mongo = MongoClient(os.environ.get('MONGODB_URI', 'mongodb://127.0.0.1:27017'), serverSelectionTimeoutMS=3000)
        self.addCleanup(self.mongo.close)
        self.addCleanup(self.drop_owned_database)
        self.db = self.mongo[self.name]
        environment = patch.dict(os.environ, MONGODB_DATABASE=self.name, DEMO_ACCOUNTS_ENABLED='false',
                                 ACCOUNT_PERMISSION_MANAGER_IDS='manager', LOGIN_MAX_FAILURES='2')
        environment.start()
        self.addCleanup(environment.stop)
        connection = patch('app.services.database.client', return_value=self.mongo)
        connection.start()
        self.addCleanup(connection.stop)
        app = FastAPI()
        configure_observability(app)
        app.include_router(api_router, prefix='/api')
        self.http = TestClient(app)
        self.addCleanup(self.http.close)
        self.headers = {}
        salt, digest = _password_hash('Synthetic-password-123')
        for identity, role in (('manager', 'support_staff'), ('staff', 'support_staff'),
                               ('operator', 'support_staff'), ('child', 'user'), ('guardian', 'caregiver')):
            self.db.users.insert_one({'_id': identity, 'username': identity, 'name': '합성 계정', 'role': role,
                                      'password_salt': salt, 'password_hash': digest,
                                      'account_permissions': ['content_manage'] if identity == 'operator' else []})
            self.headers[identity] = self.session(identity)

    def drop_owned_database(self):
        if not re.fullmatch(r'pesc_mate_account_test_[a-f0-9]{32}', self.name) or self.name == self.original_database:
            raise RuntimeError('Refusing unsafe account fixture cleanup')
        self.mongo.drop_database(self.name)

    def session(self, identity, revision=None):
        token = 'synthetic-' + uuid4().hex
        doc = {'_id': hashlib.sha256(token.encode()).hexdigest(), 'user_id': identity,
               'expires_at': datetime.now(timezone.utc) + timedelta(hours=1)}
        if revision is not None:
            doc['permission_revision'] = revision
        self.db.auth_sessions.insert_one(doc)
        return {'Authorization': 'Bearer ' + token}

    def change(self, enabled=True, revision=0, target='staff', actor='manager', **extra):
        return self.http.put(f'/api/admin/accounts/{target}/content-permission', headers=self.headers[actor], json={
            'content_manage': enabled, 'expected_revision': revision, 'reason': '합성 권한 검증',
            'password': 'Synthetic-password-123', **extra})

    def test_only_configured_custodian_can_lookup_change_and_read_audit(self):
        for actor in ('operator', 'staff', 'child', 'guardian'):
            headers = self.headers[actor]
            self.assertEqual(self.http.get('/api/admin/accounts/lookup?username=staff', headers=headers).status_code, 403)
            self.assertEqual(self.http.get('/api/admin/accounts/staff/permission-audit', headers=headers).status_code, 403)
            self.assertEqual(self.change(actor=actor).status_code, 403)
        self.assertEqual(self.db.account_permission_audit_logs.count_documents({}), 0)
        with patch.dict(os.environ, ACCOUNT_PERMISSION_MANAGER_IDS=''):
            self.assertEqual(self.change().status_code, 403)
        self.assertEqual(self.http.get('/api/admin/accounts/lookup?username=staff').status_code, 401)

    def test_lookup_excludes_children_caregivers_profiles_and_secrets(self):
        for username in ('child', 'guardian', 'unknown'):
            self.assertEqual(self.http.get('/api/admin/accounts/lookup', params={'username': username}, headers=self.headers['manager']).status_code, 404)
        response = self.http.get('/api/admin/accounts/lookup?username=staff', headers=self.headers['manager'])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(set(response.json()), {'id', 'username', 'name', 'content_manage', 'permission_revision'})
        me = self.http.get('/api/auth/me', headers=self.headers['manager']).json()
        self.assertTrue(me['can_manage_account_permissions'])
        self.assertEqual(me['account_permissions'], [])

    def test_grant_revoke_and_regrant_invalidate_every_old_session_but_not_other_accounts(self):
        second_old_session = self.session('staff')
        self.assertEqual(self.change().status_code, 200)
        for headers in (self.headers['staff'], second_old_session):
            self.assertEqual(self.http.get('/api/auth/me', headers=headers).status_code, 401)
        login = self.http.post('/api/auth/login', json={'username': 'staff', 'password': 'Synthetic-password-123'})
        self.assertEqual(login.status_code, 200)
        fresh = {'Authorization': 'Bearer ' + login.json()['access_token']}
        self.assertEqual(self.http.get('/api/admin/categories', headers=fresh).status_code, 200)
        self.assertEqual(self.change(False, 1).status_code, 200)
        self.assertEqual(self.http.get('/api/admin/categories', headers=fresh).status_code, 401)
        self.assertEqual(self.change(True, 2).status_code, 200)
        self.assertEqual(self.http.get('/api/auth/me', headers=fresh).status_code, 401)
        self.assertEqual(self.http.get('/api/auth/me', headers=self.headers['child']).status_code, 200)
        audit = self.http.get('/api/admin/accounts/staff/permission-audit', headers=self.headers['manager'])
        self.assertEqual(audit.status_code, 200)
        self.assertEqual(len(audit.json()), 3)
        self.assertEqual({row['status'] for row in audit.json()}, {'applied'})
        self.assertNotIn('Synthetic-password', audit.text)
        self.assertNotIn('password_hash', audit.text)

    def test_stale_revision_and_same_state_are_not_silent_overwrites(self):
        noop = self.change(False).json()
        self.assertFalse(noop['changed'])
        self.assertEqual(self.db.account_permission_audit_logs.count_documents({}), 0)
        self.assertEqual(self.change().status_code, 200)
        self.assertEqual(self.change(False, 0).status_code, 409)
        self.assertEqual(self.db.users.find_one({'_id': 'staff'})['permission_revision'], 1)

    def test_two_simultaneous_grants_with_same_revision_only_apply_once(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda _: self.change(), range(2)))
        self.assertEqual(sorted(response.status_code for response in responses), [200, 409])
        stored = self.db.users.find_one({'_id': 'staff'})
        self.assertEqual(stored['permission_revision'], 1)
        applied = list(self.db.account_permission_audit_logs.find({'status': 'applied'}))
        self.assertEqual(len(applied), 1)
        self.assertEqual(stored['last_account_permission_change'], applied[0]['_id'])

    def test_wrong_password_is_throttled_without_mutation_and_secret_is_not_echoed(self):
        for _ in range(2):
            response = self.change(password='secret-wrong-password')
            self.assertEqual(response.status_code, 403)
            self.assertNotIn('secret-wrong-password', response.text)
        self.assertEqual(self.change().status_code, 429)
        self.assertEqual(self.db.account_permission_audit_logs.count_documents({}), 0)
        self.assertEqual(self.db.users.find_one({'_id': 'staff'})['account_permissions'], [])

    def test_strict_input_and_non_staff_targets_cannot_gain_permissions(self):
        for extra in ({'reason': '   '}, {'expected_revision': True}, {'expected_revision': -1},
                      {'content_manage': 'true'}, {'account_permissions': ['content_manage']}, {'password': ''}):
            response = self.change(**extra)
            self.assertEqual(response.status_code, 422, response.text)
            self.assertNotIn('Synthetic-password', response.text)
        for target in ('child', 'guardian', 'missing'):
            self.assertEqual(self.change(target=target).status_code, 404)
        self.assertEqual(self.db.account_permission_audit_logs.count_documents({}), 0)

    def test_actual_legacy_demo_seeding_does_not_restore_revoked_permission(self):
        from app.services.authentication import _ensure_user
        self.assertEqual(self.change(False, target='operator').status_code, 200)
        _ensure_user('operator', 'unused-password', '합성 운영자', 'support_staff', ['content_manage'])
        user = self.db.users.find_one({'_id': 'operator'})
        self.assertEqual(user['account_permissions'], [])
        self.assertEqual(user['permission_revision'], 1)
