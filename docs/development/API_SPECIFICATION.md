---
title: "PESC MATE API 명세서"
date: "2026년 9월 9일"
lang: ko-KR
---

# 1. 개요

| 항목 | 내용 |
|---|---|
| API 이름 | PESC MATE API |
| 버전 | 0.1.0 |
| 개발 기본 URL | `http://127.0.0.1:8000` |
| API 기본 경로 | `/api` |
| 데이터 형식 | JSON |
| 문자 인코딩 | UTF-8 |
| 인증 방식 | Bearer 세션 토큰 |
| API 자동 문서 | `/docs` |
| OpenAPI JSON | `/openapi.json` |

본 명세서는 현재 구현된 API를 기준으로 한다. Ollama의 `qwen2.5:0.5b`로 문장을 생성하며, 모델 장애나 제한 시간 초과 시 서버 규칙 문장으로 자동 전환한다.

# 2. 공통 규칙

## 2.1 요청 헤더

JSON 본문을 전송하는 요청은 다음 헤더를 사용한다.

```http
Content-Type: application/json
```

인증이 필요한 API는 로그인 응답으로 받은 토큰을 전송한다.

```http
Authorization: Bearer {access_token}
```

토큰은 로그인 시 생성되며 기본 12시간 동안 유효하다. 로그아웃하면 해당 토큰이 즉시 삭제된다.
담당자 운영 권한이 변경되면 계정·세션 권한 버전을 비교해 기존 세션을 다음 요청부터 401로
차단한다. 운영 권한 관리 API와 책임자 설정은 [운영 권한 관리](../operations/ACCOUNT_PERMISSION_MANAGEMENT.md)를 따른다.
담당자 계정의 `account_active`가 false이거나 `access_expires_at`에 도달하면 로그인과 모든
다음 인증 요청을 거절한다. 신규 세션 유효 기간도 접근 만료 시각을 넘지 않는다. 누락된 접근
설정은 기존 호환용 활성·기한 없음이다. 접근 변경도 같은 권한 버전을 증가시키므로 재활성화나
만료 연장/해제로 과거 토큰이 되살아나지 않는다. 이 설정은 아동별 지원 연결을 삭제하지 않는다.

`PUT /api/admin/accounts/{id}/access`는 책임자 재인증 후 담당자 계정의 접근을 변경한다.
본문은 `account_active`(boolean), `access_expires_at`(시간대 포함 미래 시각 또는 명시적인 null),
`expected_revision`(0 이상 정수), `password`, `reason`이다. 관리 책임자로 지정된 대상은
비활성화·만료 설정을 거절한다. 상태/버전 충돌은 409, 잘못된 입력은 422이며 정상·오류 응답은
`no-store`다. `lookup` 응답에는 현재 활성·만료와 `access_protected`도 포함된다.

### 요청 추적 ID

클라이언트는 `X-Request-ID`에 UUID를 보낼 수 있다. 정규 UUID 형식의 헤더가 하나만
있으면 서버는 소문자로 정규화해 사용하고, 누락·잘못된 형식·중복 헤더는 새 UUID로
대체한다. 모든 HTTP 응답은 `X-Request-ID`를 반환하며 허용된 CORS 출처에서도
브라우저가 읽을 수 있다. 프런트엔드는 API·이미지·기기 접근 요청마다 새 ID를 보낸다.

이 헤더는 요청 추적용이다. 문장 생성·학습·TTS 기록 본문의 `request_id`는 중복
저장 방지용으로 그대로 유지하므로, 같은 작업을 재전송해도 헤더 ID는 달라질 수 있다.

## 2.2 날짜와 시간

날짜와 시간은 ISO 8601 문자열로 반환한다. 서버 저장 기준은 UTC이며 `Z` 또는 `+00:00` 시간대가 포함될 수 있다.

```text
2026-09-09T01:30:00.000000+00:00
```

## 2.3 공통 오류 응답

```json
{
  "detail": "오류 설명",
  "error": {
    "code": "forbidden",
    "message": "오류 설명",
    "request_id": "36b34017-f740-4a87-a21b-89d815178120"
  }
}
```

기존 `detail`은 유지하고 `error`를 추가한다. 오류 응답은 `Cache-Control: no-store`를
사용하며 `error.request_id`는 응답 헤더와 동일하다. 클라이언트 오류 객체의
`requestId`, `status`, `code` 속성으로 요청을 추적할 수 있다.

입력 검증 오류의 `detail`은 `type`, `loc`, `msg` 목록이다. 입력 원문과 `ctx`는
제외하고 `error.message`에 입력 확인 안내를 제공한다. 예상하지 못한 오류와
HTTP 500은 일반 안내만 반환하고 내부 예외 문구를 응답에 포함하지 않는다.

| 상태 | `error.code` |
|---|---|
| 401 | `unauthorized` |
| 403 | `forbidden` |
| 404 | `not_found` |
| 409 | `conflict` |
| 422 | `validation_error` |
| 500 | `internal_error` |
| 503 | `service_unavailable` |
| 그 밖의 HTTP 오류 | `http_error` |

이미 시작한 바이너리·스트리밍 응답의 오류는 JSON 응답으로 교체할 수 없어 전송을
중단하고 일반 예외만 전달한다. CORS preflight 응답 형식은 기존 규약을 유지하며
요청 ID 헤더를 추가한다.

| HTTP 상태 | 의미 |
|---|---|
| 401 Unauthorized | 토큰이 없거나 유효하지 않음, 로그인 실패 또는 세션 만료 |
| 403 Forbidden | 계정 역할에 허용되지 않은 기능 또는 연결되지 않은 사용자 기록 접근 |
| 404 Not Found | 보호자 계정에 연결된 사용자가 없음 |
| 409 Conflict | 같은 요청 ID가 다른 카드 조합에 사용됨 |
| 422 Unprocessable Entity | 요청 형식, 길이, UUID 또는 조회 기간이 유효하지 않음 |
| 502 Bad Gateway | 현재 미사용. 향후 외부 AI 응답 오류에 사용 가능 |
| 503 Service Unavailable | MongoDB 연결 또는 저장 실패 |

# 3. API 목록

