"""Real API + isolated MongoDB; no physical reader or real UID is used."""
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
from app.services.observability import configure_observability


class RealRfidTests(unittest.TestCase):
    def setUp(self):
        self.name = 'pesc_mate_rfid_test_' + uuid4().hex
        self.mongo = MongoClient(os.environ.get('MONGODB_URI', 'mongodb://127.0.0.1:27017'), serverSelectionTimeoutMS=3000)
        self.addCleanup(self.mongo.close)
        self.addCleanup(self.cleanup_database)
        self.db = self.mongo[self.name]
        env = patch.dict(os.environ, MONGODB_DATABASE=self.name, RFID_ALLOW_INSECURE_LAN='true', DEMO_ACCOUNTS_ENABLED='false')
        env.start(); self.addCleanup(env.stop)
        connection = patch('app.services.database.client', return_value=self.mongo)
        connection.start(); self.addCleanup(connection.stop)
        application = FastAPI(); configure_observability(application)
        application.include_router(api_router, prefix='/api')
        self.http = TestClient(application); self.addCleanup(self.http.close)
        self.headers = {}
        for identity, role in [('child-a', 'user'), ('child-b', 'user'), ('guardian', 'caregiver'), ('staff', 'support_staff'), ('operator', 'support_staff')]:
            self.db.users.insert_one({'_id': identity, 'username': identity, 'name': '합성 사용자', 'role': role,
                'account_permissions': ['content_manage'] if identity == 'operator' else []})
            token = uuid4().hex
            self.db.auth_sessions.insert_one({'_id': hashlib.sha256(token.encode()).hexdigest(), 'user_id': identity,
                'expires_at': datetime.now(timezone.utc) + timedelta(hours=1)})
            self.headers[identity] = {'Authorization': 'Bearer ' + token}
        for child in ['child-a', 'child-b']:
            self.db.privacy_settings.insert_one({'_id': child, 'guardian_consent': True})
        for actor, permissions in [('guardian', ['cards_manage', 'board_manage']), ('staff', ['board_manage'])]:
            self.db.caregiver_links.insert_one({'_id': actor + ':child-a', 'supporter_id': actor,
                'user_id': 'child-a', 'permissions': permissions, 'active': True})

    def cleanup_database(self):
        if not re.fullmatch(r'pesc_mate_rfid_test_[a-f0-9]{32}', self.name):
            raise RuntimeError('Unsafe test database name')
        self.mongo.drop_database(self.name)

    def call(self, method, path, actor='guardian', expected=200, **kwargs):
        response = self.http.request(method, '/api' + path, headers=self.headers[actor], **kwargs)
        self.assertEqual(response.status_code, expected, response.text)
        return response.json()

    def create(self):
        result = self.call('POST', '/rfid/devices?user_id=child-a', expected=201,
            json={'device_id': 'synthetic-board', 'name': '합성 카드판'})
        self.key = result['device_key']; self.device_headers = {'X-Device-Key': self.key}
        return result

    def begin(self):
        response = self.http.post('/api/rfid/devices/synthetic-board/session', headers=self.device_headers, json={})
        self.assertEqual(response.status_code, 201, response.text)
        self.session = response.json()['session_id']
        self.assertEqual(response.headers['X-RFID-Session'], self.session)

    def payload(self, event_id=1):
        return {'protocol_version': 1, 'session_id': self.session, 'event_id': event_id, 'readers': [
            {'reader_id': 3, 'status': 'PRESENT', 'uid': '03030303'},
            {'reader_id': 1, 'status': 'PRESENT', 'uid': '01010101'},
            {'reader_id': 2, 'status': 'PRESENT', 'uid': '02020202'}]}

    def send(self, payload, expected=200):
        response = self.http.post('/api/rfid/devices/synthetic-board/snapshot', headers=self.device_headers, json=payload)
        self.assertEqual(response.status_code, expected, response.text)
        return response.json()

    def state(self, actor='child-a'):
        return self.call('GET', '/rfid/devices/synthetic-board/state?user_id=child-a', actor=actor)

    def bind(self, uid, card, revision=None):
        return self.call('PUT', '/rfid/bindings?user_id=child-a', json={'uid': uid, 'card_id': card, 'expected_revision': revision})

    def test_three_positions_mapping_change_remove_and_no_communication_or_learning_write(self):
        self.create(); self.begin()
        for uid, card in [('01:01:01:01', 'me'), ('02020202', 'water'), ('03030303', 'drink')]: self.bind(uid, card)
        self.send(self.payload())
        state = self.state()
        self.assertEqual([row['card_id'] for row in state['readers']], ['me', 'water', 'drink'])
        self.assertTrue(all('uid' not in row for row in state['readers']))
        binding = next(row for row in self.call('GET', '/rfid/bindings?user_id=child-a') if row['uid'] == '02020202')
        self.bind('02020202', 'rice', binding['revision'])
        self.assertEqual(self.state()['readers'][1]['card_id'], 'rice')
        self.call('PUT', '/rfid/bindings?user_id=child-a', expected=409,
            json={'uid': '02020202', 'card_id': 'water', 'expected_revision': binding['revision']})
        binding = next(row for row in self.call('GET', '/rfid/bindings?user_id=child-a') if row['uid'] == '02020202')
        self.bind('02020202', None, binding['revision'])
        self.assertEqual(self.state()['readers'][1]['status'], 'UNMAPPED')
        payload = self.payload(2); payload['readers'][1] = {'reader_id': 1, 'status': 'EMPTY', 'uid': None}
        self.send(payload)
        self.assertEqual(self.state()['readers'][0]['status'], 'EMPTY')
        for name in ['communication_sessions', 'learning_attempts', 'tts_events', 'offline_events']:
            self.assertEqual(self.db[name].count_documents({}), 0)

    def test_retries_out_of_order_and_old_boot_cannot_overwrite_current_state(self):
        self.create(); self.begin(); payload = self.payload(4)
        self.assertTrue(self.send(payload)['accepted'])
        seen = self.db.rfid_devices.find_one({})['last_seen']
        self.assertTrue(self.send(payload)['duplicate'])
        self.assertEqual(self.db.rfid_devices.find_one({})['last_seen'], seen)
        self.assertTrue(self.send(self.payload(2))['duplicate'])
        modified = self.payload(4); modified['readers'][0] = {'reader_id': 3, 'status': 'EMPTY', 'uid': None}
        self.send(modified, expected=409)
        self.begin(); self.send(payload, expected=412)
        self.assertTrue(self.send(self.payload(1))['accepted'])

    def test_keys_permissions_transport_and_account_boundaries(self):
        created = self.create(); self.begin()
        listed = self.call('GET', '/rfid/devices?user_id=child-a')
        self.assertNotIn('device_key', listed[0]); self.assertNotIn('key_hash', listed[0])
        self.call('GET', '/rfid/devices?user_id=child-a', actor='child-b', expected=403)
        self.call('GET', '/rfid/devices?user_id=child-a', actor='operator', expected=403)
        self.call('GET', '/rfid/bindings?user_id=child-a', actor='staff', expected=403)
        self.call('POST', '/rfid/devices?user_id=child-a', actor='child-a', expected=403,
            json={'device_id': 'not-allowed', 'name': 'test'})
        self.send(self.payload())
        self.assertTrue(all('uid' not in row for row in self.state('staff')['readers']))
        old_headers = self.device_headers
        result = self.call('PUT', '/rfid/devices/synthetic-board?user_id=child-a', json={
            'operation': 'rotate_key', 'expected_revision': created['revision']})
        response = self.http.post('/api/rfid/devices/synthetic-board/session', headers=old_headers)
        self.assertEqual(response.status_code, 401)
        self.device_headers = {'X-Device-Key': result['device_key']}; self.begin()
        with patch.dict(os.environ, RFID_ALLOW_INSECURE_LAN='false'):
            response = self.http.post('/api/rfid/devices/synthetic-board/session', headers=self.device_headers)
            self.assertEqual(response.status_code, 403)

    def test_stale_snapshots_do_not_revive_from_duplicates_and_failed_devices_are_not_empty(self):
        self.create(); self.begin(); payload = self.payload()
        self.send(payload)
        self.db.rfid_devices.update_one({}, {'$set': {'last_seen': datetime.now(timezone.utc) - timedelta(seconds=30)}})
        self.send(payload)
        state = self.state()
        self.assertFalse(state['online']); self.assertTrue(all(row['status'] == 'STALE' for row in state['readers']))
        payload = self.payload(2); payload['readers'][0] = {'reader_id': 3, 'status': 'ERROR', 'uid': None}
        self.send(payload)
        self.assertEqual(self.state()['readers'][2]['status'], 'ERROR')

    def test_unknown_private_card_mapping_and_invalid_payloads_are_rejected(self):
        self.create(); self.begin()
        self.call('PUT', '/rfid/bindings?user_id=child-a', expected=422,
            json={'uid': '01010101', 'card_id': 'custom:another-child-card', 'expected_revision': None})
        invalid = self.payload(); invalid['readers'][2]['uid'] = '01010101'; self.send(invalid, expected=422)
        self.send(self.payload() | {'user_id': 'child-b'}, expected=422)
        self.send(self.payload() | {'protocol_version': 2}, expected=422)

    def test_export_deletion_and_consent_withdrawal_do_not_recreate_hardware_data(self):
        self.create(); self.begin(); self.bind('01010101', 'water'); self.send(self.payload())
        exported = self.call('GET', '/privacy/export', actor='child-a')
        self.assertEqual(exported['rfid_bindings'][0]['uid'], '01010101')
        self.assertNotIn('key_hash', exported['rfid_devices'][0])
        self.call('PUT', '/privacy/settings', actor='child-a', json={'guardian_consent': False, 'retention_days': 365})
        self.send(self.payload(2), expected=401)
        self.assertFalse(self.state()['online'])
        self.call('DELETE', '/privacy/data', actor='child-a', json={'confirmation': 'DELETE'})
        self.assertEqual(self.db.rfid_devices.count_documents({}), 0)
        self.assertEqual(self.db.rfid_bindings.count_documents({}), 0)
        self.send(self.payload(3), expected=401)
        self.assertEqual(self.db.rfid_devices.count_documents({}), 0)
