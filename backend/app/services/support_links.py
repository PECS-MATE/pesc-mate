"""Account-scoped supporter links, permissions, and immutable audit events."""
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from app.services.database import database as _database, log_crud


SUPPORT_ROLES = {'caregiver', 'support_staff'}
LINK_PERMISSIONS = (
    'records_read',
    'notes_write',
    'quick_speech_manage',
    'board_manage',
    'voice_access_manage',
    'learning_manage',
)
LEGACY_PERMISSIONS = list(LINK_PERMISSIONS)


def _supporter_id(link):
    return link.get('supporter_id') or link.get('caregiver_id')


def _permissions(link):
    values = link.get('permissions')
    if values is None:
        return LEGACY_PERMISSIONS.copy()
    return [permission for permission in LINK_PERMISSIONS if permission in values]


def validate_permissions(permissions):
    requested = list(dict.fromkeys(permissions))
    unknown = set(requested) - set(LINK_PERMISSIONS)
    if unknown:
        raise HTTPException(422, f'알 수 없는 연결 권한입니다: {", ".join(sorted(unknown))}')
    if not requested:
        raise HTTPException(422, '연결 권한을 하나 이상 선택해 주세요.')
    return [permission for permission in LINK_PERMISSIONS if permission in requested]


def link_for(supporter_id, user_id):
    try:
        database = _database()
        link = database.caregiver_links.find_one({
            'user_id': user_id,
            '$or': [{'supporter_id': supporter_id}, {'caregiver_id': supporter_id}],
        })
        return link if link and link.get('active', True) else None
    except PyMongoError as exc:
        raise HTTPException(503, '연결 권한을 확인하지 못했습니다.') from exc


def permissions_for(supporter_id, user_id):
    link = link_for(supporter_id, user_id)
    return _permissions(link) if link else []


