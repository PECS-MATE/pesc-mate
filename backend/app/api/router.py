from contextlib import nullcontext
from datetime import datetime
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, Response, UploadFile
from pydantic import AwareDatetime, BaseModel, Field, SecretStr, model_validator
from starlette.responses import JSONResponse
from uuid import UUID
from app.services.communication import CARDS, regenerate_session, save_session, statistics
from app.services.record_exports import export_records, records_csv
from app.services.accessibility_settings import save_settings as save_accessibility_settings
from app.services.accessibility_settings import settings_for as accessibility_settings_for
from app.services.authentication import (
    current_user, dashboard_user, linked_users, login, logout, register,
    require_account_permission, security,
)
from app.services.privacy import (
    access_audit_for, delete_personal_data, export_for, privacy_for, save_privacy,
)
from app.services.model import status as model_status
from app.services.health import health_report
from app.services.observability import error_response
from app.services.offline_events import sync_events
from app.services.caregiver_notes import delete_note, note_history, notes_for, save_note
from app.services.communication_activity import activity_report, speech_for_sessions
from app.services.tts_settings import save_settings, settings_for
from app.services.tts_events import finish_event, start_event
from app.services.tts_metrics import tts_report
from app.services.operational_alerts import operational_report
from app.services.support_links import (
    LINK_PERMISSIONS, SUPPORT_ROLES, change_support_permissions, grant_support,
    permissions_for, require_any_link_permission, require_link_permission,
    revoke_support, support_access_for,
)
from app.services.board_layout import audit_for as board_audit_for
from app.services.board_layout import (
    layout_for, save_quick_expressions, save_recovery_expressions, save_slots,
)
from app.services.learning import audit_for as learning_audit_for
from app.services.learning import progress_for as learning_progress_for
from app.services.learning import record_attempt as record_learning_attempt
from app.services.learning import save_settings as save_learning_settings
from app.services.learning import settings_for as learning_settings_for
from app.services.card_submissions import (
    MAX_IMAGE_BYTES, approved_cards_for, create_submission, image_for,
    review_submission, submissions_for, submissions_for_review, submit_draft,
    update_submission,
)
from app.services.categories import (
    active_categories, categories_for_admin, create_category, update_category,
)
from app.services.account_permissions import change_account_access, change_content_permission, permission_audit, staff_account
from app.services.reauthentication import reauthenticate_content_operator

api_router = APIRouter()


@api_router.get("/health", tags=["health"])
def health_check(request: Request):
    payload, status_code = health_report()
    if status_code >= 400:
        return error_response(request.scope, status_code, '데이터베이스 연결을 확인해 주세요.', extra=payload)
    return JSONResponse(payload, status_code=status_code, headers={'Cache-Control': 'no-store'})


@api_router.get('/admin/metrics', tags=['운영'])
def get_api_metrics(request: Request, user=Depends(current_user)):
    require_account_permission(user, 'content_manage')
    return JSONResponse(request.app.state.api_metrics.snapshot(), headers={'Cache-Control': 'no-store'})


@api_router.get('/admin/tts-metrics', tags=['운영'])
def get_tts_metrics(hours: int = Query(default=24, ge=1, le=168), user=Depends(current_user)):
    require_account_permission(user, 'content_manage')
    return JSONResponse(tts_report(hours), headers={'Cache-Control': 'no-store'})


@api_router.get('/admin/offline-sync-metrics', tags=['운영'])
def get_offline_sync_metrics(request: Request, user=Depends(current_user)):
    require_account_permission(user, 'content_manage')
    return JSONResponse(request.app.state.offline_sync_metrics.snapshot(), headers={'Cache-Control': 'no-store'})


@api_router.get('/admin/alerts', tags=['운영'])
def get_operational_alerts(request: Request, user=Depends(current_user)):
    require_account_permission(user, 'content_manage')
    return JSONResponse(operational_report(request.app.state.api_metrics, request.app.state.offline_sync_metrics),
                        headers={'Cache-Control': 'no-store'})


@api_router.get('/model/status', tags=['모델'])
def get_model_status(user=Depends(current_user)):
    return model_status()


class SentenceRequest(BaseModel):
    cards: list[str] = Field(min_length=1, max_length=12)
    request_id: UUID
    selected_at: list[AwareDatetime | None] | None = Field(default=None, max_length=12)

    @model_validator(mode='after')
    def validate_selection_times(self):
        if self.selected_at is not None and len(self.selected_at) != len(self.cards):
            raise ValueError('선택 시각과 카드 수가 일치해야 합니다.')
        return self


class RegenerateSentenceRequest(BaseModel):
    request_id: UUID


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class RegisterRequest(BaseModel):
    username: str = Field(pattern=r'^[A-Za-z0-9_-]+$', min_length=4, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=30)
    guardian_consent: Literal[True]


class CaregiverNoteRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=64)
    content: str = Field(min_length=1, max_length=500)
    expected_revision: int | None = Field(default=None, ge=0)


class CaregiverNoteResponse(BaseModel):
    id: str
    session_id: str
    user_id: str
    content: str
    updated_at: datetime
    author_id: str | None = None
    revision: int = 0


