"""accounts HTTP boundary; public paths and handler names are preserved."""
from typing import Literal
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from starlette.responses import JSONResponse
from app.services.authentication import current_user, linked_users
from app.services.support_links import SUPPORT_ROLES, change_support_permissions, grant_support, revoke_support, support_access_for
from app.services.card_submissions import MAX_IMAGE_BYTES
from app.services.account_permissions import change_account_access, change_content_permission, permission_audit, staff_account
from app.schemas.accounts import AccountAccessRequest, AccountPermissionRequest, ProfileRequest, ProfileResponse, SupportAccessResponse, SupportLinkRequest, SupportPermissionsRequest, UserResponse
from app.api.dependencies import require_communicator
from app.api.image_response import _image_response

router = APIRouter()


@router.get('/admin/accounts/lookup', tags=['운영 권한'])
def lookup_staff_account(username: str = Query(min_length=1, max_length=64), user=Depends(current_user)):
    return JSONResponse(staff_account(user, username.strip()), headers={'Cache-Control': 'no-store'})


@router.get('/admin/accounts/{target_id}/permission-audit', tags=['운영 권한'])
def get_account_permission_audit(target_id: str, response: Response, user=Depends(current_user)):
    response.headers['Cache-Control'] = 'no-store'
    return permission_audit(user, target_id)


@router.put('/admin/accounts/{target_id}/content-permission', tags=['운영 권한'])
def update_account_permission(target_id: str, payload: AccountPermissionRequest, request: Request,
                              response: Response, user=Depends(current_user)):
    reason = payload.reason.strip()
    if len(reason) < 3:
        raise HTTPException(422, '변경 사유를 세 글자 이상 입력해 주세요.')
    response.headers['Cache-Control'] = 'no-store'
    return change_content_permission(user, target_id, payload.content_manage, payload.expected_revision,
                                     payload.password.get_secret_value(), reason,
                                     request.client.host if request.client else None)


@router.put('/admin/accounts/{target_id}/access', tags=['운영 권한'])
def update_account_access(target_id: str, payload: AccountAccessRequest, request: Request,
                          response: Response, user=Depends(current_user)):
    reason = payload.reason.strip()
    if len(reason) < 3:
        raise HTTPException(422, '변경 사유를 세 글자 이상 입력해 주세요.')
    response.headers['Cache-Control'] = 'no-store'
    return change_account_access(user, target_id, payload.account_active, payload.access_expires_at,
                                 payload.expected_revision, payload.password.get_secret_value(), reason,
                                 request.client.host if request.client else None)


@router.get('/care/linked-users', response_model=list[UserResponse], tags=['보호자'])
def care_users(user=Depends(current_user)):
    if user['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '보호자 또는 담당자 계정만 접근할 수 있습니다.')
    return linked_users(user['id'])


@router.get('/support/links', response_model=list[SupportAccessResponse], tags=['역할·권한'])
def get_support_links(user=Depends(current_user)):
    require_communicator(user)
    return support_access_for(user['id'])


@router.post('/support/links', response_model=list[SupportAccessResponse], tags=['역할·권한'])
def post_support_link(request: SupportLinkRequest, user=Depends(current_user)):
    require_communicator(user)
    return grant_support(user['id'], request.username.strip(), request.permissions, user['id'])


@router.put('/support/links/{supporter_id}', response_model=list[SupportAccessResponse], tags=['역할·권한'])
def put_support_permissions(supporter_id: str, request: SupportPermissionsRequest,
                            user=Depends(current_user)):
    require_communicator(user)
    return change_support_permissions(user['id'], supporter_id, request.permissions, user['id'])


@router.delete('/support/links/{supporter_id}', status_code=204, tags=['역할·권한'])
def delete_support_link(supporter_id: str, user=Depends(current_user)):
    require_communicator(user)
    revoke_support(user['id'], supporter_id, user['id'])
    return None


@router.get('/profile/presets', tags=['프로필'])
def profile_presets(user=Depends(current_user)):
    from app.services.profiles import PRESETS
    return PRESETS


@router.put('/profile', response_model=ProfileResponse, tags=['프로필'])
def put_profile(request: ProfileRequest, user=Depends(current_user)):
    from app.services.profiles import save_profile
    return save_profile(user['id'], preset=request.preset)


@router.post('/profile/image', response_model=ProfileResponse, tags=['프로필'])
async def upload_profile(image: UploadFile = File(), user=Depends(current_user)):
    from app.services.profiles import save_profile
    content = await image.read(MAX_IMAGE_BYTES + 1)
    return save_profile(user['id'], image_data=content, content_type=image.content_type)


@router.get('/profile/{user_id}/image', tags=['프로필'])
def get_profile_image(user_id: str, request: Request, variant: Literal['display', 'thumbnail'] = 'display', user=Depends(current_user)):
    from app.services.profiles import profile_image
    content, mime = profile_image(user_id, user, variant)
    return _image_response(request, content, mime)
