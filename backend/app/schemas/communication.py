"""communication API request and response schemas."""
from datetime import datetime
from typing import Annotated, Literal
from pydantic import AwareDatetime, BaseModel, Field, model_validator
from uuid import UUID
from app.schemas.cards import CardResponse

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


class ServerSpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=300)
    voice: Literal['girl', 'boy'] = 'girl'
    rate: float = Field(default=0.9, ge=0.5, le=1.5, allow_inf_nan=False)
