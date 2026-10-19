"""Explicitly configured custodians manage staff content permissions, not child access."""
import os
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.database import database as _database
from app.services.schema_versions import SCHEMA_VERSION
from app.services.account_access import account_access_allowed, public_access_state, utc_now
from app.services.reauthentication import verify_account_password


def configured_manager_ids():
    return {value.strip() for value in os.environ.get('ACCOUNT_PERMISSION_MANAGER_IDS', '').split(',') if value.strip()}


def can_manage_account_permissions(user):
    return (user.get('role') == 'support_staff'
            and str(user.get('_id', user.get('id', ''))) in configured_manager_ids()
            and account_access_allowed(user))


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
            'permission_revision': permission_revision(user), **public_access_state(user),
            'access_protected': str(user['_id']) in configured_manager_ids()}


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
                'before_revision', 'after_revision', 'reason', 'status', 'created_at', 'action')}
                | {'id': row['_id']} for row in rows]
    except PyMongoError as exc:
        raise HTTPException(503, '운영 권한 감사 기록을 조회하지 못했습니다.') from exc


def _reauthenticate(actor, password, client_ip):
    require_manager(actor)
    database = _database()
    responsible = database.users.find_one({'_id': actor['id'], 'role': 'support_staff'})
    if not responsible or not can_manage_account_permissions(responsible):
        raise HTTPException(403, '운영 권한 관리 책임자를 확인해 주세요.')
    if permission_revision(responsible) != actor.get('permission_revision', 0):
        raise HTTPException(401, '권한이 변경되었습니다. 다시 로그인해 주세요.')
    verify_account_password(responsible, password, client_ip, 'account-permission:')
    return database


def _target(database, target_id, expected_revision):
    target = database.users.find_one({'_id': target_id, 'role': 'support_staff'})
    if not target:
        raise HTTPException(404, '담당자 계정을 찾을 수 없습니다.')
    if permission_revision(target) != expected_revision:
        raise HTTPException(409, '다른 곳에서 권한을 변경했습니다. 계정을 다시 조회해 주세요.')
    return target


def _apply_change(database, actor, target, fields, before, after, reason, action):
    revision = permission_revision(target)
    if before == after:
        return _staff_public(target) | {'changed': False, 'audit_id': None}
    now = datetime.now(timezone.utc)
    audit_id = str(uuid4())
    database.account_permission_audit_logs.insert_one({
        '_id': audit_id, 'schema_version': SCHEMA_VERSION, 'actor_id': actor['id'],
        'target_id': str(target['_id']), 'before': before, 'after': after, 'action': action,
        'before_revision': revision, 'after_revision': revision + 1,
        'reason': reason, 'status': 'prepared', 'created_at': now,
    })
    version_filter = {'permission_revision': revision} if revision else {
        '$or': [{'permission_revision': 0}, {'permission_revision': {'$exists': False}}]}
    result = database.users.update_one(
        {'_id': target['_id'], 'role': 'support_staff',
         'account_permissions': target.get('account_permissions'),
         'account_active': target.get('account_active'), 'access_expires_at': target.get('access_expires_at'),
         **version_filter},
        {'$set': {**fields, 'permission_revision': revision + 1,
                  'last_account_permission_change': audit_id, 'permissions_updated_at': now}},
    )
    status = 'applied' if result.modified_count == 1 else 'conflict'
    database.account_permission_audit_logs.update_one({'_id': audit_id}, {'$set': {'status': status}})
    if status == 'conflict':
        raise HTTPException(409, '다른 곳에서 권한을 변경했습니다. 계정을 다시 조회해 주세요.')
    return _staff_public(target | fields | {'permission_revision': revision + 1}) | {'changed': True, 'audit_id': audit_id}


def change_content_permission(actor, target_id, enabled, expected_revision, password, reason, client_ip=None):
    try:
        database = _reauthenticate(actor, password, client_ip)
        target = _target(database, target_id, expected_revision)
        if enabled and not account_access_allowed(target):
            raise HTTPException(409, '계정 접근 제한을 해제한 뒤 운영 권한을 부여해 주세요.')
        permissions = [value for value in target.get('account_permissions', []) if value != 'content_manage']
        if enabled:
            permissions.append('content_manage')
        return _apply_change(database, actor, target, {'account_permissions': permissions},
                             'content_manage' in target.get('account_permissions', []), enabled, reason, 'content_permission')
    except PyMongoError as exc:
        raise HTTPException(503, '권한 변경 결과를 확인하지 못했습니다. 다시 조회한 뒤 감사 기록을 확인해 주세요.') from exc


def change_account_access(actor, target_id, active, deadline, expected_revision, password, reason, client_ip=None):
    try:
        database = _reauthenticate(actor, password, client_ip)
        target = _target(database, target_id, expected_revision)
        if target_id in configured_manager_ids() and (not active or deadline is not None):
            raise HTTPException(409, '관리 책임자는 비활성화하거나 만료 시각을 지정할 수 없습니다. 책임자 설정을 먼저 변경해 주세요.')
        if deadline is not None:
            if not isinstance(deadline, datetime) or deadline.tzinfo is None:
                raise HTTPException(422, '시간대가 포함된 만료 시각을 입력해 주세요.')
            deadline = deadline.astimezone(timezone.utc)
            # MongoDB BSON dates have millisecond precision.
            deadline = deadline.replace(microsecond=deadline.microsecond // 1000 * 1000)
            if deadline <= utc_now():
                raise HTTPException(422, '만료 시각은 현재보다 이후여야 합니다.')
        fields = {'account_active': active, 'access_expires_at': deadline}
        return _apply_change(database, actor, target, fields, public_access_state(target),
                             public_access_state(fields), reason, 'account_access')
    except PyMongoError as exc:
        # The write may have succeeded. A prepared audit is NOT proof of a failed change.
        raise HTTPException(503, '권한 변경 결과를 확인하지 못했습니다. 다시 조회한 뒤 감사 기록을 확인해 주세요.') from exc
