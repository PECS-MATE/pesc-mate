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

## 2.2 날짜와 시간

날짜와 시간은 ISO 8601 문자열로 반환한다. 서버 저장 기준은 UTC이며 `Z` 또는 `+00:00` 시간대가 포함될 수 있다.

```text
2026-09-09T01:30:00.000000+00:00
```

## 2.3 공통 오류 응답

```json
{
  "detail": "오류 설명"
}
```

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
| 시스템 | GET | `/api/health` | 불필요 | 서버 상태 확인 |
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
| 개인정보 | GET/POST | `/api/privacy/caregivers` | 사용자 | 기록 열람 보호자 조회·연결 |
| 개인정보 | DELETE | `/api/privacy/caregivers/{caregiver_id}` | 사용자 | 보호자 연결 해제 |
| 개인정보 | GET | `/api/privacy/audit` | 사용자 | 연결·해제·삭제 변경 이력 조회 |
| 개인정보 | GET | `/api/privacy/export` | 사용자 | 본인 데이터 JSON 내보내기 |
| 개인정보 | DELETE | `/api/privacy/data` | 사용자 | 사용자 생성 데이터 삭제 |
| 오프라인 | POST | `/api/offline/events/sync` | 사용자 | 오프라인 최소 발화 이력 동기화 |
| 보호자 | GET | `/api/care/linked-users` | 필요 | 보호자에게 연결된 사용자 조회 |
| 보호자 | PUT | `/api/care/notes/{session_id}` | 필요 | 의사소통 기록의 보호자 메모 저장·수정 |
| 보호자 | DELETE | `/api/care/notes/{session_id}` | 필요 | 보호자 메모 삭제 |
| 카드 | GET | `/api/cards` | 필요 | 전체 카드 조회 |
| 카드 | GET | `/api/categories` | 필요 | 활성 카드 카테고리 조회 |
| 카드 | GET | `/api/cards/submissions` | 필요 | 본인 카드 등록 요청 조회 |
| 카드 | POST | `/api/cards/submissions` | 필요 | 카드 승인 요청 저장 |
| 카드 | POST | `/api/cards/submissions/{id}/submit` | 필요 | 임시 저장 카드를 승인 대기로 제출 |
| 카드 | PATCH | `/api/cards/submissions/{id}` | 필요 | 작성 중·반려 카드 정보 수정 |
| 카드 | GET | `/api/cards/submissions/{id}/image` | 필요 | 권한이 있는 카드 이미지 조회 |
| 카드판 | GET | `/api/board/layout` | 본인 또는 연결 권한 | 고정 카드·빠른 표현·복구 표현 구성 조회 |
| 카드판 | PUT | `/api/board/layout/recovery-expressions` | `quick_speech_manage` | 사용자별 복구 표현 2~4개와 고정 순서 저장 |
| 카드판 | PUT | `/api/board/layout/quick-expressions` | `quick_speech_manage` | 빠른 표현 카드와 고정 순서 저장 |
| 카드판 | PUT | `/api/board/layout/slots` | `board_manage` | 카드판 슬롯과 고정 순서 저장 |
| 카드판 | GET | `/api/board/layout/audit` | 본인 또는 연결 권한 | 카드판 구성 변경 이력 조회 |
| 운영 | GET | `/api/admin/card-submissions` | `content_manage` 권한 담당자 | 전체 카드 요청 조회 |
| 운영 | PATCH | `/api/admin/card-submissions/{id}` | `content_manage` 권한 담당자 | 카드 승인 또는 반려 |
| 운영 | GET | `/api/admin/categories` | `content_manage` 권한 담당자 | 전체 카테고리 조회 |
| 운영 | POST | `/api/admin/categories` | `content_manage` 권한 담당자 | 카테고리 추가 |
| 운영 | PATCH | `/api/admin/categories/{id}` | `content_manage` 권한 담당자 | 카테고리 수정 및 활성 상태 변경 |
| 문장 | POST | `/api/sentences` | 필요 | 문장 생성 및 기록 저장 |
| 문장 | POST | `/api/sentences/{session_id}/regenerate` | 필요 | 기존 카드로 문장 재생성 및 별도 저장 |
| 추천 | GET | `/api/recommendations` | 필요 | 사용자별 추천 카드 조회 |
| 통계 | GET | `/api/dashboard` | 필요 | 본인 또는 연결 사용자 이용 통계 조회 |

# 4. 데이터 모델

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
| `count` | integer | 아니요 | 추천·통계 응답의 사용자 사용 횟수 |
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

백엔드 프로세스가 HTTP 요청을 처리할 수 있는지 확인한다. 인증은 필요하지 않다. 현재 응답은 MongoDB 연결 상태까지 검사하지 않는다.

### 성공 응답: 200 OK

