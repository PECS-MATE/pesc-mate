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
from pymongo.errors import PyMongoError

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

    def access(self, active=True, deadline=None, revision=0, target='staff', actor='manager', **extra):
        return self.http.put(f'/api/admin/accounts/{target}/access', headers=self.headers[actor], json={
            'account_active': active, 'access_expires_at': deadline, 'expected_revision': revision,
            'reason': '합성 접근 검증', 'password': 'Synthetic-password-123', **extra})

    def login(self):
        return self.http.post('/api/auth/login', json={'username': 'staff', 'password': 'Synthetic-password-123'})

    def content_operation(self, kind, actor='operator', password='Synthetic-password-123', **extra):
        fields = {} if password is None else {'password': password}
        if kind == 'create':
            return self.http.post('/api/admin/categories', headers=self.headers[actor],
                                  json={'name': '합성 카테고리', 'display_order': 20, **fields, **extra})
        if kind == 'update':
            return self.http.patch('/api/admin/categories/synthetic-category', headers=self.headers[actor],
                                   json={'name': '변경 카테고리', 'display_order': 21, 'active': False, **fields, **extra})
        return self.http.patch('/api/admin/card-submissions/synthetic-card', headers=self.headers[actor],
                               json={'decision': 'approved', **fields, **extra})

    def content_fixtures(self):
        self.db.card_categories.insert_one({'_id': 'synthetic-category', 'name': '합성 원본', 'display_order': 10, 'active': True})
        self.db.card_submissions.insert_one({'_id': 'synthetic-card', 'owner_id': 'child', 'visibility': 'shared',
            'status': 'pending', 'label': '합성 카드', 'meaning': '재인증 검증', 'category': '합성 원본',
            'image': {'filename': 'synthetic.webp', 'content_type': 'image/webp'}, 'created_at': datetime.now(timezone.utc)})

    def assert_content_unchanged(self):
        self.assertEqual(self.db.card_categories.count_documents({}), 1)
        self.assertEqual(self.db.card_categories.find_one({'_id': 'synthetic-category'})['name'], '합성 원본')
        self.assertEqual(self.db.card_submissions.find_one({'_id': 'synthetic-card'})['status'], 'pending')
        self.assertEqual(self.db.card_audit_logs.count_documents({}), 0)

    def test_content_mutations_each_require_password_even_after_successful_verification(self):
        self.content_fixtures()
        for kind in ('create', 'update', 'review'):
            self.assertEqual(self.content_operation(kind, password=None).status_code, 422)
            response = self.content_operation(kind)
            self.assertIn(response.status_code, (200, 201), response.text)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertNotIn('password', response.text)
            self.assertEqual(self.content_operation(kind, password=None).status_code, 422)
        audit = self.db.card_audit_logs.find_one({'card_submission_id': 'synthetic-card'})
        self.assertEqual(audit['actor_id'], 'operator')
        self.assertNotIn('Synthetic-password', str(audit))

    def test_wrong_content_password_is_shared_across_operations_and_never_mutates_content(self):
        self.content_fixtures()
        for kind in ('create', 'update'):
            response = self.content_operation(kind, password='private-wrong-password')
            self.assertEqual(response.status_code, 403, response.text)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertNotIn('private-wrong-password', response.text)
        self.assertEqual(self.content_operation('review').status_code, 429)
        self.assert_content_unchanged()

    def test_content_unauthorized_roles_and_invalid_input_cannot_bypass_verification(self):
        self.content_fixtures()
        for actor in ('manager', 'staff', 'child', 'guardian'):
            for kind in ('create', 'update', 'review'):
                self.assertEqual(self.content_operation(kind, actor=actor).status_code, 403)
        for fields in ({'password': ''}, {'password': 'x' * 129}, {'password': True}, {'extra_permission': True}):
            response = self.content_operation('create', **fields)
            self.assertEqual(response.status_code, 422, response.text)
            self.assertNotIn('Synthetic-password', response.text)
        self.assert_content_unchanged()

    def test_successful_content_password_resets_failures_but_never_grants_new_permissions(self):
        self.content_fixtures()
        self.assertEqual(self.content_operation('create', password='wrong-one').status_code, 403)
        self.assertEqual(self.content_operation('update').status_code, 200)
        self.assertEqual(self.content_operation('review', password='wrong-two').status_code, 403)
        self.assertEqual(self.content_operation('review').status_code, 200)
        self.assertEqual(self.db.users.find_one({'_id': 'operator'})['account_permissions'], ['content_manage'])
        self.assertEqual(self.db.auth_sessions.count_documents({'user_id': 'operator'}), 1)
        self.assertEqual(self.change(False, target='operator').status_code, 200)
        self.assertEqual(self.content_operation('create').status_code, 401)

    def test_content_reauthentication_store_failure_stops_before_all_content_writes(self):
        self.content_fixtures()
        with patch('app.services.reauthentication._database', side_effect=PyMongoError('private-store-error')):
            for kind in ('create', 'update', 'review'):
                response = self.content_operation(kind)
                self.assertEqual(response.status_code, 503)
                self.assertNotIn('private-store-error', response.text)
        self.assert_content_unchanged()

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
        self.assertEqual(set(response.json()), {'id', 'username', 'name', 'content_manage', 'permission_revision',
                                                'account_active', 'access_expires_at', 'access_protected'})
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

    def test_disable_blocks_login_all_existing_sessions_and_protected_routes_without_deleting_links(self):
        second = self.session('staff')
        self.db.caregiver_links.insert_one({'_id': 'synthetic-link', 'supporter_id': 'staff', 'user_id': 'child', 'active': True})
        response = self.access(False)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()['account_active'])
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(self.login().status_code, 401)
        for headers in (self.headers['staff'], second):
            for path in ('/api/auth/me', '/api/care/linked-users', '/api/dashboard?user_id=child', '/api/admin/categories'):
                self.assertEqual(self.http.get(path, headers=headers).status_code, 401, path)
        self.assertEqual(self.db.caregiver_links.count_documents({'_id': 'synthetic-link', 'active': True}), 1)
        for identity in ('manager', 'child', 'guardian'):
            self.assertEqual(self.http.get('/api/auth/me', headers=self.headers[identity]).status_code, 200)
        audit = self.http.get('/api/admin/accounts/staff/permission-audit', headers=self.headers['manager']).json()[0]
        self.assertEqual(audit['action'], 'account_access')
        self.assertEqual(audit['before'], {'account_active': True, 'access_expires_at': None})
        self.assertEqual(audit['after'], {'account_active': False, 'access_expires_at': None})
        self.assertEqual(audit['status'], 'applied')
        self.assertNotIn('Synthetic-password', str(audit))

    def test_reactivation_requires_new_login_and_never_revives_old_tokens(self):
        self.assertEqual(self.access(False).status_code, 200)
        self.assertEqual(self.change().status_code, 409)  # stale revision
        self.assertEqual(self.change(revision=1).status_code, 409)  # disabled grant
        self.assertEqual(self.access(True, revision=1).status_code, 200)
        self.assertEqual(self.http.get('/api/auth/me', headers=self.headers['staff']).status_code, 401)
        login = self.login()
        self.assertEqual(login.status_code, 200, login.text)
        fresh = {'Authorization': 'Bearer ' + login.json()['access_token']}
        self.assertEqual(self.http.get('/api/auth/me', headers=fresh).status_code, 200)
        self.assertEqual(self.db.users.find_one({'_id': 'staff'})['account_permissions'], [])

    def test_deadline_is_utc_caps_new_sessions_and_blocks_legacy_long_sessions_at_boundary(self):
        deadline = (datetime.now(timezone.utc) + timedelta(minutes=10)).replace(microsecond=123000)
        local = deadline.astimezone(timezone(timedelta(hours=9))).isoformat()
        response = self.access(deadline=local)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(datetime.fromisoformat(response.json()['access_expires_at']), deadline)
        login = self.login()
        self.assertEqual(login.status_code, 200, login.text)
        self.assertEqual(datetime.fromisoformat(login.json()['expires_at']), deadline)
        stored = self.db.auth_sessions.find_one({'_id': hashlib.sha256(login.json()['access_token'].encode()).hexdigest()})
        self.assertEqual(stored['expires_at'].replace(tzinfo=timezone.utc), deadline)
        legacy_long_session = self.session('staff', revision=1)
        self.assertEqual(self.http.get('/api/auth/me', headers=legacy_long_session).status_code, 200)
        with patch('app.services.account_access.utc_now', return_value=deadline):
            self.assertEqual(self.http.get('/api/auth/me', headers=legacy_long_session).status_code, 401)
            self.assertEqual(self.login().status_code, 401)
        # Clearing the deadline advances the same revision; no old token comes back.
        self.assertEqual(self.access(revision=1).status_code, 200)
        self.assertEqual(self.http.get('/api/auth/me', headers=legacy_long_session).status_code, 401)
        self.assertEqual(self.login().status_code, 200)
        self.assertIsNone(self.db.users.find_one({'_id': 'staff'})['access_expires_at'])

    def test_access_noop_stale_revision_and_content_access_race(self):
        self.assertFalse(self.access().json()['changed'])
        self.assertEqual(self.db.account_permission_audit_logs.count_documents({}), 0)
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda operation: operation(), [lambda: self.change(), lambda: self.access(False)]))
        self.assertEqual(sorted(response.status_code for response in responses), [200, 409])
        self.assertEqual(self.access(revision=0).status_code, 409)
        self.assertEqual(self.db.users.find_one({'_id': 'staff'})['permission_revision'], 1)
        self.assertEqual(self.db.account_permission_audit_logs.count_documents({'status': 'applied'}), 1)

    def test_access_is_staff_only_and_configured_managers_cannot_be_locked(self):
        for actor in ('operator', 'staff', 'child', 'guardian'):
            self.assertEqual(self.access(False, actor=actor).status_code, 403)
        for target in ('child', 'guardian', 'missing'):
            self.assertEqual(self.access(False, target=target).status_code, 404)
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        with patch.dict(os.environ, ACCOUNT_PERMISSION_MANAGER_IDS='manager, operator'):
            for target in ('manager', 'operator'):
                self.assertEqual(self.access(False, target=target).status_code, 409)
                self.assertEqual(self.access(deadline=future, target=target).status_code, 409)
                lookup = self.http.get('/api/admin/accounts/lookup', params={'username': target}, headers=self.headers['manager'])
                self.assertTrue(lookup.json()['access_protected'])
        self.assertEqual(self.db.account_permission_audit_logs.count_documents({}), 0)

    def test_access_rejects_ambiguous_past_dates_and_coerced_or_unexpected_fields(self):
        for extra in ({'account_active': 'false'}, {'expected_revision': True}, {'expected_revision': -1},
                      {'access_expires_at': '2030-01-01T00:00:00'}, {'access_expires_at': '2000-01-01T00:00:00Z'},
                      {'access_expires_at': 'invalid'}, {'reason': '   '}, {'password': ''}, {'content_manage': True}):
            response = self.access(**extra)
            self.assertEqual(response.status_code, 422, response.text)
            self.assertNotIn('Synthetic-password', response.text)
        response = self.http.put('/api/admin/accounts/staff/access', headers=self.headers['manager'], json={
            'account_active': True, 'expected_revision': 0, 'password': 'Synthetic-password-123', 'reason': '합성 검증'})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.db.account_permission_audit_logs.count_documents({}), 0)

    def test_access_requires_reauthentication_and_demo_seed_does_not_restore_disabled_account(self):
        from app.services.authentication import _ensure_user
        self.assertEqual(self.access(False, password='wrong-password').status_code, 403)
        self.assertEqual(self.db.account_permission_audit_logs.count_documents({}), 0)
        deadline = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        self.assertEqual(self.access(False, deadline=deadline, target='operator').status_code, 200)
        _ensure_user('operator', 'unused-password', '합성 운영자', 'support_staff', ['content_manage'])
        stored = self.db.users.find_one({'_id': 'operator'})
        self.assertFalse(stored['account_active'])
        self.assertIsNotNone(stored['access_expires_at'])
        self.assertEqual(stored['account_permissions'], ['content_manage'])
        self.assertEqual(stored['permission_revision'], 1)
