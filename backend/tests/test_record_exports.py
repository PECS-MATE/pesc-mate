import csv
import io
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pymongo.errors import PyMongoError

from app.api.router import api_router
from app.services.authentication import current_user
from app.services.record_exports import export_records, records_csv


class RecordExportTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 21, 0, tzinfo=timezone.utc)
        self.collection = MagicMock()
        self.cursor = self.collection.find.return_value.sort.return_value
        self.cursor.limit.return_value = []
        self.database = SimpleNamespace(communication_sessions=self.collection)
        self.connection = patch('app.services.record_exports.database', return_value=self.database)
        self.connection.start()
        self.addCleanup(self.connection.stop)

    def document(self, **values):
        return {'_id': str(uuid4()), 'user_id': 'child', 'created_at': self.now,
                'cards': ['water', 'water', 'custom:pencil'], 'sentence': '합성 문장',
                'card_metadata': {'custom:pencil': {'id': 'custom:pencil', 'label': '연필'}},
                'private_secret': 'must not export', 'caregiver_note': 'private note', **values}

    def test_communication_exports_all_rows_with_order_snapshots_and_no_inferred_speech(self):
        documents = [self.document() for _ in range(14)]
        self.cursor.limit.return_value = documents
        result = export_records('child', 'communication', 7, self.now)
        self.assertEqual(result['count'], 14)  # Not the dashboard's ten-row preview.
        self.collection.find.assert_called_once_with({'user_id': 'child', 'created_at': {
            '$gte': self.now - timedelta(days=7), '$lte': self.now,
        }})
        self.cursor.limit.assert_called_once_with(10001)
        row = result['records'][0]
        self.assertEqual(row['card_labels'], ['물', '물', '연필'])
        self.assertEqual(row['cards'], documents[0]['cards'])
        self.assertIsNone(row['card_selected_at'])
        self.assertEqual(row['speech_status'], 'unknown')
        self.assertFalse({'user_id', 'card_metadata', 'caregiver_note', 'private_secret', 'generation'} & row.keys())
        self.assertEqual(result['from_inclusive'], '2026-10-14T00:00:00+00:00')

    def test_learning_only_reads_learning_collection_and_record_type(self):
        self.database = SimpleNamespace(learning_attempts=self.collection)
        self.connection.stop()
        with patch('app.services.record_exports.database', return_value=self.database):
            self.cursor.limit.return_value = [{
                '_id': 'practice', 'completed_at': self.now.replace(tzinfo=None),
                'items': [{'card_id': 'apple', 'label': '사과', 'first_try_correct': False, 'secret': 'no'}],
                'sentence': 'must not export',
            }]
            result = export_records('child', 'learning', 30, self.now)
        query = self.collection.find.call_args.args[0]
        self.assertEqual(query['record_type'], 'learning_attempt')
        self.assertNotIn('created_at', query)
        row = result['records'][0]
        self.assertNotIn('sentence', row)
        self.assertEqual(row['completed_at'], self.now.isoformat())
        self.assertEqual(row['items'], [{'card_id': 'apple', 'label': '사과', 'first_try_correct': False}])

    def test_empty_all_period_export_has_metadata_and_csv_header(self):
        exported = export_records('child', 'communication', now=self.now)
        self.assertEqual(exported['count'], 0)
        self.assertIsNone(exported['from_inclusive'])
        self.assertIsNone(exported['period_days'])
        self.assertEqual(list(csv.reader(io.StringIO(records_csv(exported).lstrip('\ufeff'))))[0][0], 'id')

    def test_limit_is_an_error_not_a_silent_partial_download(self):
        from fastapi import HTTPException
        self.cursor.limit.return_value = [self.document(), self.document()]
        with patch('app.services.record_exports.MAX_EXPORT_ROWS', 1):
            with self.assertRaises(HTTPException) as caught:
                export_records('child', 'communication', now=self.now)
        self.assertEqual(caught.exception.status_code, 413)
        self.cursor.limit.assert_called_once_with(2)

    def test_database_error_is_not_an_empty_export(self):
        from fastapi import HTTPException
        self.collection.find.side_effect = PyMongoError('synthetic')
        with self.assertRaises(HTTPException) as caught:
            export_records('child', 'communication', now=self.now)
        self.assertEqual(caught.exception.status_code, 503)

    def test_unknown_domain_cannot_select_a_collection(self):
        with self.assertRaises(ValueError):
            export_records('child', 'private', now=self.now)
        self.collection.find.assert_not_called()

    def test_csv_preserves_korean_commas_quotes_newlines_and_stops_formulas(self):
        for text in ['=1+1', '+SUM(1,2)', '-1+1', '@SUM(1,2)', '  =1', '\t=1', '\r=1', '\n=1']:
            with self.subTest(text=text):
                exported = {'domain': 'communication', 'records': [{'sentence': text}]}
                value = records_csv(exported)
                self.assertTrue(value.startswith('\ufeff'))
                rows = list(csv.DictReader(io.StringIO(value.lstrip('\ufeff'))))
                self.assertEqual(rows[0]['sentence'], "'" + text)
        text = '사과, "물"\n주세요'
        value = records_csv({'domain': 'communication', 'records': [{'sentence': text, 'cards': ['water']}]})
        rows = list(csv.DictReader(io.StringIO(value.lstrip('\ufeff'))))
        self.assertEqual(rows[0]['sentence'], text)
        self.assertEqual(rows[0]['cards'], '["water"]')