| 구분 | 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|---|
| 시스템 | GET | `/` | 불필요 | API 기본 응답 |
| 시스템 | GET | `/api/health` | 불필요 | 서버와 필수·선택형 의존성 상태 확인 |
| 운영 | GET | `/api/admin/metrics` | `content_manage` 권한 담당자 | 프로세스별 최근 15개 1분 버킷의 API 오류율·처리 시간 조회 |
| 운영 | GET | `/api/admin/tts-metrics` | `content_manage` 권한 담당자 | 저장된 클라이언트 보고의 TTS 시작 지연·최종 재생 실패율 집계 |
| 운영 | GET | `/api/admin/offline-sync-metrics` | `content_manage` 권한 담당자 | 프로세스별 오프라인 동기화 신규·중복·실패·미처리·재시도 집계 |
| 운영 | GET | `/api/admin/alerts` | `content_manage` 권한 담당자 | 공용 카드 검수 대기와 API·음성·동기화 반복 실패 알림 |
| 모델 | GET | `/api/model/status` | 필요 | Ollama 사용 설정과 모델 이름 조회 |
| 인증 | POST | `/api/auth/login` | 불필요 | 로그인 및 세션 생성 |
| 인증 | POST | `/api/auth/register` | 불필요 | 일반 사용자 가입 및 로그인 |
| 인증 | GET | `/api/auth/me` | 필요 | 현재 사용자 조회 |
| 인증 | POST | `/api/auth/logout` | 필요 | 전달된 토큰의 세션 삭제 |
| 음성 | GET | `/api/tts/settings` | 필요 | 현재 사용자의 TTS 설정 조회 |
| 음성 | PUT | `/api/tts/settings` | 필요 | 현재 사용자의 TTS 설정 저장 |
| 음성 | POST | `/api/tts/events` | 필요 | TTS 재생 요청 이력 생성 |
| 음성 | PATCH | `/api/tts/events/{request_id}` | 필요 | TTS 성공·실패·중지 결과 저장 |
| 접근성 | GET | `/api/accessibility/settings` | 필요 | 현재 사용자의 접근 설정 조회 |
| 접근성 | PUT | `/api/accessibility/settings` | 필요 | 현재 사용자의 접근 설정 저장 |
| 개인정보 | GET/PUT | `/api/privacy/settings` | 사용자 | 동의·보존 기간 및 삭제 상태 조회·저장 |
| 개인정보 | GET | `/api/privacy/audit` | 사용자 | 연결·해제·삭제 변경 이력 조회 |
| 개인정보 | GET | `/api/privacy/export` | 사용자 | 본인 데이터 JSON 내보내기 |
| 개인정보 | DELETE | `/api/privacy/data` | 사용자 | 사용자 생성 데이터 삭제 |
| 오프라인 | POST | `/api/offline/events/sync` | 사용자 | 오프라인 최소 발화 이력 동기화 |
| 보호자 | GET | `/api/care/linked-users` | 필요 | 보호자에게 연결된 사용자 조회 |
| 보호자 | PUT | `/api/care/notes/{session_id}` | 필요 | 의사소통 기록의 보호자 메모 저장·수정 |
| 보호자 | DELETE | `/api/care/notes/{session_id}` | 필요 | 보호자 메모 삭제 |
| 카드 | GET | `/api/cards` | 필요 | 전체 카드 조회 |
| 카드 | GET | `/api/categories` | 필요 | 활성 카드 카테고리 조회 |
| 카드 | GET | `/api/cards/submissions` | 본인 또는 `cards_manage` | 본인·연결 사용자의 카드 등록 요청 조회 |
| 카드 | POST | `/api/cards/submissions` | 본인 또는 `cards_manage` | 본인·연결 사용자의 카드 요청 저장 |
| 카드 | POST | `/api/cards/submissions/{id}/submit` | 본인 또는 `cards_manage` | 임시 저장 카드를 승인 대기로 제출 |
| 카드 | PATCH | `/api/cards/submissions/{id}` | 본인 또는 `cards_manage` | 작성 중·반려 카드 정보 수정 |
| 카드 | GET | `/api/cards/submissions/{id}/image` | 필요 | 권한이 있는 카드 이미지 조회 |
| 카드판 | GET | `/api/board/layout` | 본인 또는 연결 권한 | 고정 카드·빠른 표현·복구 표현 구성 조회 |
| 카드판 | PUT | `/api/board/layout/recovery-expressions` | `quick_speech_manage` | 사용자별 복구 표현 2~4개와 고정 순서 저장 |
| 카드판 | PUT | `/api/board/layout/quick-expressions` | `quick_speech_manage` | 빠른 표현 카드와 고정 순서 저장 |
| 카드판 | PUT | `/api/board/layout/slots` | `board_manage` | 카드판 슬롯과 고정 순서 저장 |
| 카드판 | GET | `/api/board/layout/audit` | 본인 또는 연결 권한 | 카드판 구성 변경 이력 조회 |
| 학습 | GET | `/api/learning/settings` | 본인 또는 `learning_manage` | 단어·그림 맞추기 범위·문제 수·보기 수·반복 빈도·권장 시간·재도전 설정 조회 |
| 학습 | PUT | `/api/learning/settings` | `learning_manage` | 연결 사용자의 학습 범위와 난이도 설정 저장 |
| 학습 | POST | `/api/learning/attempts` | 사용자 | 완료한 학습 세션과 문제별 첫 시도 결과를 의사소통 기록과 분리하여 저장 |
| 학습 | GET | `/api/learning/progress` | 본인 또는 `learning_manage` | 기간별 참여 횟수와 익숙한 단어·반복할 단어 조회 |
| 학습 | GET | `/api/learning/audit` | 본인 또는 `learning_manage` | 학습 설정 변경 이력 조회 |
| 운영 | GET | `/api/admin/card-submissions` | `content_manage` 권한 담당자 | 전체 카드 요청 조회 |
| 운영 | PATCH | `/api/admin/card-submissions/{id}` | `content_manage` 권한 담당자 | 카드 승인 또는 반려 |
| 운영 | GET | `/api/admin/categories` | `content_manage` 권한 담당자 | 전체 카테고리 조회 |
| 운영 | POST | `/api/admin/categories` | `content_manage` 권한 담당자 | 카테고리 추가 |
| 운영 | PATCH | `/api/admin/categories/{id}` | `content_manage` 권한 담당자 | 카테고리 수정 및 활성 상태 변경 |
| 문장 | POST | `/api/sentences` | 필요 | 문장 생성 및 기록 저장 |
| 문장 | POST | `/api/sentences/{session_id}/regenerate` | 필요 | 기존 카드로 문장 재생성 및 별도 저장 |
| 추천 | GET | `/api/recommendations` | 필요 | 사용자별 추천 카드 조회 |
| 추천 | POST | `/api/recommendations/feed` | AAC 사용자 | 선택 맥락별 후보·근거·버전 스냅샷 |
| 추천 | POST | `/api/recommendations/batches/{batch_id}/exposures` | AAC 사용자·동의 | 실제 보인 후보 기록 |
| 추천 | POST | `/api/recommendations/batches/{batch_id}/selections` | AAC 사용자·동의 | 실제 표시 후 선택 기록 |
| 추천 | GET / PUT | `/api/recommendations/settings?user_id={id}` | 자기 조회 / 연결 `board_manage` | 추천 정책 조회·비교 저장 |
| 추천 | GET | `/api/recommendations/monitoring?user_id={id}` | 본인 또는 `records_read` | 카테고리·카드별 노출/선택 표본 점검 |
| 통계 | GET | `/api/dashboard` | 필요 | 본인 또는 연결 사용자 이용 통계 조회 |
| 기록 | GET | `/api/records/export` | 본인 또는 영역별 연결 권한 | 의사소통·학습 기록을 기간별 CSV/JSON으로 다운로드 |
| 기록 | GET | `/api/records/activity` | 본인 또는 `records_read` | 카드 선택·기기 재생·상황별 추이·복구 표현 인접 흐름 |
| 메모 | GET | `/api/care/notes/{session_id}/history` | `notes_write` | 작성자 자신의 메모 수정·삭제 이력 |

카드판 조회·저장 응답은 `revision`을 포함한다. 세 PUT API는 `expected_revision`을 필수로
받으며 현재 버전과 다르거나 동시 저장에 뒤진 요청에는 `409`를 반환한다. 버전 누락·음수는
`422`다. 신규·버전 없는 기존 문서의 조회 버전은 0이며 성공 저장마다 1 증가한다.
예: 슬롯 저장 본문은 `{"card_ids":["help","water"],"expected_revision":0}`이다.
감사 이력에는 `before_revision`·`after_revision`이 추가되며 과거 이력은 null일 수 있다.
UI 동작과 배포 호환 조건은 [카드판 동시 수정 정책](../policies/BOARD_CONFLICT_POLICY.md)을 따른다.

`GET /api/admin/metrics`는 `scope`, `reset_on_restart`, `window_seconds`, `bucket_seconds`,
`uptime_seconds`, `totals`, `routes`를 반환한다. `totals`와 `routes[]`에는 요청·4xx·5xx·
전송 오류 수와 오류율, `duration_ms`의 평균·최댓값·백분위 버킷 상한·누적 분포가 있다.
전체 요청 URL이나 본문·토큰은 포함하지 않는다. 응답은 `Cache-Control: no-store`이며
401·403은 기존 인증·운영 권한 규칙을 따른다. 재시작 시 초기화되고 여러 worker 간에는
공유하지 않는다. 수치 정의와 표본·집계 한계는 [API 지표](API_METRICS.md)를 따른다.

`GET /api/admin/tts-metrics?hours=24`는 `hours=1~168` 범위의 기존 TTS 이력을 요청 시각
기준으로 집계한다. `totals`, `by_content_type`, `failure_codes`를 반환하며 사용자·요청 ID와
원문은 포함하지 않는다. 실패율의 분모는 성공+실패 완료 수이며 취소·결과 미수신은 제외한다.
지연 표본이 없는 경우 평균은 null이고, 성공·실패 완료가 없으면 비율도 null이다.
`scope=stored_events`, `source=client_reported`이며 캐시를 금지한다. 입력 오류 422,
인증·권한 오류 401·403, 집계 실패 503을 반환한다. 자세한 정의는 [TTS 지표](TTS_METRICS.md)를 따른다.

TTS 시작 POST를 같은 요청 ID로 다시 보내면 실제 저장된 상태를 반환한다. 완료 PATCH를
재전송하거나 동시에 보내면 최초 완료 결과를 반환하고 상태·지연을 덮어쓰지 않는다.
다른 계정의 요청 ID로 시작하면 409, 완료하려 하면 404다. 실제 새 재생에는 새 UUID를 사용한다.

`GET /api/admin/offline-sync-metrics`는 최근 15개 1분 버킷의 발화·학습 동기화 결과를
`totals`, `by_kind`로 반환한다. 사용자·요청·카드 ID는 포함하지 않고 캐시를 금지한다.
재시도는 기기 표시 헤더, 신규·중복은 실제 DB 처리 결과로 집계한다. 서버에 도착하지
않은 통신·기기 저장 실패는 포함하지 않는다. 재시작 시 초기화되는 프로세스별 지표이며
정확한 분모와 한계는 [오프라인 동기화 지표](OFFLINE_SYNC_METRICS.md)를 따른다.

