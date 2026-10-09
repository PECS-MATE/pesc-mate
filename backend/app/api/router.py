from datetime import datetime
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field
from uuid import UUID
from app.services.communication import CARDS, regenerate_session, save_session, statistics
from app.services.accessibility_settings import save_settings as save_accessibility_settings
from app.services.accessibility_settings import settings_for as accessibility_settings_for
from app.services.authentication import current_user, dashboard_user, linked_users, login, logout, register, security
from app.services.privacy import (
    access_audit_for, caregiver_access_for, connect_caregiver, delete_personal_data,
    disconnect_caregiver, export_for, privacy_for, save_privacy,
)
from app.services.model import status as model_status
from app.services.offline_events import sync_events
from app.services.caregiver_notes import delete_note, notes_for, save_note
from app.services.tts_settings import save_settings, settings_for
from app.services.tts_events import finish_event, start_event
from app.services.card_submissions import (
    MAX_IMAGE_BYTES, approved_cards_for, create_submission, image_for,
    review_submission, submissions_for, submissions_for_review, submit_draft,
    update_submission,
)
from app.services.categories import (
    active_categories, categories_for_admin, create_category, update_category,
)

api_router = APIRouter()


@api_router.get("/health", tags=["health"])
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@api_router.get('/model/status', tags=['모델'])
def get_model_status(user=Depends(current_user)):
    return model_status()


class SentenceRequest(BaseModel):
    cards: list[str] = Field(min_length=1, max_length=12)
    request_id: UUID


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


class CaregiverNoteResponse(BaseModel):
    id: str
    session_id: str
    user_id: str
    content: str
    updated_at: datetime


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
    profile: ProfileResponse | None = None
    session_expires_at: datetime | None = None


class TtsSettingsRequest(BaseModel):
    preset: Literal['child', 'woman', 'man']
    voice_name: str = Field(default='', max_length=120)
    rate: float = Field(ge=0.5, le=1.5)
    pitch: float = Field(ge=0.5, le=1.5)


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


class CaregiverConnectRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)


class CaregiverAccessResponse(BaseModel):
    caregiver_id: str
    username: str
    name: str
    scopes: list[str]
    connected_at: datetime | None = None


class PrivacyAuditResponse(BaseModel):
    id: str
    action: str
    actor_id: str
    target_id: str | None = None
    created_at: datetime


class PrivacyDeleteRequest(BaseModel):
    confirmation: Literal['DELETE']


class OfflineEventRequest(BaseModel):
    id: UUID
    event_type: Literal['immediate_speech', 'selection_speech']
    card_ids: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(min_length=1, max_length=12)
    occurred_at: datetime


class OfflineSyncRequest(BaseModel):
    events: list[OfflineEventRequest] = Field(min_length=1, max_length=100)


class OfflineSyncResponse(BaseModel):
    accepted_ids: list[UUID]


class TtsEventRequest(BaseModel):
    request_id: UUID
    content_type: Literal['card', 'sentence', 'preview']
    char_count: int = Field(ge=1, le=500)


class TtsEventResultRequest(BaseModel):
    status: Literal['succeeded', 'failed', 'cancelled']
    error_code: str = Field(default='', max_length=80)


class TtsEventResponse(BaseModel):
    id: UUID
    status: str
    error_code: str | None = None
    requested_at: datetime | None = None
    completed_at: datetime | None = None


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


class CategoryResponse(BaseModel):
    id: str
    name: str
    display_order: int
    active: bool


class CategoryCreateRequest(BaseModel):
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


class CardReviewRequest(BaseModel):
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
    sentence: str
    generation_source: str | None = None
    generation: dict[str, object] | None = None
    regeneration_of: UUID | None = None
    generation_attempt: int = 1
    caregiver_note: str | None = None
    created_at: datetime


class DailyActivityResponse(BaseModel):
    date: str
    sessions: int


class SafetyExpressionResponse(CardResponse):
    count: int
    last_used_at: datetime


class DashboardResponse(BaseModel):
    sessions: int
    selections: int
    top_cards: list[CardResponse]
    categories: dict[str, int]
    recent: list[CommunicationSessionResponse]
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


def require_admin(user):
    if user['role'] != 'admin':
        raise HTTPException(403, '관리자 계정만 이용할 수 있습니다.')
    return user


@api_router.post('/auth/login', response_model=LoginResponse, tags=['인증'])
def authenticate(request: LoginRequest):
    return login(request.username.strip(), request.password)


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
    if user['role'] != 'caregiver':
        raise HTTPException(403, '보호자 계정만 접근할 수 있습니다.')
    return linked_users(user['id'])