class ProfileResponse(BaseModel):
    kind: Literal['preset', 'custom']
    preset: str | None = None
    image_url: str | None = None


class ProfileRequest(BaseModel):
    preset: str = Field(min_length=1, max_length=20)


class UserResponse(BaseModel):
    id: str
    username: str
    name: str
    role: str
    account_permissions: list[str] = Field(default_factory=list)
    can_manage_account_permissions: bool = False
    permission_revision: int = 0
    account_active: bool = True
    access_expires_at: datetime | None = None
    profile: ProfileResponse | None = None
    session_expires_at: datetime | None = None
    permissions: list[str] | None = None
    link_role: str | None = None


class AccountPermissionRequest(BaseModel):
    model_config = {'extra': 'forbid'}
    content_manage: bool = Field(strict=True)
    expected_revision: int = Field(ge=0, strict=True)
    password: SecretStr = Field(min_length=1, max_length=128)
    reason: str = Field(min_length=3, max_length=300)


class AccountAccessRequest(BaseModel):
    model_config = {'extra': 'forbid'}
    account_active: bool = Field(strict=True)
    access_expires_at: AwareDatetime | None
    expected_revision: int = Field(ge=0, strict=True)
    password: SecretStr = Field(min_length=1, max_length=128)
    reason: str = Field(min_length=3, max_length=300)


@api_router.get('/admin/accounts/lookup', tags=['운영 권한'])
def lookup_staff_account(username: str = Query(min_length=1, max_length=64), user=Depends(current_user)):
    return JSONResponse(staff_account(user, username.strip()), headers={'Cache-Control': 'no-store'})


@api_router.get('/admin/accounts/{target_id}/permission-audit', tags=['운영 권한'])
def get_account_permission_audit(target_id: str, response: Response, user=Depends(current_user)):
    response.headers['Cache-Control'] = 'no-store'
    return permission_audit(user, target_id)


@api_router.put('/admin/accounts/{target_id}/content-permission', tags=['운영 권한'])
def update_account_permission(target_id: str, payload: AccountPermissionRequest, request: Request,
                              response: Response, user=Depends(current_user)):
    reason = payload.reason.strip()
    if len(reason) < 3:
        raise HTTPException(422, '변경 사유를 세 글자 이상 입력해 주세요.')
    response.headers['Cache-Control'] = 'no-store'
    return change_content_permission(user, target_id, payload.content_manage, payload.expected_revision,
                                     payload.password.get_secret_value(), reason,
                                     request.client.host if request.client else None)


@api_router.put('/admin/accounts/{target_id}/access', tags=['운영 권한'])
def update_account_access(target_id: str, payload: AccountAccessRequest, request: Request,
                          response: Response, user=Depends(current_user)):
    reason = payload.reason.strip()
    if len(reason) < 3:
        raise HTTPException(422, '변경 사유를 세 글자 이상 입력해 주세요.')
    response.headers['Cache-Control'] = 'no-store'
    return change_account_access(user, target_id, payload.account_active, payload.access_expires_at,
                                 payload.expected_revision, payload.password.get_secret_value(), reason,
                                 request.client.host if request.client else None)


class TtsSettingsRequest(BaseModel):
    preset: Literal['child', 'woman', 'man']
    voice_name: str = Field(default='', max_length=120)
    rate: float = Field(ge=0.5, le=1.5)
    pitch: float = Field(ge=0.5, le=1.5)
    volume: float = Field(ge=0.0, le=1.0)


class TtsSettingsResponse(TtsSettingsRequest):
    pass


class AccessibilitySettingsRequest(BaseModel):
    display_mode: Literal['image', 'image_text', 'text']
    cards_per_page: int = Field(ge=6, le=30)
    card_size: Literal['small', 'medium', 'large']
    text_size: Literal['small', 'medium', 'large']
    reduced_motion: bool
    high_contrast: bool


class AccessibilitySettingsResponse(AccessibilitySettingsRequest):
    pass


class PrivacySettingsRequest(BaseModel):
    guardian_consent: bool
    retention_days: Literal[30, 90, 365, 1095]


class PrivacySettingsResponse(PrivacySettingsRequest):
    consent_version: str
    consented_at: datetime | None = None
    deletion_status: str
    deleted_at: datetime | None = None
    deletion_receipt: dict[str, object] | None = None


class SupportLinkRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    permissions: list[Literal[
        'records_read', 'notes_write', 'cards_manage', 'quick_speech_manage', 'board_manage',
        'voice_access_manage', 'learning_manage',
    ]] = Field(min_length=1, max_length=len(LINK_PERMISSIONS))


class SupportPermissionsRequest(BaseModel):
    permissions: list[Literal[
        'records_read', 'notes_write', 'cards_manage', 'quick_speech_manage', 'board_manage',
        'voice_access_manage', 'learning_manage',
    ]] = Field(min_length=1, max_length=len(LINK_PERMISSIONS))


class SupportAccessResponse(BaseModel):
    supporter_id: str
    username: str
    name: str
    role: Literal['caregiver', 'support_staff']
    permissions: list[str]
    connected_at: datetime | None = None
    updated_at: datetime | None = None


