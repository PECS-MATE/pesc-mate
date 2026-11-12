"""Hermetic defaults: no MongoDB/model servers or real user fixtures."""
from io import BytesIO
import sys

import mongomock
import pytest
from PIL import Image
from fastapi.testclient import TestClient

from app.main import app
from app.services import database as database_module


@pytest.fixture(autouse=True)
def forbid_external_services(monkeypatch):
    monkeypatch.setenv('DEMO_ACCOUNTS_ENABLED', 'false')
    monkeypatch.setenv('OLLAMA_ENABLED', 'false')
    def forbidden(*args, **kwargs):
        raise AssertionError('External service access is forbidden in the default suite')
    monkeypatch.setattr(database_module, 'client', forbidden)
    # urllib is used by local model, speech and image providers.
    monkeypatch.setattr('urllib.request.urlopen', forbidden)


@pytest.fixture
def db(monkeypatch):
    database = mongomock.MongoClient(tz_aware=True).synthetic_regression
    original = database_module.database
    # Patch already imported aliases without changing production seams.
    for module in list(sys.modules.values()):
        if module and getattr(module, '__name__', '').startswith('app.'):
            for name in ('database', '_database'):
                if getattr(module, name, None) is original:
                    monkeypatch.setattr(module, name, lambda: database)
    return database


@pytest.fixture
def consented(db):
    for user_id in ('one', 'two'):
        db.privacy_settings.insert_one({'_id': user_id, 'guardian_consent': True, 'recording_revision': 1})
    return db


@pytest.fixture
def client():
    # No context manager: lifespan intentionally does not start indexes or warmup.
    app.dependency_overrides.clear()
    client = TestClient(app)
    yield client
    client.close()
    app.dependency_overrides.clear()


@pytest.fixture
def png_bytes():
    output = BytesIO()
    Image.new('RGB', (128, 128), '#337799').save(output, format='PNG')
    return output.getvalue()