`GET /api/admin/alerts`는 `generated_at`, `status`, `thresholds`, `sources`, `alerts`를
반환한다. 공개 승인 대기 1건 이상, 대기 24시간 이상, API·TTS·동기화 최종 실패
각 3회 이상을 초기 기준으로 사용한다. API·동기화는 프로세스별 최근 최대 15분,
TTS는 최근 1시간 요청 기준이다. 개별 출처 조회 불가 시 200·`status=partial`과
확인 불가 알림을 반환하고 다른 출처의 알림을 유지한다. 사용자·요청·카드 ID와
원문은 포함하지 않으며 캐시를 금지한다. 401·403은 기존 권한 규칙을 따른다.
화면 갱신·해소·외부 통보와의 구분은 [운영 알림](OPERATIONAL_ALERTS.md)에 기록한다.

# 4. 데이터 모델

MongoDB 신규 문서의 내부 `schema_version=1`은 저장 형식 기준선이다. 일반 API의
새 필수 요청·응답 필드가 아니며 보드 `revision`과 구분한다. 원본 문서 기반의
개인정보 내보내기 항목에는 포함될 수 있다. 누락된 기존 값의 명시적 변환과 실행
규칙은 [데이터 버전·마이그레이션](DATA_SCHEMA_MIGRATIONS.md)을 따른다.

## 4.1 User

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | string | 예 | 사용자 식별자 |
| `username` | string | 예 | 로그인 아이디 |
| `name` | string | 예 | 화면 표시 이름 |
| `role` | string | 예 | 사용자 역할. `user`, `caregiver`, `support_staff` 중 하나 |
| `account_permissions` | string[] | 예 | 담당자 계정 전체에 적용되는 운영 권한. 공용 콘텐츠 운영은 `content_manage` |
| `session_expires_at` | datetime 또는 null | 아니요 | 현재 사용자 조회 시 오프라인 저장본에도 적용할 세션 만료 시각 |

```json
{
  "id": "demo",
  "username": "demo",
  "name": "데모 사용자",
  "role": "user"
}
```

## 4.2 Card

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | string | 예 | 카드 식별자 |
| `label` | string | 예 | 한글 카드 이름 |
| `symbol` | string | 예 | 카드 그림 기호 |
| `category` | string | 예 | 활성 카테고리의 표시 이름 |
| `image_index` | integer | 예 | 카드 이미지 스프라이트 위치 인덱스(0~17) |
| `meaning` | string | 예 | 문장 생성에 사용하는 카드의 정규화된 의미 |
| `part_of_speech` | string | 예 | `noun`, `pronoun`, `verb`, `adjective`, `interjection` 등 품사 |
| `has_batchim` | boolean | 예 | 카드명의 마지막 한글 음절 받침 여부 |
| `sentence_role` | string | 예 | `subject`, `object`, `destination`, `predicate`, `response` 등 문장 역할 |
| `semantic_group` | string 또는 null | 아니요 | `emotion`, `physical_state`, `sensory_state`, `rejection`, `affirmation` 등 의미 분류 |
| `safety_relevant` | boolean | 아니요 | 보호자가 최근 사용을 확인할 안전 관련 표현 여부 |
| `count` | integer | 아니요 | 통계 응답의 사용자 사용 횟수 |
| `reason` | string | 아니요 | 추천 응답에 표시할 추천 근거 |

```json
{
  "id": "water",
  "label": "물",
  "symbol": "💧",
  "category": "음식",
  "image_index": 2,
  "meaning": "마시는 물",
  "part_of_speech": "noun",
  "has_batchim": true,
  "sentence_role": "object",
  "count": 3
}
```

## 4.3 Category

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | string | 예 | 영문 카테고리 식별자 |
| `name` | string | 예 | 화면에 표시할 카테고리 이름 |
| `display_order` | integer | 예 | 카테고리 표시 순서 |
| `active` | boolean | 예 | 사용자 화면 노출 여부 |

기본 카테고리는 사람, 음식, 행동, 장소, 감정, 가구, 생활용품, 학습, 사용자 카드 순서다.

## 4.4 CommunicationSession

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUID string | 예 | 요청 및 의사소통 기록 식별자 |
| `user_id` | string | 예 | 기록 소유 사용자 ID |
| `cards` | string array | 예 | 선택 순서가 보존된 카드 ID 목록 |
| `sentence` | string | 예 | 생성된 한국어 문장 |
| `generation_source` | string | 아니요 | `ollama` 또는 `rule` |
| `regeneration_of` | UUID string | 아니요 | 재생성 계열의 최초 문장 ID |
| `generation_attempt` | integer | 예 | 최초 생성은 1, 이후 재생성 차수 |
| `generation` | object | 아니요 | 모델·정책 버전, 의미·안전 검사와 폴백 처리 결과 |
| `caregiver_note` | string 또는 null | 아니요 | 보호자 대시보드 조회 시 현재 보호자가 작성한 메모 |
| `created_at` | ISO 8601 string | 예 | 생성 시각 |

```json
{
  "id": "56d46f5e-824e-48cc-968f-9ed97dfcddab",
  "user_id": "demo",
  "cards": ["me", "water", "drink"],
  "sentence": "저는 물을 마시고 싶어요.",
  "generation_source": "ollama",
  "generation": {
    "source": "ollama",
    "initial_source": "ollama",
    "model": "qwen2.5:0.5b",
    "versions": {
      "persona": "aac-ko-v1",
      "output_rules": "sentence-output-v2",
      "rule_engine": "ko-particle-v2",
      "safety": "sentence-safety-v1"
    },
    "validation": {
      "semantics": {"passed": true, "missing_card_ids": []},
      "initial_safety": {"passed": true, "flags": []},
      "final_safety": {"passed": true, "flags": []}
    },
    "fallback": {"applied": false, "reasons": []}
  },
  "created_at": "2026-09-09T01:30:00.000000+00:00"
}
```

# 5. 시스템 API

## 5.1 API 기본 응답

```http
GET /
```

인증은 필요하지 않다.

### 성공 응답: 200 OK

```json
{
  "message": "PESC MATE API"
}
```

## 5.2 상태 확인

```http
GET /api/health
```

인증 없이 서버, MongoDB, 선택형 Ollama와 기기 TTS의 검사 범위를 확인한다.
MongoDB는 실제 `ping`, Ollama는 `/api/tags`에서 설정된 모델의 존재를 검사한다.
모델 존재 확인은 실제 생성 성공을 보장하지 않는다. 기기 TTS는 서버에서 검사할 수
없어 `client_side/device_check_required`로 표시한다.

| HTTP 상태 | `status` | 의미 |
|---|---|---|
| 200 | `ok` | MongoDB 준비 완료, Ollama 정상 또는 비활성 |
| 200 | `degraded` | MongoDB 준비 완료, 선택형 Ollama 장애·모델 미설치. 규칙 기반 문장 생성 유지 |
| 503 | `unavailable` | 필수 MongoDB 연결 실패. 선택형 AI 상태와 구분 |

MongoDB 검사에는 2초 작업 제한을 적용한다. Ollama 연결·소켓 대기 시간은 2초,
응답 본문은 최대 65,536바이트로 제한한다. 소켓 대기 제한은 전체 요청의 절대 시간
제한과 다르다. 검사는 동기 작업용 스레드에서 실행하며 API 이벤트 루프를 막지 않는다.
Docker의 백엔드 헬스체크 제한은 순차 검사를 고려해 5초다. 응답은 캐시하지 않으며
서버 주소·자격 증명·예외 원문을 반환하지 않는다.

### 성공 응답: 200 OK

```json
{
  "status": "ok",
  "checks": {
    "service": { "status": "ok", "required": true },
    "mongodb": { "status": "ok", "required": true, "detail": "ready" },
    "ollama": {
      "status": "disabled", "required": false,
      "detail": "disabled", "fallback": "rule"
    },
    "tts": {
      "status": "client_side", "required": false,
      "detail": "device_check_required"
    }
  }
}
```

Ollama가 활성화돼 정상일 때는 `status: ok`, `detail: ready`를 반환한다.
장애 시 `status: unavailable`이며 `detail`은 `unreachable`, `model_missing`,
`invalid_response` 중 하나다. MongoDB 장애 응답에도 `checks`를 유지하고
`detail`과 `error.code: service_unavailable`, `error.request_id`를 추가한다.

## 5.3 문장 생성 모델 상태

```http
GET /api/model/status
Authorization: Bearer {access_token}
```

