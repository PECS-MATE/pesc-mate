from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import ValidationError, Field
from starlette.responses import JSONResponse

from app.services.authentication import current_user
from app.services import a4_projects as service

router = APIRouter(prefix='/a4/projects', tags=['A4 공유'])


def response(data, status=200):
    return JSONResponse(data, status_code=status, headers={'Cache-Control': 'no-store'})


@router.get('')
def listing(scope: Literal['discover', 'mine', 'review'] = 'discover',
            topic: str = Query(default='', max_length=20), q: str = Query(default='', max_length=60),
            offset: int = Query(default=0, ge=0, le=10000), user=Depends(current_user)):
    return response(service.list_projects(user, scope, topic, q.strip(), offset))


@router.post('', status_code=201)
async def save(request: Request, user=Depends(current_user)):
    service.require_access(user)
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > service.MAX_REQUEST_BYTES:
            raise HTTPException(413, '카드판 전송은 12MiB 이하로 줄여 주세요.')
    try:
        payload = service.SaveRequest.model_validate_json(bytes(body))
    except ValidationError:
        raise HTTPException(422, '카드판 제목·사진·용지·칸의 구성을 확인해 주세요.') from None
    return response(service.save_project(payload, user), 201)


@router.get('/{project_id}')
def detail(project_id: UUID, user=Depends(current_user)):
    return response(service.project_detail(str(project_id), user))


class CopyRequest(service.StrictModel):
    request_id: UUID


@router.post('/{project_id}/copy', status_code=201)
def copy(project_id: UUID, payload: CopyRequest, user=Depends(current_user)):
    return response(service.copy_project(str(project_id), payload.request_id, user), 201)


class VersionRequest(service.StrictModel):
    expected_version: int = Field(ge=1, strict=True)


@router.post('/{project_id}/withdraw')
def withdraw(project_id: UUID, payload: VersionRequest, user=Depends(current_user)):
    return response(service.withdraw_project(str(project_id), payload.expected_version, user))


@router.delete('/{project_id}')
def delete(project_id: UUID, payload: VersionRequest, user=Depends(current_user)):
    return response(service.delete_project(str(project_id), payload.expected_version, user))


class ReviewRequest(VersionRequest):
    action: Literal['approve', 'reject', 'withdraw', 'dismiss']
    reason: str = Field(default='', max_length=300)


@router.post('/{project_id}/review')
def review(project_id: UUID, payload: ReviewRequest, user=Depends(current_user)):
    return response(service.review_project(str(project_id), payload.expected_version, payload.action, payload.reason, user))


class ReportRequest(service.StrictModel):
    reason: str = Field(min_length=3, max_length=300)


@router.post('/{project_id}/report')
def report(project_id: UUID, payload: ReportRequest, user=Depends(current_user)):
    return response(service.report_project(str(project_id), payload.reason, user))
