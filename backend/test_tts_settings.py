import unittest
from unittest.mock import MagicMock, patch

from app.services.tts_settings import DEFAULT_SETTINGS, save_settings, settings_for


class TtsSettingsTests(unittest.TestCase):
    @patch('app.services.tts_settings._database')
    def test_default_settings_are_returned_for_new_user(self, mocked_database):
        database = MagicMock()
        database.tts_settings.find_one.return_value = None
        mocked_database.return_value = database

        self.assertEqual(settings_for('new-user'), DEFAULT_SETTINGS)
        database.tts_settings.find_one.assert_called_once_with({'_id': 'new-user'})

    @patch('app.services.tts_settings._database')
    def test_saved_settings_are_scoped_to_user(self, mocked_database):
        database = MagicMock()
        mocked_database.return_value = database

        result = save_settings('demo', 'man', 'Microsoft InJoon', 0.8, 0.75, 0.7)

        self.assertEqual(result['preset'], 'man')
        self.assertEqual(result['voice_name'], 'Microsoft InJoon')
        query, update = database.tts_settings.update_one.call_args.args[:2]
        self.assertEqual(query, {'_id': 'demo'})
        self.assertEqual(update['$set']['rate'], 0.8)
        self.assertEqual(update['$set']['volume'], 0.7)
        self.assertEqual(update['$setOnInsert']['user_id'], 'demo')
        self.assertTrue(database.tts_settings.update_one.call_args.kwargs['upsert'])

    @patch('app.services.tts_settings._database')
    def test_saved_settings_are_read_without_internal_fields(self, mocked_database):
        database = MagicMock()
        database.tts_settings.find_one.return_value = {
            '_id': 'demo', 'user_id': 'demo', 'preset': 'woman',
            'voice_name': '한국어 음성', 'rate': 1.1, 'pitch': 1.05, 'volume': 0.8,
        }
        mocked_database.return_value = database

        self.assertEqual(settings_for('demo'), {
            'preset': 'woman', 'voice_name': '한국어 음성', 'rate': 1.1, 'pitch': 1.05,
            'volume': 0.8,
        })

    @patch('app.services.tts_settings._database')
    def test_legacy_settings_receive_safe_default_volume(self, mocked_database):
        database = MagicMock()
        database.tts_settings.find_one.return_value = {
            '_id': 'demo', 'preset': 'child', 'voice_name': '', 'rate': 0.9, 'pitch': 1.25,
        }
        mocked_database.return_value = database

        self.assertEqual(settings_for('demo')['volume'], 1.0)


if __name__ == '__main__':
    unittest.main()
