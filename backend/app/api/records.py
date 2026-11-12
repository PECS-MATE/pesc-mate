"""records HTTP boundary; public paths and handler names are preserved."""
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from starlette.responses import JSONResponse
from uuid import UUID
from app.services.communication import statistics
from app.services.record_exports import export_records, records_csv
from app.services.authentication import current_user, dashboard_user
from app.services.privacy import access_audit_for, delete_personal_data, export_for
from app.services.caregiver_notes import delete_note, note_history, notes_for, save_note
from app.services.communication_activity import activity_report, speech_for_sessions
from app.services.support_links import SUPPORT_ROLES, permissions_for
from app.schemas.records import CaregiverNoteRequest, CaregiverNoteResponse, DashboardResponse, PrivacyAuditResponse, PrivacyDeleteRequest
from app.schemas.settings import PrivacySettingsResponse
from app.api.dependencies import require_communicator

router = APIRouter()


@router.put('/care/notes/{session_id}', response_model=CaregiverNoteResponse, tags=['보호자'])
def put_caregiver_note(session_id: UUID, request: CaregiverNoteRequest, user=Depends(current_user)):
    if user['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '보호자 또는 담당자만 메모를 작성할 수 있습니다.')
    target = dashboard_user(user, request.user_id, 'notes_write')
    content = request.content.strip()
    if not content:
        raise HTTPException(422, '메모 내용을 입력해 주세요.')
    return save_note(user['id'], target, str(session_id), content, request.expected_revision)


@router.get('/care/notes/{session_id}/history', tags=['보호자'])
def get_note_history(session_id: UUID, user_id: str = Query(min_length=1, max_length=64),
                     user=Depends(current_user)):
    if user['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '보호자 또는 담당자만 메모 이력을 조회할 수 있습니다.')
    target = dashboard_user(user, user_id, 'notes_write')
    return note_history(user['id'], target, str(session_id))


@router.delete('/care/notes/{session_id}', status_code=204, tags=['보호자'])
def remove_caregiver_note(session_id: UUID,
                          user_id: str = Query(min_length=1, max_length=64),
                          expected_revision: int | None = Query(default=None, ge=0),
                          user=Depends(current_user)):
    if user['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '보호자 또는 담당자만 메모를 삭제할 수 있습니다.')
    target = dashboard_user(user, user_id, 'notes_write')
    delete_note(user['id'], target, str(session_id), expected_revision)
    return None


@router.get('/privacy/audit', response_model=list[PrivacyAuditResponse], tags=['개인정보'])
def get_privacy_audit(user=Depends(current_user)):
    require_communicator(user)
    return access_audit_for(user['id'])


@router.get('/privacy/export', tags=['개인정보'])
def get_privacy_export(user=Depends(current_user)):
    require_communicator(user)
    return export_for(user['id'])


@router.delete('/privacy/data', response_model=PrivacySettingsResponse, tags=['개인정보'])
def delete_privacy_data(request: PrivacyDeleteRequest, user=Depends(current_user)):
    require_communicator(user)
    return delete_personal_data(user['id'])


@router.get('/dashboard', response_model=DashboardResponse, tags=['통계'])
def dashboard(days: int | None = Query(default=None, ge=1, le=365),
              user_id: str | None = Query(default=None, max_length=64),
              user=Depends(current_user)):
    target = dashboard_user(user, user_id)
    result = statistics(target, days=days)
    speech = speech_for_sessions(target, [row['id'] for row in result['recent']])
    for row in result['recent']:
        row['speech_results'] = speech.get(row['id'], [])
    if user['role'] in SUPPORT_ROLES and 'notes_write' in permissions_for(user['id'], target):
        notes = notes_for(user['id'], target, [row['id'] for row in result['recent']], include_details=True)
        for row in result['recent']:
            details = notes.get(row['id'])
            row['caregiver_note'] = details.get('content') if details else None
            row['caregiver_note_details'] = details
    return result


@router.get('/records/export', tags=['기록'])
def download_records(domain: Literal['communication', 'learning', 'activity'],
                     format: Literal['json', 'csv'] = 'json',
                     days: int | None = Query(default=None, ge=1, le=365),
                     user_id: str | None = Query(default=None, min_length=1, max_length=64),
                     user=Depends(current_user)):
    permission = 'learning_manage' if domain == 'learning' else 'records_read'
    target = dashboard_user(user, user_id, permission)
    exported = export_records(target, domain, days)
    headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
               'Content-Disposition': f'attachment; filename="pecsmate-{domain}-{days or "all"}.{format}"'}
    if format == 'csv':
        return Response(records_csv(exported), media_type='text/csv', headers=headers)
    return JSONResponse(exported, headers=headers)


@router.get('/records/activity', tags=['기록'])
def get_communication_activity(days: int | None = Query(default=None, ge=1, le=365),
                               user_id: str | None = Query(default=None, max_length=64),
                               user=Depends(current_user)):
    target = dashboard_user(user, user_id, 'records_read')
    return JSONResponse(activity_report(target, days), headers={'Cache-Control': 'no-store'})