def require_link_permission(requester, user_id, permission):
    if permission not in LINK_PERMISSIONS:
        raise ValueError(f'Unknown link permission: {permission}')
    if requester['role'] == 'user':
        if requester['id'] != user_id:
            raise HTTPException(403, '다른 사용자의 정보에 접근할 수 없습니다.')
        return user_id
    if requester['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '연결 사용자 정보에 접근할 권한이 없습니다.')
    link = link_for(requester['id'], user_id)
    if not link:
        raise HTTPException(403, '연결되지 않은 사용자의 정보에 접근할 수 없습니다.')
    if permission not in _permissions(link):
        raise HTTPException(403, '이 연결에 필요한 권한이 없습니다.')
    return user_id


def require_any_link_permission(requester, user_id, permissions):
    requested = set(permissions)
    if not requested or not requested.issubset(LINK_PERMISSIONS):
        raise ValueError('Unknown or empty link permissions')
    if requester['role'] == 'user':
        if requester['id'] != user_id:
            raise HTTPException(403, '다른 사용자의 정보에 접근할 수 없습니다.')
        return user_id
    if requester['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '연결 사용자 정보에 접근할 권한이 없습니다.')
    link = link_for(requester['id'], user_id)
    if not link:
        raise HTTPException(403, '연결되지 않은 사용자의 정보에 접근할 수 없습니다.')
    if requested.isdisjoint(_permissions(link)):
        raise HTTPException(403, '이 연결에 필요한 권한이 없습니다.')
    return user_id


def linked_users_for(supporter_id):
    try:
        database = _database()
        links = database.caregiver_links.find({
            '$or': [{'supporter_id': supporter_id}, {'caregiver_id': supporter_id}],
            'active': {'$ne': False},
        })
        result = []
        from app.services.authentication import _public_user
        for link in links:
            linked = database.users.find_one({'_id': link['user_id'], 'role': 'user'})
            if linked:
                result.append(_public_user(linked) | {
                    'permissions': _permissions(link),
                    'link_role': link.get('supporter_role'),
                })
        log_crud('READ', 'caregiver_links', '연결 사용자 및 권한 조회')
        return result
    except PyMongoError as exc:
        raise HTTPException(503, '연결 사용자 정보를 조회하지 못했습니다.') from exc


def support_access_for(user_id):
    try:
        database = _database()
        result = []
        for link in database.caregiver_links.find({'user_id': user_id, 'active': {'$ne': False}}):
            supporter_id = _supporter_id(link)
            supporter = database.users.find_one({'_id': supporter_id, 'role': {'$in': list(SUPPORT_ROLES)}})
            if supporter:
                result.append({
                    'supporter_id': str(supporter['_id']),
                    'username': supporter['username'],
                    'name': supporter['name'],
                    'role': supporter['role'],
                    'permissions': _permissions(link),
                    'connected_at': link.get('created_at'),
                    'updated_at': link.get('updated_at'),
                })
        log_crud('READ', 'caregiver_links', '지원 연결 조회')
        return result
    except PyMongoError as exc:
        raise HTTPException(503, '지원 연결을 조회하지 못했습니다.') from exc


def grant_support(user_id, supporter_username, permissions, actor_id):
    permissions = validate_permissions(permissions)
    try:
        database = _database()
        supporter = database.users.find_one({
            'username': supporter_username,
            'role': {'$in': list(SUPPORT_ROLES)},
        })
        if not supporter:
            raise HTTPException(404, '해당 보호자 또는 담당자 계정을 찾을 수 없습니다.')
        supporter_id = str(supporter['_id'])
        now = datetime.now(timezone.utc)
        before = database.caregiver_links.find_one({'_id': f'{supporter_id}:{user_id}'})
        database.caregiver_links.update_one(
            {'_id': f'{supporter_id}:{user_id}'},
            {'$set': {
                'caregiver_id': supporter_id,
                'supporter_id': supporter_id,
                'supporter_role': supporter['role'],
                'user_id': user_id,
                'permissions': permissions,
                'active': True,
                'updated_at': now,
            }, '$setOnInsert': {'created_at': now}},
            upsert=True,
        )
        _audit(database, user_id, actor_id, 'support_permissions_changed' if before else 'support_granted',
               supporter_id, _permissions(before) if before else [], permissions)
        log_crud('UPDATE', 'caregiver_links', '지원 연결 및 권한 저장')
        return support_access_for(user_id)
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '지원 연결을 저장하지 못했습니다.') from exc


def change_support_permissions(user_id, supporter_id, permissions, actor_id):
    permissions = validate_permissions(permissions)
    try:
        database = _database()
        link = database.caregiver_links.find_one({
            '_id': f'{supporter_id}:{user_id}', 'user_id': user_id,
        })
        if not link or not link.get('active', True):
            raise HTTPException(404, '지원 연결을 찾을 수 없습니다.')
        database.caregiver_links.update_one(
            {'_id': link['_id']},
            {'$set': {'permissions': permissions, 'updated_at': datetime.now(timezone.utc)}},
        )
        _audit(database, user_id, actor_id, 'support_permissions_changed', supporter_id,
               _permissions(link), permissions)
        log_crud('UPDATE', 'caregiver_links', '지원 권한 변경')
        return support_access_for(user_id)
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '지원 권한을 변경하지 못했습니다.') from exc


def revoke_support(user_id, supporter_id, actor_id):
    try:
        database = _database()
        link = database.caregiver_links.find_one({
            '_id': f'{supporter_id}:{user_id}', 'user_id': user_id,
        })
        if not link or not link.get('active', True):
            raise HTTPException(404, '지원 연결을 찾을 수 없습니다.')
        now = datetime.now(timezone.utc)
        database.caregiver_links.update_one(
            {'_id': link['_id']},
            {'$set': {'active': False, 'updated_at': now, 'revoked_at': now}},
        )
        _audit(database, user_id, actor_id, 'support_revoked', supporter_id, _permissions(link), [])
        log_crud('UPDATE', 'caregiver_links', '지원 연결 해제')
    except HTTPException:
        raise
    except PyMongoError as exc:
        raise HTTPException(503, '지원 연결을 해제하지 못했습니다.') from exc


def _audit(database, user_id, actor_id, action, supporter_id, before, after):
    database.privacy_audit_logs.insert_one({
        '_id': str(uuid4()),
        'user_id': user_id,
        'actor_id': actor_id,
        'action': action,
        'target_id': supporter_id,
        'before_permissions': before,
        'after_permissions': after,
        'created_at': datetime.now(timezone.utc),
    })
    log_crud('CREATE', 'privacy_audit_logs', '지원 권한 변경 기록')
