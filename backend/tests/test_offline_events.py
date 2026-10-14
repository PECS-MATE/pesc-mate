import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi import HTTPException

from app.services.offline_events import sync_events


class OfflineEventTests(unittest.TestCase):
    @patch('app.services.offline_events._database')
    def test_retry_uses_same_id_and_is_idempotent(self, mocked_database):
        database = MagicMock()
        database.offline_events.find_one.return_value = None
        mocked_database.return_value = database
        event_id = uuid4()
        event = {'id': event_id, 'event_type': 'immediate_speech', 'card_ids': ['help'],
                 'occurred_at': datetime.now(timezone.utc)}

        first = sync_events('demo', [event])
        second = sync_events('demo', [event])

        self.assertEqual(first, second)
        self.assertEqual(first['accepted_ids'], [str(event_id)])
        self.assertEqual(database.offline_events.update_one.call_count, 2)
        self.assertTrue(database.offline_events.update_one.call_args.kwargs['upsert'])

    @patch('app.services.offline_events._database')
    def test_event_id_cannot_cross_users(self, mocked_database):
        database = MagicMock()
        database.offline_events.find_one.return_value = {'_id': 'event', 'user_id': 'other'}
        mocked_database.return_value = database
        with self.assertRaises(HTTPException) as caught:
            sync_events('demo', [{
                'id': 'event', 'event_type': 'selection_speech', 'card_ids': ['water', 'drink'],
                'occurred_at': datetime.now(timezone.utc),
            }])
        self.assertEqual(caught.exception.status_code, 409)


if __name__ == '__main__':
    unittest.main()
