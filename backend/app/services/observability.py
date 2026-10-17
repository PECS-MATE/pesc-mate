"""Request correlation and error responses without logging personal content."""
import json
import logging
from time import perf_counter
from uuid import UUID, uuid4

from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from app.services.api_metrics import ApiMetrics
from app.services.offline_sync_metrics import OfflineSyncMetrics

logger = logging.getLogger('uvicorn.error')

REQUEST_ID_HEADER = 'X-Request-ID'
SERVER_ERROR_MESSAGE = '서버에서 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
ERROR_CODES = {
    401: 'unauthorized', 403: 'forbidden', 404: 'not_found',
    409: 'conflict', 422: 'validation_error', 500: 'internal_error',
    503: 'service_unavailable',
}


def request_id_for(headers):
    values = [value for name, value in headers if name.lower() == b'x-request-id']
    if len(values) == 1:
        value = values[0].decode('latin-1')
        if len(value) == 36:
            try:
                canonical = str(UUID(value))
                if canonical == value.lower():
                    return canonical
            except ValueError:
                pass
    return str(uuid4())


def error_response(scope, status_code, detail, message=None, headers=None, extra=None):
    request_id = scope['state']['request_id']
    return JSONResponse({
        **(extra or {}),
        'detail': detail,
        'error': {
            'code': ERROR_CODES.get(status_code, 'http_error'),
            'message': message or (detail if isinstance(detail, str) else '요청을 처리하지 못했습니다.'),
            'request_id': request_id,
        },
    }, status_code=status_code, headers={**(headers or {}), 'Cache-Control': 'no-store'})


class ResponseStreamError(RuntimeError):
    """Report a broken transfer without exposing the original exception message."""


class SafeErrorMiddleware:
    """Turn unexpected errors into a safe response before CORS adds its headers."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            await self.app(scope, receive, send)
            return
        response_started = False

        async def track_start(message):
            nonlocal response_started
            if message['type'] == 'http.response.start':
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, track_start)
        except Exception as exc:
            scope['state']['error_type'] = type(exc).__name__
            if response_started:
                # A binary/streaming response cannot be replaced after headers were sent.
                raise ResponseStreamError('Response stream failed') from None
            response = error_response(scope, 500, SERVER_ERROR_MESSAGE)
            await response(scope, receive, send)


class RequestContextMiddleware:
    """Add request IDs to every HTTP response, including preflights and streams."""

    def __init__(self, app, metrics):
        self.app = app
        self.metrics = metrics

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            await self.app(scope, receive, send)
            return
        request_id = request_id_for(scope.get('headers', []))
        scope.setdefault('state', {})['request_id'] = request_id
        started_at = perf_counter()
        status_code = 500

        async def add_request_id(message):
            nonlocal status_code
            if message['type'] == 'http.response.start':
                status_code = message['status']
                headers = [(name, value) for name, value in message.get('headers', [])
                           if name.lower() != b'x-request-id']
                message = {**message, 'headers': headers + [(b'x-request-id', request_id.encode('ascii'))]}
            await send(message)

        try:
            await self.app(scope, receive, add_request_id)
        finally:
            route = scope.get('route')
            method = scope.get('method', '')
            event = {
                'event': 'api_request', 'request_id': request_id,
                'method': method if method.isalpha() and len(method) <= 16 else 'UNKNOWN',
                'route': getattr(route, 'path', 'unmatched'),
                'status_code': status_code,
                'duration_ms': round((perf_counter() - started_at) * 1000, 2),
            }
            if scope['state'].get('error_type'):
                event['error_type'] = scope['state']['error_type']
            try:
                self.metrics.record(event['method'], event['route'], status_code,
                                    event['duration_ms'], failed=bool(event.get('error_type')))
            except Exception:
                # Instrumentation must not change a successful response or leak input.
                logger.warning('API metrics collection failed')
            log = (logger.error if status_code >= 500 or event.get('error_type')
                   else logger.warning if status_code >= 400 else logger.info)
            log('%s', json.dumps(event, ensure_ascii=True, separators=(',', ':')))


async def http_error_handler(request, exc):
    detail = SERVER_ERROR_MESSAGE if exc.status_code == 500 else exc.detail
    return error_response(request.scope, exc.status_code, detail, headers=exc.headers)


async def validation_error_handler(request, exc):
    # Pydantic includes raw input (including passwords) and context in its default errors.
    details = [{key: error[key] for key in ('type', 'loc', 'msg') if key in error}
               for error in exc.errors()]
    return error_response(request.scope, 422, details, '입력 내용을 확인해 주세요.')


def configure_observability(app, allowed_origins=(
        'http://localhost:5173', 'http://127.0.0.1:5173')):
    app.add_exception_handler(HTTPException, http_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    # add_middleware inserts at the front: context -> CORS -> safe errors -> routes.
    app.add_middleware(SafeErrorMiddleware)
    app.add_middleware(
        CORSMiddleware, allow_origins=allowed_origins, allow_credentials=True,
        allow_methods=['*'], allow_headers=['*'], expose_headers=[REQUEST_ID_HEADER],
    )
    app.state.api_metrics = ApiMetrics()
    app.state.offline_sync_metrics = OfflineSyncMetrics()
    app.add_middleware(RequestContextMiddleware, metrics=app.state.api_metrics)