```json
{
  "enabled": true,
  "model": "qwen2.5:0.5b",
  "policy_versions": {
    "persona": "aac-ko-v1",
    "output_rules": "sentence-output-v2",
    "rule_engine": "ko-particle-v2",
    "safety": "sentence-safety-v1"
  }
}
```

현재 Ollama 사용 여부와 모델 이름, 문장 생성에 적용되는 정책 버전을 반환한다.

# 6. 인증 API

## 6.1 로그인

```http
POST /api/auth/login
```

아이디와 비밀번호를 검증하고 불투명 세션 토큰을 생성한다. 기본 데모 계정은 실행 환경 변수로 구성된다.

### 요청 본문

| 필드 | 형식 | 제약 | 설명 |
|---|---|---|---|
| `username` | string | 1~64자 | 로그인 아이디. 앞뒤 공백은 제거됨 |
| `password` | string | 1~128자 | 로그인 비밀번호 |

```json
{
  "username": "demo",
  "password": "demo1234"
}
```

### 성공 응답: 200 OK

| 필드 | 형식 | 설명 |
|---|---|---|
| `access_token` | string | 이후 요청에 사용할 Bearer 토큰 |
| `token_type` | string | `bearer` |
| `expires_at` | ISO 8601 string | 세션 만료 시각 |
| `user` | User | 로그인 사용자 |

```json
{
  "access_token": "발급된-세션-토큰",
  "token_type": "bearer",
  "expires_at": "2026-09-09T13:30:00.000000+00:00",
  "user": {
    "id": "demo",
    "username": "demo",
    "name": "데모 사용자",
    "role": "user"
  }
}
```

### 오류 응답

- `401`: 아이디 또는 비밀번호가 올바르지 않음
- `422`: 아이디·비밀번호 누락 또는 길이 위반
- `503`: 로그인 저장소 연결 실패

## 6.2 사용자 가입

```http
POST /api/auth/register
Content-Type: application/json
```

영문, 숫자, `_`, `-`로 구성된 4~32자 아이디와 8자 이상 비밀번호,
1~30자 이름으로 일반 사용자 계정을 만든다. `guardian_consent`는 법정대리인의
개인정보 수집·이용 및 기본 1년 보존 동의를 확인한 `true`여야 한다. 성공하면
로그인과 같은 세션 정보를 반환하고 동의 정책 버전과 시각을 저장한다.

### 성공 응답: 201 Created

응답 형식은 `LoginResponse`이다.

### 오류 응답

- `409`: 이미 사용 중인 아이디
- `422`: 입력 형식 또는 길이가 올바르지 않음
- `503`: MongoDB 연결 실패

## 6.3 현재 사용자 조회

```http
GET /api/auth/me
Authorization: Bearer {access_token}
```

### 성공 응답: 200 OK

응답 형식은 `User`이다.

### 오류 응답

- `401`: 토큰 누락, 유효하지 않은 토큰, 세션 만료 또는 사용자 없음
- `503`: 로그인 저장소 연결 실패

## 6.4 로그아웃

```http
POST /api/auth/logout
Authorization: Bearer {access_token}  # 토큰이 있을 때
```

토큰이 전달되면 대응하는 로그인 세션을 삭제한다. 유효한 로그인이 필요하다.

### 성공 응답: 204 No Content

응답 본문은 없다.

### 오류 응답

- `503`: 로그인 저장소 연결 실패

## 6.5 보호 대상 사용자 조회

```http
GET /api/care/linked-users
Authorization: Bearer {access_token}
```

보호자 계정에 연결된 일반 사용자 목록을 `User[]` 형식으로 반환한다. 일반 사용자는 호출할 수 없다.

## 6.6 보호자 메모 저장 및 수정

```http
PUT /api/care/notes/{session_id}
Authorization: Bearer {access_token}
Content-Type: application/json
```

```json
{
  "user_id": "demo",
  "content": "물을 자주 찾았음"
}
```

연결된 사용자의 의사소통 기록에 최대 500자의 보호자 메모를 저장한다. 같은 기록에 다시 요청하면 기존 메모를 수정한다.

## 6.7 보호자 메모 삭제

```http
DELETE /api/care/notes/{session_id}?user_id=demo
Authorization: Bearer {access_token}
```

현재 보호자가 작성한 해당 기록의 메모를 삭제하며 성공 시 `204 No Content`를 반환한다.

## 6.8 사용자 TTS 설정 조회 및 저장

```http
GET /api/tts/settings
PUT /api/tts/settings
Authorization: Bearer {access_token}
Content-Type: application/json
```

```json
{
  "preset": "child",
  "voice_name": "Microsoft Heami",
  "rate": 0.9,
  "pitch": 1.25,
  "volume": 1.0
}
```

일반 사용자 본인 또는 `voice_access_manage` 권한이 있는 보호자·담당자가 음성 프리셋, 기기 음성 이름, 속도, 음높이와 기본 볼륨을 조회하거나 저장한다. 저장된 설정이 없으면 어린이 느낌과 100% 볼륨을 기본값으로 반환한다. `preset`은 `child`, `woman`, `man` 중 하나이며 속도와 음높이는 `0.5`부터 `1.5`, 볼륨은 `0.0`부터 `1.0`까지 허용한다. 볼륨이 0이면 클라이언트는 무음 재생 대신 설정 변경 안내를 표시한다.

## 6.9 TTS 이용 이력 저장

```http
POST /api/tts/events
PATCH /api/tts/events/{request_id}
Authorization: Bearer {access_token}
Content-Type: application/json
```

재생을 요청할 때 UUID, 콘텐츠 종류(`card`, `sentence`, `recovery`, `preview`)와 글자 수를 저장한다. 기기 TTS 재생을 먼저 요청한 뒤 이력을 비동기로 저장하며, 재생이 끝나면 같은 UUID에 `succeeded`, `failed`, `cancelled` 결과, 오류 코드와 발화 시작 지연 시간 `startup_ms`를 기록한다. 지연 시간은 버튼 입력부터 브라우저의 `onstart` 이벤트까지 측정하고 최대 60초만 허용한다. 발화 원문은 개인정보 노출을 줄이기 위해 저장하지 않는다.

## 6.10 사용자 접근 설정 조회 및 저장

```http
GET /api/accessibility/settings
PUT /api/accessibility/settings
Authorization: Bearer {access_token}
Content-Type: application/json
```

```json
{
  "display_mode": "image_text",
  "cards_per_page": 12,
  "card_size": "medium",
  "text_size": "medium",
  "reduced_motion": false,
  "high_contrast": false
}
```

일반 사용자 본인의 카드 표시 방식, 한 페이지 카드 수, 카드·글자 크기, 애니메이션·장식 감소 및 고대비 설정을 조회하거나 저장한다. `display_mode`는 `image`, `image_text`, `text`, 크기는 `small`, `medium`, `large` 중 하나다. 카드 수는 6~30개이며 저장된 설정이 없으면 위 기본값을 반환한다.

## 6.11 개인정보 동의·내보내기·삭제

`GET/PUT /api/privacy/settings`는 법정대리인 동의 확인, 동의 정책 버전, 기록 보존 기간(30·90·365·1095일)과 최근 삭제 상태를 관리한다. 보존 기간을 저장하면 기간이 지난 문장 및 음성 이력을 즉시 정리한다.

`GET /api/privacy/export`는 비밀번호, 프로필·카드 이미지 원본을 제외한 계정 정보, 의사소통·음성 이력, 개인 카드 메타데이터와 현재 지원 연결을 JSON으로 반환한다.

```http
DELETE /api/privacy/data
Authorization: Bearer {access_token}
Content-Type: application/json

{"confirmation":"DELETE"}
```

삭제하면 개인 카드와 그 감사 이력, 문장·음성 기록, 보호자 메모·연결, 프로필 이미지, 음성·접근 설정이 제거된다. 로그인 계정은 사용자가 삭제 완료 상태를 확인할 수 있도록 유지하고 `deletion_status=completed` 및 완료 시각을 영수증으로 보존한다.

## 6.12 오프라인 최소 이력 동기화

```http
POST /api/offline/events/sync
Authorization: Bearer {access_token}
Content-Type: application/json
```

```json
{
  "events": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "event_type": "immediate_speech",
      "card_ids": ["help"],
      "occurred_at": "2026-10-09T05:30:00Z"
    }
  ]
}
```

동의한 사용자가 오프라인에서 실행한 즉시 발화 또는 선택 카드 그대로 발화의 UUID, 유형, 카드 ID와 기기 시각만 저장한다. 발화 원문은 전송하지 않는다. 서버는 UUID를 `_id`로 upsert하므로 같은 묶음을 재전송해도 중복 이력이 생기지 않는다. 응답의 `accepted_ids`를 받은 뒤에만 기기 대기열에서 제거한다. 한 요청은 최대 100건, 카드 ID는 이벤트당 1~12개다.