@api_router.put('/care/notes/{session_id}', response_model=CaregiverNoteResponse, tags=['보호자'])
def put_caregiver_note(session_id: UUID, request: CaregiverNoteRequest, user=Depends(current_user)):
    if user['role'] != 'caregiver':
        raise HTTPException(403, '보호자 계정만 메모를 작성할 수 있습니다.')
    target = dashboard_user(user, request.user_id)
    content = request.content.strip()
    if not content:
        raise HTTPException(422, '메모 내용을 입력해 주세요.')
    return save_note(user['id'], target, str(session_id), content)


@api_router.delete('/care/notes/{session_id}', status_code=204, tags=['보호자'])
def remove_caregiver_note(session_id: UUID,
                          user_id: str = Query(min_length=1, max_length=64),
                          user=Depends(current_user)):
    if user['role'] != 'caregiver':
        raise HTTPException(403, '보호자 계정만 메모를 삭제할 수 있습니다.')
    target = dashboard_user(user, user_id)
    delete_note(user['id'], target, str(session_id))
    return None


@api_router.get('/privacy/settings', response_model=PrivacySettingsResponse, tags=['개인정보'])
def get_privacy_settings(user=Depends(current_user)):
    require_communicator(user)
    return privacy_for(user['id'])


@api_router.put('/privacy/settings', response_model=PrivacySettingsResponse, tags=['개인정보'])
def put_privacy_settings(request: PrivacySettingsRequest, user=Depends(current_user)):
    require_communicator(user)
    return save_privacy(user['id'], request.guardian_consent, request.retention_days)


@api_router.get('/privacy/caregivers', response_model=list[CaregiverAccessResponse], tags=['개인정보'])
def get_privacy_caregivers(user=Depends(current_user)):
    require_communicator(user)
    return caregiver_access_for(user['id'])


@api_router.post('/privacy/caregivers', response_model=list[CaregiverAccessResponse], tags=['개인정보'])
def post_privacy_caregiver(request: CaregiverConnectRequest, user=Depends(current_user)):
    require_communicator(user)
    return connect_caregiver(user['id'], request.username.strip())


@api_router.delete('/privacy/caregivers/{caregiver_id}', status_code=204, tags=['개인정보'])
def delete_privacy_caregiver(caregiver_id: str, user=Depends(current_user)):
    require_communicator(user)
    disconnect_caregiver(user['id'], caregiver_id)
    return None


@api_router.get('/privacy/audit', response_model=list[PrivacyAuditResponse], tags=['개인정보'])
def get_privacy_audit(user=Depends(current_user)):
    require_communicator(user)
    return access_audit_for(user['id'])


@api_router.get('/privacy/export', tags=['개인정보'])
def get_privacy_export(user=Depends(current_user)):
    require_communicator(user)
    return export_for(user['id'])


@api_router.delete('/privacy/data', response_model=PrivacySettingsResponse, tags=['개인정보'])
def delete_privacy_data(request: PrivacyDeleteRequest, user=Depends(current_user)):
    require_communicator(user)
    return delete_personal_data(user['id'])


@api_router.post('/offline/events/sync', response_model=OfflineSyncResponse, tags=['오프라인'])
def sync_offline_events(request: OfflineSyncRequest, user=Depends(current_user)):
    require_communicator(user)
    require_guardian_consent(user)
    return sync_events(user['id'], [event.model_dump() for event in request.events])


@api_router.post('/auth/logout', status_code=204, tags=['인증'])
def sign_out(_user=Depends(current_user), credentials=Depends(security)):
    logout(credentials)
    return None


@api_router.get('/tts/settings', response_model=TtsSettingsResponse, tags=['음성'])
def get_tts_settings(user=Depends(current_user)):
    require_communicator(user)
    return settings_for(user['id'])


@api_router.put('/tts/settings', response_model=TtsSettingsResponse, tags=['음성'])
def put_tts_settings(request: TtsSettingsRequest, user=Depends(current_user)):
    require_communicator(user)
    return save_settings(user['id'], request.preset, request.voice_name.strip(), request.rate, request.pitch)


@api_router.get('/accessibility/settings', response_model=AccessibilitySettingsResponse, tags=['접근성'])
def get_accessibility_settings(user=Depends(current_user)):
    require_communicator(user)
    return accessibility_settings_for(user['id'])


