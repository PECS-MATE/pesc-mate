# 안정성 리팩터링 실행 기록

## 1단계 회귀 기반 — 2026-11-13

운영 코드 변경 없이 Vitest·React Testing Library·jsdom·fake-indexeddb 및
pytest·HTTPX·mongomock 기반 실행 환경을 추가했다. OpenAPI 기준은
`backend/tests/fixtures/openapi.json`이며 경로·메서드·operation ID·보안·DTO를 포함한다.

- 프론트엔드 50개, 기본 백엔드 46개, 실제 MongoDB 통합 5개를
  자동 재시도 없이 연속 3회 통과했다.
- 동의 revision·계정 소유권·문장 요청 멱등성 검사를 제거한 임시 복사본
  세 변형을 해당 회귀 테스트가 모두 탐지했다. 운영 파일은 수정하지 않았다.
- Windows MongoDB를 사용했다. 기존 DB는 이름만 조회했으며 테스트는
  `pesc_mate_test_refactor_*`라는 매 실행 고유 DB에서 합성 데이터로 수행했다.
- 기본 테스트는 외부 DB·모델·유료 API를 사용하지 않는다. 이미지·WAV·계정·UID는 합성이다.

### 시나리오와 근거

| 범위 | 테스트 |
| --- | --- |
| 인증·만료·로그아웃·권한 회수·대상 전환 | `test_authentication.py`, `api.test.js`, `App.test.jsx` |
| 카드 순서·선택 시각·멱등성·의미 실패 대체 | `test_communication.py`, `test_api_contract.py` |
| TTS unlock·교체·지연 응답·중단·대체·캐시 | `speechPlayback.test.js`, `speechAudioQueue.test.js`, WAV HTTP 계약 |
| USB 분할·연속·중복·제거·재시작·리스너 정리 | `usbRfid.test.js`, `UsbRfidReader.test.jsx` |
| Wi-Fi 장치 인증·20초 만료·개인 매핑 우선 | `test_program_and_visibility.py`, `test_rfid_and_images.py`, `usbRfid.test.js` |
| OCR 입력·용량·빈 결과·수정 이름 전달·영역 crop | `CardOcrAssist.test.jsx`, `test_rfid_and_images.py`, `test_program_and_visibility.py` |
| 오프라인 복원·계정 만료·순서·부분 수락·재전송·교체 | `offlineStore.test.js`, `offlineSync.test.js`, `test_recording_and_sync.py` |
| 학습 저장·재전송·코스 revision·기록 동의 | `test_recording_and_sync.py`, `test_program_and_visibility.py` |
| 카드 가시성·이미지 권한·ETag | `test_program_and_visibility.py`, `test_api_contract.py` |
| A4 크기·양면·저장·불러오기·공유 승인·철회 | `a4Layout.test.js`, `test_a4_sharing.py` |
| 프로세스 잠금·강제 종료·소유 토큰·복구 | `integration_tests/test_write_lock.py` |
| 실제 동의 철회·삭제/재동의와 지연 문장 저장 | `integration_tests/test_recording_races.py` |
| 실제 바이너리 집계·저장 한도 413 | `integration_tests/test_capacity.py` |

기본 테스트의 mongomock은 고유 인덱스·프로세스 경쟁의 근거가 아니다.
A4 단위 테스트의 용량 집계만 대역을 사용하고 실제 집계는 통합 테스트로 분리했다.
위 항목은 대표 경로의 검증이다. 로그인 후 전체 UI 과업, 스캔 등록 전체 흐름,
삭제와 이미지/RFID 저장의 모든 경합 조합, 전체 보안·성능 검수를 뜻하지 않는다.

### 실패·중단 이력과 기존 동작

- 기본 샌드박스의 패키지 다운로드 실패 후 승인 경로에서 설치했다.
- Linux 기본 Python에는 pytest가 없고 기존 `.venv`는 Windows용이었다.
  Linux 검사에는 `/tmp/pesc-mate-refactor-venv`, MongoDB에는 Windows Python을 사용했다.
- 샌드박스 HTTPX 스레드 통신 중단 후 승인 환경에서 실행해 통과했다.
- 테스트 작성 초기의 textbox/combobox, matchMedia 누락, Vary 헤더 기대값,
  BSON 날짜 정밀도, 모델 대역 반환값을 보완했다. 운영 코드는 수정하지 않았다.
- jsdom 버전 교체 중 실행 중이던 한 검사는 모듈 교체 오류로 실패했다.
  Node 22.13 호환 jsdom 26으로 고정 후 전체 검사를 다시 수행했다.
- 프론트 연속 실행 중 한 차례 180초 제한으로 중단했다. 파일별 격리를
  유지하는 vmThreads 2개로 환경 로딩을 줄인 후 연속 3회 통과했다.
- Windows 강제 종료 검사에서 종료된 자식의 Event에 다시 신호를 보내는
  테스트 정리 코드가 교착했다. 해당 프로세스를 명령으로 대조해 종료하고,
  종료된 자식의 이벤트를 건드리지 않도록 보완 후 통합 검사 3회 통과했다.
- 변형 검사 첫 실행은 멱등성 변형 위치가 고유하지 않아 중단했다.
  위치를 좁힌 뒤 세 변형 모두 탐지했다.
