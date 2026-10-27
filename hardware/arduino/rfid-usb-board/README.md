# USB 카드 리더기

UNO R4 WiFi를 Windows PC의 Chrome/Edge에 USB로 연결한다. Wi-Fi 설정이나 장치 키가 필요 없다.
설치·브라우저 연결·태그 등록·장치 로그·실물 검수는 [USB 연동 안내](../../../docs/development/RFID_USB_INTEGRATION.md)를 따른다.

1. Arduino IDE에서 **UNO R4 WiFi**와 MFRC522 라이브러리를 준비한다.
2. 전압·배선을 확인하고 같은 폴더의 `rfid-usb-board.ino`를 연다. 기본은 리더기 1개다.
3. 업로드할 때는 웹 USB 연결과 시리얼 모니터를 닫는다. 포트는 현재 연결된 Arduino를 선택한다.
4. 업로드 뒤 웹 **그림으로 말하기 → USB 장치 연결**을 누른다. 브라우저에서 포트 선택이 필요하다.
5. 한 개를 검수한 뒤 스케치의 `RFID_READER_COUNT`를 2/3으로 늘려 순서대로 검수한다.

```sh
arduino-cli compile --fqbn arduino:renesas_uno:unor4wifi hardware/arduino/rfid-usb-board
```

115200bps·JSON Lines 프로토콜이며 카드 원시 UID는 브라우저 입력 스트림에 포함된다.
개인 UID가 들어간 시리얼 캡처를 저장소/공개 로그에 올리지 않는다. 웹/Docker 장치 로그는 UID를 숨긴다.
사용자의 기존 `UID:` 진단 스케치도 웹에서 지원하며, 유지·제거 판별의 한계는 연동 안내를 참고한다.
새 펌웨어의 실물 1/2/3개 동작은 아직 검수되지 않았다.
R4 대상 컴파일은 통과했지만 MFRC522의 renesas_uno 아키텍처 미선언 경고는 남아 있다.
