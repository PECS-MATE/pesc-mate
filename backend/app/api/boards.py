"""boards HTTP boundary; public paths and handler names are preserved."""
from fastapi import APIRouter, Depends, Query
from starlette.responses import JSONResponse
from app.services.authentication import current_user
from app.services.support_links import SUPPORT_ROLES, permissions_for, require_any_link_permission
from app.services.board_layout import audit_for as board_audit_for
from app.services.board_organization import suggestions_for as board_organization_suggestions
from app.services.board_layout import layout_for, save_quick_expressions, save_recovery_expressions, save_slots, save_locks, change_situations
from app.schemas.boards import BoardAuditResponse, BoardCardIdsRequest, BoardLayoutResponse, BoardLocksRequest, BoardRecoveryIdsRequest, SituationBoardRequest
from app.api.dependencies import _require_support_manager

router = APIRouter()


@router.get('/board/layout', response_model=BoardLayoutResponse,
                response_model_exclude_none=True, tags=['카드판'])
def get_board_layout(user_id: str | None = Query(default=None, max_length=64),
                     user=Depends(current_user)):
    target = user_id or user['id']
    require_any_link_permission(user, target, {'quick_speech_manage', 'board_manage'})
    return layout_for(target)


@router.put('/board/layout/quick-expressions', response_model=BoardLayoutResponse,
                response_model_exclude_none=True, tags=['카드판'])
def put_quick_expressions(request: BoardCardIdsRequest,
                          user_id: str = Query(min_length=1, max_length=64),
                          user=Depends(current_user)):
    target = _require_support_manager(user, user_id, 'quick_speech_manage')
    return save_quick_expressions(target, user['id'], request.card_ids, request.expected_revision)


@router.put('/board/layout/recovery-expressions', response_model=BoardLayoutResponse,
                response_model_exclude_none=True, tags=['카드판'])
def put_recovery_expressions(request: BoardRecoveryIdsRequest,
                             user_id: str = Query(min_length=1, max_length=64),
                             user=Depends(current_user)):
    target = _require_support_manager(user, user_id, 'quick_speech_manage')
    return save_recovery_expressions(target, user['id'], request.expression_ids, request.expected_revision)


@router.put('/board/layout/slots', response_model=BoardLayoutResponse,
                response_model_exclude_none=True, tags=['카드판'])
def put_board_slots(request: BoardCardIdsRequest,
                    user_id: str = Query(min_length=1, max_length=64),
                    user=Depends(current_user)):
    target = _require_support_manager(user, user_id, 'board_manage')
    return save_slots(target, user['id'], request.card_ids, request.expected_revision)


@router.put('/board/layout/locks', response_model=BoardLayoutResponse,
                response_model_exclude_none=True, tags=['카드판'])
def put_board_locks(request: BoardLocksRequest,
                    user_id: str = Query(min_length=1, max_length=64), user=Depends(current_user)):
    target = _require_support_manager(user, user_id, 'board_manage')
    return save_locks(target, user, request.card_ids, request.expected_revision)


@router.put('/board/layout/situations', response_model=BoardLayoutResponse,
                response_model_exclude_none=True, tags=['카드판'])
def put_situation_board(request: SituationBoardRequest,
                        user_id: str = Query(min_length=1, max_length=64), user=Depends(current_user)):
    target = _require_support_manager(user, user_id, 'board_manage')
    return change_situations(target, user, **request.model_dump())


@router.get('/board/layout/organization-suggestions', tags=['카드판'])
def get_board_organization_suggestions(user_id: str = Query(min_length=1, max_length=64),
                                      user=Depends(current_user)):
    return JSONResponse(board_organization_suggestions(user_id, user),
                        headers={'Cache-Control': 'no-store'})


@router.get('/board/layout/audit', response_model=list[BoardAuditResponse], tags=['카드판'])
def get_board_audit(user_id: str | None = Query(default=None, max_length=64),
                    user=Depends(current_user)):
    target = user_id or user['id']
    require_any_link_permission(user, target, {'quick_speech_manage', 'board_manage'})
    rows = board_audit_for(target)
    # Sharing the audit store must not grant quick-speech-only supporters recommendation policy access.
    if user['role'] in SUPPORT_ROLES and 'board_manage' not in permissions_for(user['id'], target):
        rows = [row for row in rows if row['action'] != 'recommendation_settings_changed']
    return rows
