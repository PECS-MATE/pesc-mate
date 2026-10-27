# UNO R4 WiFi · RC522 3개와 웹 연동

> 후속 사용자 요청으로 현재 PC 연결은 [USB 연동·장치 로그](RFID_USB_INTEGRATION.md)를 우선한다.
> 이 문서는 선택형 Wi-Fi 경로의 기록이며 USB만 꽂아 Wi-Fi 장치 목록에 나타나는 구조가 아니다.

> 2026-10-27 요구사항 기준. 기존 단일 리더기 USB 계획보다 이 문서를 우선한다.
> 사용자 확인: 단일 RC522에서 서로 다른 태그 2개 읽기 성공, 버전 응답 0x82.
> 이번 소프트웨어 구현과 실제 3개 리더기의 전기적/RF 검수 결과는 구분한다.

## 구조와 기존 기능 재사용

```text
RC522 1/2/3 → UNO R4 WiFi → 인증된 HTTP(S) 전체 상태 스냅샷
  → FastAPI /rfid → MongoDB의 장치별 최신 위치 상태 + 아동별 UID 매핑
  → React 1초 폴링 → RFID 위치별 보기 → 명시적 문장 적용
  → 기존 문장 생성/AI·내용 확인·기기 TTS
```

- 기존 React/Vite, FastAPI/PyMongo/MongoDB를 유지한다. Web Serial·새 중계 서버·WebSocket
  라이브러리를 추가하지 않는다. 폴링은 요청이 끝난 뒤 다음 요청을 예약하며 숨은 탭/페이지 이탈은 중단한다.
- RFID의 현재 세 위치는 자동 갱신하지만 **선택 문장은 자동 덮어쓰지 않는다**. ‘현재 RFID 배열을
  문장에 적용’을 누르면 Reader 1→2→3의 사용 가능한 카드로 현재 문장을 교체한다. 기존 초안이
  있으면 확인한다. 제거된 빈 위치는 제외하며 전부 비면 명시적으로 문장을 비울 수 있다.
- 미등록/사용 불가/리더기 오류/오래된 상태가 하나라도 있으면 적용하지 않는다. 같은 개념을
  다른 UID 두 개로 등록한 경우는 위치의 반복 카드를 유지한다. 동일 UID의 여러 위치 동시 감지는
  RF 간섭/복제 태그의 불확실성으로 취급하며 문장으로 적용하지 않는다.
- 적용 후 기존 문장 생성·확인·읽기 버튼을 사용한다. 자동 발화·자동 확인·고정 슬롯 변경은 없다.
  문장 생성/재생 중 적용을 막고, 기존 수동 카드 조작·긴급/복구 발화를 유지한다.
- 원래 JSON 제안의 `device_id`는 경로에, `reader_id`·`uid`·인식/빈/오류 상태는 전체 스냅샷에
  둔다. 개별 추가/제거 이벤트를 영구 적재하지 않고 최신 배열을 전달하므로 응답 유실·재연결 뒤
  오래된 제거/추가 이벤트가 역순 적용되는 문제를 줄인다. 모든 스캔의 이력 보존은 범위 밖이다.

## 펌웨어와 비밀 설정

코드는 `hardware/arduino/rfid-wifi-board/rfid-wifi-board.ino`에 있다.
같은 폴더의 `arduino_secrets.example.h`를 **로컬 `arduino_secrets.h`**로 복사해 설정한다.
실제 파일과 빌드 폴더는 Git에서 제외한다. 실제 태그 UID·아동별 매핑·장치 키는 예제에 넣지 않는다.

