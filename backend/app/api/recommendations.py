"""recommendations HTTP boundary; public paths and handler names are preserved."""
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from starlette.responses import JSONResponse
from uuid import UUID
from app.services.recommendations import available_cards as recommendation_cards, create_feed, monitoring_for as recommendation_monitoring, preview as recommendation_preview, record_interaction, save_settings as save_recommendation_settings, settings_for as recommendation_settings_for
from app.services.authentication import current_user, dashboard_user
from app.services.support_links import SUPPORT_ROLES, require_link_permission
from app.services.board_layout import audit_for as board_audit_for
from app.schemas.cards import CardResponse
from app.schemas.recommendations import RecommendationExposureRequest, RecommendationFeedRequest, RecommendationSelectionRequest, RecommendationSettingsRequest
from app.api.dependencies import require_communicator, require_guardian_consent

router = APIRouter()


@router.get('/recommendations', response_model=list[CardResponse], response_model_exclude_none=True, tags=['추천'])
def recommendations(user=Depends(current_user)):
    require_communicator(user)
    return recommendation_preview(user['id'])


@router.post('/recommendations/feed', tags=['추천'])
def recommendation_feed(request: RecommendationFeedRequest, response: Response, user=Depends(current_user)):
    require_communicator(user)
    response.headers['Cache-Control'] = 'no-store'
    return create_feed(user['id'], str(request.request_id), request.selected_card_ids,
                       request.hour, request.utc_offset_minutes)


@router.post('/recommendations/batches/{batch_id}/exposures', tags=['추천'])
def recommendation_exposures(batch_id: UUID, request: RecommendationExposureRequest, user=Depends(current_user)):
    require_communicator(user)
    require_guardian_consent(user)
    return record_interaction(user['id'], str(batch_id), request.card_ids)


@router.post('/recommendations/batches/{batch_id}/selections', tags=['추천'])
def recommendation_selection(batch_id: UUID, request: RecommendationSelectionRequest, user=Depends(current_user)):
    require_communicator(user)
    require_guardian_consent(user)
    return record_interaction(user['id'], str(batch_id), [request.card_id], selected=True)


@router.get('/recommendations/settings', tags=['추천'])
def get_recommendation_settings(response: Response, user_id: str | None = Query(default=None, max_length=64), user=Depends(current_user)):
    target = user_id or user['id']
    require_link_permission(user, target, 'board_manage')
    response.headers['Cache-Control'] = 'no-store'
    settings = recommendation_settings_for(target)
    # Reuse the existing support-configuration audit store and its retention/deletion policy.
    history = [row for row in board_audit_for(target) if row['action'] == 'recommendation_settings_changed'][:10]
    return {**settings, 'available_cards': recommendation_cards(target), 'history': history}


@router.get('/recommendations/monitoring', tags=['추천'])
def get_recommendation_monitoring(user_id: str | None = Query(default=None, max_length=64), user=Depends(current_user)):
    target = dashboard_user(user, user_id, 'records_read')
    return JSONResponse(recommendation_monitoring(target), headers={'Cache-Control': 'no-store'})


@router.put('/recommendations/settings', tags=['추천'])
def put_recommendation_settings(request: RecommendationSettingsRequest,
                                user_id: str = Query(min_length=1, max_length=64), user=Depends(current_user)):
    if user['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '보호자·담당자의 연결 권한으로 추천을 설정해 주세요.')
    require_link_permission(user, user_id, 'board_manage')
    return save_recommendation_settings(user_id, user['id'], request.model_dump(exclude={'expected_revision'}),
                                         request.expected_revision)
