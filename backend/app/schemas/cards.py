"""cards API request and response schemas."""
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, SecretStr

class CardResponse(BaseModel):
    id: str
    label: str
    symbol: str
    category: str
    image_index: int | None = None
    image_filename: str | None = None
    meaning: str | None = None
    part_of_speech: str | None = None
    has_batchim: bool | None = None
    sentence_role: str | None = None
    semantic_group: str | None = None
    safety_relevant: bool | None = None
    image_url: str | None = None
    thumbnail_url: str | None = None
    custom: bool | None = None
    count: int | None = None
    reason: str | None = None


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
    image_revision: int = 0
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
    thumbnail_url: str | None = None
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
    meaning: str | None = Field(default=None, max_length=120)
    category: str = Field(min_length=1, max_length=30)
    visibility: Literal['private', 'shared']
