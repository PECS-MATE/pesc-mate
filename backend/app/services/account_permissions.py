"""Explicitly configured custodians manage staff content permissions, not child access."""
import hmac
import os
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.database import database as _database
from app.services.schema_versions import SCHEMA_VERSION


def can_manage_account_permissions(user):
    managers = {value.strip() for value in os.environ.get('ACCOUNT_PERMISSION_MANAGER_IDS', '').split(',') if value.strip()}
    return user.get('role') == 'support_staff' and str(user.get('_id', user.get('id', ''))) in managers


def require_manager(user):
    if not can_manage_account_permissions(user):
        raise HTTPException(403, '운영 권한 관리 책임자만 사용할 수 있습니다.')


def permission_revision(user):
    value = user.get('permission_revision', 0)
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise HTTPException(503, '계정 권한 버전을 확인하지 못했습니다.')
    return value


def _staff_public(user):
    return {'id': str(user['_id']), 'username': user['username'], 'name': user['name'],
            'content_manage': 'content_manage' in user.get('account_permissions', []),
            'permission_revision': permission_revision(user)}


def staff_account(actor, username):
    require_manager(actor)
    try:
        # Exact lookup only; never enumerate children or expose their profiles/links.
        user = _database().users.find_one({'username': username, 'role': 'support_staff'})
        if not user:
            raise HTTPException(404, '담당자 계정을 찾을 수 없습니다.')
        return _staff_public(user)
    except PyMongoError as exc:
        raise HTTPException(503, '담당자 권한을 조회하지 못했습니다.') from exc


def permission_audit(actor, target_id):
    require_manager(actor)
    try:
        rows = _database().account_permission_audit_logs.find({'target_id': target_id}).sort('created_at', -1).limit(50)
        return [{key: row.get(key) for key in ('id', 'actor_id', 'target_id', 'before', 'after',
                'before_revision', 'after_revision', 'reason', 'status', 'created_at')}
                | {'id': row['_id']} for row in rows]
    except PyMongoError as exc:
        raise HTTPException(503, '운영 권한 감사 기록을 조회하지 못했습니다.') from exc


def change_content_permission(actor, target_id, enabled, expected_revision, password, reason, client_ip=None):
    require_manager(actor)
    from app.services.authentication import _password_hash
    from app.services.login_throttle import clear_login_failures, ensure_login_allowed, record_login_failure
    try:
        database = _database()
        # Check the responsible account again; caller-supplied role/permissions are never sufficient.
        responsible = database.users.find_one({'_id': actor['id'], 'role': 'support_staff'})
        if not responsible or not can_manage_account_permissions(responsible):
            raise HTTPException(403, '운영 권한 관리 책임자를 확인해 주세요.')
        if permission_revision(responsible) != actor.get('permission_revision', 0):
            raise HTTPException(401, '권한이 변경되었습니다. 다시 로그인해 주세요.')
        throttle_key = 'account-permission:' + responsible['username']
        ensure_login_allowed(throttle_key, client_ip)
        _, candidate = _password_hash(password, responsible['password_salt'])
        if not hmac.compare_digest(candidate, responsible['password_hash']):
            record_login_failure(throttle_key, client_ip)
            raise HTTPException(403, '관리 책임자 비밀번호를 확인해 주세요.')
        clear_login_failures(throttle_key, client_ip)
        target = database.users.find_one({'_id': target_id, 'role': 'support_staff'})
        if not target:
            raise HTTPException(404, '담당자 계정을 찾을 수 없습니다.')
        revision = permission_revision(target)
        if revision != expected_revision:
            raise HTTPException(409, '다른 곳에서 권한을 변경했습니다. 계정을 다시 조회해 주세요.')
        before = 'content_manage' in target.get('account_permissions', [])
        if before == enabled:
            return _staff_public(target) | {'changed': False, 'audit_id': None}
        now = datetime.now(timezone.utc)
        audit_id = str(uuid4())
        # Persist intent BEFORE the authoritative write. No transaction support is required.
        database.account_permission_audit_logs.insert_one({
            '_id': audit_id, 'schema_version': SCHEMA_VERSION, 'actor_id': actor['id'],
            'target_id': target_id, 'before': before, 'after': enabled,
            'before_revision': revision, 'after_revision': revision + 1,
            'reason': reason, 'status': 'prepared', 'created_at': now,
        })
        version_filter = {'permission_revision': revision} if revision else {
            '$or': [{'permission_revision': 0}, {'permission_revision': {'$exists': False}}]}
        permissions = [value for value in target.get('account_permissions', []) if value != 'content_manage']
        if enabled:
            permissions.append('content_manage')
        result = database.users.update_one(
            {'_id': target_id, 'role': 'support_staff',
             'account_permissions': target.get('account_permissions', None), **version_filter},
            {'$set': {'account_permissions': permissions, 'permission_revision': revision + 1,
                      'last_account_permission_change': audit_id, 'permissions_updated_at': now}},
        )
        status = 'applied' if result.modified_count == 1 else 'conflict'
        database.account_permission_audit_logs.update_one({'_id': audit_id}, {'$set': {'status': status}})
        if status == 'conflict':
            raise HTTPException(409, '다른 곳에서 권한을 변경했습니다. 계정을 다시 조회해 주세요.')
        # Permission and session version change in ONE atomic document update.
        # Old target sessions are rejected on their next request, including after a later re-grant.
        return _staff_public(target | {'account_permissions': permissions, 'permission_revision': revision + 1}) | {
            'changed': True, 'audit_id': audit_id}
    except PyMongoError as exc:
        # The write may have succeeded. A prepared audit is NOT proof of a failed change.
        raise HTTPException(503, '권한 변경 결과를 확인하지 못했습니다. 다시 조회한 뒤 감사 기록을 확인해 주세요.') from exc