선택 헤더 `X-Pesc-Sync-Retried`는 이전 기기 전송 시도 표시가 있는 항목 수이며 기본값은
0이다. 0~100이면서 전송 건수 이하여야 하고, 잘못된 값은 422다. 로컬 `sync_attempted`
표시는 본문에 넣지 않는다. 같은 소유자의 동시 저장 경쟁은 중복으로 수락하고 다른
소유자의 UUID는 409다. 묶음 도중 실패하면 앞서 저장한 항목은 유지되며, 재전송 시
최초 기록을 보존하고 `accepted_ids`로 확인한다.

## 6.13 학습 결과와 단어별 진행 조회

`POST /api/learning/attempts`는 세션 합계와 함께 각 문제의 `card_id`, `label`,
`first_try_correct`를 저장한다. 문제별 결과 수와 첫 시도 성공 수는 세션의 전체
문제 수와 정답 수에 일치해야 한다. 기존 클라이언트를 위해 문제별 결과가 없는
요청도 허용한다.

클라이언트는 오프라인 완료 결과를 별도 로컬 대기열에 보관한 뒤 같은
`request_id`로 이 API를 재호출한다. 서버는 요청 ID를 학습 기록의 고유 키로
사용하므로 응답을 받기 전에 연결이 다시 끊겨도 중복 결과를 만들지 않는다.

오프라인 대기 결과 재전송은 `X-Pesc-Offline-Sync: true`와
`X-Pesc-Sync-Retried: 0~1`로 표시한다. 일반 온라인 학습은 동기화 지표에서 제외하며,
오프라인 표시 없이 재시도 수 1을 보내면 422다. 헤더는 학습 결과에 저장하지 않는다.

`GET /api/learning/progress?days=30`은 참여 횟수와 함께 `familiar_words`,
`repeat_words`, `practicing_words`를 반환한다. 최근 조회 기간에 두 번 이상 모두
첫 시도에 찾은 단어는 익숙한 단어, 한 번이라도 어려웠던 단어는 다시 연습할
단어로 분류한다. 화면에서는 평균 점수보다 참여와 단어별 경험을 먼저 표시한다.

# 7. 카드 API

## 7.1 카드 목록 조회

```http
GET /api/cards
Authorization: Bearer {access_token}
```

현재 활성화된 기본 카드 18개를 반환한다. 서버에 정의된 순서대로 제공된다.

### 성공 응답: 200 OK

응답 형식은 `Card[]`이다. 카드 목록 응답에는 `count`가 포함되지 않는다.

```json
[
  {
    "id": "me",
    "label": "나",
    "symbol": "🙋",
    "category": "사람"
  },
  {
    "id": "water",
    "label": "물",
    "symbol": "💧",
    "category": "음식"
  }
]
```

### 오류 응답

- `401`: 인증 실패

## 7.2 활성 카테고리 조회

```http
GET /api/categories
Authorization: Bearer {access_token}
```

카드 탐색과 카드 등록 폼에서 공통으로 사용할 MongoDB의 활성 카테고리를
`display_order` 순서로 반환한다. 카테고리 데이터가 아직 없으면 기본 5개 분류와
가구, 생활용품, 학습, 사용자 카드까지 총 9개를 최초 1회 저장한다.

### 성공 응답: 200 OK

```json
[
  {"id": "people", "name": "사람", "display_order": 1, "active": true},
  {"id": "furniture", "name": "가구", "display_order": 6, "active": true},
  {"id": "user-cards", "name": "사용자 카드", "display_order": 9, "active": true}
]
```

## 7.3 카드 등록 요청

```http
POST /api/cards/submissions
Authorization: Bearer {access_token}
Content-Type: multipart/form-data
```

| 필드 | 형식 | 제한 |
|---|---|---|
| `label` | string | 1~30자 |
| `meaning` | string | 1~120자 |
| `category` | string | 1~30자 |
| `visibility` | string | `private` 또는 `shared` |
| `image` | file | JPG, PNG, WebP, 최대 5MB, 가로·세로 128~4096px |
| `submission_mode` | string | `draft` 또는 `submit`. 기본값 `submit` |
| `user_id` | string | 보호자·담당자가 관리할 연결 사용자. 본인은 생략 |

AAC 사용자 본인 또는 `cards_manage` 권한이 있는 연결 보호자·담당자가 요청할 수
있다. 보호자·담당자는 연결 사용자의 `user_id`를 전송하며 서버가 연결과 권한을
다시 확인한다. 카드 소유자는 연결 사용자, 감사 기록의 처리자는 실제 요청 계정으로
분리해 저장한다. `draft`는 작성 중으로 저장된다. `submit`인 개인 카드는 본인에게 즉시
활성화되고 운영 권한 담당자에게 공유되지 않으며, 공개 카드는 승인 대기로 저장된다.
성공 시 `201 Created`를 반환한다. 작성 중 개인 카드는
`POST /api/cards/submissions/{id}/submit`으로 즉시 활성화하고 공개 카드는 운영 권한 담당자에게 제출한다.
서버는 실제 이미지 형식과 선언된 MIME을 비교하고, 디코딩과 해상도 검증 후
메타데이터와 부가 데이터를 제거한 WebP로 재인코딩해 저장한다.
시그니처·디코더 포맷도 교차 확인하며 EXIF 방향과 투명도는 픽셀에 반영한다.
신규 카드에서 원본 파일명은 보관하지 않는다. 프로필 이미지 업로드에도 같은
[정규화·메타데이터 제거 규칙](IMAGE_UPLOAD_NORMALIZATION.md)을 적용한다.

2026-10-22부터 검증·안전성 처리를 통과한 신규 업로드의 원본 바이트를 로컬 MongoDB에
화면용 이미지와 함께 보관한다. 카드의 `original_image`, 사용자 프로필의 `original_image`는
보관용 DB 필드이며 API 응답·안전성 전송·개인정보 JSON 내보내기에 포함하지 않는다.
원본 다운로드 API와 클라우드 저장소는 추가하지 않는다. 화면용 WebP의 메타데이터 제거와
기존 접근 권한은 유지한다. 원본+WebP 합계가 15MiB를 넘으면 문서 크기 안전 여유를 위해 422다.
프로필 교체·기본 캐릭터 전환·개인정보 삭제 시 관련 원본도 함께 제거한다. 별도 백업 사본의
보존·파기 정책은 별도이며 기존 DB에서 버린 원본은 복원하지 않는다.

A1-04 후속 구현은 [로컬 이미지 저장 안정화](LOCAL_IMAGE_STORAGE.md)를 따른다.
카드 화면용은 1280px 이내, 썸네일은 256px 이내로 비율을 보존한다. 카드 응답의
`thumbnail_url`은 `?variant=thumbnail&v={콘텐츠해시}`이며 기본 image URL은 화면용이다.
프로필 화면용/썸네일은 512/128px 이내다. 새 필드는 선택적이고 기존 데이터는 화면용으로 대체한다.
이미지 GET은 인증·현재 권한 확인 후 ETag/304와 `private, no-cache`, `Vary: Authorization`을
적용한다. 원본 variant는 422다. 목록·중복 검사·인증·일반 메타데이터 조회는 원본 바이너리를 제외한다.
DB 이미지 합계는 기본 사용자 200MiB/전체 2048MiB이며 초과는 무변경 413, 동시 이미지 쓰기는
409다. 삭제 이전 또는 생성 30일이 지난 관리 백업은 복원 도구에서 거절하며 파기는 명시적
계획·확인 절차로 연결한다. 기존 백업 파일을 이번 개발 중 자동 삭제하지 않는다.
카드명은 한글·영문·숫자와 공백만, 뜻은 일반적인 문장부호를 추가로 허용한다.
공개 카드의 금칙어는 Unicode 정규화 후 공백과 특수문자를 제거해 변형 표현까지 검사한다. 개인 카드의 욕설·위기 표현은 의사표현을 막지 않기 위해 이 공개 제한을 적용하지 않는다.
기본 카드와 동일하거나 승인 대기·승인 요청에 동일한 카드명이 있으면
`409 Conflict`를 반환한다.
약어·은어·신조어 후보는 내부 검토 사전과 영문 약어 형식 검사를 거쳐
`language_flags`에 표현, 유형, 뜻, 참고 출처를 반환한다. 이 결과는 자동 반려
조건이 아니며 운영 권한 담당자의 판단을 돕는 참고 정보다.
이미지 안전성 검사 결과는 `image_safety`에 `passed`, `blocked`,
`manual_review` 중 하나로 저장된다. `blocked`는 `422`로 등록을 거부하고,
공급자 미설정·장애 시에는 `manual_review`로 저장해 운영 권한 담당자에게 표시한다.
외부 공급자는 `IMAGE_SAFETY_API_URL`에 JSON POST로 호출되며
`{"safe": true|false, "provider": "...", "reasons": []}` 응답을 사용한다.

