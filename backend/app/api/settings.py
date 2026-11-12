"""settings HTTP boundary; public paths and handler names are preserved."""
from fastapi import APIRouter, Depends, Query
from app.services.accessibility_settings import save_settings as save_accessibility_settings
from app.services.accessibility_settings import settings_for as accessibility_settings_for
from app.services.authentication import current_user
from app.services.privacy import privacy_for, save_privacy
from app.services.tts_settings import save_settings, settings_for
from app.services.support_links import require_link_permission
from app.schemas.settings import AccessibilitySettingsRequest, AccessibilitySettingsResponse, PrivacySettingsRequest, PrivacySettingsResponse, TtsSettingsRequest, TtsSettingsResponse
from app.api.dependencies import require_communicator

router = APIRouter()


@router.get('/privacy/settings', response_model=PrivacySettingsResponse, tags=['개인정보'])
def get_privacy_settings(user=Depends(current_user)):
    require_communicator(user)
    return privacy_for(user['id'])


@router.put('/privacy/settings', response_model=PrivacySettingsResponse, tags=['개인정보'])
def put_privacy_settings(request: PrivacySettingsRequest, user=Depends(current_user)):
    require_communicator(user)
    return save_privacy(user['id'], request.guardian_consent, request.retention_days)


@router.get('/tts/settings', response_model=TtsSettingsResponse, tags=['음성'])
def get_tts_settings(user_id: str | None = Query(default=None, max_length=64),
                     user=Depends(current_user)):
    target = user_id or user['id']
    require_link_permission(user, target, 'voice_access_manage')
    return settings_for(target)


@router.put('/tts/settings', response_model=TtsSettingsResponse, tags=['음성'])
def put_tts_settings(request: TtsSettingsRequest,
                     user_id: str | None = Query(default=None, max_length=64),
                     user=Depends(current_user)):
    target = user_id or user['id']
    require_link_permission(user, target, 'voice_access_manage')
    return save_settings(target, request.preset, request.voice_name.strip(), request.rate,
                         request.pitch, request.volume)


@router.get('/accessibility/settings', response_model=AccessibilitySettingsResponse, tags=['접근성'])
def get_accessibility_settings(user_id: str | None = Query(default=None, max_length=64),
                               user=Depends(current_user)):
    target = user_id or user['id']
    require_link_permission(user, target, 'voice_access_manage')
    return accessibility_settings_for(target)


@router.put('/accessibility/settings', response_model=AccessibilitySettingsResponse, tags=['접근성'])
def put_accessibility_settings(request: AccessibilitySettingsRequest,
                               user_id: str | None = Query(default=None, max_length=64),
                               user=Depends(current_user)):
    target = user_id or user['id']
    require_link_permission(user, target, 'voice_access_manage')
    return save_accessibility_settings(target, request.model_dump(), user)