| 설정 | 내용 |
|---|---|
| SECRET_SSID / SECRET_PASS | 같은 사설 Wi-Fi의 접속 정보 |
| SECRET_DEVICE_ID | 웹에서 등록한 장치 ID, 예: pecsmate-01 |
| SECRET_DEVICE_KEY | 장치 등록/재발급 때 한 번 표시되는 개별 키 |
| SECRET_API_HOST / SECRET_API_PORT | PC의 사설 IPv4/호스트와 8000, 배포 시 인증서와 맞는 호스트/포트 |
| SECRET_USE_TLS | HTTPS이면 1. WiFiSSLClient를 사용하며 인증서 검증을 해제하지 않음 |
| SECRET_ALLOW_INSECURE_LAN | HTTP 실험을 명시적으로 허용할 때만 1. 기본 예시는 0이라 먼저 확인 필요 |
| RFID_READER_COUNT | 1→2→3 순서로 실험. 사용하지 않는 위치는 ERROR로 전달 |
| RFID_DEBUG_UIDS | 기본 0. 원시 UID의 일반 시리얼 출력 비활성 |

필요 라이브러리는 SPI·MFRC522·WiFiS3이며 ArduinoJson/HTTPClient 같은 추가 의존성을 요구하지 않는다.
현재 원본 진단 파일 `hardware/arduino/card-reader-test/card_reader_test.ino`는 편집/이동하지 않는다.
새 스케치는 폴더와 주 파일 이름이 일치한다.

### 상태 판정·한계

- SS 전부 HIGH 후 각 SS/RST로 초기화한다. 안테나는 순차적으로 하나만 켜 WUPA→선택→HALT→
  안테나 끄기를 수행한다. `PICC_IsNewCardPresent()`의 결과만으로 제거를 판단하지 않는다.
- 같은 UID 2회 연속 성공 시 PRESENT. 연속 TIMEOUT 4회 이상이면서 마지막 성공 후 1200ms
  이상이면 EMPTY. 버전 0/255와 UID 읽기 실패 또는 시간 초과 외의 장기 오류는 ERROR로 분리한다.
  버전 0x82 같은 미지의 응답만으로 실패 처리하지 않는다. UID 읽기가 성공하면 PRESENT가 될 수 있다.
- 100ms 폴링 기준은 목표 간격이지 보장 지연이 아니다. WUPA·WiFi.begin·TCP/TLS 연결은
  드라이버 안에서 지연될 수 있다. 간섭/전원 불안정/여러 태그는 TIMEOUT을 일으켜 실제로는
  놓인 태그를 제거로 오판할 수 있다. 임계값은 실물 측정 후 조정한다.
- 안테나 분리만으로 공유 MISO의 비선택 칩 구동 문제를 해결하지 못한다. 한 개→두 개→세 개로
  확장하며 배선 길이·리더기 간격·전원·SS 비선택 상태·MISO 격리를 확인해야 한다.