class PrivacyAuditResponse(BaseModel):
    id: str
    action: str
    actor_id: str
    target_id: str | None = None
    created_at: datetime
    before_permissions: list[str] | None = None
    after_permissions: list[str] | None = None


class PrivacyDeleteRequest(BaseModel):
    confirmation: Literal['DELETE']


class OfflineEventRequest(BaseModel):
    id: UUID
    event_type: Literal['immediate_speech', 'selection_speech', 'card_selection', 'speech_result', 'recovery_speech']
    card_ids: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(max_length=12)
    occurred_at: datetime
    situation: Literal['unspecified', 'home', 'school', 'therapy', 'outside', 'meal', 'hospital'] = 'unspecified'
    stream_id: UUID | None = None
    sequence: int | None = Field(default=None, ge=1, le=1000000000)
    selection_id: UUID | None = None
    session_id: UUID | None = None
    speech_status: Literal['succeeded', 'failed', 'cancelled'] | None = None
    completed_at: AwareDatetime | None = None
    recovery_id: Literal['hold_on', 'wrong_tap', 'not_that', 'say_again', 'please_wait', 'dont_understand', 'yes', 'no'] | None = None

    @model_validator(mode='after')
    def validate_activity(self):
        if self.event_type in {'immediate_speech', 'selection_speech'}:
            if not self.card_ids:
                raise ValueError('기존 발화 기록에는 카드가 필요합니다.')
            return self
        if self.stream_id is None or self.sequence is None:
            raise ValueError('새 활동 기록에는 기기 흐름 번호와 순서가 필요합니다.')
        if self.event_type in {'speech_result', 'recovery_speech'}:
            if self.speech_status is None or self.completed_at is None:
                raise ValueError('발화 결과와 완료 시각이 필요합니다.')
            occurred = self.occurred_at.replace(tzinfo=self.occurred_at.tzinfo or self.completed_at.tzinfo)
            if self.completed_at < occurred:
                raise ValueError('완료 시각은 시작 시각보다 빠를 수 없습니다.')
        if self.event_type == 'recovery_speech' and self.recovery_id is None:
            raise ValueError('복구 표현 번호가 필요합니다.')
        if self.event_type == 'speech_result' and not self.card_ids:
            raise ValueError('발화한 카드가 필요합니다.')
        if self.event_type == 'card_selection' and (self.speech_status or self.completed_at or self.recovery_id):
            raise ValueError('카드 선택을 발화 결과로 기록할 수 없습니다.')
        return self


class OfflineSyncRequest(BaseModel):
    events: list[OfflineEventRequest] = Field(min_length=1, max_length=100)


class OfflineSyncResponse(BaseModel):
    accepted_ids: list[UUID]


class TtsEventRequest(BaseModel):
    request_id: UUID
    content_type: Literal['card', 'sentence', 'recovery', 'preview']
    char_count: int = Field(ge=1, le=500)


class TtsEventResultRequest(BaseModel):
    status: Literal['succeeded', 'failed', 'cancelled']
    error_code: str = Field(default='', max_length=80)
    startup_ms: int | None = Field(default=None, ge=0, le=60000)


class TtsEventResponse(BaseModel):
    id: UUID
    status: str
    error_code: str | None = None
    requested_at: datetime | None = None
    completed_at: datetime | None = None
    startup_ms: int | None = None


class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    expires_at: datetime
    user: UserResponse


class CardResponse(BaseModel):
    id: str
    label: str
    symbol: str
    category: str
    image_index: int | None = None
    meaning: str | None = None
    part_of_speech: str | None = None
    has_batchim: bool | None = None
    sentence_role: str | None = None
    semantic_group: str | None = None
    safety_relevant: bool | None = None
    image_url: str | None = None
    custom: bool | None = None
    count: int | None = None
    reason: str | None = None


class BoardSlotResponse(BaseModel):
    position: int
    card_id: str


class BoardLayoutResponse(BaseModel):
    user_id: str
    revision: int
    quick_expression_ids: list[str]
    recovery_expression_ids: list[str]
    slots: list[BoardSlotResponse]
    available_cards: list[CardResponse]
    updated_at: datetime | None = None


class BoardCardIdsRequest(BaseModel):
    expected_revision: int = Field(ge=0)
    card_ids: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(min_length=1, max_length=30)


class BoardRecoveryIdsRequest(BaseModel):
    expected_revision: int = Field(ge=0)
    expression_ids: list[Annotated[str, Field(min_length=1, max_length=40)]] = Field(min_length=2, max_length=4)


class BoardAuditResponse(BaseModel):
    id: str
    target_user_id: str
    actor_id: str
    action: str
    before: list[object] | None = None
    after: list[object] | None = None
    before_revision: int | None = None
    after_revision: int | None = None
    created_at: datetime


class LearningSettingsRequest(BaseModel):
    category_ids: list[Annotated[str, Field(min_length=1, max_length=64)]] = Field(min_length=1, max_length=20)
    question_count: int = Field(ge=5, le=30)
    option_count: int = Field(default=3, ge=2, le=4)
    repeat_frequency: int = Field(default=1, ge=1, le=3)
    time_limit_seconds: int = Field(ge=30, le=600)
    retry_enabled: bool