## 7.4 사용자 카드 등록 요청 조회

```http
GET /api/cards/submissions
Authorization: Bearer {access_token}
```

AAC 사용자는 본인의 요청만 최신순으로 반환받는다. 보호자·담당자는
`GET /api/cards/submissions?user_id=...`로 `cards_manage` 권한이 있는 연결 사용자의
요청만 조회한다.
작성 중이거나 반려된 카드는 `PATCH /api/cards/submissions/{id}`로
카드명, 뜻, 카테고리, 공개 범위를 수정할 수 있다. 반려 카드를 수정하면
작성 중 상태로 전환되며, 승인 대기로 다시 제출해야 한다.

## 7.5 카드 승인·반려

```http
GET /api/admin/card-submissions
Authorization: Bearer {operator_access_token}
```

`content_manage` 권한을 가진 담당자는 전체 제출 목록과 이미지를 확인할 수 있다. 검토 결과는 다음과
같이 저장한다.

```http
PATCH /api/admin/card-submissions/{submission_id}
Authorization: Bearer {operator_access_token}
Content-Type: application/json
```

```json
{
  "decision": "approved",
  "reason": "",
  "password": "<로그인한 운영 담당자의 비밀번호>"
}
```

`decision`은 `approved`, `rejected`, `inactive` 중 하나다. 승인 대기에서는
승인·반려, 승인 상태에서는 비활성, 비활성 상태에서는 재활성만 허용된다.
반려할 때는 `reason`이 필수다. 승인된 카드만 `/api/cards`의 기본 18개 카드 뒤에 추가되며,
개인 카드는 소유자에게만, 공개 카드는 모든 일반 사용자에게 노출된다.

공용 카드 쓰기는 작업마다 본인 비밀번호를 재확인한다. 누락/잘못된 입력은 422,
비밀번호 불일치는 403, 별도 실패 제한 초과는 429이며 재인증 실패 시 카드를 변경하지 않는다.
성공·오류 응답은 `no-store`다. 조회에는 재인증 비밀번호가 필요하지 않다.
자세한 범위·제약은 [운영 작업 재인증](../operations/OPERATION_REAUTHENTICATION.md)을 따른다.

## 7.6 운영 권한 담당자의 카테고리 관리

```http
GET /api/admin/categories
POST /api/admin/categories
PATCH /api/admin/categories/{category_id}
Authorization: Bearer {operator_access_token}
Content-Type: application/json
```

`content_manage` 권한을 가진 담당자는 비활성 항목을 포함한 전체 카테고리를 조회하고 새 카테고리를 추가할 수 있다.
이름과 표시 순서를 수정하거나 `active`를 변경하면 일반 사용자용 `/api/categories`에는
활성 카테고리만 변경된 순서로 노출된다.

추가 요청은 `name`, `display_order`, `password`를 전달하며, 수정 요청은 `active`를 함께 전달한다.
`password`는 작업마다 본인의 현재 비밀번호를 다시 확인하는 필수 필드이며 별도 유예 세션을 만들지 않는다.
이름은 1~30자의 한글·영문·숫자·공백을 허용하고 표시 순서는 1~999 범위다.

```json
{
  "name": "운동",
  "display_order": 10,
  "active": true,
  "password": "<로그인한 운영 담당자의 비밀번호>"
}
```

동일한 이름은 `409 Conflict`, 유효하지 않은 입력은 `422 Unprocessable Entity`, 없는
카테고리 수정은 `404 Not Found`를 반환한다.

# 8. 문장 API

## 8.1 문장 생성 및 저장

```http
POST /api/sentences
Authorization: Bearer {access_token}
Content-Type: application/json
```

카드 ID와 순서를 바탕으로 문장을 생성하고 로그인 사용자의 MongoDB 기록으로 저장한다. `request_id`는 클라이언트가 생성하는 UUID이며 네트워크 재시도의 중복 저장을 방지한다.

### 요청 본문

| 필드 | 형식 | 제약 | 설명 |
|---|---|---|---|
| `cards` | string array | 1~12개 | 선택 순서가 보존된 카드 ID |
| `request_id` | UUID string | UUID 형식 | 요청의 멱등 식별자 |

```json
{
  "cards": ["me", "water", "drink"],
  "request_id": "56d46f5e-824e-48cc-968f-9ed97dfcddab"
}
```

### 성공 응답: 200 OK

응답 형식은 `CommunicationSession`이다. 같은 사용자가 동일한 `request_id`와 카드 목록으로 재요청하면 새 기록을 생성하지 않고 기존 응답을 반환한다.

### 문장 생성 규칙

| 카드 순서 | 생성 예시 |
|---|---|
| `me, water, drink` | 저는 물을 마시고 싶어요. |
| `me, rice, eat` | 저는 밥을 먹고 싶어요. |
| `me, toilet, go` | 저는 화장실에 가고 싶어요. |
| 정의되지 않은 조합 | 카드 이름을 ` · `로 연결 |

### 오류 응답

- `401`: 인증 실패
- `409`: 같은 `request_id`가 다른 카드 목록 또는 다른 사용자 기록과 충돌
- `422`: 카드 개수, UUID 형식 또는 카드 ID가 유효하지 않음
- `503`: MongoDB 연결 실패

## 8.2 문장 재생성 및 별도 저장

```http
POST /api/sentences/{session_id}/regenerate
Authorization: Bearer {access_token}
Content-Type: application/json
```

지정한 문장 기록의 카드와 순서를 그대로 사용해 새 문장을 생성한다. 기존 기록은 수정하지
않고 새 `CommunicationSession`으로 저장하며, `regeneration_of`에는 최초 문장 ID,
`generation_attempt`에는 생성 차수를 반환한다. 재생성된 문장을 다시 재생성해도 최초 문장
아래에 같은 계열로 연결된다.

```json
{
  "request_id": "0db65d89-a3c9-4cf6-9422-0b0310843097"
}
```

`request_id`는 재생성 요청마다 새 UUID를 사용한다. 동일한 UUID로 같은 재생성을 재시도하면
기존 결과를 반환하므로 중복 기록이 생기지 않는다.

### 오류 응답

- `401`: 인증 실패
- `404`: 현재 사용자의 문장 기록을 찾을 수 없음
- `409`: 같은 `request_id`가 다른 재생성 요청과 충돌
- `422`: UUID 형식이 유효하지 않음
- `503`: MongoDB 연결 실패

# 9. 추천 API

## 9.1 추천 카드 조회

```http
GET /api/recommendations
Authorization: Bearer {access_token}
```

호환용 읽기 전용 조회다. 현재 추천 정책을 적용한 최대 6개 후보를 반환하고 노출 기록은 만들지 않는다.
선택 맥락·기기 시간대를 전달하는 새 화면은 아래 feed API를 사용한다. 알고리즘의 표본·상한·정책은
[추천 통제·탐색 보조](RECOMMENDATION_POLICY.md)를 따른다. 학습 결과나 메모는 사용하지 않는다.

### 성공 응답: 200 OK

응답 형식은 `Card[]`이며 `reason`을 포함한다. 사용 횟수 `count`는 더 이상 반환하지 않는다.

```json
[
  {
    "id": "water",
    "label": "물",
    "symbol": "💧",
    "category": "음식",
    "reason": "최근 저장한 문장에 포함"
  },
  {
    "id": "me",
    "label": "나",
    "symbol": "🙋",
    "category": "사람"
  }
]
```

### 오류 응답

- `401`: 인증 실패
- `503`: MongoDB 연결 실패

## 9.2 맥락별 후보 묶음

```http
POST /api/recommendations/feed
```

```json
{
  "request_id": "e7cb2bb1-b2bb-4bd3-b880-55d55fca6606",
  "selected_card_ids": ["me"],
  "hour": 12,
  "utc_offset_minutes": -540
}
```

AAC 사용자만 호출하며 다른 사용자 ID를 받지 않는다. UUID는 논리 요청마다 새로 생성한다.
선택 카드는 최대 12개, 시각은 0~23, UTC 오프셋은 -840~840분이다.
응답은 `Cache-Control: no-store`이고 다음 필드를 가진다.

| 필드 | 의미 |
|---|---|
| `batch_id` | 동의 유효·후보 존재 시 요청 UUID, 기록하지 않으면 null |
| `algorithm_version` | 현재 `aac-candidates-v1` |
| `cards` | 최대 6개 카드, 각 `reason`, `algorithm_version`, `evidence` 포함 |
| `settings_revision`, `enabled`, `mode`, `situation` | 계산에 적용한 보호자 정책 |
| `diagnostics` | 카테고리 분포, 반복 카드, 표본 수·기간·상한과 해석 제한 |

