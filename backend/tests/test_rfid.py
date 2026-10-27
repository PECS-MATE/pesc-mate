import unittest
from uuid import uuid4
from unittest.mock import patch
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from pydantic import ValidationError
from app.api.rfid import Snapshot, Binding, UsbLookup, UsbEvent, device_transport
from app.services.rfid import normalize_uid, ingest, public_device, STALE_SECONDS, board_state
from starlette.requests import Request


class RfidTests(unittest.TestCase):
    def test_usb_payloads_are_bounded_and_diagnostic_logs_never_accept_serial_content(self):
        self.assertEqual(UsbLookup(uids=['01:ab:cd:02']).uids, ['01ABCD02'])
        for values in ([], ['01020304'] * 13, ['invalid']):
            with self.assertRaises(ValidationError):
                UsbLookup(uids=values)
        for body in ({'action': 'anything'}, {'action': 'tag_read', 'uid': '01020304'}, {'action': 'connected', 'user_id': 'outside'}):
            with self.assertRaises(ValidationError):
                UsbEvent(**body)

    def snapshot(self, **extra):
        return {'protocol_version': 1, 'session_id': str(uuid4()), 'event_id': 1, 'readers': [
            {'reader_id': 1, 'status': 'PRESENT', 'uid': '01 02 03 04'},
            {'reader_id': 2, 'status': 'EMPTY', 'uid': None},
            {'reader_id': 3, 'status': 'ERROR', 'uid': None}], **extra}

    def test_uid_normalization_and_strict_snapshot_positions(self):
        self.assertEqual(normalize_uid('01:ab:cd:02'), '01ABCD02')
        self.assertEqual(Snapshot(**self.snapshot()).readers[0].uid, '01020304')
        for value in ('', '01', 'G1ABCDEF', '0102030405'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_uid(value)
        rows = self.snapshot()['readers']
        for invalid in ([rows[0]] * 3, rows[:2], [rows[0], rows[1] | {'uid': '01020304'}, rows[2]],
                        [rows[0], rows[1] | {'status': 'PRESENT', 'uid': '01020304'}, rows[2]]):
            with self.subTest(rows=invalid), self.assertRaises(ValidationError):
                Snapshot(**self.snapshot(readers=invalid))
        with self.assertRaises(ValidationError):
            Snapshot(**self.snapshot(user_id='outside'))
        self.assertEqual(Binding(uid='01-02-03-04', card_id='water').uid, '01020304')

    def test_device_credentials_never_appear_in_public_device(self):
        output = public_device({'device_id': 'sample', 'key_hash': 'secret', 'readers': [{'uid': 'private'}]})
        self.assertNotIn('key_hash', output)
        self.assertNotIn('readers', output)

    def test_plain_http_is_an_explicit_development_opt_in(self):
        request = Request({'type': 'http', 'scheme': 'http', 'server': ('localhost', 80), 'path': '/', 'headers': []})
        with patch.dict('os.environ', {'RFID_ALLOW_INSECURE_LAN': 'false'}):
            with self.assertRaises(HTTPException):
                device_transport(request)
        with patch.dict('os.environ', {'RFID_ALLOW_INSECURE_LAN': 'true'}):
            device_transport(request)

    @patch('app.services.rfid.image_write_lock')
    @patch('app.services.rfid.authenticate_device')
    @patch('app.services.rfid.database')
    def test_old_events_do_not_refresh_liveness_or_write_communication(self, mock_db, auth, lock):
        payload = Snapshot(**self.snapshot()).model_dump(mode='json')
        auth.return_value = {'session_id': payload['session_id'], 'last_event_id': 9}
        result = ingest('board', 'key', payload)
        self.assertTrue(result['duplicate'])
        mock_db.return_value.rfid_devices.update_one.assert_not_called()
        mock_db.return_value.communication_sessions.insert_one.assert_not_called()

    @patch('app.services.rfid.image_write_lock')
    @patch('app.services.rfid.authenticate_device')
    @patch('app.services.rfid.database')
    def test_previous_boot_session_cannot_replace_new_state(self, mock_db, auth, lock):
        auth.return_value = {'session_id': str(uuid4())}
        with self.assertRaises(HTTPException) as failure:
            ingest('board', 'key', Snapshot(**self.snapshot()).model_dump(mode='json'))
        self.assertEqual(failure.exception.status_code, 412)
        mock_db.return_value.rfid_devices.update_one.assert_not_called()
