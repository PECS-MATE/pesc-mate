"""learning API request and response schemas."""
from datetime import datetime
from typing import Annotated, Literal
from pydantic import BaseModel, Field, model_validator
from uuid import UUID

class LearningSettingsRequest(BaseModel):
    category_ids: list[Annotated[str, Field(min_length=1, max_length=64)]] = Field(min_length=1, max_length=20)
    question_count: int = Field(ge=5, le=30)
    option_count: int = Field(default=3, ge=2, le=4)
    repeat_frequency: int = Field(default=1, ge=1, le=3)
    time_limit_seconds: int = Field(ge=30, le=600)
    retry_enabled: bool


class LearningSettingsResponse(BaseModel):
    user_id: str
    category_ids: list[str]
    question_count: int
    option_count: int
    repeat_frequency: int
    time_limit_seconds: int
    retry_enabled: bool
    updated_at: datetime | None = None
    updated_by: str | None = None


class LearningItemResult(BaseModel):
    card_id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=30)
    first_try_correct: bool


class LearningSequenceItemResult(LearningItemResult):
    content_id: str = Field(min_length=1, max_length=64, pattern=r'^[a-z][a-z0-9-]*$')
    card_ids: list[Annotated[str, Field(min_length=1, max_length=64)]] = Field(min_length=2, max_length=3)


class LearningAttemptRequest(BaseModel):
    request_id: UUID
    activity_type: Literal['word_picture_match', 'sound_picture_match', 'sentence_card_order', 'situation_card_match']
    content_version: Literal['word-picture-v1', 'sound-picture-v1', 'sentence-order-v1', 'situation-card-v1'] | None = None
    program_set_id: UUID | None = None
    category_id: str = Field(min_length=1, max_length=64)
    total_questions: int = Field(ge=1, le=30)
    correct_answers: int = Field(ge=0, le=30)
    duration_seconds: int = Field(ge=0, le=3600)
    items: list[LearningSequenceItemResult | LearningItemResult] = Field(default_factory=list, max_length=30)

    @model_validator(mode='before')
    @classmethod
    def validate_sequence_items(cls, values):
        if isinstance(values, dict) and isinstance(values.get('items'), list):
            for item in values['items']:
                if not isinstance(item, dict):
                    continue  # The ordinary item schema reports malformed types.
                if values.get('activity_type') == 'sentence_card_order':
                    LearningSequenceItemResult.model_validate(item)
                elif 'content_id' in item or 'card_ids' in item:
                    raise ValueError('문장 순서 결과는 해당 학습 활동에서만 저장할 수 있습니다.')
        return values


class LearningAttemptResponse(BaseModel):
    program_set_id: UUID | None = None
    id: UUID
    user_id: str
    activity_type: str
    content_version: str | None = None
    category_id: str
    total_questions: int
    correct_answers: int
    incorrect_answers: int
    score: int
    duration_seconds: int
    items: list[LearningSequenceItemResult | LearningItemResult]
    completed_at: datetime


class LearningWordProgress(BaseModel):
    card_id: str
    label: str
    practice_count: int
    first_try_correct_count: int
    needs_repeat_count: int


class LearningProgressResponse(BaseModel):
    user_id: str
    period_days: int | None = None
    attempts: int
    total_questions: int
    correct_answers: int
    incorrect_answers: int
    average_score: int
    last_completed_at: datetime | None = None
    categories: dict[str, dict[str, int]]
    familiar_words: list[LearningWordProgress]
    repeat_words: list[LearningWordProgress]
    practicing_words: list[LearningWordProgress]
    recent: list[LearningAttemptResponse]


class LearningAuditResponse(BaseModel):
    id: UUID
    target_user_id: str
    actor_id: str
    action: str
    before: dict[str, object] | None = None
    after: dict[str, object] | None = None
    created_at: datetime


# Course DTOs formerly declared beside the learning program HTTP handlers.
from datetime import date
from typing import Annotated, Literal
from uuid import UUID
from pydantic import BaseModel, Field, model_validator

ACTIVITIES = Literal['word_picture_match', 'sound_picture_match', 'situation_card_match']
SITUATIONS = Literal['meal', 'school', 'outing']

class PracticeSet(BaseModel):
    id: UUID
    title: str = Field(min_length=1, max_length=40)
    activity_type: ACTIVITIES = 'word_picture_match'
    situation_id: SITUATIONS = 'meal'
    card_ids: list[Annotated[str, Field(min_length=1, max_length=64)]] = Field(min_length=2, max_length=60)
    question_count: Literal[5, 10, 15, 20, 30] = 5
    option_count: Literal[2, 3, 4] = 3

    @model_validator(mode='after')
    def unique_cards(self):
        self.title = self.title.strip()
        if not self.title:
            raise ValueError('연습 이름을 입력해 주세요.')
        if len(set(self.card_ids)) != len(self.card_ids) or len(self.card_ids) < self.option_count:
            raise ValueError('보기 수 이상의 서로 다른 카드를 선택해 주세요.')
        targets = {'meal': {'water', 'rice', 'stop', 'finished'},
                   'school': {'help', 'rest', 'want_rest', 'toilet'},
                   'outing': {'home', 'wait', 'hold_on', 'water'}}
        if self.activity_type == 'situation_card_match' and not targets[self.situation_id].intersection(self.card_ids):
            raise ValueError('선택한 상황에 맞는 카드를 하나 이상 넣어 주세요.')
        return self


class ProgramChange(BaseModel):
    expected_revision: int = Field(ge=0)
    sets: list[PracticeSet] = Field(default_factory=list, max_length=20)
    daily_set_ids: list[UUID] = Field(default_factory=list, max_length=30)
    starts_on: date
    review_interval_days: int = Field(default=3, ge=1, le=30)

    @model_validator(mode='after')
    def references(self):
        ids = {row.id for row in self.sets}
        if len(ids) != len(self.sets) or any(key not in ids for key in self.daily_set_ids):
            raise ValueError('중복 세트나 코스에 없는 세트를 확인해 주세요.')
        return self
