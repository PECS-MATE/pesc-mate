"""communication HTTP boundary; public paths and handler names are preserved."""
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from uuid import UUID
from app.services.communication import regenerate_session, save_session
from app.services.authentication import current_user
from app.services.offline_events import sync_events
from app.services.server_speech import synthesize_speech
from app.services.tts_events import finish_event, start_event
from app.services.card_submissions import approved_cards_for
from app.schemas.communication import CommunicationSessionResponse, OfflineSyncRequest, OfflineSyncResponse, RegenerateSentenceRequest, SentenceRequest, ServerSpeechRequest, TtsEventRequest, TtsEventResponse, TtsEventResultRequest
from app.api.dependencies import require_communicator, require_guardian_consent

router = APIRouter()


@router.post('/offline/events/sync', response_model=OfflineSyncResponse, tags=['오프라인'])
def sync_offline_events(request: OfflineSyncRequest, http_request: Request,
                       retried: int = Header(default=0, alias='X-Pesc-Sync-Retried', ge=0, le=100),
                       user=Depends(current_user)):
    require_communicator(user)
    require_guardian_consent(user)
    if retried > len(request.events):
        raise HTTPException(422, '재시도 건수는 전송 건수보다 클 수 없습니다.')
    with http_request.app.state.offline_sync_metrics.measure('communication', len(request.events), retried) as observation:
        return sync_events(user['id'], [event.model_dump(exclude_none=True) for event in request.events], observation=observation)


@router.post('/tts/speech', tags=['음성'])
def server_speech(request: ServerSpeechRequest, _user=Depends(current_user)):
    text = request.text.strip()
    if not text:
        raise HTTPException(422, '읽을 문장을 입력해 주세요.')
    return Response(synthesize_speech(text, request.rate, account_id=_user['id'], voice=request.voice), media_type='audio/wav',
                    headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})


@router.post('/tts/events', response_model=TtsEventResponse, status_code=201, tags=['음성'])
def create_tts_event(request: TtsEventRequest, user=Depends(current_user)):
    require_communicator(user)
    require_guardian_consent(user)
    return start_event(user['id'], str(request.request_id), request.content_type, request.char_count)


@router.patch('/tts/events/{request_id}', response_model=TtsEventResponse, tags=['음성'])
def complete_tts_event(request_id: UUID, request: TtsEventResultRequest, user=Depends(current_user)):
    require_communicator(user)
    return finish_event(user['id'], str(request_id), request.status, request.error_code.strip(),
                        request.startup_ms)


@router.post('/sentences', response_model=CommunicationSessionResponse, tags=['문장'])
def generate_sentence(request: SentenceRequest, user=Depends(current_user)):
    require_communicator(user)
    require_guardian_consent(user)
    return save_session(request, user['id'], approved_cards_for(user['id']))


@router.post('/sentences/{session_id}/regenerate', response_model=CommunicationSessionResponse,
                 tags=['문장'])
def regenerate_sentence(session_id: UUID, request: RegenerateSentenceRequest,
                        user=Depends(current_user)):
    require_communicator(user)
    require_guardian_consent(user)
    return regenerate_session(session_id, request.request_id, user['id'],
                              approved_cards_for(user['id']))
