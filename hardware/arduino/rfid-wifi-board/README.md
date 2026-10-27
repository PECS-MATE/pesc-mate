# 세 위치 Wi-Fi RFID 카드판

UNO R4 WiFi와 MFRC522 리더기 3개가 현재 카드 배열을 기존 PECS Mate 서버에 전송한다.
웹에서 배열을 명시적으로 적용한 뒤 기존 문장 생성·확인·TTS 버튼으로 말한다.
전체 배선 제안·권한·API·실물 검수표는 [연동 안내](../../../docs/development/RFID_WIFI_INTEGRATION.md)를 참고한다.

## 준비 및 실행

1. Arduino IDE에서 **Arduino UNO R4 WiFi** 보드와 **MFRC522** 라이브러리를 준비한다.
   WiFiS3는 보드 코어에 포함된다. 검증에 사용한 버전은 코어 1.6.0, MFRC522 1.4.12다.
2. 보호자 화면의 **RFID 카드판**에서 연결 아동과 장치를 등록한다. 장치 ID와 한 번 표시되는 키를 보관한다.
3. `arduino_secrets.example.h`를 같은 폴더의 `arduino_secrets.h`로 복사한다.
   Wi-Fi·서버 주소·장치 ID/키를 입력한다. 실제 비밀값은 커밋하지 않는다.
4. 신뢰하는 사설 LAN의 개발 HTTP는 서버를 다음처럼 시작하고
   `SECRET_ALLOW_INSECURE_LAN`도 `1`로 설정해야 한다.

   ```sh
   docker compose -f compose.yaml -f compose.rfid.yaml up --build
   ```

   서버 주소는 보드에서 접근 가능한 PC 사설 IPv4다. `localhost`가 아니다.
   Windows 방화벽의 사설 네트워크 수신 규칙도 확인한다. 인터넷에 포트를 공개하지 않는다.
   HTTPS는 유효한 서버 인증서·호스트와 `SECRET_USE_TLS=1`, 해당 포트를 사용한다.
5. 전원을 분리한 상태에서 연동 안내의 전압·레벨 변환·공통 GND·MISO 조건을 확인한다.
   `RFID_READER_COUNT=1`부터 업로드·진단하고 2개, 3개 순으로 늘린다.
   설정하지 않은 위치는 `ERROR`다. 실제 카드 UID는 보호자 화면에서 등록한다.

기본 SS는 D10/D8/D7, RST는 D9/D6/D5이며 SPI는 공유한다. 이 배선은 실물 미검수 제안이다.
라이브러리의 `renesas_uno` 아키텍처 미선언 경고가 있으므로 컴파일 통과만으로 동작을 보장하지 않는다.
시리얼 모니터는 115200bps다. `RFID_DEBUG_UIDS`는 기본 0이며 실제 UID를 저장소/공개 로그에 올리지 않는다.

CLI를 사용하는 경우 로컬 비밀 설정 파일을 만든 뒤 실행한다.

```sh
arduino-cli compile --fqbn arduino:renesas_uno:unor4wifi hardware/arduino/rfid-wifi-board
```

이 스케치는 순차 RF 폴링·현재 상태 스냅샷·재접속을 구현한다. 태그 제거 임계값·공유 MISO·안테나
간섭·TLS 연결과 실스피커 재생은 실제 환경에서 확인해야 한다. 자동 테스트의 TTS 스텁은 음질 검수가 아니다.
