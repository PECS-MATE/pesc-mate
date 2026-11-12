"""auth HTTP boundary; public paths and handler names are preserved."""
from fastapi import APIRouter, Depends, HTTPException, Request
from app.services.authentication import current_user, login, logout, register, security
from app.schemas.auth import LoginRequest, LoginResponse, RegisterRequest
from app.schemas.accounts import UserResponse

router = APIRouter()


@router.post('/auth/login', response_model=LoginResponse, tags=['인증'])
def authenticate(request: LoginRequest, http_request: Request):
    client_ip = http_request.client.host if http_request.client else None
    return login(request.username.strip(), request.password, client_ip)


@router.post('/auth/register', response_model=LoginResponse, status_code=201, tags=['인증'])
def create_account(request: RegisterRequest):
    name = request.name.strip()
    if not name:
        raise HTTPException(422, '이름을 입력해 주세요.')
    return register(request.username.strip(), request.password, name, request.guardian_consent)


@router.get('/auth/me', response_model=UserResponse, tags=['인증'])
def me(user=Depends(current_user)):
    return user


@router.post('/auth/logout', status_code=204, tags=['인증'])
def sign_out(_user=Depends(current_user), credentials=Depends(security)):
    logout(credentials)
    return None
