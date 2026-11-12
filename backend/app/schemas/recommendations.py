"""recommendations API request and response schemas."""
from typing import Annotated, Literal
from pydantic import BaseModel, Field
from uuid import UUID

class RecommendationFeedRequest(BaseModel):
    request_id: UUID
    selected_card_ids: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(default_factory=list, max_length=12)
    hour: int = Field(ge=0, le=23)
    utc_offset_minutes: int = Field(ge=-840, le=840)


class RecommendationExposureRequest(BaseModel):
    card_ids: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(min_length=1, max_length=6)


class RecommendationSelectionRequest(BaseModel):
    card_id: str = Field(min_length=1, max_length=100)


class RecommendationSettingsRequest(BaseModel):
    enabled: bool
    mode: Literal['automatic', 'approval']
    approved_card_ids: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(max_length=100)
    hidden_card_ids: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(max_length=100)
    situation: Literal['unspecified', 'home', 'school', 'therapy', 'outside', 'meal', 'hospital']
    use_time_of_day: bool
    expected_revision: int = Field(ge=0)