class LearningSettingsResponse(BaseModel):
    user_id: str
    category_ids: list[str]
    question_count: int
    option_count: int
    repeat_frequency: int
    time_limit_seconds: int
    retry_enabled: bool
    updated_at: datetime | None = None
    updated_by: str | None = None


class LearningItemResult(BaseModel):
    card_id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=30)
    first_try_correct: bool


class LearningAttemptRequest(BaseModel):
    request_id: UUID
    activity_type: Literal['word_picture_match']
    category_id: str = Field(min_length=1, max_length=64)
    total_questions: int = Field(ge=1, le=30)
    correct_answers: int = Field(ge=0, le=30)
    duration_seconds: int = Field(ge=0, le=3600)
    items: list[LearningItemResult] = Field(default_factory=list, max_length=30)


class LearningAttemptResponse(BaseModel):
    id: UUID
    user_id: str
    activity_type: str
    category_id: str
    total_questions: int
    correct_answers: int
    incorrect_answers: int
    score: int
    duration_seconds: int
    items: list[LearningItemResult]
    completed_at: datetime


class LearningWordProgress(BaseModel):
    card_id: str
    label: str
    practice_count: int
    first_try_correct_count: int
    needs_repeat_count: int


class LearningProgressResponse(BaseModel):
    user_id: str
    period_days: int | None = None
    attempts: int
    total_questions: int
    correct_answers: int
    incorrect_answers: int
    average_score: int
    last_completed_at: datetime | None = None
    categories: dict[str, dict[str, int]]
    familiar_words: list[LearningWordProgress]
    repeat_words: list[LearningWordProgress]
    practicing_words: list[LearningWordProgress]
    recent: list[LearningAttemptResponse]


class LearningAuditResponse(BaseModel):
    id: UUID
    target_user_id: str
    actor_id: str
    action: str
    before: dict[str, object] | None = None
    after: dict[str, object] | None = None
    created_at: datetime


class CategoryResponse(BaseModel):
    id: str
    name: str
    display_order: int
    active: bool


class ReauthenticatedOperation(BaseModel):
    model_config = {'extra': 'forbid'}
    password: SecretStr = Field(min_length=1, max_length=128)


class CategoryCreateRequest(ReauthenticatedOperation):
    name: str = Field(min_length=1, max_length=30)
    display_order: int = Field(ge=1, le=999)


class CategoryUpdateRequest(CategoryCreateRequest):
    active: bool


class CardSubmissionResponse(BaseModel):
    id: str
    label: str
    meaning: str
    category: str
    visibility: str
    owner_id: str
    status: str
    requires_review: bool
    sharing_notice: str
    image_filename: str
    image_content_type: str
    image_url: str
    review_reason: str | None = None
    reviewer_id: str | None = None
    reviewed_at: datetime | None = None
    language_flags: list[dict[str, str]] = Field(default_factory=list)
    image_safety: dict[str, object]
    created_at: datetime


class CardReviewRequest(ReauthenticatedOperation):
    decision: Literal['approved', 'rejected', 'inactive']
    reason: str = Field(default='', max_length=500)


class CardUpdateRequest(BaseModel):
    label: str = Field(min_length=1, max_length=30)
    meaning: str = Field(min_length=1, max_length=120)
    category: str = Field(min_length=1, max_length=30)
    visibility: Literal['private', 'shared']


class CommunicationSessionResponse(BaseModel):
    id: UUID
    user_id: str
    cards: list[str]
    card_details: list[CardResponse] = Field(default_factory=list)
    card_selected_at: list[datetime | None] | None = None
    speech_results: list[dict[str, object]] = Field(default_factory=list)
    sentence: str
    generation_source: str | None = None
    generation: dict[str, object] | None = None
    regeneration_of: UUID | None = None
    generation_attempt: int = 1
    caregiver_note: str | None = None
    caregiver_note_details: dict[str, object] | None = None
    created_at: datetime


class DailyActivityResponse(BaseModel):
    date: str
    sessions: int


class SafetyExpressionResponse(CardResponse):
    count: int
    last_used_at: datetime


class CardCombinationResponse(BaseModel):
    cards: list[CardResponse]
    count: int


class DashboardResponse(BaseModel):
    sessions: int
    selections: int
    top_cards: list[CardResponse]
    categories: dict[str, int]
    recent: list[CommunicationSessionResponse]
    top_combinations: list[CardCombinationResponse] = Field(default_factory=list)
    period_days: int | None
    today_sessions: int
    today_selections: int
    frequent_emotion_state: CardResponse | None
    last_activity: datetime | None
    daily_activity: list[DailyActivityResponse]
    recent_safety_expressions: list[SafetyExpressionResponse]


def require_communicator(user):
    if user['role'] != 'user':
        raise HTTPException(403, 'AAC 사용자만 카드 기능을 이용할 수 있습니다.')
    return user


def require_guardian_consent(user):
    if not privacy_for(user['id'])['guardian_consent']:
        raise HTTPException(403, '기록을 저장하려면 개인정보 화면에서 법정대리인 동의를 확인해 주세요.')
    return user


@api_router.post('/auth/login', response_model=LoginResponse, tags=['인증'])
def authenticate(request: LoginRequest, http_request: Request):
    client_ip = http_request.client.host if http_request.client else None
    return login(request.username.strip(), request.password, client_ip)


