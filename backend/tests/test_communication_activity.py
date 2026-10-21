from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from pymongo.errors import PyMongoError

from app.api.router import OfflineEventRequest, SentenceRequest
from app.services.communication_activity import activity_report, speech_for_sessions
from app.services.offline_events import sync_events


class ActivityTests(TestCase):
    def setUp(self):
        self.now = datetime.now(timezone.utc)
        self.stream = str(uuid4())
        self.collection = MagicMock()
        self.database = SimpleNamespace(offline_events=self.collection)
        self.connection = patch('app.services.communication_activity.database', return_value=self.database)
        self.connection.start()
        self.addCleanup(self.connection.stop)

    def event(self, sequence, kind='card_selection', **extra):
        return {'_id': str(uuid4()), 'user_id': 'child', 'event_type': kind, 'card_ids': ['water', 'water'],
                'occurred_at': self.now - timedelta(minutes=5-sequence), 'sequence': sequence,
                'situation': 'home', 'stream_id': self.stream, **extra}

    def rows(self, rows):
        self.collection.find.return_value.sort.return_value.limit.return_value = rows

    def test_situations_and_recovery_flow_are_observations_from_same_stream_only(self):
        before = self.event(1)
        recovery = self.event(2, 'recovery_speech', recovery_id='not_that', speech_status='succeeded')
        after = self.event(3, 'speech_result', speech_status='failed')
        other_device = self.event(4, stream_id=str(uuid4()), situation='school')
        self.rows([other_device, after, recovery, before])
        report = activity_report('child', 7, self.now)
        self.assertEqual(report['total'], 4)
        home = next(row for row in report['situations'] if row['situation'] == 'home')
        self.assertEqual((home['selections'], home['speech_results'], home['succeeded'], home['failed']), (1, 2, 1, 1))
        flow = report['recovery_flows'][0]
        self.assertEqual((flow['before']['id'], flow['after']['id']), (before['_id'], after['_id']))
        query = self.collection.find.call_args.args[0]
        self.assertEqual(query['user_id'], 'child')
        self.assertEqual(query['occurred_at']['$gte'], self.now - timedelta(days=7))
        self.assertEqual(query['occurred_at']['$lte'], self.now)

    def test_missing_neighbour_legacy_and_long_gap_are_not_inferred(self):
        old = self.event(1, occurred_at=self.now - timedelta(hours=1))
        recovery = self.event(2, 'recovery_speech', recovery_id='wrong_tap', speech_status='cancelled')
        legacy = self.event(3, 'immediate_speech', stream_id=None, situation=None)
        self.rows([legacy, recovery, old])
        report = activity_report('child', now=self.now)
        self.assertIsNone(report['recovery_flows'][0]['before'])
        self.assertIsNone(report['recovery_flows'][0]['after'])
        self.assertEqual(next(row for row in report['situations'] if row['situation'] == 'unspecified')['legacy_requests'], 1)
        self.assertNotIn('user_id', report['recent'][0])

    def test_bounded_report_and_query_failure_do_not_look_like_no_activity(self):
        self.rows([self.event(1), self.event(2)])
        with patch('app.services.communication_activity.MAX_ACTIVITY_ROWS', 1):
            with self.assertRaises(HTTPException) as caught:
                activity_report('child')
        self.assertEqual(caught.exception.status_code, 413)
        self.collection.find.side_effect = PyMongoError('private')
        with self.assertRaises(HTTPException) as caught:
            activity_report('child')
        self.assertEqual(caught.exception.status_code, 503)

    def test_speech_results_require_the_exact_user_session_and_are_individually_bounded(self):
        self.rows([self.event(1, 'speech_result', session_id='session', speech_status='succeeded')])
        result = speech_for_sessions('child', ['session', 'another'])
        self.assertEqual(result['session'][0]['speech_status'], 'succeeded')
        queries = [call.args[0] for call in self.collection.find.call_args_list]
        self.assertEqual(queries, [{'user_id': 'child', 'session_id': key, 'event_type': 'speech_result'} for key in ['session', 'another']])

    def test_activity_schema_rejects_missing_results_wrong_context_and_bad_selection_times(self):
        base = {'id': uuid4(), 'event_type': 'speech_result', 'card_ids': ['water'], 'occurred_at': self.now,
                'stream_id': uuid4(), 'sequence': 1, 'speech_status': 'succeeded', 'completed_at': self.now}
        OfflineEventRequest(**base)
        for changes in ({'speech_status': None}, {'completed_at': None}, {'situation': 'inferred'},
                        {'sequence': 0}, {'stream_id': None}, {'event_type': 'recovery_speech'},
                        {'completed_at': self.now - timedelta(seconds=1)}, {'event_type': 'card_selection'}):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                OfflineEventRequest(**(base | changes))
        OfflineEventRequest(id=uuid4(), event_type='card_selection', card_ids=[], occurred_at=self.now,
                            stream_id=uuid4(), sequence=1)
        with self.assertRaises(ValidationError):
            SentenceRequest(cards=['water'], request_id=uuid4(), selected_at=[])

    def test_sync_whitelists_values_and_checks_linked_session_ownership(self):
        event = self.event(1, 'speech_result', id=uuid4(), speech_status='succeeded',
                           completed_at=self.now, session_id=uuid4(), content='must not persist')
        self.collection.find_one.return_value = None
        database = SimpleNamespace(offline_events=self.collection, communication_sessions=MagicMock())
        database.communication_sessions.find_one.return_value = None
        with patch('app.services.offline_events._database', return_value=database):
            with self.assertRaises(HTTPException) as caught:
                sync_events('child', [event])
            self.assertEqual(caught.exception.status_code, 404)
            self.collection.update_one.assert_not_called()
            database.communication_sessions.find_one.return_value = {'user_id': 'child'}
            sync_events('child', [event])
        stored = self.collection.update_one.call_args.args[1]['$setOnInsert']
        self.assertNotIn('content', stored)
        self.assertEqual(stored['session_id'], str(event['session_id']))
        self.assertEqual(stored['speech_status'], 'succeeded')
