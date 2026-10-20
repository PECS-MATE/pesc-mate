"""MongoDB-backed prototype authentication with opaque session tokens."""
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pymongo.errors import DuplicateKeyError, PyMongoError
from app.services.database import database as _database
from app.services.schema_versions import SCHEMA_VERSION
from app.services.login_throttle import clear_login_failures, ensure_login_allowed, record_login_failure
from app.services.account_permissions import can_manage_account_permissions, permission_revision
from app.services.account_access import access_state, account_access_allowed

SESSION_HOURS = 12
ACCOUNT_PERMISSIONS = ('content_manage',)
security = HTTPBearer(auto_error=False)


def _password_hash(password, salt=None):
    salt_bytes = bytes.fromhex(salt) if salt else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt_bytes, 310_000)
    return salt_bytes.hex(), digest.hex()


def _public_user(user):
    from app.services.profiles import public_profile
    active, deadline = access_state(user)
    legacy_admin = user.get('role') == 'admin'
    permissions = list(user.get('account_permissions', []))
    if legacy_admin and 'content_manage' not in permissions:
        permissions.append('content_manage')
    return {
        'id': str(user['_id']),
        'username': user['username'],
        'name': user['name'],
        'role': 'support_staff' if legacy_admin else user['role'],
        'account_permissions': [permission for permission in ACCOUNT_PERMISSIONS if permission in permissions],
        'can_manage_account_permissions': can_manage_account_permissions(user),
        'permission_revision': permission_revision(user),
        'account_active': active,
        'access_expires_at': deadline,
        'profile': public_profile(user),
    }


def demo_accounts_enabled():
    return os.environ.get('DEMO_ACCOUNTS_ENABLED', '').strip().lower() in {'1', 'true', 'yes'}


def _ensure_user(username, password, name, role, account_permissions=None):
    database = _database()
    profile = {'username': username, 'name': name, 'role': role,
               'account_permissions': account_permissions or []}
    if database.users.find_one({'_id': username}, {'_id': 1}):
        # Seeding must never restore an explicitly revoked operating permission.
        database.users.update_one({'_id': username}, {'$set': {key: value for key, value in profile.items() if key != 'account_permissions'}})
        return
    salt, password_hash = _password_hash(password)
    database.users.update_one(
        {'_id': username},
        {'$set': profile,
         '$setOnInsert': {'schema_version': SCHEMA_VERSION, 'password_salt': salt, 'password_hash': password_hash,
                          'created_at': datetime.now(timezone.utc)}},
        upsert=True,
    )


def _migrate_legacy_admins():
    _database().users.update_many(
        {'role': 'admin'},
        {'$set': {'role': 'support_staff'}, '$addToSet': {'account_permissions': 'content_manage'}},
    )


def ensure_demo_users():
    user_id = os.environ.get('DEMO_USERNAME', 'demo')
    _ensure_user(user_id, os.environ.get('DEMO_PASSWORD', 'demo1234'), '민준', 'user')
    caregiver_id = os.environ.get('CAREGIVER_USERNAME', 'caregiver')
    _ensure_user(caregiver_id, os.environ.get('CAREGIVER_PASSWORD', 'caregiver1234'), '민준 보호자', 'caregiver')
    staff_id = os.environ.get('SUPPORT_USERNAME', 'support')
    _ensure_user(staff_id, os.environ.get('SUPPORT_PASSWORD', 'support1234'), '민준 담당자', 'support_staff')
    admin_id = os.environ.get('ADMIN_USERNAME', 'admin')
    _ensure_user(admin_id, os.environ.get('ADMIN_PASSWORD', 'admin1234'),
                 '운영 권한 담당자', 'support_staff', ['content_manage'])
    database = _database()
    privacy = database.privacy_settings.find_one({'_id': user_id})
    latest_access_change = database.privacy_audit_logs.find_one(
        {'user_id': user_id, 'target_id': caregiver_id,
         'action': {'$in': ['caregiver_connected', 'caregiver_disconnected',
                            'support_granted', 'support_permissions_changed', 'support_revoked']}},
        sort=[('created_at', -1)],
    )
    existing_demo_link = database.caregiver_links.find_one({'_id': f'{caregiver_id}:{user_id}'})
    if (privacy and privacy.get('guardian_consent') and privacy.get('deletion_status') != 'completed'
            and existing_demo_link is None
            and (not latest_access_change or latest_access_change['action'] not in {'caregiver_disconnected', 'support_revoked'})):
        database.caregiver_links.update_one(
            {'_id': f'{caregiver_id}:{user_id}'},
            {'$setOnInsert': {'schema_version': SCHEMA_VERSION, 'created_at': datetime.now(timezone.utc),
                      'caregiver_id': caregiver_id, 'supporter_id': caregiver_id,
                      'supporter_role': 'caregiver', 'user_id': user_id,
                      'permissions': ['records_read', 'notes_write', 'cards_manage', 'quick_speech_manage',
                                      'board_manage', 'voice_access_manage', 'learning_manage'],
                      'active': True}},
            upsert=True,
        )


