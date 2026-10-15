import unittest
from unittest.mock import MagicMock, patch

from pymongo.errors import OperationFailure, ServerSelectionTimeoutError

from app.services.indexes import INDEXES, ensure_indexes


class IndexTests(unittest.TestCase):
    def setUp(self):
        patcher = patch('app.services.indexes.database')
        self.db = MagicMock()
        patcher.start().return_value = self.db
        self.addCleanup(patcher.stop)

    def test_creates_every_index_once_mongodb_responds(self):
        self.assertEqual(ensure_indexes(), len(INDEXES))
        self.assertEqual(self.db.__getitem__.return_value.create_index.call_count, len(INDEXES))

    def test_expired_sessions_and_login_attempts_are_removed_by_ttl(self):
        ttl = {(collection, options['name']): options.get('expireAfterSeconds')
               for collection, _keys, options in INDEXES}
        self.assertEqual(ttl[('auth_sessions', 'session_expiry_ttl')], 0)
        self.assertEqual(ttl[('login_attempts', 'login_attempt_expiry_ttl')], 0)

    def test_user_scoped_history_is_indexed_by_user_first(self):
        keys = {collection: [index_keys for name, index_keys, _ in INDEXES if name == collection]
                for collection in ('communication_sessions', 'learning_attempts', 'tts_events')}
        for collection, index_keys in keys.items():
            self.assertTrue(any(fields[0][0] == 'user_id' for fields in index_keys), collection)

    def test_one_failed_index_does_not_block_the_rest(self):
        self.db.__getitem__.return_value.create_index.side_effect = (
            [OperationFailure('conflict')] + [None] * (len(INDEXES) - 1))
        self.assertEqual(ensure_indexes(), len(INDEXES) - 1)

    def test_waits_for_mongodb_then_gives_up_without_raising(self):
        self.db.command.side_effect = ServerSelectionTimeoutError('down')
        sleep = MagicMock()
        self.assertEqual(ensure_indexes(attempts=3, retry_seconds=1, sleep=sleep), 0)
        self.assertEqual(sleep.call_count, 2)
        self.db.__getitem__.return_value.create_index.assert_not_called()

    def test_retries_until_mongodb_is_ready(self):
        self.db.command.side_effect = [ServerSelectionTimeoutError('starting'), {'ok': 1}]
        sleep = MagicMock()
        self.assertEqual(ensure_indexes(attempts=3, retry_seconds=1, sleep=sleep), len(INDEXES))
        sleep.assert_called_once_with(1)


if __name__ == '__main__':
    unittest.main()
