import hmac

import pytest

from app.services.authentication import _password_hash, ensure_demo_users
from app.services.presentation_accounts import prepare_presentation_accounts


def test_presentation_passwords_preserve_data_and_are_repeatable(db, tmp_path):
    salt, hashed = _password_hash('old-password')
    db.users.insert_one({'_id': 'guardian', 'username': 'guardian', 'role': 'caregiver',
                         'name': '기존 보호자', 'account_permissions': [], 'account_active': False,
                         'password_salt': salt, 'password_hash': hashed})
    db.auth_sessions.insert_one({'_id': 'existing-session', 'user_id': 'guardian'})
    db.privacy_settings.insert_one({'_id': 'guardian', 'guardian_consent': False})
    first = prepare_presentation_accounts(db, '1234', tmp_path)
    assert first['created_demo2'] and first['verified'] == 2
    guardian = db.users.find_one({'_id': 'guardian'})
    assert guardian['name'] == '기존 보호자' and guardian['role'] == 'caregiver'
    assert guardian['account_active'] is False and guardian['account_permissions'] == []
    assert db.auth_sessions.count_documents({}) == 1
    assert db.privacy_settings.count_documents({}) == 1
    assert not db.privacy_settings.find_one({'_id': 'demo2'})
    assert not db.caregiver_links.find_one({'user_id': 'demo2'})
    for row in db.users.find():
        _, candidate = _password_hash('1234', row['password_salt'])
        assert hmac.compare_digest(candidate, row['password_hash'])
    second = prepare_presentation_accounts(db, '1234', tmp_path)
    assert not second['created_demo2'] and second['updated'] == 0 and second['verified'] == 2
    assert len(list(tmp_path.glob('*.json'))) == 2


def test_presentation_refuses_demo2_collision_before_writes(db, tmp_path):
    db.users.insert_one({'_id': 'demo2', 'username': 'demo2', 'role': 'caregiver'})
    with pytest.raises(ValueError):
        prepare_presentation_accounts(db, '1234', tmp_path)
    assert db.users.find_one({'_id': 'demo2'})['role'] == 'caregiver'
    assert not list(tmp_path.iterdir())


def test_demo_seed_has_two_children_and_does_not_reset_existing_password(db, monkeypatch):
    for key in ('DEMO_USERNAME', 'DEMO_PASSWORD', 'DEMO_SECOND_USERNAME', 'DEMO_SECOND_PASSWORD',
                'CAREGIVER_USERNAME', 'CAREGIVER_PASSWORD', 'SUPPORT_USERNAME', 'SUPPORT_PASSWORD',
                'ADMIN_USERNAME', 'ADMIN_PASSWORD'):
        monkeypatch.delenv(key, raising=False)
    ensure_demo_users()
    assert db.users.count_documents({'role': 'user'}) == 2
    for row in db.users.find():
        _, candidate = _password_hash('1234', row['password_salt'])
        assert hmac.compare_digest(candidate, row['password_hash'])
    salt, hashed = _password_hash('changed-after-demo')
    db.users.update_one({'_id': 'demo2'}, {'$set': {'password_salt': salt, 'password_hash': hashed}})
    ensure_demo_users()
    assert db.users.find_one({'_id': 'demo2'})['password_hash'] == hashed
