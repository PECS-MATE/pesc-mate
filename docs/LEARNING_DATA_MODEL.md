# 학습 기록 데이터 모델

의사소통은 사용자가 실제 의도를 전달한 기록이고, 학습은 문제 풀이 결과이므로
서로 다른 컬렉션과 API에서 관리한다. 학습 점수나 오답은 카드 추천 및
의사소통 통계에 포함하지 않는다.

## 컬렉션

- `communication_sessions`: 실제 카드 선택과 생성 문장 기록
- `learning_settings`: 사용자별 학습 카테고리, 문제 수, 보기 수, 카드 반복 빈도,
  제한 시간, 재도전 설정
- `learning_attempts`: 활동 유형, 카테고리, 문제·정답·오답 수, 문제별 카드 ID·표시명·
  첫 시도 성공 여부, 서버 계산 점수, 소요 시간 및 완료 시각
- `learning_audit_logs`: 설정 변경 대상, 변경자, 변경 전·후 값 및 변경 시각

학습 시도에는 `record_type=learning_attempt`를 저장한다. 동일한 요청 ID를 다시
전송해도 한 건만 저장하며, 보존 기간과 개인정보 다운로드·삭제는 기존 사용자
정책을 동일하게 적용한다.

최근 학습 진행은 총점보다 참여 횟수와 단어별 경험을 먼저 보여 준다. 조회 기간
안에서 두 번 이상 모두 첫 시도에 찾은 카드는 `familiar_words`, 한 번이라도
어려움이 있었던 카드는 `repeat_words`, 한 번 편안하게 찾은 카드는
`practicing_words`로 집계한다. 과거 문제별 결과가 없는 기록도 세션 참여 집계에는
포함되며 단어 집계에서만 제외한다.

## 역할별 API

| API | AAC 사용자 | `learning_manage` 연결 계정 |
|---|---:|---:|
| `GET /api/learning/settings` | 본인 조회 | 연결 사용자 조회 |
| `PUT /api/learning/settings?user_id=...` | 차단 | 설정 변경 |
| `POST /api/learning/attempts` | 본인 결과 저장 | 차단 |
| `GET /api/learning/progress` | 본인 조회 | 연결 사용자 성취 조회 |
| `GET /api/learning/audit` | 본인 조회 | 연결 사용자 설정 이력 조회 |

설정 변경과 성취 조회는 역할명만으로 허용하지 않고 활성 연결과
`learning_manage` 권한을 모두 확인한다. 최초 지원 활동은
`word_picture_match`이며, 보호자·권한 있는 담당자는 연결 사용자의 학습 범위와
문제 수, 보기 수, 반복 빈도, 권장 시간, 재도전 여부를 편집할 수 있다. 후속
활동은 별도 유형으로 추가한다.
