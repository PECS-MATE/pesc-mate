from datetime import datetime, timedelta, timezone
import hashlib

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from app.services import authentication as auth


@pytest.fixture
def account(db):
    salt, hashed = auth._password_hash('synthetic-password', '00' * 16)
    account = {'_id': 'one', 'username': 'synthetic-one', 'name': '합성 사용자', 'role': 'user',
               'password_salt': salt, 'password_hash': hashed}
    db.users.insert_one(account)
    return account


def test_login_expiry_logout_and_permission_revision(db, account):
    result = auth.login(account['username'], 'synthetic-password')
    credentials = HTTPAuthorizationCredentials(scheme='Bearer', credentials=result['access_token'])
    assert auth.current_user(credentials)['id'] == 'one'
    session_id = hashlib.sha256(result['access_token'].encode()).hexdigest()
    assert db.auth_sessions.find_one({'_id': session_id})
    db.users.update_one({'_id': 'one'}, {'$set': {'permission_revision': 1}})
    with pytest.raises(HTTPException) as error:
        auth.current_user(credentials)
    assert error.value.status_code == 401
    db.users.update_one({'_id': 'one'}, {'$set': {'permission_revision': 0}})
    db.auth_sessions.update_one({'_id': session_id}, {'$set': {'expires_at': datetime.now(timezone.utc) - timedelta(seconds=1)}})
    with pytest.raises(HTTPException) as error:
        auth.current_user(credentials)
    assert error.value.status_code == 401
    assert db.auth_sessions.find_one({'_id': session_id}) is None


@pytest.mark.parametrize('changes', [{'account_active': False}, {'registration_state': 'pending'},
    {'access_expires_at': datetime(2000, 1, 1, tzinfo=timezone.utc)}])
def test_unusable_account_cannot_login(db, account, changes):
    db.users.update_one({'_id': 'one'}, {'$set': changes})
    with pytest.raises(HTTPException) as error:
        auth.login(account['username'], 'synthetic-password')
    assert error.value.status_code in (401, 409)
    assert db.auth_sessions.count_documents({}) == 0


def test_wrong_password_and_anonymous_access(db, account):
    with pytest.raises(HTTPException) as error:
        auth.login(account['username'], 'wrong')
    assert error.value.status_code == 401
    with pytest.raises(HTTPException) as error:
        auth.current_user(None)
    assert error.value.headers == {'WWW-Authenticate': 'Bearer'}


def test_linked_target_selection_and_revocation(monkeypatch):
    requester = {'id': 'guardian', 'role': 'caregiver'}
    users = [{'id': 'one', 'permissions': ['records_read']}, {'id': 'two', 'permissions': ['cards_manage']}]
    monkeypatch.setattr(auth, 'linked_users', lambda _: users)
    assert auth.dashboard_user(requester) == 'one'
    assert auth.dashboard_user(requester, 'two', 'cards_manage') == 'two'
    for requester, target in [({'id': 'one', 'role': 'user'}, 'two'), (requester, 'two')]:
        with pytest.raises(HTTPException) as error:
            auth.dashboard_user(requester, target)
        assert error.value.status_code == 403
    users[0]['permissions'] = []
    with pytest.raises(HTTPException):
        auth.dashboard_user({'id': 'guardian', 'role': 'caregiver'}, 'one')


def test_logout_removes_only_its_session(db, account):
    result = auth.login(account['username'], 'synthetic-password')
    credentials = HTTPAuthorizationCredentials(scheme='Bearer', credentials=result['access_token'])
    db.auth_sessions.insert_one({'_id': 'other-synthetic-session', 'user_id': 'two'})
    auth.logout(credentials)
    assert db.auth_sessions.count_documents({'user_id': 'one'}) == 0
    assert db.auth_sessions.count_documents({'user_id': 'two'}) == 1
    with pytest.raises(HTTPException) as error:
        auth.current_user(credentials)
    assert error.value.status_code == 401
