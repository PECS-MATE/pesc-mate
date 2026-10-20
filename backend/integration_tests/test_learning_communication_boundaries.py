"""Real authenticated HTTP routes + MongoDB, isolated in each test's UUID database."""
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
from app.services.observability import configure_observability


class RealLearningCommunicationBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.original_database = os.environ.get('MONGODB_DATABASE', 'pesc_mate')
        self.name = 'pesc_mate_boundary_test_' + uuid4().hex
        self.mongo = MongoClient(os.environ.get('MONGODB_URI', 'mongodb://127.0.0.1:27017'),
                                 serverSelectionTimeoutMS=3000)
        self.addCleanup(self.mongo.close)
        self.addCleanup(self.drop_owned_database)
        self.database = self.mongo[self.name]
        environment = patch.dict(os.environ, MONGODB_DATABASE=self.name, OLLAMA_ENABLED='false',
                                 DEMO_ACCOUNTS_ENABLED='false')
        environment.start()
        self.addCleanup(environment.stop)
        # Every imported database() alias resolves through this shared client function.
        connection = patch('app.services.database.client', return_value=self.mongo)
        connection.start()
        self.addCleanup(connection.stop)
        application = FastAPI()  # No main lifespan, seed, or background index worker.
        configure_observability(application)
        application.include_router(api_router, prefix='/api')
        self.http = TestClient(application)
        self.addCleanup(self.http.close)
        self.headers = {}
        for user_id, role in (('child-a', 'user'), ('child-b', 'user'),
                              ('guardian', 'caregiver'), ('staff', 'support_staff'),
                              ('operator', 'support_staff')):
            self.database.users.insert_one({'_id': user_id, 'username': user_id,
                                            'name': '합성 계정 ' + user_id, 'role': role,
                                            'account_permissions': ['content_manage'] if user_id == 'operator' else []})
            token = 'synthetic-' + uuid4().hex
            self.database.auth_sessions.insert_one({'_id': hashlib.sha256(token.encode()).hexdigest(),
                'user_id': user_id, 'expires_at': datetime.now(timezone.utc) + timedelta(hours=1)})
            self.headers[user_id] = {'Authorization': 'Bearer ' + token}
        for user_id in ('child-a', 'child-b'):
            self.database.privacy_settings.insert_one({'_id': user_id, 'guardian_consent': True})
        for actor in ('guardian', 'staff'):
            self.set_permissions(actor, ['records_read', 'learning_manage', 'notes_write'])

    def drop_owned_database(self):
        if (not re.fullmatch(r'pesc_mate_boundary_test_[a-f0-9]{32}', self.name)
                or self.name == self.original_database):
            raise RuntimeError('Refusing unsafe boundary fixture cleanup')
        self.mongo.drop_database(self.name)

    def set_permissions(self, actor, permissions, active=True):
        self.database.caregiver_links.replace_one({'_id': actor + ':child-a'}, {
            '_id': actor + ':child-a', 'supporter_id': actor, 'user_id': 'child-a',
            'permissions': permissions, 'active': active,
        }, upsert=True)

    def request(self, method, path, *, actor='child-a', expected=200, **kwargs):
        headers = self.headers[actor] | kwargs.pop('headers', {})
        response = self.http.request(method, '/api' + path, headers=headers, **kwargs)
        self.assertEqual(response.status_code, expected, (method, path, response.text))
        return response.json() if response.content else None

    def attempt(self, request_id=None, **extra):
        return {'request_id': request_id or str(uuid4()), 'activity_type': 'word_picture_match',
                'category_id': 'food', 'total_questions': 1, 'correct_answers': 0,
                'duration_seconds': 4, 'items': [{'card_id': 'apple', 'label': '사과',
                                               'first_try_correct': False}], **extra}

    def sentence(self, request_id=None, **extra):
        return {'request_id': request_id or str(uuid4()), 'cards': ['help'], **extra}

    def test_each_domain_write_leaves_other_statistics_recommendations_and_history_unchanged(self):
        dashboard = self.request('GET', '/dashboard')
        recommendations = self.request('GET', '/recommendations')
        attempt = self.attempt()
        self.request('POST', '/learning/attempts', json=attempt, expected=201)
        progress = self.request('GET', '/learning/progress')
        self.assertEqual(progress['attempts'], 1)
        self.assertEqual(progress['repeat_words'][0]['card_id'], 'apple')
        self.assertEqual(self.request('GET', '/dashboard'), dashboard)
        self.assertEqual(self.request('GET', '/recommendations'), recommendations)
        self.assertEqual(self.database.communication_sessions.count_documents({}), 0)
        result = self.request('POST', '/sentences', json=self.sentence())
        self.assertEqual(self.request('GET', '/learning/progress'), progress)
        dashboard = self.request('GET', '/dashboard')
        self.assertEqual((dashboard['sessions'], dashboard['selections']), (1, 1))
        self.assertEqual(dashboard['top_cards'][0]['id'], 'help')
        self.assertEqual([row['id'] for row in dashboard['recent']], [result['id']])
        self.assertEqual(self.request('GET', '/recommendations')[0]['id'], 'help')
        stored = self.database.learning_attempts.find_one()
        self.assertEqual(stored['record_type'], 'learning_attempt')
        self.assertEqual(stored['score'], 0)
        self.assertFalse({'cards', 'sentence', 'generation'} & stored.keys())
        stored = self.database.communication_sessions.find_one()
        self.assertFalse({'score', 'items', 'activity_type', 'correct_answers'} & stored.keys())

    def test_same_uuid_is_independent_across_domains_and_replays_do_not_duplicate(self):
        identity = str(uuid4())
        learning = self.attempt(identity)
        sentence = self.sentence(identity)
        event = {'events': [{'id': identity, 'event_type': 'immediate_speech', 'card_ids': ['water'],
                             'occurred_at': datetime.now(timezone.utc).isoformat()}]}
        for replay in range(2):
            headers = {'X-Pesc-Offline-Sync': 'true', 'X-Pesc-Sync-Retried': '1'} if replay else {}
            self.request('POST', '/learning/attempts', json=learning, expected=201, headers=headers)
            self.request('POST', '/sentences', json=sentence)
            self.assertEqual(self.request('POST', '/offline/events/sync', json=event)['accepted_ids'], [identity])
        for collection in ('learning_attempts', 'communication_sessions', 'offline_events'):
            self.assertEqual(self.database[collection].count_documents({}), 1)
            self.assertEqual(self.database[collection].find_one()['_id'], identity)
        self.assertEqual(self.request('GET', '/dashboard')['sessions'], 1)
        self.assertEqual(self.request('GET', '/learning/progress')['attempts'], 1)
        metrics = {row['kind']: row for row in self.http.app.state.offline_sync_metrics.snapshot()['by_kind']}
        self.assertEqual((metrics['learning']['inserted'], metrics['learning']['duplicates'],
                          metrics['learning']['retried']), (0, 1, 1))
        self.assertEqual((metrics['communication']['inserted'], metrics['communication']['duplicates']), (1, 1))

    def test_learning_store_failure_does_not_block_communication_or_change_learning_data(self):
        with patch('app.services.learning._database', side_effect=PyMongoError('synthetic learning failure')):
            self.request('GET', '/learning/progress', expected=503)
            self.request('POST', '/learning/attempts', json=self.attempt(), expected=503)
            self.request('POST', '/sentences', json=self.sentence())
            self.assertEqual(self.request('GET', '/dashboard')['sessions'], 1)
        self.assertEqual(self.database.learning_attempts.count_documents({}), 0)
        self.assertEqual(self.request('GET', '/learning/progress')['attempts'], 0)

    def test_other_child_cannot_reuse_owned_uuid_or_read_either_domain(self):
        identity = str(uuid4())
        learning = self.attempt(identity)
        sentence = self.sentence(identity)
        self.request('POST', '/learning/attempts', json=learning, expected=201)
        self.request('POST', '/sentences', json=sentence)
        originals = {name: list(self.database[name].find({})) for name in
                     ('communication_sessions', 'learning_attempts')}
        self.request('POST', '/learning/attempts', json=learning, actor='child-b', expected=409)
        self.request('POST', '/sentences', json=sentence, actor='child-b', expected=409)
        for path in ('/dashboard', '/learning/progress', '/learning/settings', '/learning/audit'):
            self.request('GET', path + '?user_id=child-a', actor='child-b', expected=403)
        self.assertEqual(self.request('GET', '/dashboard', actor='child-b')['sessions'], 0)
        self.assertEqual(self.request('GET', '/learning/progress', actor='child-b')['attempts'], 0)
        for name, rows in originals.items():
            self.assertEqual(list(self.database[name].find({})), rows)

    def test_cross_payloads_are_rejected_and_extra_fields_cannot_change_domain_or_owner(self):
        self.request('POST', '/sentences', json=self.attempt(), expected=422)
        self.request('POST', '/learning/attempts', json=self.sentence(), expected=422)
        self.request('POST', '/learning/attempts', json=self.attempt(activity_type='communication'), expected=422)
        self.assertEqual(self.database.learning_attempts.count_documents({}), 0)
        self.assertEqual(self.database.communication_sessions.count_documents({}), 0)
        result = self.request('POST', '/learning/attempts', expected=201,
            json=self.attempt(user_id='child-b', record_type='communication_session', score=100,
                              cards=['help'], sentence='ignored'))
        self.assertEqual((result['user_id'], result['score']), ('child-a', 0))
        stored = self.database.learning_attempts.find_one()
        self.assertEqual(stored['record_type'], 'learning_attempt')
        self.assertNotIn('sentence', stored)
        result = self.request('POST', '/sentences', json=self.sentence(user_id='child-b', score=100, items=[]))
        self.assertEqual(result['user_id'], 'child-a')
        self.assertNotIn('score', self.database.communication_sessions.find_one())

    def test_records_and_learning_permissions_are_independent_for_both_support_roles(self):
        self.request('POST', '/learning/attempts', json=self.attempt(), expected=201)
        self.request('POST', '/sentences', json=self.sentence())
        settings = {'category_ids': ['food'], 'question_count': 5, 'option_count': 3,
                    'repeat_frequency': 1, 'time_limit_seconds': 60, 'retry_enabled': True}
        for actor in ('guardian', 'staff'):
            with self.subTest(actor=actor):
                self.set_permissions(actor, ['records_read'])
                self.assertEqual(self.request('GET', '/dashboard?user_id=child-a', actor=actor)['sessions'], 1)
                for path in ('/learning/progress', '/learning/settings', '/learning/audit'):
                    self.request('GET', path + '?user_id=child-a', actor=actor, expected=403)
                self.request('PUT', '/learning/settings?user_id=child-a', json=settings, actor=actor, expected=403)
                self.assertEqual(self.database.learning_settings.count_documents({'_id': 'child-a'}), 0 if actor == 'guardian' else 1)
                self.set_permissions(actor, ['learning_manage'])
                self.request('GET', '/dashboard?user_id=child-a', actor=actor, expected=403)
                for path in ('/learning/progress', '/learning/settings', '/learning/audit'):
                    self.request('GET', path + '?user_id=child-a', actor=actor)
                self.assertEqual(self.request('GET', '/learning/progress?user_id=child-a', actor=actor)['attempts'], 1)
                self.request('PUT', '/learning/settings?user_id=child-a', json=settings, actor=actor)
                self.request('POST', '/learning/attempts', json=self.attempt(), actor=actor, expected=403)
                self.request('POST', '/sentences', json=self.sentence(), actor=actor, expected=403)
        self.assertEqual(self.database.learning_attempts.count_documents({}), 1)
        self.assertEqual(self.database.communication_sessions.count_documents({}), 1)
        self.assertEqual(self.database.learning_audit_logs.count_documents({}), 2)

    def test_revoked_link_and_content_operator_cannot_bypass_domain_permissions(self):
        self.set_permissions('staff', ['records_read', 'learning_manage'], active=False)
        for actor in ('staff', 'operator'):
            for path in ('/dashboard', '/learning/progress', '/learning/settings', '/learning/audit'):
                # Dashboard hides absence of any linked children as 404; learning returns 403.
                self.request('GET', path + '?user_id=child-a', actor=actor,
                             expected=404 if path == '/dashboard' else 403)

    def test_learning_object_id_is_not_a_communication_session_for_notes_or_regeneration(self):
        identity = str(uuid4())
        self.request('POST', '/learning/attempts', json=self.attempt(identity), expected=201)
        before = self.database.learning_attempts.find_one()
        self.request('POST', '/sentences/' + identity + '/regenerate',
                     json={'request_id': str(uuid4())}, expected=404)
        self.request('PUT', '/care/notes/' + identity, actor='staff',
                     json={'user_id': 'child-a', 'content': '합성 메모'}, expected=404)
        self.request('DELETE', '/care/notes/' + identity + '?user_id=child-a', actor='staff', expected=404)
        self.assertEqual(self.database.caregiver_notes.count_documents({}), 0)
        sentence = self.request('POST', '/sentences', json=self.sentence())
        self.request('PUT', '/care/notes/' + sentence['id'], actor='staff',
                     json={'user_id': 'child-a', 'content': '합성 의사소통 메모'})
        regenerated = self.request('POST', '/sentences/' + sentence['id'] + '/regenerate',
                                   json={'request_id': str(uuid4())})
        self.assertEqual(regenerated['regeneration_of'], sentence['id'])
        self.assertEqual(self.database.learning_attempts.find_one(), before)

    def test_consent_gate_blocks_both_writes_and_offline_sync_without_any_domain_records(self):
        self.database.privacy_settings.update_one({'_id': 'child-a'}, {'$set': {'guardian_consent': False}})
        self.request('POST', '/learning/attempts', json=self.attempt(), expected=403)
        self.request('POST', '/sentences', json=self.sentence(), expected=403)
        event = {'events': [{'id': str(uuid4()), 'event_type': 'immediate_speech', 'card_ids': ['help'],
                             'occurred_at': datetime.now(timezone.utc).isoformat()}]}
        self.request('POST', '/offline/events/sync', json=event, expected=403)
        for name in ('communication_sessions', 'learning_attempts', 'offline_events'):
            self.assertEqual(self.database[name].count_documents({}), 0)

    def test_date_filters_use_domain_timestamp_and_learning_record_type(self):
        communication_id, learning_id = str(uuid4()), str(uuid4())
        self.request('POST', '/sentences', json=self.sentence(communication_id))
        self.request('POST', '/learning/attempts', json=self.attempt(learning_id), expected=201)
        old = datetime.now(timezone.utc) - timedelta(days=40)
        self.database.communication_sessions.update_one({'_id': communication_id}, {'$set': {'created_at': old}})
        self.database.learning_attempts.update_one({'_id': learning_id}, {'$set': {'completed_at': old}})
        # A foreign record type inside the learning collection is not a learning result.
        self.database.learning_attempts.insert_one({'_id': str(uuid4()), 'user_id': 'child-a',
            'record_type': 'communication_session', 'completed_at': datetime.now(timezone.utc)})
        self.assertEqual(self.request('GET', '/dashboard?days=7')['sessions'], 0)
        self.assertEqual(self.request('GET', '/learning/progress?days=7')['attempts'], 0)
        self.assertEqual(self.request('GET', '/dashboard')['sessions'], 1)
        self.assertEqual(self.request('GET', '/learning/progress')['attempts'], 1)

    def test_personal_export_and_deletion_keep_domain_keys_separate_and_other_child_intact(self):
        for actor in ('child-a', 'child-b'):
            self.request('POST', '/sentences', json=self.sentence(), actor=actor)
            self.request('POST', '/learning/attempts', json=self.attempt(), actor=actor, expected=201)
        other = {name: list(self.database[name].find({'user_id': 'child-b'})) for name in
                 ('communication_sessions', 'learning_attempts')}
        exported = self.request('GET', '/privacy/export')
        for key in other:
            self.assertEqual(len(exported[key]), 1)
            self.assertEqual(exported[key][0]['user_id'], 'child-a')
        self.assertIn('sentence', exported['communication_sessions'][0])
        self.assertNotIn('score', exported['communication_sessions'][0])
        self.assertEqual(exported['learning_attempts'][0]['record_type'], 'learning_attempt')
        self.assertNotIn('sentence', exported['learning_attempts'][0])
        self.request('DELETE', '/privacy/data', json={'confirmation': 'DELETE'})
        for name, rows in other.items():
            self.assertEqual(self.database[name].count_documents({'user_id': 'child-a'}), 0)
            self.assertEqual(list(self.database[name].find({'user_id': 'child-b'})), rows)


if __name__ == '__main__':
    unittest.main()
