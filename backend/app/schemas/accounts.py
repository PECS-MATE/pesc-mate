"""accounts API request and response schemas."""
from datetime import datetime
from typing import Literal
from pydantic import AwareDatetime, BaseModel, Field, SecretStr
from app.services.support_links import LINK_PERMISSIONS

class ProfileResponse(BaseModel):
    kind: Literal['preset', 'custom']
    preset: str | None = None
    image_url: str | None = None
    thumbnail_url: str | None = None


class ProfileRequest(BaseModel):
    preset: str = Field(min_length=1, max_length=20)


class UserResponse(BaseModel):
    id: str
    username: str
    name: str
    role: str
    default_output_mode: Literal['word', 'selection', 'natural'] = 'natural'
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