- MFRC522의 [다중 리더기 예제](https://github.com/miguelbalboa/rfid/blob/master/examples/ReadUidMultiReader/ReadUidMultiReader.ino)는
  공유 SPI 문제를 경고하며, [라이브러리 구현](https://github.com/miguelbalboa/rfid/blob/master/src/MFRC522.cpp)은
  WUPA의 IDLE/HALT 깨우기와 복수 태그 타임아웃 가능성을 설명한다. 이를 실물 성공 증빙으로 대신하지 않는다.

### Wi-Fi 전송

연결/부팅마다 서버에서 새 세션을 발급받아 이전 세션의 이벤트를 거절한다. 각 스냅샷은 증가하는
`event_id`를 가지며 정상 상태에서는 변경 시/5초 heartbeat로 전송한다. 실패 시 같은 내용/번호를
재시도하고 최대 30초까지 대기 간격을 늘린다. 그 사이 실제 배열이 바뀌면 최신 스냅샷으로 대체해
과거 큐를 무한히 쌓지 않는다. 번호의 공백은 허용하지만 낮은 번호는 적용하지 않는다.
같은 번호/다른 내용은 409, 이전 세션은 412이며 412에서 새 세션을 요청한다.
중복 재전송은 서버의 생존 시각을 갱신하지 않는다. 서버에 새로운 상태가 20초 없으면 STALE이다.
비밀 값과 원시 UID는 일반 로그에 출력하지 않고 상태/HTTP 코드만 출력한다.

## 예정 배선표 — 실물 검수 필요

| RC522 핀 | Reader 1 | Reader 2 | Reader 3 |
|---|---|---|---|
| SDA/SS | D10 | D8 | D7 |
| RST | D9 | D6 | D5 |
| SCK | D13 공유 | D13 공유 | D13 공유 |
| MOSI | D11 공유 | D11 공유 | D11 공유 |
| MISO | D12 공유 | D12 공유 | D12 공유 |
| 전원 | 외부 안정화 3.3V | 외부 안정화 3.3V | 외부 안정화 3.3V |
| GND | Arduino·전원·레벨 변환기와 공통 | 공통 | 공통 |
| IRQ | 미사용 | 미사용 | 미사용 |

사용자 제안 레벨 변환기 A: D13/SCK, D11/MOSI, D10/SS1, D8/SS2.
B: D7/SS3, D9/RST1, D6/RST2, D5/RST3. HV는 Arduino 5V, LV는 외부 3.3V다.
이는 **검증된 회로가 아니라 사용자 제안의 기록**이다. 다음을 먼저 확인한다.

- [UNO R4 WiFi](https://docs.arduino.cc/hardware/uno-r4-wifi/)의 5V GPIO와
  [MFRC522](https://www.nxp.com/docs/en/data-sheet/MFRC522.pdf)의 전원/신호 허용 조건.
- WAT-LC232-S의 실제 회로·방향·SPI 에지/속도 적합성. 채널 수가 맞는 것만으로 고속 SPI 적합성을
  보장하지 않는다. 라이브러리 기본 SPI 클록과 파형을 확인하고 필요 시 적절한 회로/클록으로 검수한다.
- MISO를 직접 공통 연결하는 구성의 R4 입력 HIGH 인식 전압과 RC522 출력 전압, 비선택 리더기의
  high-impedance 상태. 두 변환기의 출력용 8채널에는 MISO 레벨 변환이 포함되지 않았다.
- 외부 3.3V 전원의 용량/리플·공통 GND·짧은 배선과 RF 간격. 불안정한 통신을 소프트웨어 재시도로
  숨기지 않는다. 실제 사진/계측 없이 3개 동작이나 배선 안전을 승인하지 않는다.

## 서버·웹 실행과 등록

1. 정상 로컬 앱을 실행하고 AAC 계정의 개인정보 동의와 보호자 연결을 명시적으로 설정한다.
2. 보호자/담당자에게 `board_manage`로 장치 관리, `cards_manage`로 태그 매핑을 허용한다.
   지원 메뉴 **RFID 카드판**에서 대상 아동을 선택한다. UID를 포함한 등록용 상태를 보려면 두 권한이 필요하다.
3. 장치 ID와 이름을 등록한다. 서버에는 무작위 키의 SHA-256만 저장하며 평문 키는 이 응답에서
   한 번만 표시한다. 응답을 잃으면 목록을 확인해 키를 재발급한다. 장치 등록을 자동 반복하지 않는다.
4. 개발 HTTP가 필요한 사설망에서만 아래 명령을 사용한다. PC의 비공개 방화벽에서 8000을 필요한
   사설망 범위에만 허용하고 공용망/WAN 포트포워딩은 하지 않는다. DB는 계속 loopback에 둔다.

```sh
docker compose -f compose.yaml -f compose.rfid.yaml up --build
```

5. Arduino의 로컬 비밀 파일을 설정해 업로드한다. `SECRET_API_HOST`는 PC 주소이며 Arduino의
   localhost나 Docker 서비스명은 아니다. 예제의 HTTP opt-in과 서버 opt-in 모두 필요하다.
6. 등록 화면에서 리더기 상태를 조회해 태그 UID를 선택하고 앱의 카드 ID에 연결한다. UID의 공백·
   콜론·하이픈은 제거하고 대문자 16진수로 정규화한다. UID는 4/7/10바이트만 허용한다.
7. 아동 계정에서 **그림으로 말하기 → RFID 상태 열기 → 장치 선택**. 배열을 확인해 문장에 적용하고
   기존 문장 생성/확인/TTS를 사용한다. 학습이나 등록 스캔은 문장 이력에 넣지 않는다.

운영은 HTTPS가 기본이다. `RFID_ALLOW_INSECURE_LAN` 기본값은 false이며 개발 override에서만 true다.
기기 키는 계정 로그인/개인 카드 열람 권한이 아니며 해당 장치의 세션/스냅샷 제출에만 사용한다.
UID를 인증 비밀로 사용하지 않는다. 실제 인터넷 운영의 인증서 배포·네트워크 제한·키 보관/회전과
하드웨어 신뢰성 승인은 별도다. [WiFiS3 공식 예제](https://github.com/arduino/ArduinoCore-renesas/tree/main/libraries/WiFiS3/examples)를 참고한다.

## API 계약

아래 경로 앞에는 `/api`가 붙는다. 웹 API는 기존 Bearer 세션을 사용한다.

| 메서드·경로 | 권한 / 동작 |
|---|---|
| GET /rfid/devices?user_id=… | 본인 또는 board_manage 연결, 키 제외 장치 목록 |
| POST /rfid/devices?user_id=… | board_manage 보호자/담당자, device_id·name, 최초 키 응답 |
| PUT /rfid/devices/{id}?user_id=… | board_manage, expected_revision과 configure/rotate_key/revoke |
| GET /rfid/devices/{id}/state?user_id=… | 본인/board_manage. 원시 UID는 cards_manage도 있는 지원 계정만 조회 |
| GET /rfid/cards?user_id=… | cards_manage, 대상에게 제공되는 카드의 id·label |
| GET /rfid/bindings?user_id=… | cards_manage 지원 계정, uid·card_id·revision |
| PUT /rfid/bindings?user_id=… | cards_manage 지원 계정, uid·card_id·expected_revision. card_id=null이면 해제 |
| POST /rfid/devices/{id}/session | X-Device-Key + HTTPS/개발 opt-in, 새 세션과 X-RFID-Session 응답 헤더 |
| POST /rfid/devices/{id}/snapshot | X-Device-Key + 같은 세션, 아래 전체 스냅샷 |

```json
{
  "protocol_version": 1,
  "session_id": "00000000-0000-4000-8000-000000000001",
  "event_id": 1,
  "readers": [
    {"reader_id": 1, "status": "PRESENT", "uid": "01020304"},
    {"reader_id": 2, "status": "EMPTY", "uid": null},
    {"reader_id": 3, "status": "ERROR", "uid": null}
  ]
}
```

JSON의 UUID/UID는 합성 예시다. 기기의 실제 세션은 서버 발급 값을 사용한다.
PRESENT/EMPTY/ERROR와 위치 1·2·3 전체가 필수이며 추가 소유자 필드·지원하지 않는 버전·중복 위치·
여러 위치의 동일 UID를 거절한다. 순서는 서버에서 reader_id로 정렬한다. 미등록 태그는 UNMAPPED,
매핑 카드가 삭제/비활성화되면 UNAVAILABLE, 수신 중단은 STALE로 웹에 표시한다.
한 아동당 장치 8개·매핑 200개 한도다. 장치 이름/리더기 위치 이름은 revision 조건부로 변경하며,
태그는 하나의 아동 안에서 한 UID당 한 카드에 연결한다. 다른 UID를 같은 개념에 연결하는 것은 허용한다.
서버는 등록/수정 잠금 안에서 동의·연결 권한을 다시 검사하고 개인정보 삭제와 같은 경계를 사용한다.

## 개인정보·보존·장애

`rfid_devices`에는 장치 설정/키 해시/현재 스냅샷만, `rfid_bindings`에는 아동별 매핑을 저장한다.
이벤트별 원시 이력 컬렉션은 만들지 않는다. 등록·변경 감사에는 원시 UID/키를 넣지 않는다.
기존 스키마 버전·로컬 BSON 백업 대상에 포함하며 개인정보 JSON에는 키 해시를 제외한다.
개인정보 삭제는 두 컬렉션을 삭제해 옛 키/재전송으로 되살리지 못하게 한다. 기존 백업 보존 한계는 유지하며
복원 후 하드웨어 재개 전 키를 재발급해야 한다.

동의 철회는 장치를 비활성화하고 세션/현재 UID를 지운다. 다시 동의해도 장치를 자동 활성화하지 않으며
보호자가 키 재발급으로 재개한다. 동의가 없으면 **기본 화면 말하기는 유지**하지만 서버에 UID를 쓰는
Wi-Fi 수신은 차단한다. 이전 USB 설계의 메모리 전용 무동의 RFID 입력을 구현한 것으로 취급하지 않는다.
보존 기간 변경 시 기간 밖의 최신 상태를 비운다. 장치 설정/매핑은 명시 해제 또는 개인정보 삭제까지 유지한다.
오프라인에서는 새 RFID 배열을 받지 못한다. 웹 요청 실패 시 적용을 막고 기존 선택 문장과 기본 발화를 보존한다.

장치/매핑 변경·스냅샷 수신·동의 철회는 기존 `image-writes` 공유 잠금으로 직렬화해 삭제 뒤 데이터가
되살아나는 경쟁을 막는다. 다른 쓰기 중이면 409로 재시도하며 상태 조회/기본 말하기는 잠금을 기다리지 않는다.
작성 프로세스 강제 종료로 잠금이 남으면 [로컬 저장소의 잠금 복구 절차](LOCAL_IMAGE_STORAGE.md)를 따른다.
RFID 전송을 포함한 모든 작성자를 중단한 뒤 확인해야 하며 실행 중인 잠금을 임의 삭제하지 않는다.

## 검증 기록과 실제 기기 검수표

2026-10-27 최종 수정본의 `npm run verify:full`이 통과했다. 개별 결과와 초기 실패 원인을 함께 남긴다.

| 검사 | 확인된 결과 |
|---|---|
| 호스트 RFID 단위 | 백엔드 5개, Node 조합 3개, React 화면 4개 통과 |
| 호스트 백엔드 전체 | 395개 실행, 환경상 심볼릭 링크 검사 2개 제외, 나머지 통과 |
| 격리 Docker 백엔드 | 395개 통과 |
| 격리 MongoDB 통합 | 기존 검사 포함 93개 통과, 새 RFID 6개 포함 |
| 격리 프런트엔드 | Node 103개 + React 190개 = 293개, 빌드 통과 |
| 전체 브라우저 | Chromium 55개 통과, 새 RFID 1개 포함. 음성은 TTS 스텁으로 확인 |
| 실행기 정책/정리 | 28개 통과, 격리 스택/볼륨 정리 통과 |
| 사설망 실행 구성 | Compose 병합 결과 API 8000 개방·DB 27018 loopback 유지 확인 |
| R4 HTTP 컴파일 | 코어 1.6.0 / MFRC522 1.4.12 / CLI 1.5.1, 71,908바이트 Flash / 7,984바이트 RAM |
| R4 HTTPS 컴파일 | 같은 도구/라이브러리, 74,828바이트 Flash / 7,984바이트 RAM |

펌웨어 컴파일은 실제 소스와 동일한 복사본에 합성 Wi-Fi/키를 넣어 수행했다. 두 빌드 모두 종료 코드 0이다.
MFRC522의 **renesas_uno 아키텍처 미선언 경고**가 있으며, 컴파일은 전기적 호환·TLS 핸드셰이크·RF
동작을 검증하지 않는다. 보드 업로드와 실제 연결은 미실행이다.

최종 전체 검사는 **864개**이며 실행 결과는 `passed`, 전체 소요 618.3초다.
실제 소요와 단계별 종료 코드는 다음 로컬 보고서를 기준으로 한다.
`.local-validation/2026-10-27T06-13-50.768Z-ecc1f223967d455e80fc3dc9a29b0089/summary.json`.
이전 실패 실행은 최종 통과 결과로 덮어쓰지 않고 별도 디렉터리와 아래 이력으로 보존한다.

초기 실패/수정 이력:

- 첫 `verify:full`은 개인정보 저장 함수를 잠금 래퍼로 분리한 뒤 정적 스키마 검사 대상이 옛 함수에
  남아 실패했다. 검사 대상을 실제 쓰기 함수로 수정하고 새 RFID 쓰기도 포함했다.
- 같은 실행에서 기존 인증 만료 화면 테스트는 아직 사용되지 않은 Promise를 거절해 비처리 오류가
  발생했다. 지원 홈 준비와 실제 대기 요청 시작을 기다리도록 수정했다. 검증 조건/시간 제한은 유지한다.
- 후속 전체 실행에서 새 RFID E2E가 정확한 라벨 텍스트로 select를 찾지 못해 실패했다. 접근 가능한
  combobox 역할을 사용하고 문장 영역 범위도 수정했다. 로그인 뒤 합성 heartbeat를 보내 실제 장치와
  같은 생존 조건을 유지한다. STALE 제한을 늘리거나 검사를 제외하지 않았다.
- 조회 중 오프라인이 되면 화면 busy가 해제되지 않을 수 있어 세션 일치 검사와 온라인 검사를 분리했다.
  연결 복구 뒤 새로고침 가능한지 React 회귀 검사로 확인했다.

실행 상세 로그/HTML 보고서는 Git 제외 `.local-validation`에 저장한다. 자동 검사 실패를 실물 검수
완료로 바꾸지 않으며 아래 미실행 항목은 별도로 유지한다.

| 실물 항목 | 절차·기대 관찰 | 현재 상태 |
|---|---|---|
| 리더기 1개 | READER_COUNT=1, 서로 다른 태그를 대고 PRESENT/EMPTY/ERROR 확인 | 사용자의 이전 UID 읽기 성공만 확인, 새 펌웨어 미검수 |
| 리더기 2개 | COUNT=2, 각 위치의 서로 다른 태그·교차 감지·MISO 확인 | 미실행 |
| 리더기 3개 | COUNT=3, 다른 UID 3장 동시 배치 후 1→2→3 대응 | 미실행 |
| 유지/교체/제거 | 10초 유지 시 중복 문장 없음, 한 장 교체·제거·재제시. 타임아웃 오판 기록 | 미실행 |
| RF 간섭 | 동일 UID가 여러 위치에 감지되면 ERROR, 간격/전원/배선 조정 후 재확인 | 미실행 |
| Wi-Fi 단절 | AP 끄기→STALE, 재연결→새 세션→최신 전체 배열 | 미실행 |
| 서버/응답 실패 | 서버 중지/응답 유실 뒤 재시도, 중복/과거 세션이 상태를 되돌리지 않음 | 실물 미실행, API 자동 검사 대상 |
| 웹/TTS | 위치 표시·미등록 안내·명시 적용·기존 문장 확인·PC 스피커 재생 | 실제 기기 미실행, 브라우저 자동 검사는 합성 장치/TTS 스텁 |

예상 시리얼 출력 예시는 아래처럼 키/개인 UID 없이 상태를 보여 준다. 버전/순서는 실제 기기에 따라 다르다.

```text
Reader 1 version 0x82
RFID board initialized; actual presence/removal requires hardware verification
Reader 1: PRESENT
RFID session ready
Reader 1: EMPTY
Snapshot pending, HTTP 0
```

자동 검사·컴파일·사용자 단일 읽기 보고를 3개 리더기 실물 성공이나 현장/운영 배포 승인으로 표시하지 않는다.
