"""settings API request and response schemas."""
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field

class TtsSettingsRequest(BaseModel):
    preset: Literal['girl', 'boy', 'child', 'woman', 'man']
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
    start_screen: Literal['home', 'cards'] = 'home'
    output_mode: Literal['word', 'selection', 'natural'] = 'natural'


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
