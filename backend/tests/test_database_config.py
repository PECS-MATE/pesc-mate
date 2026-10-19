import asyncio
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from app.services.database_config import DatabaseConfigurationError, connection_options


class DatabaseConfigurationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.username = self.directory / 'username'
        self.password = self.directory / 'password'
        self.username.write_text('synthetic_app\n', encoding='ascii')
        self.password.write_text('synthetic-only-password-' + 'x' * 32 + '\r\n', encoding='ascii')
        environment = patch.dict(os.environ, {}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

    def secure(self, **extra):
        os.environ.update({'MONGODB_REQUIRE_AUTH': 'true', 'MONGODB_HOST': 'mongodb',
                           'MONGODB_DATABASE': 'pesc_mate_secure',
                           'MONGODB_USERNAME_FILE': str(self.username), 'MONGODB_PASSWORD_FILE': str(self.password), **extra})

    def test_local_default_and_explicit_uri_remain_compatible(self):
        self.assertEqual(connection_options(), {'host': 'mongodb://127.0.0.1:27017'})
        os.environ['MONGODB_URI'] = 'mongodb://local-fixture:27017'
        self.assertEqual(connection_options(), {'host': 'mongodb://local-fixture:27017'})

    def test_secret_mode_uses_driver_arguments_not_credential_uri_and_db_scoped_scram(self):
        self.secure(MONGODB_PORT='27018')
        settings = connection_options()
        self.assertEqual(settings['host'], 'mongodb')
        self.assertEqual(settings['port'], 27018)
        self.assertEqual(settings['username'], 'synthetic_app')
        self.assertEqual(settings['password'], 'synthetic-only-password-' + 'x' * 32)
        self.assertEqual(settings['authSource'], 'pesc_mate_secure')
        self.assertEqual(settings['authMechanism'], 'SCRAM-SHA-256')

    def test_required_mode_never_falls_back_when_credentials_are_missing(self):
        os.environ['MONGODB_REQUIRE_AUTH'] = 'true'
        with self.assertRaises(DatabaseConfigurationError):
            connection_options()

    def test_partial_or_blank_file_configuration_never_falls_back_in_local_mode(self):
        for key, value in (('MONGODB_USERNAME_FILE', str(self.username)), ('MONGODB_PASSWORD_FILE', '')):
            with patch.dict(os.environ, {key: value}, clear=True), self.assertRaises(DatabaseConfigurationError):
                connection_options()

    def test_uri_and_file_credentials_are_ambiguous_and_never_echoed(self):
        self.secure(MONGODB_URI='mongodb://private-user:private-password@private-host')
        with self.assertRaises(DatabaseConfigurationError) as caught:
            connection_options()
        self.assertNotIn('private-', str(caught.exception))

    def test_invalid_flags_hosts_ports_database_and_auth_source_fail_closed(self):
        for key, value in (('MONGODB_REQUIRE_AUTH', 'treu'), ('MONGODB_REQUIRE_AUTH', ''),
                           ('MONGODB_HOST', ''), ('MONGODB_HOST', 'mongodb://private-host'),
                           ('MONGODB_PORT', '0'), ('MONGODB_PORT', '65536'), ('MONGODB_PORT', 'bad'),
                           ('MONGODB_DATABASE', ''), ('MONGODB_DATABASE', 'admin'), ('MONGODB_DATABASE', 'LOCAL'),
                           ('MONGODB_DATABASE', 'bad/name'), ('MONGODB_DATABASE', 'a' * 64),
                           ('MONGODB_AUTH_SOURCE', 'admin')):
            with self.subTest(key=key, value=value):
                self.secure(**{key: value})
                try:
                    with self.assertRaises(DatabaseConfigurationError):
                        connection_options()
                finally:
                    os.environ.pop(key, None)

    def test_secret_files_must_be_absolute_existing_regular_and_bounded(self):
        self.secure()
        for path in ('relative-secret', str(self.directory), str(self.directory / 'missing')):
            os.environ['MONGODB_PASSWORD_FILE'] = path
            with self.subTest(path=path), self.assertRaises(DatabaseConfigurationError):
                connection_options()
        os.environ['MONGODB_PASSWORD_FILE'] = str(self.password)
        self.password.write_bytes(b'x' * 1025)
        with self.assertRaises(DatabaseConfigurationError):
            connection_options()

    def test_invalid_passwords_are_not_coerced_or_exposed(self):
        self.secure()
        for value in (b'', b'demo1234', b'x' * 257, b'x' * 31 + b' ', b'x' * 31 + b'\nprivate', b'\xff' * 40):
            self.password.write_bytes(value)
            with self.subTest(length=len(value)), self.assertRaises(DatabaseConfigurationError) as caught:
                connection_options()
            self.assertNotIn('private', str(caught.exception))

    def test_application_username_cannot_be_root_admin_or_malformed(self):
        self.secure()
        for value in ('root', 'Admin', 'ab', 'bad/user', 'x' * 65):
            self.username.write_text(value, encoding='ascii')
            with self.subTest(value=value), self.assertRaises(DatabaseConfigurationError):
                connection_options()

    def test_validated_credentials_reach_the_cached_client_without_network_calls(self):
        from app.services.database import client
        self.secure()
        client.cache_clear()
        self.addCleanup(client.cache_clear)
        with patch('app.services.database.MongoClient') as mongo:
            first = client()
            self.assertIs(client(), first)
            mongo.assert_called_once()
            self.assertEqual(mongo.call_args.kwargs['authSource'], 'pesc_mate_secure')
            self.assertEqual(mongo.call_args.kwargs['username'], 'synthetic_app')
            self.assertEqual(mongo.call_args.kwargs['serverSelectionTimeoutMS'], 3000)

    def test_invalid_required_configuration_stops_startup_before_background_indexes(self):
        from app.main import lifespan
        os.environ['MONGODB_REQUIRE_AUTH'] = 'true'

        async def start():
            async with lifespan(None):
                self.fail('Invalid authenticated configuration must not serve requests')

        with patch('app.main.Thread') as thread, self.assertRaises(DatabaseConfigurationError):
            asyncio.run(start())
        thread.assert_not_called()