@api_router.post('/auth/register', response_model=LoginResponse, status_code=201, tags=['인증'])
def create_account(request: RegisterRequest):
    name = request.name.strip()
    if not name:
        raise HTTPException(422, '이름을 입력해 주세요.')
    result = register(request.username.strip(), request.password, name)
    save_privacy(result['user']['id'], request.guardian_consent, 365)
    return result


@api_router.get('/auth/me', response_model=UserResponse, tags=['인증'])
def me(user=Depends(current_user)):
    return user


@api_router.get('/care/linked-users', response_model=list[UserResponse], tags=['보호자'])
def care_users(user=Depends(current_user)):
    if user['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '보호자 또는 담당자 계정만 접근할 수 있습니다.')
    return linked_users(user['id'])


@api_router.put('/care/notes/{session_id}', response_model=CaregiverNoteResponse, tags=['보호자'])
def put_caregiver_note(session_id: UUID, request: CaregiverNoteRequest, user=Depends(current_user)):
    if user['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '보호자 또는 담당자만 메모를 작성할 수 있습니다.')
    target = dashboard_user(user, request.user_id, 'notes_write')
    content = request.content.strip()
    if not content:
        raise HTTPException(422, '메모 내용을 입력해 주세요.')
    return save_note(user['id'], target, str(session_id), content, request.expected_revision)


@api_router.get('/care/notes/{session_id}/history', tags=['보호자'])
def get_note_history(session_id: UUID, user_id: str = Query(min_length=1, max_length=64),
                     user=Depends(current_user)):
    if user['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '보호자 또는 담당자만 메모 이력을 조회할 수 있습니다.')
    target = dashboard_user(user, user_id, 'notes_write')
    return note_history(user['id'], target, str(session_id))


@api_router.delete('/care/notes/{session_id}', status_code=204, tags=['보호자'])
def remove_caregiver_note(session_id: UUID,
                          user_id: str = Query(min_length=1, max_length=64),
                          expected_revision: int | None = Query(default=None, ge=0),
                          user=Depends(current_user)):
    if user['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '보호자 또는 담당자만 메모를 삭제할 수 있습니다.')
    target = dashboard_user(user, user_id, 'notes_write')
    delete_note(user['id'], target, str(session_id), expected_revision)
    return None


@api_router.get('/privacy/settings', response_model=PrivacySettingsResponse, tags=['개인정보'])
def get_privacy_settings(user=Depends(current_user)):
    require_communicator(user)
    return privacy_for(user['id'])


@api_router.put('/privacy/settings', response_model=PrivacySettingsResponse, tags=['개인정보'])
def put_privacy_settings(request: PrivacySettingsRequest, user=Depends(current_user)):
    require_communicator(user)
    return save_privacy(user['id'], request.guardian_consent, request.retention_days)


@api_router.get('/privacy/audit', response_model=list[PrivacyAuditResponse], tags=['개인정보'])
def get_privacy_audit(user=Depends(current_user)):
    require_communicator(user)
    return access_audit_for(user['id'])


@api_router.get('/support/links', response_model=list[SupportAccessResponse], tags=['역할·권한'])
def get_support_links(user=Depends(current_user)):
    require_communicator(user)
    return support_access_for(user['id'])


@api_router.post('/support/links', response_model=list[SupportAccessResponse], tags=['역할·권한'])
def post_support_link(request: SupportLinkRequest, user=Depends(current_user)):
    require_communicator(user)
    return grant_support(user['id'], request.username.strip(), request.permissions, user['id'])


@api_router.put('/support/links/{supporter_id}', response_model=list[SupportAccessResponse], tags=['역할·권한'])
def put_support_permissions(supporter_id: str, request: SupportPermissionsRequest,
                            user=Depends(current_user)):
    require_communicator(user)
    return change_support_permissions(user['id'], supporter_id, request.permissions, user['id'])


@api_router.delete('/support/links/{supporter_id}', status_code=204, tags=['역할·권한'])
def delete_support_link(supporter_id: str, user=Depends(current_user)):
    require_communicator(user)
    revoke_support(user['id'], supporter_id, user['id'])
    return None


@api_router.get('/privacy/export', tags=['개인정보'])
def get_privacy_export(user=Depends(current_user)):
    require_communicator(user)
    return export_for(user['id'])


@api_router.delete('/privacy/data', response_model=PrivacySettingsResponse, tags=['개인정보'])
def delete_privacy_data(request: PrivacyDeleteRequest, user=Depends(current_user)):
    require_communicator(user)
    return delete_personal_data(user['id'])


@api_router.post('/offline/events/sync', response_model=OfflineSyncResponse, tags=['오프라인'])
def sync_offline_events(request: OfflineSyncRequest, http_request: Request,
                       retried: int = Header(default=0, alias='X-Pesc-Sync-Retried', ge=0, le=100),
                       user=Depends(current_user)):
    require_communicator(user)
    require_guardian_consent(user)
    if retried > len(request.events):
        raise HTTPException(422, '재시도 건수는 전송 건수보다 클 수 없습니다.')
    with http_request.app.state.offline_sync_metrics.measure('communication', len(request.events), retried) as observation:
        return sync_events(user['id'], [event.model_dump(exclude_none=True) for event in request.events], observation=observation)


@api_router.post('/auth/logout', status_code=204, tags=['인증'])
def sign_out(_user=Depends(current_user), credentials=Depends(security)):
    logout(credentials)
    return None


@api_router.get('/tts/settings', response_model=TtsSettingsResponse, tags=['음성'])
def get_tts_settings(user_id: str | None = Query(default=None, max_length=64),
                     user=Depends(current_user)):
    target = user_id or user['id']
    require_link_permission(user, target, 'voice_access_manage')
    return settings_for(target)


@api_router.put('/tts/settings', response_model=TtsSettingsResponse, tags=['음성'])
def put_tts_settings(request: TtsSettingsRequest,
                     user_id: str | None = Query(default=None, max_length=64),
                     user=Depends(current_user)):
    target = user_id or user['id']
    require_link_permission(user, target, 'voice_access_manage')
    return save_settings(target, request.preset, request.voice_name.strip(), request.rate,
                         request.pitch, request.volume)


@api_router.get('/accessibility/settings', response_model=AccessibilitySettingsResponse, tags=['접근성'])
def get_accessibility_settings(user_id: str | None = Query(default=None, max_length=64),
                               user=Depends(current_user)):
    target = user_id or user['id']
    require_link_permission(user, target, 'voice_access_manage')
    return accessibility_settings_for(target)


@api_router.put('/accessibility/settings', response_model=AccessibilitySettingsResponse, tags=['접근성'])
def put_accessibility_settings(request: AccessibilitySettingsRequest,
                               user_id: str | None = Query(default=None, max_length=64),
                               user=Depends(current_user)):
    target = user_id or user['id']
    require_link_permission(user, target, 'voice_access_manage')
    return save_accessibility_settings(target, request.model_dump())


@api_router.post('/tts/events', response_model=TtsEventResponse, status_code=201, tags=['음성'])
def create_tts_event(request: TtsEventRequest, user=Depends(current_user)):
    require_communicator(user)
    require_guardian_consent(user)
    return start_event(user['id'], str(request.request_id), request.content_type, request.char_count)


@api_router.patch('/tts/events/{request_id}', response_model=TtsEventResponse, tags=['음성'])
def complete_tts_event(request_id: UUID, request: TtsEventResultRequest, user=Depends(current_user)):
    require_communicator(user)
    return finish_event(user['id'], str(request_id), request.status, request.error_code.strip(),
                        request.startup_ms)


@api_router.get('/cards', response_model=list[CardResponse], response_model_exclude_none=True, tags=['카드'])
def cards(user=Depends(current_user)):
    require_communicator(user)
    return CARDS + approved_cards_for(user['id'])


@api_router.get('/board/layout', response_model=BoardLayoutResponse,
                response_model_exclude_none=True, tags=['카드판'])
def get_board_layout(user_id: str | None = Query(default=None, max_length=64),
                     user=Depends(current_user)):
    target = user_id or user['id']
    require_any_link_permission(user, target, {'quick_speech_manage', 'board_manage'})
    return layout_for(target)


def _require_support_manager(user, user_id, permission):
    if user['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '보호자 또는 담당자만 카드판 구성을 변경할 수 있습니다.')
    return require_link_permission(user, user_id, permission)


@api_router.put('/board/layout/quick-expressions', response_model=BoardLayoutResponse,
                response_model_exclude_none=True, tags=['카드판'])
def put_quick_expressions(request: BoardCardIdsRequest,
                          user_id: str = Query(min_length=1, max_length=64),
                          user=Depends(current_user)):
    target = _require_support_manager(user, user_id, 'quick_speech_manage')
    return save_quick_expressions(target, user['id'], request.card_ids, request.expected_revision)


@api_router.put('/board/layout/recovery-expressions', response_model=BoardLayoutResponse,
                response_model_exclude_none=True, tags=['카드판'])
def put_recovery_expressions(request: BoardRecoveryIdsRequest,
                             user_id: str = Query(min_length=1, max_length=64),
                             user=Depends(current_user)):
    target = _require_support_manager(user, user_id, 'quick_speech_manage')
    return save_recovery_expressions(target, user['id'], request.expression_ids, request.expected_revision)


@api_router.put('/board/layout/slots', response_model=BoardLayoutResponse,
                response_model_exclude_none=True, tags=['카드판'])
def put_board_slots(request: BoardCardIdsRequest,
                    user_id: str = Query(min_length=1, max_length=64),
                    user=Depends(current_user)):
    target = _require_support_manager(user, user_id, 'board_manage')
    return save_slots(target, user['id'], request.card_ids, request.expected_revision)


@api_router.get('/board/layout/audit', response_model=list[BoardAuditResponse], tags=['카드판'])
def get_board_audit(user_id: str | None = Query(default=None, max_length=64),
                    user=Depends(current_user)):
    target = user_id or user['id']
    require_any_link_permission(user, target, {'quick_speech_manage', 'board_manage'})
    return board_audit_for(target)


@api_router.get('/learning/settings', response_model=LearningSettingsResponse, tags=['학습'])
def get_learning_settings(user_id: str | None = Query(default=None, max_length=64),
                          user=Depends(current_user)):
    target = user_id or user['id']
    require_link_permission(user, target, 'learning_manage')
    return learning_settings_for(target)


@api_router.put('/learning/settings', response_model=LearningSettingsResponse, tags=['학습'])
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


@api_router.post('/learning/attempts', response_model=LearningAttemptResponse,
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
        )


@api_router.get('/learning/progress', response_model=LearningProgressResponse, tags=['학습'])
def get_learning_progress(days: int | None = Query(default=None, ge=1, le=365),
                          user_id: str | None = Query(default=None, max_length=64),
                          user=Depends(current_user)):
    target = user_id or user['id']
    require_link_permission(user, target, 'learning_manage')
    return learning_progress_for(target, days=days)


@api_router.get('/learning/audit', response_model=list[LearningAuditResponse], tags=['학습'])
def get_learning_audit(user_id: str | None = Query(default=None, max_length=64),
                       user=Depends(current_user)):
    target = user_id or user['id']
    require_link_permission(user, target, 'learning_manage')
    return learning_audit_for(target)


@api_router.get('/categories', response_model=list[CategoryResponse], tags=['카드'])
def categories(_user=Depends(current_user)):
    return active_categories()


def _card_owner(user, user_id=None):
    if user['role'] == 'user':
        if user_id and user_id != user['id']:
            raise HTTPException(403, '다른 사용자의 카드를 관리할 수 없습니다.')
        return user['id']
    if not user_id:
        raise HTTPException(422, '관리할 연결 사용자를 선택해 주세요.')
    return require_link_permission(user, user_id, 'cards_manage')


@api_router.get('/cards/submissions', response_model=list[CardSubmissionResponse], tags=['카드'])
def card_submissions(user_id: str | None = Query(default=None, max_length=64),
                     user=Depends(current_user)):
    return submissions_for(_card_owner(user, user_id))


@api_router.post('/cards/submissions', response_model=CardSubmissionResponse, status_code=201, tags=['카드'])
async def submit_card(label: str = Form(min_length=1, max_length=30),
                      meaning: str = Form(min_length=1, max_length=120),
                      category: str = Form(min_length=1, max_length=30),
                      visibility: str = Form(),
                      submission_mode: str = Form(default='submit'),
                      user_id: str | None = Form(default=None, max_length=64),
                      image: UploadFile = File(),
                      user=Depends(current_user)):
    owner_id = _card_owner(user, user_id)
    require_guardian_consent({'id': owner_id})
    image_data = await image.read(MAX_IMAGE_BYTES + 1)
    return create_submission(owner_id, label, meaning, category, visibility,
                             image.filename, image.content_type, image_data, submission_mode,
                             actor_id=user['id'])


@api_router.post('/cards/submissions/{submission_id}/submit', response_model=CardSubmissionResponse, tags=['카드'])
def request_card_review(submission_id: str,
                        user_id: str | None = Query(default=None, max_length=64),
                        user=Depends(current_user)):
    owner_id = _card_owner(user, user_id)
    require_guardian_consent({'id': owner_id})
    return submit_draft(submission_id, owner_id, actor_id=user['id'])


@api_router.patch('/cards/submissions/{submission_id}', response_model=CardSubmissionResponse, tags=['카드'])
def edit_card_submission(submission_id: str, request: CardUpdateRequest,
                         user_id: str | None = Query(default=None, max_length=64),
                         user=Depends(current_user)):
    owner_id = _card_owner(user, user_id)
    require_guardian_consent({'id': owner_id})
    return update_submission(submission_id, owner_id, request.label, request.meaning,
                             request.category, request.visibility, actor_id=user['id'])


@api_router.get('/cards/submissions/{submission_id}/image', tags=['카드'])
def card_submission_image(submission_id: str, user=Depends(current_user)):
    content, content_type = image_for(submission_id, user)
    return Response(content=content, media_type=content_type,
                    headers={'Cache-Control': 'private, max-age=300'})


@api_router.get('/admin/card-submissions', response_model=list[CardSubmissionResponse], tags=['운영'])
def admin_card_submissions(user=Depends(current_user)):
    require_account_permission(user, 'content_manage')
    return submissions_for_review()


@api_router.patch('/admin/card-submissions/{submission_id}', response_model=CardSubmissionResponse, tags=['운영'])
def review_card_submission(submission_id: str, request: CardReviewRequest, http_request: Request, response: Response,
                           user=Depends(current_user)):
    reauthenticate_content_operator(user, request.password.get_secret_value(),
                                    http_request.client.host if http_request.client else None)
    response.headers['Cache-Control'] = 'no-store'
    return review_submission(submission_id, user['id'], request.decision, request.reason)


@api_router.get('/admin/categories', response_model=list[CategoryResponse], tags=['운영'])
def admin_categories(user=Depends(current_user)):
    require_account_permission(user, 'content_manage')
    return categories_for_admin()


@api_router.post('/admin/categories', response_model=CategoryResponse, status_code=201, tags=['운영'])
def add_category(request: CategoryCreateRequest, http_request: Request, response: Response, user=Depends(current_user)):
    reauthenticate_content_operator(user, request.password.get_secret_value(),
                                    http_request.client.host if http_request.client else None)
    response.headers['Cache-Control'] = 'no-store'
    return create_category(request.name, request.display_order)


@api_router.patch('/admin/categories/{category_id}', response_model=CategoryResponse, tags=['운영'])
def edit_category(category_id: str, request: CategoryUpdateRequest, http_request: Request, response: Response,
                  user=Depends(current_user)):
    reauthenticate_content_operator(user, request.password.get_secret_value(),
                                    http_request.client.host if http_request.client else None)
    response.headers['Cache-Control'] = 'no-store'
    return update_category(category_id, request.name, request.display_order, request.active)


@api_router.post('/sentences', response_model=CommunicationSessionResponse, tags=['문장'])
def generate_sentence(request: SentenceRequest, user=Depends(current_user)):
    require_communicator(user)
    require_guardian_consent(user)
    return save_session(request, user['id'], approved_cards_for(user['id']))


@api_router.post('/sentences/{session_id}/regenerate', response_model=CommunicationSessionResponse,
                 tags=['문장'])
def regenerate_sentence(session_id: UUID, request: RegenerateSentenceRequest,
                        user=Depends(current_user)):
    require_communicator(user)
    require_guardian_consent(user)
    return regenerate_session(session_id, request.request_id, user['id'],
                              approved_cards_for(user['id']))


@api_router.get('/recommendations', response_model=list[CardResponse], response_model_exclude_none=True, tags=['추천'])
def recommendations(user=Depends(current_user)):
    require_communicator(user)
    used = statistics(user['id'])['top_cards']
    keys = {c['id'] for c in used}
    available = CARDS + approved_cards_for(user['id'])
    available_by_id = {card['id']: card for card in available}
    frequent = [available_by_id.get(card['id'], {}) | card |
                {'reason': f"자주 사용함 · {card['count']}회"} for card in used]
    defaults = [card | {'reason': '처음 시작하기 좋은 카드'} for card in available if card['id'] not in keys]
    return (frequent + defaults)[:6]


@api_router.get('/dashboard', response_model=DashboardResponse, tags=['통계'])
def dashboard(days: int | None = Query(default=None, ge=1, le=365),
              user_id: str | None = Query(default=None, max_length=64),
              user=Depends(current_user)):
    target = dashboard_user(user, user_id)
    result = statistics(target, days=days)
    speech = speech_for_sessions(target, [row['id'] for row in result['recent']])
    for row in result['recent']:
        row['speech_results'] = speech.get(row['id'], [])
    if user['role'] in SUPPORT_ROLES and 'notes_write' in permissions_for(user['id'], target):
        notes = notes_for(user['id'], target, [row['id'] for row in result['recent']], include_details=True)
        for row in result['recent']:
            details = notes.get(row['id'])
            row['caregiver_note'] = details.get('content') if details else None
            row['caregiver_note_details'] = details
    return result


@api_router.get('/records/export', tags=['기록'])
def download_records(domain: Literal['communication', 'learning', 'activity'],
                     format: Literal['json', 'csv'] = 'json',
                     days: int | None = Query(default=None, ge=1, le=365),
                     user_id: str | None = Query(default=None, min_length=1, max_length=64),
                     user=Depends(current_user)):
    permission = 'learning_manage' if domain == 'learning' else 'records_read'
    target = dashboard_user(user, user_id, permission)
    exported = export_records(target, domain, days)
    headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
               'Content-Disposition': f'attachment; filename="pesc-mate-{domain}-{days or "all"}.{format}"'}
    if format == 'csv':
        return Response(records_csv(exported), media_type='text/csv', headers=headers)
    return JSONResponse(exported, headers=headers)


@api_router.get('/records/activity', tags=['기록'])
def get_communication_activity(days: int | None = Query(default=None, ge=1, le=365),
                               user_id: str | None = Query(default=None, max_length=64),
                               user=Depends(current_user)):
    target = dashboard_user(user, user_id, 'records_read')
    return JSONResponse(activity_report(target, days), headers={'Cache-Control': 'no-store'})


@api_router.get('/profile/presets', tags=['프로필'])
def profile_presets(user=Depends(current_user)):
    from app.services.profiles import PRESETS
    return PRESETS


@api_router.put('/profile', response_model=ProfileResponse, tags=['프로필'])
def put_profile(request: ProfileRequest, user=Depends(current_user)):
    from app.services.profiles import save_profile
    return save_profile(user['id'], preset=request.preset)


@api_router.post('/profile/image', response_model=ProfileResponse, tags=['프로필'])
async def upload_profile(image: UploadFile = File(), user=Depends(current_user)):
    from app.services.profiles import save_profile
    content = await image.read(MAX_IMAGE_BYTES + 1)
    return save_profile(user['id'], image_data=content, content_type=image.content_type)


@api_router.get('/profile/{user_id}/image', tags=['프로필'])
def get_profile_image(user_id: str, user=Depends(current_user)):
    from app.services.profiles import profile_image
    content, mime = profile_image(user_id, user)
    return Response(content=content, media_type=mime, headers={'Cache-Control': 'private, no-store'})
