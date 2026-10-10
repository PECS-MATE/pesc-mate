"""Persistent account profiles with fail-closed image safety validation."""
from fastapi import HTTPException
from pymongo.errors import PyMongoError
from app.services.database import database
from app.services.card_submissions import _normalize_image
from app.services.image_safety import check_image_safety

PRESETS = [
    dict(id='pink', label='핑크'),
    dict(id='orange', label='오렌지'),
    dict(id='sky', label='하늘'),
    dict(id='cream', label='크림'),
    dict(id='green', label='그린'),
    dict(id='blue', label='블루'),
    dict(id='space', label='우주'),
]


def public_profile(user):
    profile = user.get('profile')
    return {k: profile[k] for k in ('kind', 'preset', 'image_url') if k in profile} if profile else None


def save_profile(user_id, preset=None, image_data=None, content_type=None):
    if image_data is None:
        if preset not in {p['id'] for p in PRESETS}:
            raise HTTPException(422, '사용할 수 없는 프로필입니다.')
        profile = dict(kind='preset', preset=preset)
    else:
        content, mime = _normalize_image(image_data, content_type)
        if check_image_safety(content, mime)['status'] != 'passed':
            raise HTTPException(422, '안전성이 확인된 이미지만 사용할 수 있습니다. 다른 이미지나 기본 캐릭터를 선택해 주세요.')
        from uuid import uuid4
        profile = dict(kind='custom', image_url=f'/api/profile/{user_id}/image?v={uuid4()}',
                       image_data=content, content_type=mime)
    try:
        result = database().users.update_one({'_id': user_id}, {'$set': {'profile': profile}})
        if not result.matched_count:
            raise HTTPException(404, '사용자 계정을 찾을 수 없습니다.')
        return public_profile({'profile': profile})
    except PyMongoError as exc:
        raise HTTPException(503, '프로필을 저장하지 못했습니다.') from exc


def profile_image(user_id, requester):
    if requester['id'] != user_id:
        from app.services.authentication import dashboard_user
        if requester['role'] not in {'caregiver', 'support_staff'}:
            raise HTTPException(403, '프로필 이미지를 조회할 권한이 없습니다.')
        dashboard_user(requester, user_id)
    try:
        user = database().users.find_one({'_id': user_id})
        profile = (user or {}).get('profile') or {}
        if profile.get('kind') != 'custom':
            raise HTTPException(404, '프로필 이미지가 없습니다.')
        return profile['image_data'], profile['content_type']
    except PyMongoError as exc:
        raise HTTPException(503, '프로필 이미지를 조회하지 못했습니다.') from exc