class RecordExportRouteTests(unittest.TestCase):
    def setUp(self):
        self.actor = {'id': 'support', 'role': 'caregiver', 'account_permissions': []}
        self.permissions = ['records_read', 'learning_manage']
        app = FastAPI()
        app.include_router(api_router, prefix='/api')
        app.dependency_overrides[current_user] = lambda: self.actor
        self.http = TestClient(app)
        self.addCleanup(self.http.close)
        self.links = patch('app.services.authentication.linked_users', side_effect=lambda _: [
            {'id': 'child', 'permissions': self.permissions},
        ])
        self.links.start()
        self.addCleanup(self.links.stop)
        self.export = patch('app.api.router.export_records', return_value={
            'domain': 'communication', 'count': 0, 'records': [],
        })
        self.exporter = self.export.start()
        self.addCleanup(self.export.stop)

    def test_each_support_role_requires_the_domain_permission_before_reading(self):
        for role in ('caregiver', 'support_staff'):
            self.actor['role'] = role
            for permission, allowed, denied in [('records_read', 'communication', 'learning'),
                                               ('learning_manage', 'learning', 'communication')]:
                self.permissions = [permission]
                self.exporter.reset_mock()
                response = self.http.get(f'/api/records/export?domain={denied}&user_id=child')
                self.assertEqual(response.status_code, 403)
                self.exporter.assert_not_called()
                response = self.http.get(f'/api/records/export?domain={allowed}&user_id=child&days=7')
                self.assertEqual(response.status_code, 200)
                self.exporter.assert_called_once_with('child', allowed, 7)

    def test_other_child_and_content_operator_cannot_export_unlinked_data(self):
        for actor in ({'id': 'other-child', 'role': 'user'},
                      {'id': 'operator', 'role': 'support_staff', 'account_permissions': ['content_manage']}):
            self.actor = actor
            self.permissions = []
            self.assertEqual(self.http.get('/api/records/export?domain=communication&user_id=child').status_code, 403)
        self.exporter.assert_not_called()

    def test_self_export_and_download_headers(self):
        self.actor = {'id': 'child', 'role': 'user'}
        for format in ('json', 'csv'):
            response = self.http.get(f'/api/records/export?domain=communication&format={format}')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['cache-control'], 'no-store')
            self.assertEqual(response.headers['x-content-type-options'], 'nosniff')
            self.assertEqual(response.headers['content-disposition'],
                             f'attachment; filename="pesc-mate-communication-all.{format}"')
            self.assertIn('application/json' if format == 'json' else 'text/csv', response.headers['content-type'])

    def test_invalid_domain_format_or_period_never_reads_records(self):
        for query in ('domain=private', 'domain=communication&format=html', 'domain=communication&days=0',
                      'domain=learning&days=366', 'domain=learning&user_id='):
            self.assertEqual(self.http.get('/api/records/export?' + query).status_code, 422)
        self.exporter.assert_not_called()
