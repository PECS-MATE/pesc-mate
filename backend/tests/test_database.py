import unittest
from unittest.mock import patch

from app.services import database


class DatabaseConnectionTests(unittest.TestCase):
    def setUp(self):
        database.client.cache_clear()
        self.addCleanup(database.client.cache_clear)

    def test_application_reuses_one_client_with_validated_connection_options(self):
        with patch.object(database, 'connection_options', return_value={'host': 'mongodb://synthetic.invalid'}), \
                patch.object(database, 'MongoClient') as mongo:
            first = database.client()
            self.assertIs(database.client(), first)
        mongo.assert_called_once_with(host='mongodb://synthetic.invalid',
                                      serverSelectionTimeoutMS=3000, appname='pesc-mate-backend')

    def test_database_selection_uses_configured_name_without_extra_connections(self):
        selected = object()
        with patch.dict('os.environ', {'MONGODB_DATABASE': 'synthetic_database'}), \
                patch.object(database, 'client', return_value={'synthetic_database': selected}) as client:
            self.assertIs(database.database(), selected)
        client.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