def login(username, password, client_ip=None):
    try:
        _migrate_legacy_admins()
        demo_enabled = demo_accounts_enabled()
        if demo_enabled:
            ensure_demo_users()
        ensure_login_allowed(username, client_ip)
        database = _database()
        user = database.users.find_one({'username': username})
        if not user:
            record_login_failure(username, client_ip)
            raise HTTPException(401, '아이디 또는 비밀번호가 올바르지 않습니다.')
        _, candidate = _password_hash(password, user['password_salt'])
        if not hmac.compare_digest(candidate, user['password_hash']) or not account_access_allowed(user):
            record_login_failure(username, client_ip)
            raise HTTPException(401, '아이디 또는 비밀번호가 올바르지 않습니다.')
        clear_login_failures(username, client_ip)
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS)
        _, access_deadline = access_state(user)
        if access_deadline is not None:
            expires_at = min(expires_at, access_deadline)
        database.auth_sessions.insert_one({
            'schema_version': SCHEMA_VERSION,
            '_id': hashlib.sha256(token.encode()).hexdigest(),
            'user_id': str(user['_id']),
            'permission_revision': permission_revision(user),
            'expires_at': expires_at,
        })
        if demo_enabled:
            from app.services.communication import ensure_demo_history
            ensure_demo_history(os.environ.get('DEMO_USERNAME', 'demo'))
        return {'access_token': token, 'token_type': 'bearer', 'expires_at': expires_at.isoformat(),
                'user': _public_user(user)}
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '로그인 저장소에 연결하지 못했습니다.') from exc


def register(username, password, name):
    try:
        database = _database()
        if database.users.find_one({'username': username}):
            raise HTTPException(409, '이미 사용 중인 아이디입니다.')
        salt, password_hash = _password_hash(password)
        database.users.insert_one({
            'schema_version': SCHEMA_VERSION,
            '_id': username,
            'username': username,
            'name': name,
            'role': 'user',
            'password_salt': salt,
            'password_hash': password_hash,
            'created_at': datetime.now(timezone.utc),
        })
        return login(username, password)
    except DuplicateKeyError as exc:
        raise HTTPException(409, '이미 사용 중인 아이디입니다.') from exc
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '회원가입 정보를 저장하지 못했습니다.') from exc


def current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials or credentials.scheme.lower() != 'bearer':
        raise HTTPException(401, '로그인이 필요합니다.', headers={'WWW-Authenticate': 'Bearer'})
    token_hash = hashlib.sha256(credentials.credentials.encode()).hexdigest()
    try:
        database = _database()
        session = database.auth_sessions.find_one({'_id': token_hash})
        now = datetime.now(timezone.utc)
        expires_at = session.get('expires_at') if session else None
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if not session or not expires_at or expires_at <= now:
            if session:
                database.auth_sessions.delete_one({'_id': token_hash})
            raise HTTPException(401, '로그인 시간이 만료되었습니다.', headers={'WWW-Authenticate': 'Bearer'})
        user = database.users.find_one({'_id': session['user_id']})
        if not user:
            raise HTTPException(401, '사용자 계정을 찾을 수 없습니다.')
        if not account_access_allowed(user):
            raise HTTPException(401, '계정이 비활성화되었거나 접근 기간이 만료되었습니다.',
                                headers={'WWW-Authenticate': 'Bearer'})
        if permission_revision(session) != permission_revision(user):
            raise HTTPException(401, '계정 권한이 변경되었습니다. 다시 로그인해 주세요.',
                                headers={'WWW-Authenticate': 'Bearer'})
        return _public_user(user) | {'session_expires_at': expires_at}
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '로그인 저장소에 연결하지 못했습니다.') from exc


def logout(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if credentials:
        try:
            _database().auth_sessions.delete_one({'_id': hashlib.sha256(credentials.credentials.encode()).hexdigest()})
        except PyMongoError as exc:
            raise HTTPException(503, '로그아웃을 처리하지 못했습니다.') from exc


def linked_users(supporter_id):
    from app.services.support_links import linked_users_for
    return linked_users_for(supporter_id)


def dashboard_user(requester, requested_user_id=None, permission='records_read'):
    if requester['role'] == 'user':
        if requested_user_id and requested_user_id != requester['id']:
            raise HTTPException(403, '다른 사용자의 기록에 접근할 수 없습니다.')
        return requester['id']
    if requester['role'] in {'caregiver', 'support_staff'}:
        available = linked_users(requester['id'])
        if not available:
            raise HTTPException(404, '연결된 사용자가 없습니다.')
        permitted = [user for user in available if permission in user.get('permissions', [])]
        target = requested_user_id or (permitted[0]['id'] if permitted else None)
        if not target or target not in {user['id'] for user in permitted}:
            raise HTTPException(403, '연결되지 않은 사용자의 기록에 접근할 수 없습니다.')
        return target
    raise HTTPException(403, '이용 현황을 조회할 권한이 없습니다.')


def require_account_permission(user, permission):
    if permission not in ACCOUNT_PERMISSIONS:
        raise ValueError(f'Unknown account permission: {permission}')
    if user.get('role') == 'admin':
        return user
    if user.get('role') != 'support_staff' or permission not in user.get('account_permissions', []):
        raise HTTPException(403, '이 계정에 필요한 운영 권한이 없습니다.')
    return user