- 기존 문장 저장 첫 응답의 `created_at`은 마이크로초, 재전송 응답은 BSON
  밀리초 정밀도다. 동등한 내용과 1ms 미만 차이를 고정했으며 별도 수정 대상이다.
- 최신 Python 패키지 조합에서 Starlette의 HTTPX TestClient 사용 중단 예정
  경고가 발생했다. HTTPX 테스트 자체는 통과했으며 경고를 숨기지 않았다.

## 이후 단계의 실행 조건

사용자가 2026-11-13 추가 검증 없이 구현을 진행하도록 지시했다.
이후 App·잠금·API 분리 후 테스트·린트·타입 검사·빌드는 실행하지 않는다.
각 후속 커밋의 검증은 **미실행**이며 이전 1단계 통과 수치를 적용하지 않는다.
실물 RFID 3개·실제 OCR 사진·PC/Android/iPad 음성·오프라인 재시작·보호자
전체 과업은 미검수이며 전체 프로젝트 완료로 표시하지 않는다.

## 2단계 App 책임 분리 — 구현 반영·검증 미실행

- 인증·복원·만료·로그아웃을 `use-auth-session`, 캐시·네트워크·동기화를
  `use-offline-session`, 음성 객체·실행 번호·기기 이벤트·재생을
  `use-speech-controller`로 이동했다.
- 선택·문장 생성·활동 이벤트는 `use-communication`, 학습 상태·진행·재전송은
  `use-learning-session`, 대상 사용자·기록·카드·설정은 `use-support-workspace`로 이동했다.
- 각 모듈의 State 훅이 상태를 한 번만 만들고 처리 훅은 그 상태와 명시적
  외부 입력·콜백을 받는다. 상태를 먼저 할당한 뒤 처리 함수를 연결하므로
  하위 훅이 App이나 다른 도메인 훅을 import하지 않는다.
- 기존 effect 등록 순서·의존 배열·정리 함수를 개별 수명주기 훅으로 유지했다.
  새 라이브러리·저장 키·권한·UI 동선은 도입하지 않았다.
- 의사소통/연습과 지원 작업의 순수 렌더링을 `CommunicatorPage`,
  `SupportWorkspacePage`로 옮겼다. USB 연결 컴포넌트와 음성 객체는
  페이지 안으로 이동하지 않아 기존 App 마운트 수명을 유지한다.
- 역할별 오프라인 계정 저장 규칙은 `services/offlineAccount.js`를 공유한다.
- 사용자 지시로 변경 후 자동 검사·StrictMode 재검사·브라우저·실기기
  검수·빌드를 실행하지 않았다. 1단계 통과 결과는 이 변경의 근거가 아니다.

## 3단계 잠금 격리 — 구현 반영·검증 미실행

단일 잠금 구현을 `services/write_lock.py`로 옮기고 image_storage에는 호환
래퍼·상수를 유지했다. 직접 호출 업무 서비스와 복구 CLI는 공통 모듈을 사용한다.
통신·학습·오프라인·TTS 기록과 학습 코스는 recording_guard 경로를 그대로 사용한다.
컬렉션·ID·토큰·무기한 유지·409/503 응답·최종 토큰 조건 해제를 바꾸지 않았다.
사용처·보호 대상·대안 검토는 IMAGE_STORAGE.md에 기록했다.
사용자 지시로 이동 후 프로세스 경합·삭제·복구·용량·API 검사를 실행하지 않았다.

## 4단계 API 경계 분리 — 구현 반영·검증 미실행

router.py에서 도메인 10개 라우터와 같은 도메인의 스키마 모듈로 옮겼다.
공통 권한 검사와 이미지 응답은 순환 참조가 없는 별도 모듈을 사용한다.
기존 별도 RFID·A4·이미지 도구·연습 제안 라우터를 유지했다.
학습 코스의 조회·갱신·감사·최종 재검사를 서비스로 옮기고 HTTP 계층에는
입력·인증 의존성·응답 헤더를 남겼다. 일괄 repository 계층은 추가하지 않았다.
이동된 내부 대역 경로에 맞춰 관련 테스트 import/monkeypatch 대상만 바꿨다.
저장된 OpenAPI 기준값과 HTTP assertion은 바꾸지 않았다.

사용자 지시로 분리 후 자동 검증·OpenAPI 비교·중복/누락 경로 검사·import 검사·
HTTP 검사·전체 회귀·실제 MongoDB 통합 검사·빌드를 실행하지 않았다.
실기기 검수도 미완료다. 구현 반영과 검증 완료를 구분한다.

## 설정 화면 분리 — 2026-11-13

App의 `settingsSections`와 설정 내 화면 이동 렌더링을
`components/account-settings-panel.jsx`로 옮겼다. App은 열림 조건과 계정별 key,
현재 상태·권한·처리 콜백을 전달한다. 새 컴포넌트는 기존
AccountSettingsDialog를 그대로 사용한다. 프로필·접근성·음성·보호자·지원/운영
섹션의 순서, 역할별 노출 조건, 문구, 비활성 조건과 이벤트 연결은 원문을 이동했다.
설정 상태와 저장·동의·연결 권한 처리의 소유자는 기존 훅에 남겼다.
프로필 최초 설정 화면은 기존 위치를 유지한다.

사용자의 추가 검증 생략 지시에 따라 테스트·린트·타입 검사·브라우저 확인·
빌드는 미실행이다. 이 변경의 동작 검증과 실기기 검수는 완료로 표시하지 않는다.
