"""operations HTTP boundary; public paths and handler names are preserved."""
from fastapi import APIRouter, Depends, Query, Request
from starlette.responses import JSONResponse
from app.services.authentication import current_user, require_account_permission
from app.services.model import status as model_status
from app.services.health import health_report
from app.services.observability import error_response
from app.services.tts_metrics import tts_report
from app.services.operational_alerts import operational_report

router = APIRouter()


@router.get("/health", tags=["health"])
def health_check(request: Request):
    payload, status_code = health_report()
    if status_code >= 400:
        return error_response(request.scope, status_code, '데이터베이스 연결을 확인해 주세요.', extra=payload)
    return JSONResponse(payload, status_code=status_code, headers={'Cache-Control': 'no-store'})


@router.get('/admin/metrics', tags=['운영'])
def get_api_metrics(request: Request, user=Depends(current_user)):
    require_account_permission(user, 'content_manage')
    return JSONResponse(request.app.state.api_metrics.snapshot(), headers={'Cache-Control': 'no-store'})


@router.get('/admin/tts-metrics', tags=['운영'])
def get_tts_metrics(hours: int = Query(default=24, ge=1, le=168), user=Depends(current_user)):
    require_account_permission(user, 'content_manage')
    return JSONResponse(tts_report(hours), headers={'Cache-Control': 'no-store'})


@router.get('/admin/offline-sync-metrics', tags=['운영'])
def get_offline_sync_metrics(request: Request, user=Depends(current_user)):
    require_account_permission(user, 'content_manage')
    return JSONResponse(request.app.state.offline_sync_metrics.snapshot(), headers={'Cache-Control': 'no-store'})


@router.get('/admin/alerts', tags=['운영'])
def get_operational_alerts(request: Request, user=Depends(current_user)):
    require_account_permission(user, 'content_manage')
    return JSONResponse(operational_report(request.app.state.api_metrics, request.app.state.offline_sync_metrics),
                        headers={'Cache-Control': 'no-store'})


@router.get('/model/status', tags=['모델'])
def get_model_status(user=Depends(current_user)):
    return model_status()
