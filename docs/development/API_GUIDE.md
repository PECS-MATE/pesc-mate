# API 연동 가이드

> 현재 안내: 2026-11-12. 정확한 스키마는 실행 서버 `/openapi.json`을 기준으로 합니다.
> 최신 음성·보관 정책은 [TTS 정책](../policies/TTS_POLICY.md), 검증 상태는 [안정화 기록](LOCAL_DEVELOPMENT.md#안정화-회귀-점검--2026-11-12)을 참고합니다.

## 공용 기본 카드 조회 — 2026-11-12

`GET /api/cards/builtin`은 로그인한 계정에 번들 기본 카드만 반환합니다. 보호자 홈의 기본 A4 카드판이 사용하며 아이 연결이나 아동별 지원 권한은 필요하지 않습니다. 개인·사용자 등록 카드를 조회하지 않고 응답은 `Cache-Control: no-store`입니다.

기존 `GET /api/cards`는 아동 전용이며 보호자에게 허용하지 않습니다. 인프로세스 HTTP 검사에서 보호자·담당자·운영자·아동의 기본 카드 120장 조회, 익명 차단, 보호자의 기존 카드 API 403 유지 및 개인 카드 조회 함수 미호출을 확인했습니다. 합성 인증 의존성을 사용했으며 실제 계정 로그인·DB 통합 검수는 미실행입니다.

## 회원가입 재시도 — 2026-11-10

`POST /api/auth/register`는 계정을 pending으로 생성하고 개인정보 초기 설정을 저장한 뒤
ready로 전환해 로그인 세션을 만든다. pending은 일반 로그인/세션 사용이 불가능하다.
후속 DB 작업이 실패해도 같은 아이디·비밀번호·이름의 요청으로 안전하게 이어서 완료한다.
이 흐름으로 생성한 ready 계정도 같은 정보의 재요청은 로그인 결과를 반환하며,
이미 저장된 이름·비밀번호·동의/보존 기간을 덮어쓰지 않는다. 다른 정보나 기존 일반 계정은 409다.
등록 상태는 내부 값이고 회원가입을 완료한 것으로 거짓 응답하지 않는다.

임시 실제 MongoDB에서 개인정보 저장 장애 후 재시도·pending 로그인 차단·세션 실패 후 재시도,
다른 비밀번호 거부와 재시도 시 철회된 동의/30일 보존 기간 유지 검사를 통과했다.
실제 브라우저 가입 동선·메일/본인 인증·운영 부하 검수는 미실행이다.

카드 등록/수정의 `meaning`은 2026-11-07부터 선택 항목입니다.
`POST /api/cards/submissions`, `POST /api/admin/cards`는 생략 시 카드 이름을 내부 값으로 사용합니다.
`PATCH /api/cards/submissions/{id}`는 생략 시 기존 별도 설명을 보존합니다.
사용자 화면에는 뜻 입력이 없으며 이름·분류·이미지·공개/권한 조건은 기존대로 확인합니다.

## 2026-11-06 추가 API

| 경로 | 용도 |
| --- | --- |
| `GET /api/learning/program?user_id=...` | 맞춤 세트·일일 코스·세트별 마지막 완료 조회 |
| `PUT /api/learning/program?user_id=...` | 보호자/담당자 코스 저장. expected_revision 충돌 시 409 |
| `GET /api/card-image-tools/status` | 개인/공용 이미지 도구 설정 상태 조회 |
| `POST /api/card-image-tools/generate` | JSON label·external_accepted·expected_backend·expected_model·scope·user_id로 명시적 외부 생성 |
| `POST /api/card-image-tools/remove-background` | multipart image·scope·user_id로 로컬 배경 제거 |

scope는 private/shared입니다. 공용은 콘텐츠 운영 권한, 개인은 연결 카드 권한·동의를 확인합니다.
코스는 학습·카드 권한을 모두 요구하고 기록은 기존 학습 저장소에만 남깁니다.
이미지 응답은 미리보기용 data URL이며 카드 저장 API를 별도로 호출해야 합니다.
키·모델 미설정 시 이미지 실행은 503, 과부하/시간당 제한은 429입니다. 생성은 자동 재시도하지 마세요.
자세한 스키마는 실행 중인 서버의 `/docs`, 사용·검증 경계는
[학습](LEARNING_AND_RECORDS.md), [이미지 보조](CARD_MANAGEMENT.md#card-image-tools)를 따릅니다.

> 기존 안내의 기준일은 2026-10-28입니다. 위 2026-11-06 추가 경로와 실행 서버 `/docs`를 우선합니다.

## 어디서 확인하나요?

로컬 백엔드 주소는 `http://127.0.0.1:8000`이고, 서비스 경로는 `/api`로 시작한다.
서버를 실행한 뒤 [Swagger UI](http://127.0.0.1:8000/docs)에서 실제 요청·응답 모델과
쿼리 매개변수를 확인할 수 있다. 기계가 읽는 명세는 `http://127.0.0.1:8000/openapi.json`이다.
경로·요청/응답 모델을 중복 관리하던 수기 명세는 제거했다. 아래는 통합에 필요한 공통 규약이다.
이 URL은 PC 로컬 실행 환경 기준이며 iPad의 localhost는 PC가 아니다.

| 먼저 볼 영역 | 대표 경로 | 목적 |
|---|---|---|
| 인증 | `POST /api/auth/login`, `GET /api/auth/me` | 세션 시작과 현재 사용자 확인 |
| 말하기 | `GET /api/cards`, `POST /api/sentences` | 카드 조회와 문장 생성·기록 |
| 개인정보 | `GET /api/privacy/settings` | 동의·보존 설정 확인 |
| 프로필·지원 | `/api/profile/*`, `/api/support/links` | 사진·보호자/담당자 연결 |
| 학습·기록 | `/api/learning/*`, `/api/dashboard` | 학습 결과와 사용 현황 |
| RFID | `/api/rfid/*` | USB 카드 조회·공용/개인 칩 등록·선택형 Wi-Fi 장치 |

## 요청과 응답 규약

- JSON 요청은 `Content-Type: application/json`, 인증은 `Authorization: Bearer <token>`을 사용한다.
  이미지 업로드 등 multipart 요청에는 JSON Content-Type을 강제로 지정하지 않는다.
- 세션 기본 유효 기간은 12시간이다. 계정 비활성·접근 만료·운영 권한 변경으로 더 일찍 거부될 수 있다.
  권한 관리와 재인증은 [운영 권한 절차](../operations/ACCOUNT_PERMISSION_MANAGEMENT.md)를 따른다.
- 시각은 UTC 기준 ISO 8601이다. 응답 예시의 버전·시각·카드 개수를 계약 상수로 사용하지 않는다.
- 음성 합성은 `{ "text": "도와주세요", "voice": "girl", "rate": 0.9 }`이며 boy도 허용한다.
  공백 정리 후 빈 본문은 거부하며 요청 텍스트는 최대 300자, 속도는 0.5~1.5 유한값이다.
  성공은 JSON이 아닌 PCM16 모노 WAV다. 공급자·제한·캐시는 [TTS 정책](../policies/TTS_POLICY.md)을 따른다.
- 실패는 기존 `detail`과 `error: { code, message, request_id }`를 사용한다.
  입력 검증 detail은 필드 위치·원인을 포함하는 목록일 수 있으며 원문·토큰·내부 예외는 표시하지 않는다.
- `X-Request-ID`는 HTTP 추적용 UUID다. 본문의 중복 방지 `request_id`와 별개다.
  바이너리/스트리밍이 이미 시작된 뒤 실패하면 JSON 오류로 바꿀 수 없으므로 전송 실패도 확인한다.
- 정상 CRUD/DB 조회를 별도 콘솔 로그로 남기지 않는다. 장애 추적과 개인정보 제외 기준은
  [장애 대응](../operations/INCIDENT_RESPONSE.md), 저장 관계는 [데이터 스키마](DATA_SCHEMA_MIGRATIONS.md)를 따른다.

## 기본 호출 순서

1. `POST /api/auth/login`에 `username`, `password`를 JSON으로 보낸다. 응답의
   `access_token`을 이후 요청의 `Authorization: Bearer <token>`에 넣는다.
   새 AAC 계정은 `POST /api/auth/register`를 사용하며 `guardian_consent: true`를
   명시적으로 제출해야 한다. 동의를 임의로 대신하거나 자동 입력하지 않는다.
2. `GET /api/auth/me`로 역할·계정 상태·프로필을 확인한다. 보호자·담당자는
   `GET /api/care/linked-users`로 연결된 아동을 조회한다.
3. AAC 사용자는 `GET /api/cards`로 카드 ID를 받은 뒤 화면에서 선택한다.
   저장할 문장은 `POST /api/sentences`에 `cards`(1~12개 카드 ID)와 새 UUID
   `request_id`를 보낸다. 법정대리인 동의가 없는 기본 말하기는 화면에서
   기록 없이 사용할 수 있지만 이 저장 API는 동의가 필요하다.
4. 서버 연결 시 `POST /api/tts/speech`에 `text`, `voice`(`girl`/`boy`), `rate`를 보내 WAV를 재생한다.
   생략 기본값은 girl/0.90배다. 기본 서버는 MeloTTS 단일 음색, Qwen overlay는 두 음색이다.
   오프라인에서는 기기 음성/준비된 녹음을 사용한다. `/api/tts/settings`와
   `/api/tts/events`는 설정·재생 결과용이며 음성 파일을 반환하지 않는다.
5. 작업을 마치면 `POST /api/auth/logout`으로 해당 세션을 종료한다.

같은 작업을 재전송할 때 본문의 `request_id`는 중복 저장 방지용이다.
매 HTTP 요청의 `X-Request-ID`는 별도 추적 ID이며 생략하면 서버가 생성한다.
요청 결과가 불확실할 때 새 본문 UUID로 무작정 재시도하면 별도 기록이 될 수 있다.

## 권한 경계

| 호출 주체 | 사용하는 인증 | 범위 |
|---|---|---|
| AAC 사용자 | Bearer 세션 | 본인 카드·문장·프로필·동의·지원 연결 |
| 보호자·담당자 | Bearer 세션 | 연결된 아동과 부여받은 `cards_manage`, `board_manage`, `records_read` 등 기능 권한 |
| 공용 콘텐츠 운영 담당자 | Bearer 세션 + `content_manage` | 공용 카드·카테고리·공용 칩 관리. 변경 일부는 본인 비밀번호 재확인 |
| 관리 책임자 | Bearer 세션 + 책임자 조건 | 담당자 운영 권한·접근 상태 변경. 변경 시 재인증·revision 필요 |
| Wi-Fi RFID 장치 | `X-Device-Key` | 장치 세션·스냅샷 수신만. 사용자 권한 없음 |

`user_id`를 쿼리에 넣어도 다른 아동의 권한이 생기지 않는다. 서버가 연결 관계와
기능별 권한을 확인한다. 수정 API의 `expected_revision`은 조회한 현재 버전을 보내며,
충돌 시 `409`를 받고 새 상태를 조회해 사용자가 다시 결정한다.

학습 코스·학습 설정 저장도 동의·삭제 보호를 적용한다. 쓰기 직전 동의 revision이 달라지면
409, 동의가 없으면 403이며 오래된 요청을 자동 재전송하지 않는다. 동의 없는 기본 카드 조회는 유지한다.

## 실물 카드 입력 흐름

**Windows Chrome/Edge + USB:** 브라우저에서 사용자가 Web Serial 포트를 선택한다.
USB 데이터는 먼저 브라우저로 들어온다. 공용 칩 등록은 `GET /api/rfid/admin/catalog`와
`PUT /api/rfid/admin/bindings`, 아동별 개인 매핑은 `/api/rfid/bindings`를 사용한다.
말하기 화면에서는 `POST /api/rfid/usb/resolve`로 읽은 UID를 카드에 연결한 뒤
사용자가 명시적으로 문장에 추가·적용한다. 스캔 자체가 문장 저장이나 발화를 호출하지 않는다.
세부 메시지·권한·상태 이벤트는 [USB 연동](RFID_USB_INTEGRATION.md)과
[관리자 공용 칩 등록](RFID_USB_INTEGRATION.md#rfid-chip-registration)을 참고한다.

**선택형 Wi-Fi 카드판:** 보호자·담당자가 `/api/rfid/devices`로 장치를 관리하고,
장치는 별도 키로 `/api/rfid/devices/{device_id}/session`과 `snapshot`을 호출한다.
기본 수신은 HTTPS이며 개발용 사설망 HTTP는 명시 설정이 있어야 한다.
세 위치 전체 스냅샷·순서 검사·실물 검수 조건은 [Wi-Fi 연동](RFID_WIFI_INTEGRATION.md)에 있다.

## 오류와 확인 범위

401은 세션/로그인, 403은 역할·연결·동의, 409는 버전/중복 충돌, 422는 입력,
503은 저장소 등 필수 의존성 오류를 우선 확인한다. 오류 응답에는 `detail`,
`error.code`, `error.message`, `error.request_id`가 있고 같은 추적 ID를
`X-Request-ID` 응답 헤더로도 받는다. 실제 서버가 살아 있는지는 `GET /api/health`로
확인하며 이 응답만으로 실제 태그 인식·기기 음성 성공을 판단하지 않는다.

**검증 상태:** 2026-11-12 격리 DB/HTTP 검사의 범위는 위 안정화 기록에 있다.
이번 문서 정리는 소스·내부 링크를 대조한 작업이며 앱 테스트나 실제 기기 검수의 추가 실행은 아니다.

## 도메인 코드 경계 — 2026-11-13

`app/api/router.py`는 라우터 조립만 담당한다. 외부 `/api` prefix는 여전히
`main.py`가 한 번 적용한다. 각 도메인 라우터에는 새 prefix를 추가하지 않는다.

| API 모듈 | 담당 | 스키마 |
| --- | --- | --- |
| auth | 로그인·가입·세션·로그아웃 | schemas/auth.py |
| accounts | 계정 권한·접근기간·연결 사용자·지원 연결·프로필 | schemas/accounts.py |
| boards | 카드판·빠른/복구 표현·슬롯·상황·변경 이력 | schemas/boards.py |
| cards | 기본/등록 카드·카테고리·OCR·스캔·이미지·승인 | schemas/cards.py |
| communication | 문장·재생성·TTS 합성/이벤트·오프라인 동기화 | schemas/communication.py |
| learning | 일반 학습 설정·결과·진행·감사 | schemas/learning.py |
| records | 기록·통계·보호자 노트·개인정보 조회/삭제/내보내기 | schemas/records.py |
| recommendations | 추천·피드·노출/선택·설정·모니터링 | schemas/recommendations.py |
| settings | 음성·접근성·개인정보 동의 설정 | schemas/settings.py |
| operations | health·모델 상태·운영 지표·경고 | schemas/operations.py |

기존 RFID·A4·이미지 도구·연습 제안 라우터는 유지한다.
`api/learning_program.py`는 DTO 검증·인증 의존성·응답 헤더를 담당하며,
DB 조회·최종 권한/동의 재검사·revision 갱신·감사는
`services/learning_program.py`로 이동했다. 코스 DTO는 `schemas/learning.py`에 있다.
공통 권한 검사는 `api/dependencies.py`, 권한 확인 후 이미지 ETag 응답은
`api/image_response.py`가 담당한다. 업무 규칙·DB/브라우저 저장 형식은 변경하지 않는다.

DTO 클래스명·필드·validator, HTTP 핸들러 이름·데코레이터·경로·응답 모델·
상태 코드·보안 의존성은 원본에서 이동했다. 기존 자동 생성 operation ID를
별도 새 이름으로 덮어쓰지 않았다. 같은 도메인 안의 정적/동적 경로 등록 순서를 유지한다.
OpenAPI 기준값은 `backend/tests/fixtures/openapi.json`에 보존했다.
내부 코드 이동에 맞춰 계약 테스트의 이미지/음성 대역과 코스 서비스 대역 위치만 옮겼다.

사용자 요청으로 이번 분리 후 OpenAPI·HTTP·바이너리·캐시·ETag·요청 ID·
중복 경로·순환 import 및 회귀/실제 MongoDB 재검증은 실행하지 않았다.
따라서 구현 반영 상태이며 계약 동일성 검증 완료 또는 배포 승인을 뜻하지 않는다.