```json
{
  "status": "ok"
}
```

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
  "pitch": 1.25
}
```

일반 사용자 본인의 음성 프리셋, 기기 음성 이름, 속도 및 음높이를 조회하거나 저장한다. 저장된 설정이 없으면 어린이 느낌 기본값을 반환한다. `preset`은 `child`, `woman`, `man` 중 하나이며 속도와 음높이는 `0.5`부터 `1.5`까지 허용한다.

## 6.9 TTS 이용 이력 저장

```http
POST /api/tts/events
PATCH /api/tts/events/{request_id}
Authorization: Bearer {access_token}
Content-Type: application/json
```

재생을 요청할 때 UUID, 콘텐츠 종류(`card`, `sentence`, `preview`)와 글자 수를 저장한다. 재생이 끝나면 같은 UUID에 `succeeded`, `failed`, `cancelled` 결과와 오류 코드를 기록한다. 발화 원문은 개인정보 노출을 줄이기 위해 저장하지 않는다.

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

## 6.11 개인정보 동의·열람자·내보내기·삭제

`GET/PUT /api/privacy/settings`는 법정대리인 동의 확인, 동의 정책 버전, 기록 보존 기간(30·90·365·1095일)과 최근 삭제 상태를 관리한다. 보존 기간을 저장하면 기간이 지난 문장 및 음성 이력을 즉시 정리한다.

`GET/POST /api/privacy/caregivers`와 `DELETE /api/privacy/caregivers/{caregiver_id}`는 AAC 사용자가 본인의 기록 열람자를 직접 확인·연결·해제하게 한다. 연결 범위는 현황, 의사소통 기록, 프로필 이미지와 보호자 메모이며 변경은 `/api/privacy/audit`에 남는다.

`GET /api/privacy/export`는 비밀번호, 프로필·카드 이미지 원본을 제외한 계정 정보, 의사소통·음성 이력, 개인 카드 메타데이터와 현재 열람자를 JSON으로 반환한다.

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

인증된 일반 사용자만 요청할 수 있다. 소유자는 인증 정보로
설정되며 `draft`는 작성 중으로 저장된다. `submit`인 개인 카드는 본인에게 즉시
활성화되고 운영 권한 담당자에게 공유되지 않으며, 공개 카드는 승인 대기로 저장된다.
성공 시 `201 Created`를 반환한다. 작성 중 개인 카드는
`POST /api/cards/submissions/{id}/submit`으로 즉시 활성화하고 공개 카드는 운영 권한 담당자에게 제출한다.
서버는 실제 이미지 형식과 선언된 MIME을 비교하고, 디코딩과 해상도 검증 후
메타데이터와 부가 데이터를 제거한 WebP로 재인코딩해 저장한다.
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

## 7.4 본인 카드 등록 요청 조회

```http
GET /api/cards/submissions
Authorization: Bearer {access_token}
```

현재 로그인한 사용자가 제출한 요청만 최신순으로 반환한다.
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
  "reason": ""
}
```

`decision`은 `approved`, `rejected`, `inactive` 중 하나다. 승인 대기에서는
승인·반려, 승인 상태에서는 비활성, 비활성 상태에서는 재활성만 허용된다.
반려할 때는 `reason`이 필수다. 승인된 카드만 `/api/cards`의 기본 18개 카드 뒤에 추가되며,
개인 카드는 소유자에게만, 공개 카드는 모든 일반 사용자에게 노출된다.

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

추가 요청은 `name`, `display_order`를 전달하며, 수정 요청은 `active`를 함께 전달한다.
이름은 1~30자의 한글·영문·숫자·공백을 허용하고 표시 순서는 1~999 범위다.

```json
{
  "name": "운동",
  "display_order": 10,
  "active": true
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

로그인 사용자의 전체 기간 카드 사용 횟수를 집계하여 최대 6개를 반환한다. 사용 이력이 부족하면 기본 카드 순서로 채우며 각 카드에 추천 근거인 `reason`을 포함한다.

### 성공 응답: 200 OK

응답 형식은 `Card[]`이다. 사용 이력으로 추천된 카드에는 `count`가 포함되고 기본으로 채운 카드에는 포함되지 않는다.

```json
[
  {
    "id": "water",
    "label": "물",
    "symbol": "💧",
    "category": "음식",
    "count": 3
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
| 추천 | `communication_sessions` | 로그인 사용자 전체 기록 조회 |
| 이용 현황 | `communication_sessions` | 사용자 및 기간 조건 조회 |

백엔드 로그는 문서 내용, 비밀번호 및 토큰을 출력하지 않고 다음 형식으로 변경 작업만 기록한다.
조회(`READ`) 작업은 디버그 레벨로 낮춰 기본 실행 로그에는 표시하지 않는다.

```text
DB CRUD | CREATE | communication_sessions | 문장 기록 저장
```

# 13. 현재 제약사항

1. 비밀번호 변경 및 계정 탈퇴 API는 구현되지 않았다.
2. 기본 데모 계정은 개발·시연용이며 운영 배포 전에 교체해야 한다.
3. MongoDB 자체 인증은 현재 개발 구성에 적용되지 않았다.
4. 카드 작성 중·비활성 상태와 수정·삭제 API는 구현되지 않았다.
5. Ollama가 실행되지 않거나 모델 응답이 60초를 초과하면 규칙 기반 문장을 사용한다.
6. 음성 출력은 프런트엔드의 Web Speech API로 처리하므로 백엔드 TTS API는 없다.
7. `/api/health`는 백엔드 상태만 반환하며 MongoDB 준비 상태를 응답에 포함하지 않는다.


## 사용자 프로필 API

프로필 조회·저장·사진 접근 권한과 응답 필드는 [사용자 프로필 정책](PROFILE_POLICY.md#api)을 참고한다. 인증 응답과 연결 사용자 응답의 `profile` 필드는 미설정 계정에서 `null`이다.
