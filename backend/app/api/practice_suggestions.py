"""Supporter reviewed learning proposals; no automatic child activity starts."""
from uuid import UUID
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app.services.authentication import current_user
from app.services.support_links import SUPPORT_ROLES, require_link_permission
from app.services import practice_suggestions as suggestions

router = APIRouter(prefix='/practice-suggestions', tags=['연습 제안'])


def supporter_target(user, user_id):
    if user['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '연결된 보호자 또는 담당자만 연습 제안을 관리할 수 있습니다.')
    require_link_permission(user, user_id, 'records_read')
    require_link_permission(user, user_id, 'learning_manage')
    return user_id


class PersonalizationChange(BaseModel):
    enabled: bool
    expected_revision: int = Field(ge=0)


class StartRequest(BaseModel):
    candidate_id: str = Field(min_length=1, max_length=100)
    request_id: UUID
    question_count: Literal[5, 10, 15, 20, 30]
    option_count: Literal[2, 3, 4]
    repeat_frequency: Literal[1, 2, 3]
    retry_enabled: bool


class FeedbackChange(BaseModel):
    rating: Literal['appropriate', 'difficult', 'not_interested']
    expected_revision: int = Field(ge=0)


@router.get('/settings')
def settings(response: Response, user_id: str = Query(min_length=1, max_length=64), user=Depends(current_user)):
    supporter_target(user, user_id)
    response.headers['Cache-Control'] = 'no-store'
    return suggestions.personalization_for(user_id)


@router.put('/settings')
def change_settings(body: PersonalizationChange, response: Response,
                    user_id: str = Query(min_length=1, max_length=64), user=Depends(current_user)):
    supporter_target(user, user_id)
    response.headers['Cache-Control'] = 'no-store'
    return suggestions.set_personalization(user_id, body.enabled, body.expected_revision)


@router.get('/candidates')
def candidates(response: Response, user_id: str = Query(min_length=1, max_length=64),
               request_id: UUID = Query(), user=Depends(current_user)):
    supporter_target(user, user_id)
    response.headers['Cache-Control'] = 'no-store'
    result = suggestions.generated_candidates_for(user_id, str(request_id))
    supporter_target(user, user_id)
    return result


@router.post('/start')
def start(body: StartRequest, response: Response,
          user_id: str = Query(min_length=1, max_length=64), user=Depends(current_user)):
    supporter_target(user, user_id)
    response.headers['Cache-Control'] = 'no-store'
    return suggestions.approve_candidate(user_id, user, body.candidate_id, str(body.request_id),
        body.model_dump(include={'question_count', 'option_count', 'repeat_frequency', 'retry_enabled'}))


@router.get('/active')
def active(response: Response, user=Depends(current_user)):
    if user['role'] != 'user':
        raise HTTPException(403, '아동 계정에서만 준비된 연습을 볼 수 있습니다.')
    response.headers['Cache-Control'] = 'no-store'
    return suggestions.active_plan(user['id'])


@router.get('/feedback')
def feedback(response: Response, user_id: str = Query(min_length=1, max_length=64), user=Depends(current_user)):
    supporter_target(user, user_id)
    response.headers['Cache-Control'] = 'no-store'
    return suggestions.feedback_for(user_id)


@router.put('/feedback/{plan_id}')
def save_feedback(plan_id: UUID, body: FeedbackChange, response: Response,
                  user_id: str = Query(min_length=1, max_length=64), user=Depends(current_user)):
    supporter_target(user, user_id)
    response.headers['Cache-Control'] = 'no-store'
    return suggestions.save_feedback(user_id, user['id'], str(plan_id), body.rating, body.expected_revision)


@router.delete('/feedback/{plan_id}')
def delete_feedback(plan_id: UUID, response: Response, expected_revision: int = Query(ge=1),
                    user_id: str = Query(min_length=1, max_length=64), user=Depends(current_user)):
    supporter_target(user, user_id)
    response.headers['Cache-Control'] = 'no-store'
    return suggestions.delete_feedback(user_id, str(plan_id), expected_revision)
