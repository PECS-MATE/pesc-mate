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
