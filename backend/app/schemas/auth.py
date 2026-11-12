"""auth API request and response schemas."""
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field
from app.schemas.accounts import UserResponse

class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class RegisterRequest(BaseModel):
    username: str = Field(pattern=r'^[A-Za-z0-9_-]+$', min_length=4, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=30)
    guardian_consent: Literal[True]


class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    expires_at: datetime
    user: UserResponse