동의가 없거나 삭제 진행·실패·완료 상태이면 개인 기록을 사용·저장하지 않고 현재 정책의 기본 후보만
제공한다. 추천 꺼짐·빈 승인 목록은 빈 배열이며 전체 카드 API나 고정 보드를 제한하지 않는다.
같은 UUID·맥락의 재시도는 저장된 후보와 근거를 그대로 반환한다. 다른 소유자·맥락으로 재사용,
정책 또는 제공 가능한 카드 변경은 409다. 사용할 수 없는 선택 카드는 422, 추천 장애는 503이다.

## 9.3 실제 노출·선택 확인

```http
POST /api/recommendations/batches/{batch_id}/exposures
{ "card_ids": ["water"] }

POST /api/recommendations/batches/{batch_id}/selections
{ "card_id": "water" }
```

자기 묶음만 기록할 수 있으며 보호자 동의가 필요하다. 노출은 1~6개, 선택은 카드 하나를 받는다.
제공되지 않은 카드나 노출 전 선택은 422, 다른 사용자의 묶음은 404, 정책 변경은 409다.
200 응답은 `{ "recorded": true }`다. 묶음당 카드별 여부를 멱등 기록하며 클릭 횟수가 아니다.
UI는 문서·뷰포트에서 실제 보이는 후보만 노출로 전송한다. 조회 성공만으로 노출을 가정하지 않는다.
후보 클릭의 기록 전송과 실패는 실제 카드 선택·말하기를 막지 않는다.

## 9.4 보호자 정책과 반복 노출 점검

```http
GET /api/recommendations/settings?user_id={id}
PUT /api/recommendations/settings?user_id={id}
```

조회는 본인 또는 연결 `board_manage`, 변경은 보호자·담당자의 연결 `board_manage`가 필요하다.
조회는 no-store이며 정책, 현재 `available_cards`, 최근 추천 설정 감사 `history`를 반환한다.

```json
{
  "expected_revision": 0,
  "enabled": true,
  "mode": "approval",
  "approved_card_ids": ["water"],
  "hidden_card_ids": ["help"],
  "situation": "school",
  "use_time_of_day": true
}
```

모드는 `automatic` 또는 `approval`, 상황은 `unspecified`, `home`, `school`, `therapy`,
`outside`, `meal`, `hospital` 중 하나다. 승인·숨김 각각 최대 100개이며 중복·교집합은 422다.
`expected_revision`은 필수이고 충돌은 409다. 저장 응답은 해당 저장의 증가한 revision과 정책,
updated_by/updated_at이다. 고정 보드 revision과 배치는 바꾸지 않는다.
`board_audit_logs`에 전후 정책을 기록하므로 카드판 감사 응답의 before/after는 배열 외 객체도 허용한다.
빠른 표현 관리 권한만으로 카드판 감사 API를 조회할 때는 추천 정책 변경 이력을 제외한다.

```http
GET /api/recommendations/monitoring?user_id={id}
```

본인 또는 별도 `records_read` 연결 권한만 허용한다. 보드·학습·공용 콘텐츠 관리만으로 조회할 수 없다.
최근 90일의 실제 노출 묶음 최대 50개를 집계한 no-store 응답으로 `sampled_batches`, `limit`,
`window_days`, `algorithm_versions`, `categories`, `repeated_card_ids`, `cards`, `notice`를 제공한다.
cards 항목은 id/exposed_batches/selected_batches다. 미선택을 거절·지원 불필요로 해석하지 않는다.

# 10. 이용 현황 API

## 10.1 사용자 통계 조회

```http
GET /api/dashboard
GET /api/dashboard?days=7
GET /api/dashboard?days=30
GET /api/dashboard?days=30&user_id=demo
Authorization: Bearer {access_token}
```

일반 사용자는 본인의 기록만 집계한다. 보호자는 `user_id`로 연결 사용자의 기록을 조회하며, 생략하면 첫 연결 사용자를 조회한다. `days`가 없으면 전체 기간을 조회한다.

### 쿼리 매개변수

| 이름 | 형식 | 필수 | 기본값 | 제약 | 설명 |
|---|---|---|---|---|---|
| `days` | integer | 아니요 | 없음 | 1~365 | 최근 N일 기록만 조회 |
| `user_id` | string | 아니요 | 본인 또는 첫 연결 사용자 | 최대 64자 | 보호자가 조회할 연결 사용자 ID |

### 성공 응답: 200 OK

| 필드 | 형식 | 설명 |
|---|---|---|
| `sessions` | integer | 선택 기간에 저장된 문장 수 |
| `selections` | integer | 선택 기간에 사용된 전체 카드 수 |
| `top_cards` | Card[] | 사용 횟수 순 카드 목록. `count` 포함 |
| `categories` | object | 카테고리 이름별 사용 횟수 |
| `recent` | CommunicationSession[] | 최신순 기록 최대 10개 |
| `top_combinations` | object[] | 최초 저장 문장의 두 카드 조합 상위 10개. `cards: Card[]`, `count` 포함. 순서·반복·재생성 중복 제외 |
| `period_days` | integer 또는 null | 적용된 기간. 전체 기간이면 `null` |
| `today_sessions` | integer | 오늘 생성한 문장 수 |
| `today_selections` | integer | 오늘 선택한 카드 수 |
| `frequent_emotion_state` | Card 또는 null | 선택 기간에 자주 사용한 감정·신체·감각 상태 표현. 진단이나 추론이 아닌 선택 횟수 기준 |
| `last_activity` | ISO 8601 또는 null | 가장 최근 의사소통 시각 |
| `daily_activity` | object[] | 최근 7일 날짜별 문장 수 |
| `recent_safety_expressions` | Card[] | 최근 사용한 안전 관련 표현의 횟수와 최근 시각. 위험 자동 판정이 아닌 관찰 기록 |

```json
{
  "sessions": 2,
  "selections": 6,
  "top_cards": [
    {
      "id": "me",
      "label": "나",
      "symbol": "🙋",
      "category": "사람",
      "count": 2
    }
  ],
  "categories": {
    "사람": 2,
    "음식": 2,
    "행동": 2
  },
  "recent": [
    {
      "id": "56d46f5e-824e-48cc-968f-9ed97dfcddab",
      "user_id": "demo",
      "cards": ["me", "water", "drink"],
      "sentence": "저는 물을 마시고 싶어요.",
      "created_at": "2026-09-09T01:30:00.000000+00:00"
    }
  ],
  "period_days": 7
}
```

데이터가 없으면 수치는 `0`, 목록은 `[]`, 카테고리는 `{}`로 반환한다.

```json
{
  "sessions": 0,
  "selections": 0,
  "top_cards": [],
  "categories": {},
  "recent": [],
  "period_days": 7
}
```

### 오류 응답

- `401`: 인증 실패
- `422`: `days`가 정수가 아니거나 1~365 범위를 벗어남
- `503`: MongoDB 연결 실패

## 10.2 영역별 기록 다운로드

```http
GET /api/records/export?domain=communication&format=csv&days=7&user_id=demo
GET /api/records/export?domain=learning&format=json&days=30&user_id=demo
Authorization: Bearer {access_token}
```

`domain`은 필수 `communication`, `learning`, `activity` 중 하나이며 `format`은 `json`(기본) 또는 `csv`다.
`days`는 1~365, 생략 시 전체이며 요청 시각까지의 기록을 읽는다. `user_id`는 본인 또는
의사소통·활동은 `records_read`, 학습은 `learning_manage` 연결 권한이 있는 아동만 허용한다. 계정 운영 권한은
이 경계를 우회하지 않는다. 지원 메모·다른 영역·계정 비밀 정보는 포함하지 않는다.

JSON은 `export_version`, `domain`, `user_id`, `period_days`, `from_inclusive`, `to_inclusive`,
`count`, `scope_note`, `records`를 반환한다. 의사소통 행은 `id`, `saved_at`, `cards`,
`card_labels`, `sentence`, `generation_source`, `generation_attempt`, `regeneration_of`,
`card_selected_at`(기록된 ISO 선택 시각 배열 또는 null), `speech_status: "unknown"`을 담는다.
문장 파일은 재생 결과를 조인하지 않으며 명시적 연결 결과는 활동 파일의 `session_id`로 확인한다.
저장 시각을 선택 시각이나 재생 결과로 해석하지 않는다. 학습 행은 완료 시각·활동·카테고리·문제 수·첫 시도
결과·소요 시간과 단어별 결과만 담는다. CSV는 같은 행 필드의 UTF-8 BOM 파일이며 복합 필드는
JSON 셀, 수식 시작 문자는 작은따옴표 접두사로 보호한다.

