"""Opt-in real MongoDB tests. Never use the application database setting."""
import os
from uuid import uuid4

import pytest
from pymongo import MongoClient


@pytest.fixture
def mongo_config():
    uri = os.environ.get('PECS_TEST_MONGODB_URI')
    prefix = os.environ.get('PECS_TEST_MONGODB_DATABASE')
    if not uri or not prefix:
        pytest.skip('Set PECS_TEST_MONGODB_URI and PECS_TEST_MONGODB_DATABASE explicitly')
    if not prefix.startswith('pesc_mate_test_') or len(prefix) > 40 or not prefix.replace('_', '').isalnum():
        pytest.fail('Test database prefix must start with pesc_mate_test_ and contain only letters, digits, underscores')
    return uri, prefix + '_' + uuid4().hex[:12]


@pytest.fixture
def mongo_db(mongo_config):
    uri, name = mongo_config
    client = MongoClient(uri, serverSelectionTimeoutMS=3000, connectTimeoutMS=3000, tz_aware=True)
    client.admin.command('ping')
    assert name not in client.list_database_names(), 'Refuse an existing database'
    db = client[name]
    try:
        yield db
    finally:
        # Retention policy: remove only this fixture's unique, synthetic database.
        client.drop_database(name)
        client.close()
