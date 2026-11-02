# USB 카드 리더기

UNO R4 WiFi를 Windows PC의 Chrome/Edge에 USB로 연결한다. Wi-Fi 설정이나 장치 키가 필요 없다.
설치·브라우저 연결·태그 등록·장치 로그·실물 검수는 [USB 연동 안내](../../../docs/development/RFID_USB_INTEGRATION.md)를 따른다.

1. Arduino IDE에서 **UNO R4 WiFi**와 MFRC522 라이브러리를 준비한다.
2. 전압·배선을 확인하고 같은 폴더의 `rfid-usb-board.ino`를 연다. 기본은 리더기 2개다.
   리더기 1은 SS D10/RST D9, 리더기 2는 SS D8/RST D6이다. SPI 버스는 공유한다.
3. 업로드할 때는 웹 USB 연결과 시리얼 모니터를 닫는다. 포트는 현재 연결된 Arduino를 선택한다.
4. 업로드 뒤 웹 오른쪽 위 **기기 연결**을 누른다. Arduino 포트 하나를 선택하면 리더기 두 개를 함께 읽는다.
5. 두 리더기에 각각 카드를 대고 나의 문장에 추가되는지 확인한다. 같은 상태가 유지되면 재추가하지 않는다.
   동시에 새로 인식된 카드는 리더기 1 → 2 순서로 추가한다. 카드 제거는 이미 만든 문장을 지우지 않는다.

```sh
arduino-cli compile --fqbn arduino:renesas_uno:unor4wifi hardware/arduino/rfid-usb-board
```

115200bps·JSON Lines 프로토콜이며 카드 원시 UID는 브라우저 입력 스트림에 포함된다.
개인 UID가 들어간 시리얼 캡처를 저장소/공개 로그에 올리지 않는다. 웹/Docker 장치 로그는 UID를 숨긴다.
사용자의 기존 `UID:` 진단 스케치도 웹에서 지원하며, 유지·제거 판별의 한계는 연동 안내를 참고한다.
새 펌웨어의 실물 1/2/3개 동작은 아직 검수되지 않았다.
R4 대상 컴파일은 통과했지만 MFRC522의 renesas_uno 아키텍처 미선언 경고는 남아 있다.

2026-11-02 변경: 기본 2개 구성으로 변경했다. 위 컴파일 통과는 이전 버전 기록이며,
이번 변경의 Arduino 컴파일·업로드와 실물 2개 입력 검수는 미실행이다.
