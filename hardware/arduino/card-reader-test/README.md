# 두 리더기 진단 스케치

UNO R4 WiFi, MFRC522/SPI, 115200bps. 사용자 제공 2개 리더기 코드를 반영했다.

| 리더기 | SS | RST |
| --- | --- | --- |
| 1 | D10 | D9 |
| 2 | D8 | D6 |

SPI 버스를 공유하며 초기화 전 두 SS 핀을 HIGH로 만든다.
3초마다 각 리더기의 버전을 출력하고 두 리더기를 순서대로 검사한다.
원본 예시와 달리 웹에서 출처를 구분하도록 UID 줄에도 리더기 번호를 넣었다.

```text
Reader 1 Version: 0x92
Reader 1 TAG DETECTED!
Reader 1 UID: 01 02 03 04
Reader 2 TAG DETECTED!
Reader 2 UID: 05 06 07 08
```

위 UID는 설명용 값이다. 실제 UID 캡처나 개인 매핑은 공개 커밋하지 않는다.
기존 `UID:` 한 줄 출력도 웹에서 지원한다. 번호 없는 출력은 리더기 1로 취급한다.
진단 출력은 리더기별 800ms 중복 억제만 제공하며 카드 유지·제거를 알리지 않는다.
실사용은 [USB JSONL 스케치](../rfid-usb-board/README.md)를 권장한다.
두 스케치는 대안이며 보드에는 한 번에 하나만 업로드한다.

웹 **기기 연결**에서 Arduino 포트 하나를 선택하면 두 리더기의 입력을 함께 받는다.
업로드 전 웹 연결을 해제하고, 웹 연결 전 시리얼 모니터·플로터를 닫는다.
Arduino IDE에서 `.ino`를 열 때 폴더/스케치 이름 정리를 요구할 수 있다.
이번 변경의 Arduino 컴파일·업로드·실제 두 리더기/카드·웹 검수는 미실행이다.

[하드웨어 안내](../../README.md) · [USB 연동 안내](../../../docs/development/RFID_USB_INTEGRATION.md)
