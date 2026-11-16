# UNO R4 WiFi · RC522 리더 3개 배선표

대화에서 구성한 양방향 HV/LV 로직 레벨 컨버터 3개(A·B·C) 기준입니다.
컨버터의 전원 핀 `HV`·`LV`와 신호 핀 `HV1`·`LV1` 등을 구분합니다.
배선 변경 전 USB와 외부 전원을 분리합니다.

## 확인 상태

- 1번·2번: `STATUS test2` 진단에서 모두 `OK` 확인.
- 3번: 아래 구성으로 추가 연결 안내 완료. 3개 동시 진단 결과는 아직 미확인.

## 공통 전원

| UNO R4 WiFi | 연결 대상 |
|---|---|
| 3.3V | 컨버터 A·B·C의 LV 전원 핀 + RC522 1·2·3번의 3.3V |
| 5V | 컨버터 A·B·C의 HV 전원 핀 |
| GND | 컨버터 A·B·C의 GND + RC522 1·2·3번의 GND |

RC522 전원에는 5V를 연결하지 않습니다. 브레드보드 전원 레일과
가운데 홈 양쪽은 필요한 점퍼선으로 연결해야 합니다. 같은 전원 레일을
사용하더라도 중간 단절 여부를 확인합니다.

## 전체 신호 배선

표의 HV/LV는 물리적인 연결 쌍을 뜻합니다. MISO 신호는 RC522에서 UNO 방향입니다.

| UNO 핀 | 컨버터 | HV 쪽 채널 | LV 쪽 채널 | RC522 연결 대상 |
|---|---|---|---|---|
| D13 | A | HV1 | LV1 | 1·2·3번 SCK 공통 |
| D11 | A | HV2 | LV2 | 1·2·3번 MOSI 공통 |
| D10 | A | HV3 | LV3 | 1번 SDA/SS |
| D9 | A | HV4 | LV4 | 1번 RST |
| D12 | B | HV1 | LV1 | 1·2·3번 MISO 공통 |
| D8 | B | HV2 | LV2 | 2번 SDA/SS |
| D6 | B | HV3 | LV3 | 2번 RST |
| D7 | B | HV4 | LV4 | 3번 SDA/SS |
| D5 | C | HV1 | LV1 | 3번 RST |

컨버터 C의 2·3·4번 신호 채널과 모든 RC522의 IRQ는 연결하지 않습니다.
SCK·MOSI·MISO만 공유하며, 각 리더의 SDA/SS와 RST는 다른 리더와 묶지 않습니다.
RC522의 SDA 표기는 이 SPI 구성에서 SS 선택 핀을 뜻합니다.

## 리더별 연결 요약

| RC522 핀 | 1번 리더 | 2번 리더 | 3번 리더 |
|---|---|---|---|
| 3.3V | 공통 3.3V | 공통 3.3V | 공통 3.3V |
| GND | 공통 GND | 공통 GND | 공통 GND |
| SCK | A LV1 | A LV1 | A LV1 |
| MOSI | A LV2 | A LV2 | A LV2 |
| MISO | B LV1 | B LV1 | B LV1 |
| SDA/SS | A LV3 | B LV2 | B LV4 |
| RST | A LV4 | B LV3 | C LV1 |
| IRQ | 미연결 | 미연결 | 미연결 |

## 펌웨어 설정과 확인

프로젝트의 `hardware/arduino/rfid-usb-board/rfid-usb-board.ino` 기준:

```cpp
#define RFID_READER_COUNT 3
const byte SS_PINS[3] = {10, 8, 7}, RST_PINS[3] = {9, 6, 5};
```

업로드 후 시리얼 모니터를 **115200 baud / New Line**으로 설정하고 다음을 전송합니다.

```text
STATUS test3
```

`diagnostics`에서 1·2·3번 모두 `OK`인지 확인합니다.
`snapshot`의 `EMPTY`는 카드가 없는 정상 상태이며, `PRESENT`는 카드 감지 상태입니다.
실제 카드를 리더별로 대어 UID가 해당 reader_id에 표시되는지 확인합니다.
