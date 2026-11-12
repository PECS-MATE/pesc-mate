"""Learning course HTTP validation, authentication and response headers."""
from fastapi import APIRouter, Depends, Query, Response

from app.schemas.learning import ProgramChange
from app.services.authentication import current_user
from app.services import learning_program as program_service

router = APIRouter(prefix='/learning/program', tags=['학습 코스'])


@router.get('')
def get_program(response: Response, user_id: str | None = Query(default=None, max_length=64),
                user=Depends(current_user)):
    payload = program_service.get_program(user_id or user['id'], user)
    response.headers['Cache-Control'] = 'no-store'
    return payload


@router.put('')
def save_program(body: ProgramChange, response: Response, user_id: str = Query(min_length=1, max_length=64),
                 user=Depends(current_user)):
    payload = program_service.save_program(body, user_id, user)
    response.headers['Cache-Control'] = 'no-store'
    return payload
