"""MongoDB-backed prototype authentication with opaque session tokens."""
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pymongo.errors import DuplicateKeyError, PyMongoError
from app.services.database import database as _database, log_crud

SESSION_HOURS = 12
security = HTTPBearer(auto_error=False)


def _password_hash(password, salt=None):
    salt_bytes = bytes.fromhex(salt) if salt else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt_bytes, 310_000)
    return salt_bytes.hex(), digest.hex()


def _public_user(user):
    from app.services.profiles import public_profile
    return {'id': str(user['_id']), 'username': user['username'], 'name': user['name'], 'role': user['role'], 'profile': public_profile(user)}


def _ensure_user(username, password, name, role):
    salt, password_hash = _password_hash(password)
    database = _database()
    database.users.update_one(
        {'_id': username},
        {'$set': {'username': username, 'name': name, 'role': role,
                  'password_salt': salt, 'password_hash': password_hash},
         '$setOnInsert': {'created_at': datetime.now(timezone.utc)}},
        upsert=True,
    )
    log_crud('UPDATE', 'users', f'{role} 데모 계정 동기화')


def ensure_demo_users():
    user_id = os.environ.get('DEMO_USERNAME', 'demo')
    _ensure_user(user_id, os.environ.get('DEMO_PASSWORD', 'demo1234'), '민준', 'user')
    caregiver_id = os.environ.get('CAREGIVER_USERNAME', 'caregiver')
    _ensure_user(caregiver_id, os.environ.get('CAREGIVER_PASSWORD', 'caregiver1234'), '민준 보호자', 'caregiver')
    admin_id = os.environ.get('ADMIN_USERNAME', 'admin')
    _ensure_user(admin_id, os.environ.get('ADMIN_PASSWORD', 'admin1234'), '컨텐츠 관리자', 'admin')
    database = _database()
    privacy = database.privacy_settings.find_one({'_id': user_id})
    latest_access_change = database.privacy_audit_logs.find_one(
        {'user_id': user_id, 'target_id': caregiver_id,
         'action': {'$in': ['caregiver_connected', 'caregiver_disconnected']}},
        sort=[('created_at', -1)],
    )
    if (privacy and privacy.get('guardian_consent') and privacy.get('deletion_status') != 'completed'
            and (not latest_access_change or latest_access_change['action'] != 'caregiver_disconnected')):
        database.caregiver_links.update_one(
            {'_id': f'{caregiver_id}:{user_id}'},
            {'$set': {'caregiver_id': caregiver_id, 'user_id': user_id},
             '$setOnInsert': {'created_at': datetime.now(timezone.utc)}},
            upsert=True,
        )
        log_crud('UPDATE', 'caregiver_links', '데모 사용자 최초 연결')


def login(username, password):
    try:
        ensure_demo_users()
        database = _database()
        user = database.users.find_one({'username': username})
        log_crud('READ', 'users', '로그인 계정 조회')
        if not user:
            raise HTTPException(401, '아이디 또는 비밀번호가 올바르지 않습니다.')
        _, candidate = _password_hash(password, user['password_salt'])
        if not hmac.compare_digest(candidate, user['password_hash']):
            raise HTTPException(401, '아이디 또는 비밀번호가 올바르지 않습니다.')
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS)
        database.auth_sessions.insert_one({
            '_id': hashlib.sha256(token.encode()).hexdigest(),
            'user_id': str(user['_id']),
            'expires_at': expires_at,
        })
        log_crud('CREATE', 'auth_sessions', '로그인 세션 생성')
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
            log_crud('READ', 'users', '회원가입 아이디 중복 확인')
            raise HTTPException(409, '이미 사용 중인 아이디입니다.')
        salt, password_hash = _password_hash(password)
        database.users.insert_one({
            '_id': username,
            'username': username,
            'name': name,
            'role': 'user',
            'password_salt': salt,
            'password_hash': password_hash,
            'created_at': datetime.now(timezone.utc),
        })
        log_crud('CREATE', 'users', '일반 사용자 회원가입')
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
        log_crud('READ', 'auth_sessions', '로그인 세션 확인')
        now = datetime.now(timezone.utc)
        expires_at = session.get('expires_at') if session else None
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if not session or not expires_at or expires_at <= now:
            if session:
                database.auth_sessions.delete_one({'_id': token_hash})
                log_crud('DELETE', 'auth_sessions', '만료 세션 삭제')
            raise HTTPException(401, '로그인 시간이 만료되었습니다.', headers={'WWW-Authenticate': 'Bearer'})
        user = database.users.find_one({'_id': session['user_id']})
        log_crud('READ', 'users', '인증 사용자 조회')
        if not user:
            raise HTTPException(401, '사용자 계정을 찾을 수 없습니다.')
        return _public_user(user) | {'session_expires_at': expires_at}
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '로그인 저장소에 연결하지 못했습니다.') from exc


def logout(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if credentials:
        try:
            _database().auth_sessions.delete_one({'_id': hashlib.sha256(credentials.credentials.encode()).hexdigest()})
            log_crud('DELETE', 'auth_sessions', '로그아웃 세션 삭제')
        except PyMongoError as exc:
            raise HTTPException(503, '로그아웃을 처리하지 못했습니다.') from exc


def linked_users(caregiver_id):
    try:
        database = _database()
        links = database.caregiver_links.find({'caregiver_id': caregiver_id})
        users = []
        for link in links:
            linked = database.users.find_one({'_id': link['user_id'], 'role': 'user'})
            if linked:
                users.append(_public_user(linked))
        log_crud('READ', 'caregiver_links', '연결 사용자 조회')
        return users
    except PyMongoError as exc:
        raise HTTPException(503, '연결 사용자 정보를 조회하지 못했습니다.') from exc


def dashboard_user(requester, requested_user_id=None):
    if requester['role'] == 'user':
        if requested_user_id and requested_user_id != requester['id']:
            raise HTTPException(403, '다른 사용자의 기록에 접근할 수 없습니다.')
        return requester['id']
    if requester['role'] == 'caregiver':
        available = linked_users(requester['id'])
        if not available:
            raise HTTPException(404, '연결된 사용자가 없습니다.')
        target = requested_user_id or available[0]['id']
        if target not in {user['id'] for user in available}:
            raise HTTPException(403, '연결되지 않은 사용자의 기록에 접근할 수 없습니다.')
        return target
    raise HTTPException(403, '이용 현황을 조회할 권한이 없습니다.')
