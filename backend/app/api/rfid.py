"""RFID routes reuse account sessions; hardware keys never grant account access."""
import os
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.authentication import current_user
from app.services.support_links import require_link_permission, permissions_for, SUPPORT_ROLES
from app.services import rfid

router = APIRouter(prefix='/rfid', tags=['RFID'])
DeviceId = Annotated[str, Field(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9][A-Za-z0-9_-]*$')]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class DeviceCreate(StrictModel):
    device_id: DeviceId
    name: str = Field(min_length=1, max_length=40)

    @field_validator('name')
    @classmethod
    def trim_name(cls, value):
        if not value.strip() or any(ord(char) < 32 for char in value):
            raise ValueError('장치 이름이 올바르지 않습니다.')
        return value.strip()


class DeviceChange(StrictModel):
    expected_revision: int = Field(ge=0)
    operation: Literal['configure', 'rotate_key', 'revoke']
    name: str | None = Field(default=None, min_length=1, max_length=40)
    reader_labels: list[Annotated[str, Field(min_length=1, max_length=30)]] | None = Field(default=None, min_length=3, max_length=3)

    @model_validator(mode='after')
    def configuration(self):
        if self.operation == 'configure':
            if not self.name or not self.reader_labels or any(not item.strip() for item in [self.name, *self.reader_labels]):
                raise ValueError('이름과 리더기 위치 세 개가 필요합니다.')
        elif self.name is not None or self.reader_labels is not None:
            raise ValueError('이 작업에는 위치 구성을 포함할 수 없습니다.')
        return self


class Reading(StrictModel):
    reader_id: int = Field(ge=1, le=3, strict=True)
    status: Literal['PRESENT', 'EMPTY', 'ERROR']
    uid: str | None = Field(default=None, max_length=64)

    @model_validator(mode='after')
    def validate_reading(self):
        if self.status == 'PRESENT':
            if not self.uid:
                raise ValueError('인식한 카드 UID가 필요합니다.')
            self.uid = rfid.normalize_uid(self.uid)
        elif self.uid is not None:
            raise ValueError('빈 위치와 오류 상태에는 UID를 보내지 않습니다.')
        return self


class Snapshot(StrictModel):
    protocol_version: Literal[1]
    session_id: UUID
    event_id: int = Field(ge=1, le=2147483647, strict=True)
    readers: list[Reading] = Field(min_length=3, max_length=3)

    @model_validator(mode='after')
    def all_readers(self):
        if {row.reader_id for row in self.readers} != {1, 2, 3}:
            raise ValueError('리더기 1·2·3의 전체 상태가 필요합니다.')
        uids = [row.uid for row in self.readers if row.uid]
        if len(set(uids)) != len(uids):
            raise ValueError('같은 UID가 여러 위치에서 감지되었습니다. 리더기 간섭과 태그를 확인해 주세요.')
        return self


class Binding(StrictModel):
    uid: str = Field(min_length=1, max_length=64)
    card_id: str | None = Field(default=None, min_length=1, max_length=80)
    expected_revision: int | None = Field(default=None, ge=1)

    @field_validator('uid')
    @classmethod
    def canonical_uid(cls, value):
        return rfid.normalize_uid(value)


def target(user, user_id, permission, writing=False):
    identity = user_id or user['id']
    if writing and user['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '보호자 또는 담당자만 RFID 구성을 변경할 수 있습니다.')
    return require_link_permission(user, identity, permission)


def device_transport(request):
    if request.url.scheme != 'https' and os.environ.get('RFID_ALLOW_INSECURE_LAN', '').lower() != 'true':
        raise HTTPException(403, '장치 수신은 HTTPS가 필요합니다. 사설망 개발 설정을 명시적으로 확인해 주세요.')


@router.get('/devices')
def devices(user_id: str | None = Query(default=None, max_length=64), user=Depends(current_user)):
    return rfid.list_devices(target(user, user_id, 'board_manage'))


@router.post('/devices', status_code=201)
def register_device(body: DeviceCreate, user_id: str = Query(max_length=64), user=Depends(current_user)):
    return rfid.create_device(target(user, user_id, 'board_manage', True), user['id'], body.device_id, body.name)


@router.put('/devices/{device_id}')
def update_device(device_id: DeviceId, body: DeviceChange, user_id: str = Query(max_length=64), user=Depends(current_user)):
    return rfid.change_device(target(user, user_id, 'board_manage', True), user['id'], device_id,
        body.expected_revision, body.operation, body.name, body.reader_labels)


@router.get('/devices/{device_id}/state')
def state(device_id: DeviceId, user_id: str | None = Query(default=None, max_length=64), user=Depends(current_user)):
    identity = target(user, user_id, 'board_manage')
    show_uids = user['role'] in SUPPORT_ROLES and 'cards_manage' in permissions_for(user['id'], identity)
    return rfid.board_state(identity, device_id, show_uids)


@router.get('/bindings')
def bindings(user_id: str = Query(max_length=64), user=Depends(current_user)):
    if user['role'] not in SUPPORT_ROLES:
        raise HTTPException(403, '보호자 또는 담당자만 UID 연결을 조회할 수 있습니다.')
    return rfid.list_bindings(target(user, user_id, 'cards_manage'))


@router.put('/bindings')
def bind(body: Binding, user_id: str = Query(max_length=64), user=Depends(current_user)):
    return rfid.save_binding(target(user, user_id, 'cards_manage', True), user['id'],
                             body.uid, body.card_id, body.expected_revision)


@router.get('/cards')
def mapping_cards(user_id: str = Query(max_length=64), user=Depends(current_user)):
    return [{'id': card['id'], 'label': card['label']} for card in
            rfid.available_cards(target(user, user_id, 'cards_manage')).values()]


@router.post('/devices/{device_id}/session', status_code=201)
def session(device_id: DeviceId, request: Request, response: Response,
            key: str = Header(alias='X-Device-Key', min_length=32, max_length=128)):
    device_transport(request)
    result = rfid.start_session(device_id, key)
    response.headers['X-RFID-Session'] = result['session_id']
    response.headers['Cache-Control'] = 'no-store'
    return result


@router.post('/devices/{device_id}/snapshot')
def snapshot(device_id: DeviceId, body: Snapshot, request: Request,
             key: str = Header(alias='X-Device-Key', min_length=32, max_length=128)):
    device_transport(request)
    return rfid.ingest(device_id, key, body.model_dump(mode='json'))
