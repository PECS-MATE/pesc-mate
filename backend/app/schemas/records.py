"""records API request and response schemas."""
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field
from app.schemas.cards import CardResponse
from app.schemas.communication import CommunicationSessionResponse

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
