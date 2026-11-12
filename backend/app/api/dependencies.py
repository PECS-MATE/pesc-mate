"""Shared authorization checks used by domain routers."""
from fastapi import HTTPException
from app.services.privacy import privacy_for
from app.services.support_links import SUPPORT_ROLES, require_link_permission


def require_communicator(user):
    if user['role'] != 'user':
        raise HTTPException(403, 'AAC 사용자만 카드 기능을 이용할 수 있습니다.')
    return user


def require_guardian_consent(user):
    if not privacy_for(user['id'])['guardian_consent']:
        raise HTTPException(403, '기록을 저장하려면 개인정보 화면에서 법정대리인 동의를 확인해 주세요.')
    return user


def _require_support_manager(user, user_id, permission):
    if user['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '보호자 또는 담당자만 카드판 구성을 변경할 수 있습니다.')
    return require_link_permission(user, user_id, permission)


def _card_owner(user, user_id=None):
    if user['role'] == 'user':
        if user_id and user_id != user['id']:
            raise HTTPException(403, '다른 사용자의 카드를 관리할 수 없습니다.')
        return user['id']
    if not user_id:
        raise HTTPException(422, '관리할 연결 사용자를 선택해 주세요.')
    return require_link_permission(user, user_id, 'cards_manage')
