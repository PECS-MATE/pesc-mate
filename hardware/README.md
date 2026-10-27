# 하드웨어 확장

Arduino 등 외부 기기의 코드와 배선·실행 안내를 웹 클라이언트·API와 분리해 보관한다.
현재 UNO R4 WiFi와 RC522 세 위치를 연결하는 펌웨어·API·웹 화면을 구현했다.
설정·배선 제안·프로토콜·검증 결과는 [Wi-Fi 카드판 연동 안내](../docs/development/RFID_WIFI_INTEGRATION.md)를 따른다.
실제 세 리더기의 전압·간섭·카드 제거·음성 출력 검수는 아직 완료하지 않았다.

## Arduino 카드 리더기

| 폴더 | 용도 |
|---|---|
| [rfid-wifi-board](arduino/rfid-wifi-board/README.md) | RC522 3개 → Wi-Fi → 기존 문장 생성·웹 TTS |
| [card-reader-test](arduino/card-reader-test/README.md) | 사용자가 추가한 단일 리더기 진단 스케치 보관 |

사용자 진단 파일 `hardware/arduino/card-reader-test/card_reader_test.ino`는 수정·이동하지 않았다.
단일 리더기의 사용자 UID 읽기 보고와 새 세 위치 펌웨어의 실물 성공은 구분한다.
Wi-Fi 비밀번호·장치 키는 각 스케치의 Git 제외 파일 `arduino_secrets.h`에만 작성한다.

## 작업 기록 — 2026-10-26

사용자 요청으로 폴더와 안내 문서만 생성한다. README로 폴더를 Git에 보관하며 빈 스케치나
동작하지 않는 예제 코드를 추가하지 않는다. 사용자 요청에 따라 추가 테스트는 실행하지 않는다.
Arduino 컴파일·업로드·실제 카드 인식·웹 연동·앱 테스트/빌드는 모두 **미실행**이다.

같은 날짜의 후속 계획 정리에서 보드와 시연 환경을 확정했다. 기존 기록은 폴더 준비 당시의
범위이며, 진단 스케치 확인을 컴파일·실제 카드 인식·웹 연동 성공으로 취급하지 않는다.