응답은 `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, 첨부 파일명을 포함한다.
10,000개 초과 시 잘린 파일 대신 413으로 기간 축소를 안내하고 조회 실패는 503이다.
대시보드 `recent[].card_details`에는 순서를 보존한 카드 메타데이터(개인 카드 저장 스냅샷 우선)를
추가한다. 자세한 해석·보관 안내는 [지원 기록 화면](SUPPORT_RECORD_DASHBOARD.md)을 따른다.

## 10.3 선택·발화·상황 기록

`GET /api/records/activity?user_id=…&days=7`은 의사소통 기록 권한만 사용하며 학습 권한으로
우회하지 않는다. `days=1~365`, 생략 시 전체다. 응답은 `total`, `recent`(최근 최대 100개),
`situations`, `daily`(UTC 날짜·상황별), `recovery_flows`(최근 최대 20개)를 포함한다.
각 이벤트는 `id`, `event_type`, `card_ids`, `occurred_at`, `situation`, `stream_id`, `sequence`,
`selection_id`, `session_id`, `speech_status`, `completed_at`, `recovery_id`의 허용 목록만 반환한다.
최대 10,000개, 초과 시 413, 조회 실패 503이며 `no-store`다.

기존 `POST /api/offline/events/sync`에 새 `card_selection`, `speech_result`, `recovery_speech`
유형을 추가한다. 새 형식은 흐름 UUID와 1 이상의 순서를 요구한다. 발화 결과에는
`succeeded|failed|cancelled`와 시작보다 빠르지 않은 완료 시각, 복구 표현에는 정해진
`recovery_id`가 필요하다. 선택 이벤트의 빈 배열은 비우기이며 발화 결과를 붙일 수 없다.
상황은 `unspecified|home|school|therapy|outside|meal|hospital` 중 직접 선택한다. 미래 5분을
넘는 기기 시각은 422다. 문장 `session_id` 연결은 동일 사용자 소유일 때만 허용한다.
동의·본인 권한·동일 ID 재시도의 기존 규칙은 유지하며 본문·녹음·기기 지문은 저장하지 않는다.

`POST /sentences`의 선택적 `selected_at`은 카드 수와 같은 길이의 timezone-aware 시각/null
배열이다. 대시보드는 `card_selected_at`과 정확한 문장 ID에 연결된 최근 10개 `speech_results`를
추가한다. 기기 재생 완료는 실제 청취·의사 전달 성공을 보증하지 않는다. 복구 전후는 같은
페이지 흐름의 5분 이내 인접 관찰이며 인과·의도를 추론하지 않는다.

## 10.4 메모 이력과 삭제 결과

메모 저장은 선택적 `expected_revision`을 받고 작성자·증가 버전·수정 시각을 반환한다.
삭제도 쿼리 `expected_revision`을 지원하며 기존 204 응답을 유지한다. 버전 충돌은 409이고
서버 내부의 읽기-쓰기 사이 충돌도 차단한다. `/care/notes/{id}/history?user_id=…`는 `notes_write`
연결과 작성자 본인 범위를 검사해 현재 상태와 `history`(버전·작성자·행위·본문·시각)를 반환한다.
삭제 시 모든 과거 본문은 null로 지우며 메타데이터만 남긴다. 개인정보 전체 삭제는 문서 자체를 제거한다.

개인정보 응답의 `deletion_receipt`는 요청 ID·요청/완료 시각·`in_progress|completed|failed`·
컬렉션별 삭제 건수·프로필 처리·유지 항목·별도 파일/백업의 한계를 포함한다. 부분 실패는 503과
실패 영수증으로 남기며 성공으로 표시하지 않는다. 계정 본인만 개인정보 설정에서 확인할 수 있다.

# 11. 호출 예시

## 11.1 PowerShell

```powershell
$login = Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8000/api/auth/login `
  -ContentType 'application/json' `
  -Body '{"username":"demo","password":"demo1234"}'

$headers = @{ Authorization = "Bearer $($login.access_token)" }

Invoke-RestMethod `
  -Uri 'http://127.0.0.1:8000/api/dashboard?days=7' `
  -Headers $headers
```

## 11.2 cURL

```bash
curl -X POST http://127.0.0.1:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"demo","password":"demo1234"}'

curl "http://127.0.0.1:8000/api/dashboard?days=7" \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

# 12. 데이터 저장 관계

| API | MongoDB 컬렉션 | 작업 |
|---|---|---|
| 로그인 | `users` | 데모 사용자 동기화 및 조회 |
| 보호 대상 조회 | `caregiver_links`, `users` | 보호자-사용자 연결 조회 |
| 보호자 메모 | `caregiver_notes`, `communication_sessions` | 기록 확인 및 메모 저장·조회·삭제 |
| 로그인 | `auth_sessions` | 인증 세션 생성 |
| 현재 사용자 | `auth_sessions`, `users` | 세션 및 사용자 조회 |
| 로그아웃 | `auth_sessions` | 세션 삭제 |
| 카드 등록 | `card_submissions` | 제출, 승인·반려 저장 및 사용자 카드 조회 |
| 카드 감사 | `card_audit_logs` | 등록·제출·수정·승인·반려·비활성 행위자와 시각 저장 |
| 문장 생성 | `communication_sessions` | 중복 확인 및 문장 기록 생성 |
| 추천 | `communication_sessions`, `offline_events` | 동의한 본인의 최근 90일 문장·선택 관찰 표본 조회 |
| 추천 정책 | `recommendation_settings`, `board_audit_logs` | 연결 권한·revision 확인, 전후 정책 감사 |
| 추천 노출·선택 | `recommendation_batches` | 계산 근거 스냅샷과 실제 표시·선택 여부; 개인 내보내기·보존·삭제에 포함 |
| 이용 현황 | `communication_sessions` | 사용자 및 기간 조건 조회 |

DB 조회·변경의 콘솔 로그와 해당 로그를 활성화하는 환경 변수는 제거했다.
브라우저 기기 접속 정보 수집·전송 코드와 `/api/device/access`도 제거했으므로
기기 식별자를 새로 만들거나 접속을 별도 전송하지 않는다. 개인정보·권한·카드판 등의
감사 이력과 기능별 운영 지표 집계는 유지한다.

## 장애 HTTP 요청 로그

5xx 응답과 스트림 전송 예외만 `api_request` JSON으로 출력한다. 정상 응답·4xx·CORS
preflight는 요청 ID와 지표 집계를 유지하지만 콘솔 요청 로그를 출력하지 않는다.
오류 로그에는 실제 경로 대신 매칭된 경로
템플릿을 사용하고, 매칭되지 않은 요청은 `unmatched`로 기록한다. 쿼리, 헤더,
본문, 사용자·객체 ID, 발화 내용과 예외 원문은 이 로그에 포함하지 않는다.

```json
{
  "event": "api_request",
  "request_id": "36b34017-f740-4a87-a21b-89d815178120",
  "method": "POST",
  "route": "/sentences",
  "status_code": 500,
  "duration_ms": 12.4
}
```

5xx나 스트리밍 예외는 ERROR로 출력한다.
예상하지 못한 예외는 `error_type`에 클래스명만 추가한다. 전송이 시작된 스트림은
이미 보낸 HTTP 상태를 유지하지만 ERROR 로그로 실패를 확인할 수 있다.
이 로그가 오류율·시간 지표의 집계나 경보를 대신하지는 않는다.

# 13. 현재 제약사항

1. 비밀번호 변경 및 계정 탈퇴 API는 구현되지 않았다.
2. 기본 데모 계정은 개발·시연용이며 운영 배포 전에 교체해야 한다.
3. MongoDB 자체 인증은 현재 개발 구성에 적용되지 않았다.
4. 카드 작성 중·비활성 상태와 수정·삭제 API는 구현되지 않았다.
5. Ollama가 실행되지 않거나 모델 응답이 60초를 초과하면 규칙 기반 문장을 사용한다.
6. 음성 출력은 프런트엔드의 Web Speech API로 처리하므로 백엔드 TTS API는 없다.
7. `/api/health`의 기기 TTS 상태는 실제 음성 설치·오프라인 재생 성공을 판정하지 않는다. 기기별 검수는 별도로 수행한다.


## 사용자 프로필 API

프로필 조회·저장·사진 접근 권한과 응답 필드는 [사용자 프로필 정책](../policies/PROFILE_POLICY.md#api)을 참고한다. 인증 응답과 연결 사용자 응답의 `profile` 필드는 미설정 계정에서 `null`이다.