@api_router.put('/accessibility/settings', response_model=AccessibilitySettingsResponse, tags=['접근성'])
def put_accessibility_settings(request: AccessibilitySettingsRequest, user=Depends(current_user)):
    require_communicator(user)
    return save_accessibility_settings(user['id'], request.model_dump())


@api_router.post('/tts/events', response_model=TtsEventResponse, status_code=201, tags=['음성'])
def create_tts_event(request: TtsEventRequest, user=Depends(current_user)):
    require_communicator(user)
    require_guardian_consent(user)
    return start_event(user['id'], str(request.request_id), request.content_type, request.char_count)


@api_router.patch('/tts/events/{request_id}', response_model=TtsEventResponse, tags=['음성'])
def complete_tts_event(request_id: UUID, request: TtsEventResultRequest, user=Depends(current_user)):
    require_communicator(user)
    return finish_event(user['id'], str(request_id), request.status, request.error_code.strip())


@api_router.get('/cards', response_model=list[CardResponse], response_model_exclude_none=True, tags=['카드'])
def cards(user=Depends(current_user)):
    require_communicator(user)
    return CARDS + approved_cards_for(user['id'])


@api_router.get('/categories', response_model=list[CategoryResponse], tags=['카드'])
def categories(user=Depends(current_user)):
    require_communicator(user)
    return active_categories()


@api_router.get('/cards/submissions', response_model=list[CardSubmissionResponse], tags=['카드'])
def card_submissions(user=Depends(current_user)):
    require_communicator(user)
    return submissions_for(user['id'])


@api_router.post('/cards/submissions', response_model=CardSubmissionResponse, status_code=201, tags=['카드'])
async def submit_card(label: str = Form(min_length=1, max_length=30),
                      meaning: str = Form(min_length=1, max_length=120),
                      category: str = Form(min_length=1, max_length=30),
                      visibility: str = Form(),
                      submission_mode: str = Form(default='submit'),
                      image: UploadFile = File(),
                      user=Depends(current_user)):
    require_communicator(user)
    require_guardian_consent(user)
    image_data = await image.read(MAX_IMAGE_BYTES + 1)
    return create_submission(user['id'], label, meaning, category, visibility,
                             image.filename, image.content_type, image_data, submission_mode)


@api_router.post('/cards/submissions/{submission_id}/submit', response_model=CardSubmissionResponse, tags=['카드'])
def request_card_review(submission_id: str, user=Depends(current_user)):
    require_communicator(user)
    require_guardian_consent(user)
    return submit_draft(submission_id, user['id'])


@api_router.patch('/cards/submissions/{submission_id}', response_model=CardSubmissionResponse, tags=['카드'])
def edit_card_submission(submission_id: str, request: CardUpdateRequest,
                         user=Depends(current_user)):
    require_communicator(user)
    require_guardian_consent(user)
    return update_submission(submission_id, user['id'], request.label, request.meaning,
                             request.category, request.visibility)


@api_router.get('/cards/submissions/{submission_id}/image', tags=['카드'])
def card_submission_image(submission_id: str, user=Depends(current_user)):
    content, content_type = image_for(submission_id, user)
    return Response(content=content, media_type=content_type,
                    headers={'Cache-Control': 'private, max-age=300'})


@api_router.get('/admin/card-submissions', response_model=list[CardSubmissionResponse], tags=['관리자'])
def admin_card_submissions(user=Depends(current_user)):
    require_admin(user)
    return submissions_for_review()


@api_router.patch('/admin/card-submissions/{submission_id}', response_model=CardSubmissionResponse, tags=['관리자'])
def review_card_submission(submission_id: str, request: CardReviewRequest,
                           user=Depends(current_user)):
    require_admin(user)
    return review_submission(submission_id, user['id'], request.decision, request.reason)


@api_router.get('/admin/categories', response_model=list[CategoryResponse], tags=['관리자'])
def admin_categories(user=Depends(current_user)):
    require_admin(user)
    return categories_for_admin()


@api_router.post('/admin/categories', response_model=CategoryResponse, status_code=201, tags=['관리자'])
def add_category(request: CategoryCreateRequest, user=Depends(current_user)):
    require_admin(user)
    return create_category(request.name, request.display_order)


@api_router.patch('/admin/categories/{category_id}', response_model=CategoryResponse, tags=['관리자'])
def edit_category(category_id: str, request: CategoryUpdateRequest, user=Depends(current_user)):
    require_admin(user)
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
    if user['role'] == 'caregiver':
        notes = notes_for(user['id'], target, [row['id'] for row in result['recent']])
        for row in result['recent']:
            row['caregiver_note'] = notes.get(row['id'])
    return result


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
