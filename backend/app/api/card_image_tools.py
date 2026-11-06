from typing import Literal
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from starlette.responses import JSONResponse
from app.services.authentication import current_user, require_account_permission
from app.services.support_links import SUPPORT_ROLES, require_link_permission
from app.services.privacy import privacy_for
from app.services.card_submissions import MAX_IMAGE_BYTES
from app.services import card_image_tools as tools

router = APIRouter(prefix='/card-image-tools', tags=['카드 이미지 보조'])


def authorize(user, scope, target):
    if scope == 'shared':
        require_account_permission(user, 'content_manage')
    else:
        if user['role'] not in SUPPORT_ROLES or not target:
            raise HTTPException(403, '연결된 보호자 또는 담당자만 사용할 수 있습니다.')
        require_link_permission(user, target, 'cards_manage')
        if not privacy_for(target).get('guardian_consent'):
            raise HTTPException(403, '보호자 동의 후 사용할 수 있습니다.')


class Generate(BaseModel):
    label: str = Field(min_length=1, max_length=30)
    external_accepted: bool = False
    expected_backend: Literal['huggingface', 'gemini']
    expected_model: str = Field(min_length=1, max_length=160)
    scope: Literal['private', 'shared'] = 'private'
    user_id: str | None = Field(default=None, max_length=64)


@router.get('/status')
def status(scope: Literal['private', 'shared'] = Query(default='private'),
           user_id: str | None = Query(default=None, max_length=64), user=Depends(current_user)):
    authorize(user, scope, user_id)
    return JSONResponse(tools.status(), headers={'Cache-Control': 'no-store'})


@router.post('/generate')
def generate(body: Generate, user=Depends(current_user)):
    authorize(user, body.scope, body.user_id)
    if not body.label.strip():
        raise HTTPException(422, '그림을 만들 카드 이름을 입력하세요.')
    configuration = tools.status()
    if (body.expected_backend, body.expected_model) != (configuration['generation_backend'], configuration['model']):
        raise HTTPException(409, '이미지 서비스 설정이 바뀌었습니다. 사용 가능 여부를 다시 확인해 주세요.')
    with tools.capacity(user['id']):
        result = tools.generate(body.label.strip(), body.external_accepted)
    authorize(user, body.scope, body.user_id)
    return JSONResponse(result, headers={'Cache-Control': 'no-store'})


@router.post('/remove-background')
def remove_background(image: UploadFile = File(), scope: Literal['private', 'shared'] = Form(default='private'),
                      user_id: str | None = Form(default=None, max_length=64), user=Depends(current_user)):
    authorize(user, scope, user_id)
    with tools.capacity(user['id']):
        result = tools.cutout(image.file.read(MAX_IMAGE_BYTES + 1), image.content_type)
    authorize(user, scope, user_id)
    return JSONResponse(result, headers={'Cache-Control': 'no-store'})
