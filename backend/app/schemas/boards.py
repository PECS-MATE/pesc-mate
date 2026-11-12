"""boards API request and response schemas."""
from datetime import datetime
from typing import Annotated, Literal
from pydantic import BaseModel, Field, model_validator
from app.schemas.cards import CardResponse

class BoardSlotResponse(BaseModel):
    position: int
    card_id: str


class SituationBoardResponse(BaseModel):
    id: str
    name: str
    slots: list[BoardSlotResponse]


class BoardLayoutResponse(BaseModel):
    user_id: str
    revision: int
    quick_expression_ids: list[str]
    recovery_expression_ids: list[str]
    slots: list[BoardSlotResponse]
    locked_card_ids: list[str] = Field(default_factory=list)
    situations: list[SituationBoardResponse] = Field(default_factory=list)
    situation_names: list[str] = Field(default_factory=list)
    max_situations: int = 6
    available_cards: list[CardResponse]
    updated_at: datetime | None = None


class BoardCardIdsRequest(BaseModel):
    expected_revision: int = Field(ge=0)
    card_ids: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(min_length=1, max_length=30)


class BoardRecoveryIdsRequest(BaseModel):
    expected_revision: int = Field(ge=0)
    expression_ids: list[Annotated[str, Field(min_length=1, max_length=40)]] = Field(min_length=2, max_length=4)


class BoardLocksRequest(BaseModel):
    expected_revision: int = Field(ge=0, strict=True)
    card_ids: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(max_length=30)


class SituationBoardRequest(BaseModel):
    model_config = {'extra': 'forbid'}
    expected_revision: int = Field(ge=0, strict=True)
    operation: Literal['create', 'copy', 'update', 'delete']
    situation_id: str | None = Field(default=None, min_length=1, max_length=64)
    source_id: str = Field(default='default', min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=30)
    card_ids: list[Annotated[str, Field(min_length=1, max_length=100)]] | None = Field(default=None, min_length=1, max_length=30)

    @model_validator(mode='after')
    def check_operation_fields(self):
        if self.operation in {'update', 'delete'} and not self.situation_id:
            raise ValueError('상황 카드판 ID가 필요합니다.')
        if self.operation != 'delete' and (not self.name or not self.name.strip()):
            raise ValueError('상황 이름이 필요합니다.')
        if self.operation == 'update' and self.card_ids is None:
            raise ValueError('상황 슬롯이 필요합니다.')
        if self.operation not in {'create', 'update'} and self.card_ids is not None:
            raise ValueError('카드 지정은 새 상황 만들기 또는 상황 편집에서만 허용합니다.')
        if self.operation in {'create', 'copy'} and self.situation_id is not None:
            raise ValueError('새 상황의 ID는 서버가 정합니다.')
        if self.operation == 'copy' and self.source_id == 'default':
            raise ValueError('복사할 상황을 선택해 주세요.')
        if self.operation != 'copy' and self.source_id != 'default':
            raise ValueError('복사 외 작업에는 원본 상황을 지정할 수 없습니다.')
        if self.operation == 'delete' and self.name is not None:
            raise ValueError('상황 삭제에 이름 변경을 함께 보낼 수 없습니다.')
        return self


class BoardAuditResponse(BaseModel):
    id: str
    target_user_id: str
    actor_id: str
    action: str
    before: list[object] | dict[str, object] | None = None
    after: list[object] | dict[str, object] | None = None
    before_revision: int | None = None
    after_revision: int | None = None
    created_at: datetime
