"""Real authenticated HTTP routes + MongoDB, isolated in each test's UUID database."""
from datetime import datetime, timedelta, timezone
import hashlib
import csv
import io
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

    def test_sentence_order_api_preserves_sequence_exports_deduplicates_and_enforces_boundaries(self):
        identity = str(uuid4())
        item = {'card_id': 'drink', 'label': '마시다', 'first_try_correct': True,
                'content_id': 'water-drink', 'card_ids': ['water', 'drink']}
        payload = self.attempt(request_id=identity, activity_type='sentence_card_order',
            content_version='sentence-order-v1', correct_answers=1, items=[item])
        first = self.request('POST', '/learning/attempts', json=payload, expected=201)
        replay = self.request('POST', '/learning/attempts', json=payload, expected=201,
            headers={'X-Pesc-Offline-Sync': 'true', 'X-Pesc-Sync-Retried': '1'})
        self.assertEqual(first, replay)
        self.assertEqual(first['items'], [item])
        self.assertEqual(self.database.learning_attempts.count_documents({'_id': identity}), 1)
        for collection in ('communication_sessions', 'tts_events', 'offline_events'):
            self.assertEqual(self.database[collection].count_documents({}), 0)
        progress = self.request('GET', '/learning/progress', actor='guardian', params={'user_id': 'child-a'})
        self.assertEqual(progress['attempts'], 1)
        self.assertEqual(progress['practicing_words'], [])
        exported = self.request('GET', '/records/export', actor='guardian', params={
            'user_id': 'child-a', 'domain': 'learning', 'format': 'json'})
        self.assertEqual(exported['records'][0]['items'], [item])
        own_export = self.request('GET', '/privacy/export')
        self.assertEqual(own_export['learning_attempts'][0]['items'], [item])
        self.request('POST', '/learning/attempts', json=payload, actor='child-b', expected=409)
        self.request('POST', '/learning/attempts', json=payload, actor='guardian', expected=403)
        self.request('GET', '/learning/progress', actor='operator', params={'user_id': 'child-a'}, expected=403)
        self.request('POST', '/learning/attempts', json=payload | {'content_version': 'sound-picture-v1'}, expected=422)
        self.request('POST', '/learning/attempts', json=payload | {'items': [item | {'card_ids': ['drink', 'drink']}]}, expected=422)
        self.database.privacy_settings.update_one({'_id': 'child-a'}, {'$set': {'guardian_consent': False}})
        self.request('POST', '/learning/attempts', json=payload, expected=403)

    def sentence(self, request_id=None, **extra):
        return {'request_id': request_id or str(uuid4()), 'cards': ['help'], **extra}

    def test_record_download_includes_full_period_and_keeps_domains_and_users_separate(self):
        now = datetime.now(timezone.utc)
        for index in range(12):
            self.database.communication_sessions.insert_one({
                '_id': str(uuid4()), 'user_id': 'child-a', 'created_at': now - timedelta(hours=1),
                'cards': ['water', 'water', 'help'], 'sentence': '합성 문장 ' + str(index),
            })
        old = str(uuid4())
        self.database.communication_sessions.insert_one({
            '_id': old, 'user_id': 'child-a', 'created_at': now - timedelta(days=40),
            'cards': ['no'], 'sentence': '기간 밖 합성 문장',
        })
        self.request('POST', '/sentences', json=self.sentence(), actor='child-b')
        self.request('POST', '/learning/attempts', json=self.attempt(), expected=201)
        recent = self.request('GET', '/dashboard?days=7&user_id=child-a', actor='guardian')
        self.assertEqual(len(recent['recent']), 10)
        self.assertEqual(recent['top_combinations'][0]['count'], 12)
        self.assertEqual([card['id'] for card in recent['recent'][0]['card_details']], ['water', 'water', 'help'])
        exported = self.request('GET', '/records/export?domain=communication&days=7&user_id=child-a', actor='guardian')
        self.assertEqual(exported['count'], 12)
        self.assertNotIn(old, [row['id'] for row in exported['records']])
        self.assertTrue(all(row['speech_status'] == 'unknown' for row in exported['records']))
        all_records = self.request('GET', '/records/export?domain=communication&user_id=child-a', actor='guardian')
        self.assertEqual(all_records['count'], 13)
        learning = self.request('GET', '/records/export?domain=learning&days=30&user_id=child-a', actor='staff')
        self.assertEqual(learning['count'], 1)
        self.assertNotIn('sentence', learning['records'][0])

    def test_download_rechecks_link_and_domain_permissions_for_each_request(self):
        for actor in ('guardian', 'staff'):
            for permission, allowed, blocked in [('records_read', 'communication', 'learning'),
                                                 ('learning_manage', 'learning', 'communication')]:
                self.set_permissions(actor, [permission])
                self.request('GET', f'/records/export?domain={allowed}&user_id=child-a', actor=actor)
                self.request('GET', f'/records/export?domain={blocked}&user_id=child-a', actor=actor, expected=403)
            self.set_permissions(actor, ['records_read', 'learning_manage'], active=False)
            self.request('GET', '/records/export?domain=communication&user_id=child-a', actor=actor, expected=404)
        for actor in ('child-b', 'operator'):
            self.request('GET', '/records/export?domain=communication&user_id=child-a', actor=actor, expected=403 if actor == 'child-b' else 404)

    def test_csv_download_headers_korean_text_and_formula_protection(self):
        self.database.communication_sessions.insert_one({
            '_id': str(uuid4()), 'user_id': 'child-a', 'created_at': datetime.now(timezone.utc),
            'cards': ['water'], 'sentence': '=HYPERLINK("synthetic")',
        })
        response = self.http.get('/api/records/export?domain=communication&format=csv&user_id=child-a',
                                 headers=self.headers['guardian'])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertIn('attachment;', response.headers['content-disposition'])
        rows = list(csv.DictReader(io.StringIO(response.content.decode('utf-8-sig'))))
        self.assertEqual(rows[0]['sentence'], '\'=HYPERLINK("synthetic")')
        self.assertEqual(rows[0]['card_labels'], '["물"]')

    def test_b1_activity_selection_speech_context_and_recovery_keep_permissions_and_exports(self):
        now = datetime.now(timezone.utc) - timedelta(seconds=10)
        identity, stream = str(uuid4()), str(uuid4())
        sentence = self.request('POST', '/sentences', json=self.sentence(cards=['water'], selected_at=[now.isoformat()]))
        events = [
            {'id': identity, 'event_type': 'card_selection', 'card_ids': ['water'], 'sequence': 1},
            {'id': str(uuid4()), 'event_type': 'recovery_speech', 'card_ids': [], 'sequence': 2,
             'recovery_id': 'not_that', 'speech_status': 'succeeded', 'completed_at': now.isoformat()},
            {'id': str(uuid4()), 'event_type': 'speech_result', 'card_ids': ['water'], 'sequence': 3,
             'speech_status': 'succeeded', 'completed_at': now.isoformat(), 'session_id': sentence['id'], 'selection_id': identity},
        ]
        events = [dict(event, occurred_at=now.isoformat(), stream_id=stream, situation='school') for event in events]
        for _ in range(2):
            self.request('POST', '/offline/events/sync', json={'events': events})
        self.assertEqual(self.database.offline_events.count_documents({'user_id': 'child-a'}), 3)
        report = self.request('GET', '/records/activity?user_id=child-a&days=7', actor='guardian')
        self.assertEqual(report['total'], 3)
        self.assertEqual(report['situations'][0]['succeeded'], 2)
        flow = report['recovery_flows'][0]
        self.assertEqual(flow['before']['id'], identity)
        self.assertEqual(flow['after']['session_id'], sentence['id'])
        dashboard = self.request('GET', '/dashboard?user_id=child-a', actor='staff')
        self.assertIsNotNone(dashboard['recent'][0]['card_selected_at'][0])
        self.assertEqual(dashboard['recent'][0]['speech_results'][0]['speech_status'], 'succeeded')
        downloaded = self.request('GET', '/records/export?domain=activity&days=7&user_id=child-a', actor='guardian')
        self.assertEqual(downloaded['count'], 3)
        self.assertFalse(any('content' in row for row in downloaded['records']))
        self.set_permissions('staff', ['learning_manage'])
        self.request('GET', '/records/activity?user_id=child-a', actor='staff', expected=403)
        self.request('GET', '/records/export?domain=activity&user_id=child-a', actor='staff', expected=403)
        events[2]['id'] = str(uuid4())
        self.request('POST', '/offline/events/sync', actor='child-b', json={'events': [events[2]]}, expected=404)
        self.assertEqual(self.request('GET', '/learning/progress')['attempts'], 0)

    def test_b1_note_history_conflict_delete_receipt_and_personal_deletion(self):
        sentence = self.request('POST', '/sentences', json=self.sentence())
        path = '/care/notes/' + sentence['id']
        def save(content, revision, expected=200):
            return self.request('PUT', path, actor='guardian', expected=expected,
                json={'user_id': 'child-a', 'content': content, 'expected_revision': revision})
        first = save('합성 최초 메모', 0)
        self.assertEqual(first['author_id'], 'guardian')
        save('합성 수정 메모', 1)
        save('충돌 메모', 1, 409)
        history = self.request('GET', path + '/history?user_id=child-a', actor='guardian')
        self.assertEqual([row['content'] for row in history['history']], ['합성 최초 메모', '합성 수정 메모'])
        other = self.request('GET', path + '/history?user_id=child-a', actor='staff')
        self.assertEqual(other['history'], [])  # Another author cannot inspect private notes.
        self.request('DELETE', path + '?user_id=child-a&expected_revision=2', actor='guardian', expected=204)
        deleted = self.request('GET', path + '/history?user_id=child-a', actor='guardian')
        self.assertTrue(deleted['deleted'])
        self.assertTrue(all(row['content'] is None for row in deleted['history']))
        receipt = self.request('DELETE', '/privacy/data', json={'confirmation': 'DELETE'})
        self.assertEqual(receipt['deletion_receipt']['status'], 'completed')
        self.assertEqual(receipt['deletion_receipt']['counts']['caregiver_notes'], 1)
        self.assertEqual(self.database.caregiver_notes.count_documents({'user_id': 'child-a'}), 0)
        self.assertIsNotNone(self.database.users.find_one({'_id': 'child-a'}))
        self.request('GET', '/records/activity?user_id=child-a', actor='guardian', expected=404)
        self.request('GET', path + '/history?user_id=child-a', actor='guardian', expected=404)
        self.assertEqual(self.request('GET', '/privacy/settings')['deletion_receipt']['id'], receipt['deletion_receipt']['id'])

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


    def recommendation_feed(self, actor='child-a', **extra):
        return self.request('POST', '/recommendations/feed', actor=actor, json={
            'request_id': str(uuid4()), 'selected_card_ids': [], 'hour': 12, 'utc_offset_minutes': -540, **extra})

    def recommendation_policy(self, revision=0, actor='guardian', expected=200, **extra):
        return self.request('PUT', '/recommendations/settings?user_id=child-a', actor=actor, expected=expected,
            json={'expected_revision': revision, 'enabled': True, 'mode': 'automatic',
                  'approved_card_ids': [], 'hidden_card_ids': [], 'situation': 'unspecified',
                  'use_time_of_day': True, **extra})

    def test_recommendation_configuration_and_monitoring_have_separate_link_permissions(self):
        for actor in ('guardian', 'staff'):
            self.set_permissions(actor, ['board_manage'])
            self.request('GET', '/recommendations/settings?user_id=child-a', actor=actor)
            self.request('GET', '/recommendations/monitoring?user_id=child-a', actor=actor, expected=403)
            self.set_permissions(actor, ['records_read'])
            self.request('GET', '/recommendations/monitoring?user_id=child-a', actor=actor)
            self.request('GET', '/recommendations/settings?user_id=child-a', actor=actor, expected=403)
            self.recommendation_policy(actor=actor, expected=403)
            self.set_permissions(actor, ['learning_manage'])
            self.request('GET', '/recommendations/monitoring?user_id=child-a', actor=actor, expected=403)
        self.recommendation_policy(actor='child-a', expected=403)
        self.recommendation_policy(actor='operator', expected=403)
        self.request('GET', '/recommendations/settings?user_id=child-a', actor='child-b', expected=403)
        self.set_permissions('guardian', ['board_manage'], active=False)
        self.recommendation_policy(expected=403)

    def test_core_card_locks_permission_versions_positions_and_explicit_unlock(self):
        path = '/board/layout/locks?user_id=child-a'
        values = {'expected_revision': 0, 'card_ids': ['water']}
        for actor in ('child-a', 'child-b', 'guardian', 'staff', 'operator'):
            self.request('PUT', path, actor=actor, expected=403, json=values)
        self.set_permissions('guardian', ['board_manage'])
        self.request('PUT', '/board/layout/slots?user_id=child-a', actor='guardian', json={
            'expected_revision': 0, 'card_ids': ['help', 'water', 'stop']})
        values['expected_revision'] = 1
        locked = self.request('PUT', path, actor='guardian', json=values)
        self.assertEqual(locked['locked_card_ids'], ['water'])
        self.assertEqual(locked['revision'], 2)
        for ids in (['water', 'help', 'stop'], ['help', 'stop'], ['help', 'stop', 'water']):
            self.request('PUT', '/board/layout/slots?user_id=child-a', actor='guardian', expected=409,
                json={'expected_revision': 2, 'card_ids': ids})
        self.request('PUT', path, actor='guardian', expected=409, json=values)
        self.assertEqual(self.request('GET', '/board/layout')['slots'], locked['slots'])
        cleared = self.request('PUT', path, actor='guardian', json={'expected_revision': 2, 'card_ids': []})
        self.assertEqual(cleared['locked_card_ids'], [])
        self.assertEqual(cleared['slots'], locked['slots'])
        self.request('PUT', '/board/layout/slots?user_id=child-a', actor='guardian', json={
            'expected_revision': 3, 'card_ids': ['water', 'stop']})
        audits = self.request('GET', '/board/layout/audit')
        self.assertEqual([row['action'] for row in audits].count('core_card_locks_changed'), 2)

    def test_core_card_locks_reject_unknown_non_slot_duplicates_and_busy_image_writer(self):
        self.set_permissions('guardian', ['board_manage'])
        self.request('PUT', '/board/layout/slots?user_id=child-a', actor='guardian', json={
            'expected_revision': 0, 'card_ids': ['help']})
        path = '/board/layout/locks?user_id=child-a'
        for ids in (['water'], ['unknown'], ['help', 'help']):
            self.request('PUT', path, actor='guardian', expected=422, json={'expected_revision': 1, 'card_ids': ids})
        from app.services.image_storage import image_write_lock
        with image_write_lock(self.database):
            self.request('PUT', path, actor='guardian', expected=409, json={'expected_revision': 1, 'card_ids': ['help']})
        self.assertEqual(self.request('GET', '/board/layout')['revision'], 1)
        self.assertEqual(len(self.request('GET', '/board/layout/audit')), 1)

    def situation(self, operation, revision, *, expected=200, actor='guardian', target='child-a', **fields):
        return self.request('PUT', '/board/layout/situations?user_id=' + target, actor=actor, expected=expected,
                            json={'operation': operation, 'expected_revision': revision, **fields})

    def test_sound_learning_version_results_export_and_consent_remain_separate(self):
        identity = str(uuid4())
        payload = self.attempt(request_id=identity, activity_type='sound_picture_match', content_version='sound-picture-v1')
        result = self.request('POST', '/learning/attempts', json=payload, expected=201)
        self.assertEqual(result['content_version'], 'sound-picture-v1')
        self.assertEqual(self.request('POST', '/learning/attempts', json=payload, expected=201), result)
        self.assertEqual(self.database.learning_attempts.count_documents({'_id': identity}), 1)
        self.assertEqual(self.database.communication_sessions.count_documents({}), 0)
        self.assertEqual(self.database.tts_events.count_documents({}), 0)
        exported = self.request('GET', '/records/export?domain=learning')
        self.assertEqual(exported['records'][0]['content_version'], 'sound-picture-v1')
        self.request('POST', '/learning/attempts', json=self.attempt(activity_type='sound_picture_match', content_version='word-picture-v1'), expected=422)
        self.database.privacy_settings.update_one({'_id': 'child-a'}, {'$set': {'guardian_consent': False}})
        self.request('POST', '/learning/attempts', json=self.attempt(activity_type='sound_picture_match'), expected=403)

    def test_situations_create_copy_independent_edit_delete_and_privacy_scope(self):
        self.set_permissions('guardian', ['board_manage'])
        before = self.request('GET', '/board/layout')
        home = self.situation('create', 0, name='집')
        first = home['situations'][0]
        self.assertEqual(first['slots'], before['slots'])
        school = self.situation('copy', 1, name='학교', source_id=first['id'])
        second = school['situations'][1]
        self.assertNotEqual(first['id'], second['id'])
        edited = self.situation('update', 2, situation_id=second['id'], name='학교', card_ids=['water', 'help'])
        self.assertEqual(edited['situations'][0], first)
        self.assertEqual(edited['slots'], before['slots'])
        self.assertEqual(edited['situations'][1]['slots'], [{'position': 1, 'card_id': 'water'}, {'position': 2, 'card_id': 'help'}])
        self.situation('delete', 1, situation_id=first['id'], expected=409)
        self.database.communication_sessions.insert_one({'_id': 'preserved-session', 'user_id': 'child-a', 'cards': ['water']})
        self.database.tts_settings.insert_one({'_id': 'child-a', 'rate': 1.2})
        removed = self.situation('delete', 3, situation_id=first['id'])
        self.assertEqual(removed['situations'], [edited['situations'][1]])
        self.assertIsNotNone(self.database.communication_sessions.find_one({'_id': 'preserved-session'}))
        self.assertEqual(self.database.tts_settings.find_one({'_id': 'child-a'})['rate'], 1.2)
        self.assertEqual(self.request('GET', '/board/layout', actor='child-b')['situations'], [])
        self.assertEqual(len(self.request('GET', '/board/layout/audit')), 4)
        # Existing privacy deletion includes embedded presets without another collection.
        self.request('DELETE', '/privacy/data', json={'confirmation': 'DELETE'})
        self.assertIsNone(self.database.board_layouts.find_one({'_id': 'child-a'}))

    def test_situations_require_permission_owned_source_unique_name_and_six_item_limit(self):
        for actor in ('child-a', 'child-b', 'guardian', 'staff', 'operator'):
            self.situation('create', 0, name='집', actor=actor, expected=403)
        self.set_permissions('guardian', ['board_manage'])
        self.situation('create', 0, target='child-b', name='집', expected=403)
        self.situation('copy', 0, name='학교', source_id='foreign-source', expected=404)
        for index, name in enumerate(['집', '학교', '치료실', '외출', '식사', '병원']):
            self.situation('create', index, name=name)
        self.situation('create', 6, name='일곱번째', expected=422)
        self.situation('create', 6, name='집', expected=409)
        self.situation('delete', 6, situation_id='default', expected=404)
        self.situation('create', 6, name='제어\n이름', expected=422)
        self.assertEqual(self.request('GET', '/board/layout')['revision'], 6)
        self.assertEqual(len(self.request('GET', '/board/layout/audit')), 6)

    def test_situations_keep_locked_positions_and_new_locks_require_alignment_in_every_board(self):
        self.set_permissions('guardian', ['board_manage'])
        root = self.request('PUT', '/board/layout/slots?user_id=child-a', actor='guardian',
            json={'expected_revision': 0, 'card_ids': ['help', 'water', 'stop']})
        home = self.situation('create', 1, name='집')['situations'][0]
        self.situation('update', 2, situation_id=home['id'], name='집', card_ids=['water', 'help', 'stop'])
        self.request('PUT', '/board/layout/locks?user_id=child-a', actor='guardian', expected=409,
            json={'expected_revision': 3, 'card_ids': ['water']})
        self.situation('update', 3, situation_id=home['id'], name='집', card_ids=['help', 'water', 'stop'])
        self.request('PUT', '/board/layout/locks?user_id=child-a', actor='guardian',
            json={'expected_revision': 4, 'card_ids': ['water']})
        self.situation('update', 5, situation_id=home['id'], name='집', card_ids=['water', 'help'], expected=409)
        self.situation('update', 5, situation_id=home['id'], name='집', card_ids=['help', 'water', 'custom:foreign'], expected=422)
        school = self.situation('copy', 5, name='학교', source_id=home['id'])
        self.assertTrue(all(item['slots'] == root['slots'] for item in school['situations']))

    def test_recommendations_approval_hide_disable_conflict_audit_and_board_independence(self):
        self.set_permissions('guardian', ['board_manage'])
        board = self.request('GET', '/board/layout')
        dashboard = self.request('GET', '/dashboard')
        progress = self.request('GET', '/learning/progress')
        self.recommendation_policy(mode='approval', approved_card_ids=['water'], hidden_card_ids=['help'])
        feed = self.recommendation_feed()
        self.assertEqual([card['id'] for card in feed['cards']], ['water'])
        self.assertIn('reason', feed['cards'][0])
        self.assertEqual(feed['cards'][0]['algorithm_version'], feed['algorithm_version'])
        self.recommendation_policy(expected=409)
        self.recommendation_policy(1, mode='approval', approved_card_ids=[])
        self.assertEqual(self.recommendation_feed()['cards'], [])
        self.recommendation_policy(2, enabled=False)
        self.assertFalse(self.recommendation_feed()['enabled'])
        self.assertEqual(self.request('GET', '/recommendations'), [])
        self.assertEqual(self.request('GET', '/board/layout'), board)
        self.assertEqual(self.request('GET', '/dashboard'), dashboard)
        self.assertEqual(self.request('GET', '/learning/progress'), progress)
        self.assertIn('help', [card['id'] for card in self.request('GET', '/cards')])
        audit = self.request('GET', '/recommendations/settings?user_id=child-a', actor='guardian')['history']
        self.assertEqual(len(audit), 3)
        self.assertEqual(len(self.request('GET', '/board/layout/audit')), 3)
        self.set_permissions('staff', ['quick_speech_manage'])
        self.assertEqual(self.request('GET', '/board/layout/audit?user_id=child-a', actor='staff'), [])
        self.request('GET', '/recommendations/settings?user_id=child-a', actor='staff', expected=403)
        self.assertEqual({row['actor_id'] for row in audit}, {'guardian'})
        self.assertTrue(all(row['created_at'].endswith('Z') or row['created_at'].endswith('+00:00') for row in audit))

    def test_recommendation_batch_replay_owner_context_policy_and_actual_visible_selection(self):
        identity = str(uuid4())
        feed = self.recommendation_feed(request_id=identity)
        self.assertEqual(self.recommendation_feed(request_id=identity), feed)
        self.assertEqual(self.database.recommendation_batches.count_documents({}), 1)
        for actor, context in [('child-b', []), ('child-a', ['water'])]:
            self.request('POST', '/recommendations/feed', actor=actor, expected=409, json={
                'request_id': identity, 'selected_card_ids': context, 'hour': 12, 'utc_offset_minutes': -540})
        path = '/recommendations/batches/' + identity
        card = feed['cards'][0]['id']
        self.request('POST', path + '/selections', expected=422, json={'card_id': card})
        self.request('POST', path + '/exposures', expected=422, json={'card_ids': []})
        self.request('POST', path + '/exposures', expected=422, json={'card_ids': ['not-offered']})
        self.request('POST', path + '/exposures', actor='child-b', expected=404, json={'card_ids': [card]})
        self.assertEqual(self.database.recommendation_batches.find_one({'_id': identity})['exposed_card_ids'], [])
        for _ in range(2):
            self.request('POST', path + '/exposures', json={'card_ids': [card, card]})
            self.request('POST', path + '/selections', json={'card_id': card})
        stored = self.database.recommendation_batches.find_one({'_id': identity})
        self.assertEqual(stored['exposed_card_ids'], [card])
        self.assertEqual(stored['selected_card_ids'], [card])
        self.assertEqual(stored['response'], feed)
        self.assertEqual(self.database.communication_sessions.count_documents({}), 0)
        self.assertEqual(self.database.offline_events.count_documents({}), 0)
        self.set_permissions('guardian', ['board_manage'])
        self.recommendation_policy(hidden_card_ids=[card])
        self.request('POST', path + '/exposures', expected=409, json={'card_ids': [card]})
        self.request('POST', '/recommendations/feed', expected=409, json={
            'request_id': identity, 'selected_card_ids': [], 'hour': 12, 'utc_offset_minutes': -540})

    def test_recommendation_uses_own_recent_communication_context_not_learning_or_other_child(self):
        self.set_permissions('guardian', ['board_manage'])
        self.recommendation_policy(situation='school')
        now = datetime.now(timezone.utc) - timedelta(seconds=1)
        for actor, ids, age, extra in [('child-a', ['me', 'water'], 0, {}),
                                     ('child-b', ['me', 'rice'], 0, {}),
                                     ('child-a', ['rice'], 100, {}),
                                     ('child-a', ['rice'], 0, {'regeneration_of': 'original'})]:
            self.database.communication_sessions.insert_one({'_id': str(uuid4()), 'user_id': actor,
                'cards': ids, 'created_at': now - timedelta(days=age), **extra})
        self.database.offline_events.insert_many([
            {'_id': str(uuid4()), 'user_id': 'child-a', 'event_type': 'card_selection',
             'situation': 'school', 'card_ids': ['water'], 'occurred_at': now},
            {'_id': str(uuid4()), 'user_id': 'child-a', 'event_type': 'speech_result',
             'situation': 'school', 'card_ids': ['rice'], 'occurred_at': now}])
        self.request('POST', '/learning/attempts', json=self.attempt(), expected=201)
        feed = self.recommendation_feed(selected_card_ids=['me'])
        self.assertEqual(feed['cards'][0]['id'], 'water')
        self.assertEqual(feed['cards'][0]['evidence']['combination'], 4)
        self.assertEqual(feed['cards'][0]['evidence']['situation'], 3)
        rice = next(card for card in feed['cards'] if card['id'] == 'rice')
        self.assertEqual(sum(rice['evidence'].values()), 0)
        self.assertNotIn('me', [card['id'] for card in feed['cards']])

    def test_recommendation_monitoring_counts_actual_exposure_and_selection_without_inference(self):
        for _ in range(3):
            feed = self.recommendation_feed()
            path = '/recommendations/batches/' + feed['batch_id']
            self.request('POST', path + '/exposures', json={'card_ids': [feed['cards'][0]['id']]})
        fetched = self.recommendation_feed()
        path = '/recommendations/batches/' + fetched['batch_id']
        self.request('POST', path + '/exposures', json={'card_ids': [fetched['cards'][0]['id']]})
        self.request('POST', path + '/selections', json={'card_id': fetched['cards'][0]['id']})
        self.recommendation_feed()  # Fetched-only does not count as shown.
        report = self.request('GET', '/recommendations/monitoring?user_id=child-a', actor='guardian')
        self.assertEqual(report['sampled_batches'], 4)
        self.assertEqual(sum(card['exposed_batches'] for card in report['cards']), 4)
        self.assertEqual(sum(card['selected_batches'] for card in report['cards']), 1)
        self.assertIn('미선택은 거절', report['notice'])
        self.assertEqual(self.request('GET', '/recommendations/monitoring', actor='child-b')['sampled_batches'], 0)

    def test_recommendation_consent_and_retention_export_deletion_are_user_scoped(self):
        self.set_permissions('guardian', ['board_manage'])
        self.recommendation_policy()
        feed = self.recommendation_feed()
        other = self.recommendation_feed(actor='child-b')
        exported = self.request('GET', '/privacy/export')
        self.assertEqual(exported['recommendation_settings']['revision'], 1)
        self.assertEqual(exported['recommendation_batches'][0]['_id'], feed['batch_id'])
        self.database.recommendation_batches.update_one({'_id': feed['batch_id']},
            {'$set': {'created_at': datetime.now(timezone.utc) - timedelta(days=40)}})
        self.request('PUT', '/privacy/settings', json={'guardian_consent': True, 'retention_days': 30})
        self.assertIsNone(self.database.recommendation_batches.find_one({'_id': feed['batch_id']}))
        self.assertIsNotNone(self.database.recommendation_batches.find_one({'_id': other['batch_id']}))
        feed = self.recommendation_feed()
        self.request('PUT', '/privacy/settings', json={'guardian_consent': False, 'retention_days': 30})
        no_consent = self.recommendation_feed()
        self.assertIsNone(no_consent['batch_id'])
        self.assertFalse(no_consent['diagnostics']['personal_history_used'])
        self.request('POST', '/recommendations/batches/' + feed['batch_id'] + '/exposures', expected=403,
            json={'card_ids': [feed['cards'][0]['id']]})
        receipt = self.request('DELETE', '/privacy/data', json={'confirmation': 'DELETE'})
        self.assertEqual(receipt['deletion_receipt']['counts']['recommendation_settings'], 1)
        self.assertEqual(receipt['deletion_receipt']['counts']['recommendation_batches'], 1)
        self.assertIsNotNone(self.database.recommendation_batches.find_one({'_id': other['batch_id']}))
        self.assertEqual(self.database.recommendation_batches.count_documents({'user_id': 'child-a'}), 0)

    def test_recommendation_failure_does_not_block_cardbook_fixed_board_or_sentence(self):
        with patch('app.services.recommendations.database', side_effect=PyMongoError('synthetic outage')):
            self.request('POST', '/recommendations/feed', expected=503,
                json={'request_id': str(uuid4()), 'selected_card_ids': [], 'hour': 12, 'utc_offset_minutes': -540})
            self.assertTrue(self.request('GET', '/cards'))
            self.assertTrue(self.request('GET', '/board/layout')['slots'])
            self.assertTrue(self.request('POST', '/sentences', json=self.sentence())['sentence'])


if __name__ == '__main__':
    unittest.main()
