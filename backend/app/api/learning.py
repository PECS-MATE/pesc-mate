"""learning HTTP boundary; public paths and handler names are preserved."""
from contextlib import nullcontext
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from app.services.authentication import current_user
from app.services.support_links import SUPPORT_ROLES, require_link_permission
from app.services.learning import audit_for as learning_audit_for
from app.services.learning import progress_for as learning_progress_for
from app.services.learning import record_attempt as record_learning_attempt
from app.services.learning import save_settings as save_learning_settings
from app.services.learning import settings_for as learning_settings_for
from app.schemas.learning import LearningAttemptRequest, LearningAttemptResponse, LearningAuditResponse, LearningProgressResponse, LearningSettingsRequest, LearningSettingsResponse
from app.api.dependencies import require_communicator, require_guardian_consent

router = APIRouter()


@router.get('/learning/settings', response_model=LearningSettingsResponse, tags=['학습'])
def get_learning_settings(user_id: str | None = Query(default=None, max_length=64),
                          user=Depends(current_user)):
    target = user_id or user['id']
    require_link_permission(user, target, 'learning_manage')
    return learning_settings_for(target)


@router.put('/learning/settings', response_model=LearningSettingsResponse, tags=['학습'])
def put_learning_settings(request: LearningSettingsRequest,
                          user_id: str = Query(min_length=1, max_length=64),
                          user=Depends(current_user)):
    if user['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '보호자 또는 담당자만 학습 설정을 변경할 수 있습니다.')
    target = require_link_permission(user, user_id, 'learning_manage')
    return save_learning_settings(target, user['id'], request.category_ids,
                                  request.question_count, request.option_count,
                                  request.repeat_frequency, request.time_limit_seconds,
                                  request.retry_enabled)


@router.post('/learning/attempts', response_model=LearningAttemptResponse,
                 status_code=201, tags=['학습'])
def post_learning_attempt(request: LearningAttemptRequest, http_request: Request,
                          offline_sync: bool = Header(default=False, alias='X-Pesc-Offline-Sync'),
                          retried: int = Header(default=0, alias='X-Pesc-Sync-Retried', ge=0, le=1),
                          user=Depends(current_user)):
    require_communicator(user)
    require_guardian_consent(user)
    if retried and not offline_sync:
        raise HTTPException(422, '오프라인 동기화에서만 재시도 건수를 보낼 수 있습니다.')
    measurement = http_request.app.state.offline_sync_metrics.measure('learning', 1, retried) if offline_sync else nullcontext(None)
    with measurement as observation:
        return record_learning_attempt(
            user['id'], str(request.request_id), request.activity_type, request.category_id,
            request.total_questions, request.correct_answers, request.duration_seconds,
            [item.model_dump() for item in request.items], observation=observation,
            content_version=request.content_version,
            program_set_id=str(request.program_set_id) if request.program_set_id else None,
        )


@router.get('/learning/progress', response_model=LearningProgressResponse, tags=['학습'])
def get_learning_progress(days: int | None = Query(default=None, ge=1, le=365),
                          user_id: str | None = Query(default=None, max_length=64),
                          user=Depends(current_user)):
    target = user_id or user['id']
    require_link_permission(user, target, 'learning_manage')
    return learning_progress_for(target, days=days)


@router.get('/learning/audit', response_model=list[LearningAuditResponse], tags=['학습'])
def get_learning_audit(user_id: str | None = Query(default=None, max_length=64),
                       user=Depends(current_user)):
    target = user_id or user['id']
    require_link_permission(user, target, 'learning_manage')
    return learning_audit_for(target)
