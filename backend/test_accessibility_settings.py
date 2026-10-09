import unittest
from unittest.mock import MagicMock, patch

from app.services.accessibility_settings import DEFAULT_SETTINGS, save_settings, settings_for


class AccessibilitySettingsTests(unittest.TestCase):
    @patch('app.services.accessibility_settings._database')
    def test_default_settings_are_returned_for_new_user(self, mocked_database):
        database = MagicMock()
        database.accessibility_settings.find_one.return_value = None
        mocked_database.return_value = database

        self.assertEqual(settings_for('new-user'), DEFAULT_SETTINGS)

    @patch('app.services.accessibility_settings._database')
    def test_settings_are_saved_for_each_user(self, mocked_database):
        database = MagicMock()
        mocked_database.return_value = database
        settings = DEFAULT_SETTINGS | {
            'display_mode': 'text', 'cards_per_page': 6, 'card_size': 'large',
            'text_size': 'large', 'reduced_motion': True, 'high_contrast': True,
        }

        self.assertEqual(save_settings('demo', settings), settings)
        query, update = database.accessibility_settings.update_one.call_args.args[:2]
        self.assertEqual(query, {'_id': 'demo'})
        self.assertEqual(update['$set']['display_mode'], 'text')
        self.assertEqual(update['$setOnInsert']['user_id'], 'demo')
        self.assertTrue(database.accessibility_settings.update_one.call_args.kwargs['upsert'])

    @patch('app.services.accessibility_settings._database')
    def test_internal_fields_are_not_exposed(self, mocked_database):
        database = MagicMock()
        database.accessibility_settings.find_one.return_value = {
            '_id': 'demo', 'user_id': 'demo', 'display_mode': 'image',
            'cards_per_page': 18, 'card_size': 'small', 'text_size': 'small',
            'reduced_motion': True, 'high_contrast': False, 'internal': 'hidden',
        }
        mocked_database.return_value = database

        result = settings_for('demo')
        self.assertEqual(result['display_mode'], 'image')
        self.assertNotIn('internal', result)


if __name__ == '__main__':
    unittest.main()
