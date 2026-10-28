# API 연동 가이드

> 2026-10-28 저장소의 FastAPI 라우트 기준. 문서 작업이며 API 코드·응답 형식은 변경하지 않았다.

## 어디서 확인하나요?

로컬 백엔드 주소는 `http://127.0.0.1:8000`이고, 서비스 경로는 `/api`로 시작한다.
서버를 실행한 뒤 [Swagger UI](http://127.0.0.1:8000/docs)에서 실제 요청·응답 모델과
쿼리 매개변수를 확인할 수 있다. 기계가 읽는 명세는 `/openapi.json`, 전체 경로·권한 목록과
오류 규약은 [API 명세서](API_SPECIFICATION.md)에 있다. 이 URL은 로컬 실행 환경 기준이다.

| 먼저 볼 영역 | 대표 경로 | 목적 |
|---|---|---|
| 인증 | `POST /api/auth/login`, `GET /api/auth/me` | 세션 시작과 현재 사용자 확인 |
| 말하기 | `GET /api/cards`, `POST /api/sentences` | 카드 조회와 문장 생성·기록 |
| 개인정보 | `GET /api/privacy/settings` | 동의·보존 설정 확인 |
| 프로필·지원 | `/api/profile/*`, `/api/support/links` | 사진·보호자/담당자 연결 |
| 학습·기록 | `/api/learning/*`, `/api/dashboard` | 학습 결과와 사용 현황 |
| RFID | `/api/rfid/*` | USB 카드 조회·공용/개인 칩 등록·선택형 Wi-Fi 장치 |

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
4. 발화는 브라우저의 Web Speech API가 처리한다. `/api/tts/settings`와
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

## 실물 카드 입력 흐름

**Windows Chrome/Edge + USB:** 브라우저에서 사용자가 Web Serial 포트를 선택한다.
USB 데이터는 먼저 브라우저로 들어온다. 공용 칩 등록은 `GET /api/rfid/admin/catalog`와
`PUT /api/rfid/admin/bindings`, 아동별 개인 매핑은 `/api/rfid/bindings`를 사용한다.
말하기 화면에서는 `POST /api/rfid/usb/resolve`로 읽은 UID를 카드에 연결한 뒤
사용자가 명시적으로 문장에 추가·적용한다. 스캔 자체가 문장 저장이나 발화를 호출하지 않는다.
세부 메시지·권한·상태 이벤트는 [USB 연동](RFID_USB_INTEGRATION.md)과
[관리자 공용 칩 등록](RFID_CHIP_REGISTRATION.md)을 참고한다.

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

**검증 상태:** 사용자 요청에 따라 이번 문서 정리의 테스트·빌드·실행 API 확인은
수행하지 않았다. 경로와 권한을 소스에서 읽어 반영했으며, 실제 동작 검증은 사용자가 진행한다.
