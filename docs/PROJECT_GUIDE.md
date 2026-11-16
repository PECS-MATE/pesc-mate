# PECS MATE 실행·사용·운영 안내

> 정리 기준: 2026-11-16. 프로젝트 소개와 기본 실행은 [README](../README.md),
> 커밋 작성은 [커밋 규칙](development/COMMIT_CONVENTION.md)을 따른다.

현재 사용하는 절차만 모았다. 날짜별 변경 내역과 완료된 작업 목록은 Git 이력에서 확인한다.

## 실행과 태블릿 접속

기본 실행은 Docker Desktop Linux 컨테이너와 Compose v2를 사용한다.
Compose 2.24.4 이상을 사용하며 실행 설정은 루트 `compose.yaml` 하나로 관리한다. 기본 음성 서버는 MeloTTS다.

```powershell
docker compose up -d --build
docker compose ps
```

| 대상 | 주소 |
| --- | --- |
| 웹 | `http://localhost:5173` |
| API 및 실제 요청 스키마 | `http://localhost:8000/docs` |
| 서버 상태 | `http://localhost:8000/api/health` |
| 호스트 개발용 MongoDB | `mongodb://127.0.0.1:27018/pesc_mate` |

Compose 내부 DB 주소는 `mongodb://mongodb:27017`이다.
기본 계정은 `demo`, `demo2`, `caregiver`, `support`, `admin`이며 비밀번호는 모두 `1234`다.
기존 계정의 비밀번호나 회수된 권한은 다시 초기화하지 않는다.
[환경변수 예제](env.example)는 필요한 선택 기능을 설정할 때만 루트의 `.env`로 복사한다.
`Copy-Item docs/env.example .env`를 사용하며 기존 `.env`를 덮어쓰지 않는다.

### PC 핫스팟과 iPad

1. Windows 설정의 모바일 핫스팟에서 Wi-Fi 공유를 켠다.
2. iPad를 PC가 만든 Wi-Fi에 연결한다.
3. 아래 태블릿 구성을 실행한다.
4. iPad 설정 → Wi-Fi → 연결한 네트워크의 ⓘ → IPv4 라우터 주소를 확인한다.
5. Safari에서 `http://라우터주소:5173`을 연다. 일반 공유기에서는 PC의 Wi-Fi IPv4를 쓴다.

```powershell
$env:TABLET_BIND_ADDRESS = "0.0.0.0"
docker compose up -d --build
```

iPad의 `localhost`는 PC 주소가 아니다. 태블릿 구성은 웹 포트만 LAN에 공개한다.
접속이 안 되면 같은 네트워크인지, PC에서 해당 주소가 열리는지, TCP 5173 방화벽 허용을 확인한다.
필요한 경우에만 관리자 PowerShell에서 다음 규칙을 추가한다. 기존 동일 규칙은 중복 생성하지 않는다.

```powershell
New-NetFirewallRule -DisplayName "PECS MATE 5173" -Direction Inbound -Protocol TCP -LocalPort 5173 -RemoteAddress LocalSubnet -Action Allow -Profile Any
```

두 iPad는 `demo`와 `demo2`로 나누어 로그인한다. PC에서 아동·보호자를 함께 시연할 때는
Chrome과 Edge처럼 브라우저를 나눈다. 같은 브라우저의 일반 탭은 로그인 저장소를 공유한다.
USB 태그 결과는 리더기를 연결한 PC에서 표시하며 다른 iPad에 실시간 복제하는 시연은 아니다.

태블릿 접속 주소는 `TABLET_BIND_ADDRESS`로 선택한다. 종료 시 `down`에 볼륨 삭제 옵션을 붙이지 않는다.

```powershell
docker compose down
```

### 개별 개발 실행

Python 3.12와 Node.js 22.13 이상 22.x·24.x 또는 26 이상을 사용한다.
루트에서 `docker compose up -d mongodb`로 DB를 실행한 뒤 터미널을 나눈다.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:MONGODB_URI = 'mongodb://127.0.0.1:27018'
$env:DEMO_ACCOUNTS_ENABLED = 'true'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --reload-dir app --no-access-log
```

```powershell
cd frontend
npm ci
npm run dev
```

웹의 `/api`는 기본적으로 `http://127.0.0.1:8000`으로 프록시된다.
데모 계정 생성은 로컬 시연용이며 실제 운영에서 켜지 않는다.

## 화면과 카드 사용

| 사용자 | 주요 흐름 |
| --- | --- |
| AAC 사용자 | 홈 빠른 표현 → 말하기 또는 연습하기, 프로필 메뉴에서 접근·음성 설정 |
| 보호자 | 연결 아동 선택 → 카드·카드판·음성·학습 설정·기록 관리 |
| 지원 담당자 | 부여된 연결·기능 권한으로 지원, 기본 카드 전체 인쇄 |
| 공용 콘텐츠 운영자 | 공용 카드·카테고리·공유 카드판 검토와 공용 RFID 등록 |

### 말하기와 카드 제작

- 기본 카드 120종을 카테고리·폴더·검색·즐겨찾기로 찾는다. 최대 12장으로 문장을 구성한다.
- 개인 카드는 보호자가, 공용 카드는 운영 권한 담당자가 등록한다.
- 실물 카드 사진에서 여러 영역과 글자를 추출한 뒤 이미지·이름을 확인하고 선택 저장한다.
- 글자만 있는 카드도 등록할 수 있다. 개인 사진의 원본과 화면용 이미지는 구분해 저장한다.
- 이미지 생성·배경 제거는 선택 기능이다. 외부 공급자·전송·비용을 확인한 뒤 결과를 적용한다.
  Hugging Face/Gemini 공급자 설정과 rembg 모델 준비는 기본 실행에 포함되지 않는다.
- 공용 기본 카드판 14개를 복사해 편집하거나 개인 A4 카드판을 제작하고 공유 검토를 요청한다.
- A4 편집기에서 칸 이름·그림 크기·배치·방향·행/열·양면을 조정한다.
- 기본 카드 전체 인쇄는 이미지가 내장된 HTML을 내려받아 브라우저에서 인쇄/PDF 저장한다.
  한 장 배치는 10열×12행, 4cm 카드는 A4 5쪽이며 개인 사진은 포함하지 않는다.

핵심 카드 잠금은 보호자·담당자가 저장된 슬롯의 카드를 직접 선택해 적용한다.
잠긴 카드의 이동·제외·개인 사진 교체는 제한되지만 선택·문장 생성·발화는 유지된다.
카드판 수정은 revision으로 충돌을 감지하므로 409 발생 시 최신 자료를 다시 읽는다.

### 연습과 기록

단어·그림 맞추기, 소리 듣고 카드 찾기, 카드 순서로 문장 만들기, 상황별 카드 고르기를 제공한다.
보호자가 카드 세트와 30일 일일 코스를 정하고, 완료 기록을 바탕으로 복습을 제안할 수 있다.
의사소통 기록과 학습 기록은 별도로 조회한다. 학습 추천은 보호자 확인을 거치며 진단 결과가 아니다.
기록 저장에 동의하지 않아도 새 이력을 남기지 않는 기본 말하기와 연습은 사용할 수 있다.
카드·글자 크기, 고대비, 동작 줄이기, 키보드 조작을 지원한다.

## 음성과 문장 생성

### 기본 카드·긴급 표현 아이 음성 미리 만들기

프로젝트 루트 PowerShell에서 실행한다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-card-speech.ps1
```

기존 Qwen 컨테이너와 선택된 여자아이·남자아이 참조 음성을 사용한다.
생성 중 Melo를 잠시 중지했다면 정상 종료·실패·Ctrl+C 때 명령 실행 전 상태로 복원한다.
같은 명령으로 검증된 파일을 재사용해 이어서 생성한다. 모델 다운로드나 이미지 빌드는 하지 않는다.
사전 점검은 `-CheckOnly`, 실행 기한 변경은 `-MaxMinutes 240`처럼 지정한다.

- 기본 카드 120종을 두 음색으로 합성해 총 240개를 준비한다. 긴급·복구 표현도 포함한다.
- 중간 파일은 `.local-validation/card-speech-assets/v2/`에 보관한다.
- 전체 검증이 끝나야 `frontend/public/audio/core/v2/`와 manifest를 게시한다.
- 생성 파일은 Git에서 제외되므로 새 PC에서는 다시 준비해야 한다.
- 완료 후 새로고침하면 선택 음색의 저장 파일을 우선 사용한다. 그 전에는 기존 재생 경로를 유지한다.
- 파일은 원본 1.0배이며 재생 시 개인 속도·볼륨을 적용한다. 새 문장·개인 카드는 서버 합성을 사용한다.

재개용 파일과 `.local-validation/card-speech-run.json`은 생성 진행 확인에 사용하므로 보존한다.
전체 음성 묶음의 생성 완료 여부와 실제 청음·iPad 재생 확인은 구분한다.

#### 생성 중 음성 검사 (2026-11-16)

생성 프로세스를 중단하지 않고 당시 완성된 182개(여자아이 120·남자아이 62)를 확인했다.
두 음색이 모두 준비된 62쌍에서 동일 파일은 없었다.
WAV·생성 참조 지문·실제 파형 모두 정상이며 24kHz·모노·16비트, 길이는 0.48~2.88초다.
무음, -45dBFS 미만 RMS와 0.1% 초과 클리핑은 없었다.

- 별도 Chrome에서 182개 모두 디코딩 성공. 실제 재생 모듈로 두 음색 각 62개 캐시 준비 성공.
- 긴급 표현 6건과 오프라인 복원 2건의 재생 진행·종료 확인. 스피커는 음소거했다.
- 첫 무입력 재생은 브라우저 자동 재생 제한으로 실패했다. 실제 사용자 클릭 입력 후 8건 통과.
- Node 캐시 검사 7건과 기존 프런트엔드의 게시·재생 검사 10건 통과.
- 검사 당시 전체 manifest는 아직 미게시였고 기존 음성 대체 경로도 정상 동작했다.
  240개 완성과 게시 이후의 전체 서비스 카드 클릭·실제 iPad·스피커·발음/음색 청음은 미실행이다.
- 원본 파일·생성 체크포인트·서비스 배포는 변경하지 않았고 빌드·추가 합성도 하지 않았다.
- 읽기 전용 검증 결과와 직접 청음 페이지는 `.local-validation/card-speech-check/`에 보관했다.

### 선택형 Qwen 음성

기본 실행은 MeloTTS다. Qwen은 같은 파일의 `qwen` 프로필에서 선택 실행한다. Qwen을 사용하려면 VoiceDesign으로 두 합성 음색을 준비한다.
실존 아동의 녹음을 업로드하는 절차가 아니다. 최초 모델 다운로드와 시안 생성은 시간이 걸린다.
시안 생성 중 다른 음성 서버를 함께 실행하지 않는다.

```powershell
docker compose run --rm --build voice-design --text "물 주세요. 도와주세요. 잠깐만요."
docker compose run --rm voice-design --description-file /app/voice-description-boy.txt --text "물 주세요. 도와주세요. 잠깐만요."
```

출력된 `.local-voice-design/audition-.../sample.wav`를 직접 듣고 선택한다.
다음 ID를 실제 생성 폴더로 바꾼다. 기본 모드를 먼저 중지한 뒤 `frontend-qwen`을 명시해 실행한다.
이 대상의 의존성인 MongoDB·Qwen 서버·Qwen용 backend만 함께 시작한다.
`--profile qwen up`만 실행하면 기본 서비스까지 시작되므로 아래 대상 지정 명령을 사용한다.

```powershell
$env:QWEN_REFERENCE_DIR = './.local-voice-design/audition-여자아이ID'
$env:QWEN_BOY_REFERENCE_DIR = './.local-voice-design/audition-남자아이ID'
$env:QWEN_CACHE_VERSION = 'qwen-선택한두음색-v1'
docker compose stop frontend backend melotts
docker compose --profile qwen up -d --build frontend-qwen
```

Qwen 중지는 `docker compose stop frontend-qwen backend-qwen qwen-tts`다.
Melo로 돌아갈 때는 Qwen 서비스를 중지하고 `docker compose up -d`로 실행한다.
태블릿은 같은 `TABLET_BIND_ADDRESS`를 사용하며 이후 재시작에도 Qwen 대상 명령을 유지한다.
선택 음색은 여자아이·남자아이 두 종류이며 기본 속도는 0.90배다. 기존 개인 설정을 덮어쓰지 않는다.
참조를 바꾸면 캐시 버전도 바꾼다. `.local-voice-design/`은 합성에 필요한 원본이므로 삭제하지 않는다.

| 음성 저장 범위 | 기준 |
| --- | --- |
| 게시된 기본 카드 파일 | 정적 파일 및 선택 음색의 기기 IndexedDB |
| 브라우저 세션 캐시 | 30분·128개/64MiB, 새로고침·세션 변경 시 소멸 |
| backend 개인 음성 메모리 | 계정별 키, 30분·전체 256개/64MiB, 재시작 시 소멸 |
| Qwen 기본 카드 영속 캐시 | 공개 기본 label만, 생성 후 7일·512개/128MiB, Docker 볼륨 유지 시 재사용 |

공급자·음색·속도·참조 버전을 구분한다. 개인 문장·개인 카드 음성은 별도 디스크에 추가 보관하지 않는다.
만료된 영속 캐시는 조회·저장 시 정리하며 주기 삭제 작업은 아니다.

### 문장 생성

호스트 Ollama의 `qwen2.5:0.5b`를 선택적으로 사용한다.
Compose에서는 `host.docker.internal:11434`, 개별 실행에서는 `OLLAMA_ENABLED=true`,
`OLLAMA_BASE_URL=http://127.0.0.1:11434`, `OLLAMA_MODEL=qwen2.5:0.5b`로 연결한다.

```powershell
ollama pull qwen2.5:0.5b
```

선택 카드의 대상·행동·감정·부정을 보존한 짧고 쉬운 존댓말 한 문장을 만든다.
선택하지 않은 사람·장소·원인·주어를 추론하지 않는다. 모델 실패 시 규칙 기반 문장으로 대체한다.
같은 계정의 최근 5분·32건 중 동일 순서·카드 정보·정책·모델의 검증된 AI 문장은 재사용할 수 있다.
명시적 재생성은 모델을 다시 호출한다. 새 추론 시간과 재사용 처리 시간을 같은 성능 수치로 보지 않는다.
정책 버전은 `aac-ko-v1`, `sentence-output-v2`, `ko-particle-v6`, `sentence-safety-v1`,
프롬프트는 `sentence-prompt-v4`이며 기존 버전의 의미를 소급 변경하지 않는다.

## RFID 연결

### USB 리더기

펌웨어: [rfid-usb-board.ino](../hardware/arduino/rfid-usb-board/rfid-usb-board.ino).
PC Chrome/Edge의 Web Serial로 Arduino UNO R4 WiFi에 연결한다. iPad의 직접 USB 연결은 아니다.

1. Arduino IDE에 UNO R4 WiFi 보드와 MFRC522 라이브러리를 준비한다.
2. 기본 리더기 2개의 SS/RST는 각각 D10/D9, D8/D6이며 SPI 버스와 GND를 공유한다.
3. 웹 USB 연결·시리얼 모니터를 닫고 펌웨어를 업로드한다.
4. 업로드 후 웹의 기기 연결에서 Arduino 포트 하나를 선택한다.
5. 공용 태그는 운영 권한으로, 개인 태그는 연결 아동 범위에서 표현에 매핑한다.

115200bps·JSON Lines를 사용한다. 기존 `UID:` 진단 입력도 지원하지만 유지·제거 판별에 한계가 있다.
리더기 진단 스케치는 [card_reader_test.ino](../hardware/arduino/card-reader-test/card_reader_test.ino)다.
RC522 전압·레벨 변환·공유 SPI 배선은 실제 보드와 확인한 뒤 연결한다.

순차 태그는 감지 순서를 유지한다. 서로 다른 리더기의 새 입력이 150ms 안에 들어오면
한 묶음으로 처리하고 리더기 번호순으로 정렬한다. 등록된 카드 두 장 이상의 동시 입력은
문장 생성·자동 발화로 이어지고 단일 태그는 문장판만 갱신한다.
유지 중인 카드는 중복 추가하지 않으며 제거해도 이미 만든 문장은 지우지 않는다.
연결·계정 변경과 수동 문장 편집 시 이전 입력·생성 응답은 취소한다.
소프트웨어는 리더기 1~3개를 지원하며 기본 펌웨어의 배선은 2개다.
원시 UID가 포함된 시리얼 캡처는 공개하지 않는다.

### 선택형 Wi-Fi 카드판

펌웨어: [rfid-wifi-board.ino](../hardware/arduino/rfid-wifi-board/rfid-wifi-board.ino).
세 위치의 전체 카드 스냅샷을 보내고 웹에서 명시적으로 적용하는 별도 경로다.
USB의 동시 입력 자동 발화 규칙과 혼용하지 않는다.

1. 보호자 RFID 카드판에서 아동·장치를 등록하고 장치 ID와 한 번 표시되는 키를 보관한다.
2. 같은 폴더의 `arduino_secrets.example.h`를 Git 제외 파일 `arduino_secrets.h`로 복사한다.
3. Wi-Fi·PC 서버 주소·장치 ID/키를 입력한다. 보드에서 `localhost`는 PC 주소가 아니다.
4. 기본 SS D10/D8/D7, RST D9/D6/D5와 공유 SPI를 사용한다. 1개부터 연결해 늘린다.

사설망 개발 HTTP는 `RFID_BIND_ADDRESS=0.0.0.0`, `RFID_ALLOW_INSECURE_LAN=true`와
펌웨어 `SECRET_ALLOW_INSECURE_LAN=1`을 설정한 뒤 선택한 앱 서비스를 재시작한다.
기본값은 PC 내부 바인딩과 비허용이며 USB 연결에는 이 설정이 필요하지 않다.
HTTPS는 유효한 서버 인증서·호스트와 `SECRET_USE_TLS=1`을 사용한다.
등록·세션·스냅샷 API는 `/api/rfid/devices` 아래에 있으며 장치는 별도 키로 인증한다.
실제 3개 리더기의 전압·간섭·제거·재태그·재연결은 최종 기기 확인이 필요하다.

## 전시 발표와 시연

실행 중인 웹 서버에서 `http://localhost:5173/promo-ipad.html`을 연다.
소개 → 제작 배경 → 말하기 시연 → 맞춤 카드 → RFID → 발전 과정 → 체험 안내의
7개 장면을 75초마다 무음으로 반복한다. 카드 이미지가 준비된 뒤 타이머가 시작된다.
설명과 아이패드의 카드 선택은 같은 시계로 동기화한다.

- 설정 숨기기 / 설정 표시 버튼으로 하단 조작 바를 접고 펼친다. Esc로도 다시 표시한다.
  바를 접어도 시연은 계속되며, 남은 공간에 맞춰 화면 크기를 조정한다.
- 전체 화면 → 전시·촬영 모드를 누르면 도구가 숨겨진다. Esc로 복원한다.
- 일시정지 후 재생은 같은 위치에서 이어간다. 장면 이름·이전·다음은 해당 장면에서 정지한다.
- Space는 재생·정지, 좌우 방향키는 장면 이동, Home은 첫 장면이다.
- 동작 줄이기 환경에서는 정지 상태로 시작한다.
- 아이패드만 버튼 또는 `/promo-ipad.html?view=tablet`은 11개 장면·28.6초 단독 시연이다.
- 실제 앱 조작은 기존 계정·서버로 전환한다. 자동 시연 예시는 계정·기록 API에 쓰지 않는다.
- 발표 화면은 1600×900, 아이패드 내부는 1194×886이며 창 크기에 맞춰 축소한다.
- 영상 자료는 전시·촬영 모드의 화면을 별도 도구로 녹화한다. MP4를 자동 생성하지 않는다.
- RFID 사진은 실제 배선 시제품과 리더기 배치 콘셉트를 구분한다. 학습지 제작은 향후 계획이다.

조작 바 접기 검증(2026-11-16): Node 테스트 5개, Chrome 5개 화면 크기의
단독 시연·접기·복원·촬영 배치 검사 30개, 실제 페이지 35개 장면 배치와
시연 제어 검사를 통과했다. 빌드와 컨테이너 재시작은 실행하지 않았다.

맞춤 카드 장면의 이미지는 야채 카드 보관함과 A4 카드판 편집기가 보이는
사용자 제공 스크린샷으로 교체했다(2026-11-16). 로컬 서버가 교체된 PNG와
동일한 파일을 제공하는지 SHA-256으로 확인했다. 빌드는 실행하지 않았다.

### 5분 현장 시연 순서

| 시간 | 보여줄 내용 |
| --- | --- |
| 0:00–0:30 | 실물 카드 관리의 불편과 서비스 소개 |
| 0:30–1:30 | iPad 1에서 빠른 표현, 나 → 물 → 마시다 선택과 문장·음성 |
| 1:30–2:00 | iPad 2의 별도 계정에서 독립적으로 카드 선택 |
| 2:00–3:00 | PC Chrome에서 USB 순차 태그와 두 리더기의 동시 입력 |
| 3:00–4:00 | PC Edge 보호자 화면의 카드 등록·A4 편집·인쇄 |
| 4:00–5:00 | 연습하기와 활용 설명, 마무리 |

발표 전에 로그인·권한·실제 음성·UID 매핑·인쇄본을 준비하고 시리얼 모니터를 닫는다.
네트워크·장치 문제가 있으면 준비한 시연 영상과 화면 캡처로 설명한다.

## 개인정보와 오프라인 동작

기록 저장은 동의·정책 버전·시각·보존 기간을 관리한다. 선택 기간은 30일·90일·1년·3년이다.
보존 기간 정리는 개인정보 설정 저장 시 수행하며 자동 주기 삭제 작업은 아니다.
저장 직전에 현재 동의 revision과 삭제 상태를 재확인한다. 철회는 403, 삭제·수정 충돌은 409다.

개인 카드와 공개 카드의 조회·검토 범위를 분리한다. 보호자·담당자는 현재 연결과 기능 권한이
허용한 아동만 열람한다. 연결 해제 즉시 기록·프로필·메모 접근을 중단한다.
개인 연습 추천은 별도 기본 꺼짐이며 `records_read`와 `learning_manage`가 필요하다.

내보내기 JSON에는 계정 정보·이력·개인 카드 메타데이터·지원 연결을 포함하며 비밀번호 해시·
인증 토큰·이미지 바이너리는 제외한다. 이용 데이터 삭제는 개인 카드·기록·메모·연결·프로필·
설정을 정리하고 로그인 계정과 최소 삭제 완료 기록을 유지한다.
DB 백업과 다른 기기에 남은 자료까지 자동 삭제된 것으로 보지 않는다.

AAC 사용자 기기에서는 미리 준비한 그림·음성·설정과 대기 기록을 사용할 수 있다.
보호자·담당자의 연결 아동 자료는 오프라인 조회용으로 저장하지 않으며 재연결 뒤 권한을 다시 확인한다.
음성은 저장 파일·캐시·서버 합성·지원 가능한 한국어 기기 음성 경로를 사용하지만 같은 음색을 보장하지 않는다.
오프라인 대기 기록은 같은 UUID로 재전송해 중복 집계를 막는다.
기기 확인 시 비행기 모드 재시작·긴급 표현·개인 카드·학습 재개와 재연결 후 한 번만 집계를 확인한다.

## API와 운영

### 인증·오류·권한

실행 서버의 `/docs`와 `/openapi.json`을 API 스키마 기준으로 사용한다.
인증 세션은 `Authorization: Bearer {access_token}`을 사용하며 요청 ID로 오류를 대조한다.
401은 로그인, 403은 역할·연결·동의, 409는 revision·중복 충돌, 422는 입력,
503은 저장소 등 필수 의존성을 우선 확인한다. 저장 결과가 불명확하면 재전송 전에 최신 상태를 조회한다.

공용 콘텐츠의 `content_manage`와 권한 관리 책임자는 별개다.
책임자는 `ACCOUNT_PERMISSION_MANAGER_IDS`에 지정한 기존 담당자 계정 ID이며 기본은 비어 있다.
콘텐츠 운영 권한으로 개인 기록 열람 권한이 생기지 않는다.
운영 권한 변경은 비밀번호 재확인·변경 사유·짧은 확인 세션과 감사 이력을 사용한다.

`GET /api/admin/metrics`는 운영 권한으로 조회하는 현재 프로세스의 15분 메모리 집계다.
API 응답 시간·음성 시작 지연·오프라인 동기화는 서로 다른 지표이며 요청 성공을 소리 출력 성공으로 세지 않는다.
사용자 ID·원문·토큰·이미지 경로를 지표나 공개 로그에 남기지 않는다.

### 상태 확인과 장애 대응

```powershell
docker compose ps
docker compose logs --tail 100 backend frontend
curl.exe --silent --show-error --max-time 8 http://127.0.0.1:8000/api/health
```

문제가 생기면 사용 중 문장·기기 대기열·DB·볼륨·사이트 데이터를 먼저 지우지 않는다.
핵심 의사소통을 유지할 수 있는 그림·텍스트·준비된 음성/실물 카드로 전환한다.
요청 ID·발생 시각·배포 커밋·영향 범위로 원인을 대조한다. 개인 내용은 공유 로그에서 제외한다.
공통 쓰기 잠금이 남았을 때는 모든 writer 중단과 실제 프로세스 종료를 확인하고 정확한 잠금만 복구한다.
임의 잠금 전체 삭제나 schema_version 제거를 복구 방법으로 사용하지 않는다.

### DB 백업과 마이그레이션

현재 백업 CLI는 기본 로컬 Compose MongoDB 전용이다. `.env`, 브라우저 기기 저장소,
외부 모델과 Docker 볼륨 전체는 DB 백업에 포함되지 않는다.
실제 적용 전 모든 writer를 중단하고 백업을 새 DB에 격리 복원해 확인한다.
백업은 개인정보를 포함하며 gzip 압축은 암호화가 아니다.

```powershell
$migrationDb = '<대상 DB 이름>'
python backend/app/mongo_backup.py create --database $migrationDb
python backend/app/mongo_backup.py create --database $migrationDb --apply --confirm-database $migrationDb --writers-stopped
$migrationBackupRef = '<반환된 backup_id>'
python backend/app/mongo_backup.py inspect --backup-id $migrationBackupRef
$restoreDb = 'pesc_mate_restore_' + [guid]::NewGuid().ToString('N')
python backend/app/mongo_backup.py restore --backup-id $migrationBackupRef --target-database $restoreDb
python backend/app/mongo_backup.py restore --backup-id $migrationBackupRef --target-database $restoreDb --apply --confirm-database $restoreDb
```

`restore_verified`와 검증 영수증을 확인한 뒤 마이그레이션에 같은 백업 참조를 전달한다.
마이그레이션 CLI가 백업 파일·영수증까지 자동 검증하지는 않는다.

```powershell
docker compose run --rm --no-deps backend python -m app.migrations --database $migrationDb --dry-run
docker compose run --rm --no-deps backend python -m app.migrations --database $migrationDb --apply --confirm-database $migrationDb --writers-stopped --backup-ref $migrationBackupRef
```

실패한 원본 DB와 부분 복원 대상은 보존한다. TTL 삭제가 지문을 바꾸면 성공으로 간주하지 않는다.
복원 도구가 서비스 DB 설정을 자동 전환하지 않으므로 검증 후 별도로 연결을 전환한다.

### 선택형 인증 DB와 감사

`secure` 프로필은 기본 앱과 분리된 인증 DB·API 서비스를 같은 파일에 정의한다.
별도 `mongodb_secure_data` 볼륨을 사용하며 기존 개발 DB를 자동 이전하지 않는다.
앱 계정은 해당 DB의 `readWrite`, 초기 관리 계정은 별도이며 backend는 root 비밀번호를 받지 않는다.
비밀 디렉터리에 `mongodb_root_username`, `mongodb_root_password`,
`mongodb_app_username`, `mongodb_app_password` 네 파일을 준비한다.
사용자명은 영문 시작 3~64자, 비밀번호는 공백 없는 ASCII 가시 문자 32~256자이며
앱/관리 계정과 비밀번호를 분리한다. 관리용 파일에는 BOM·CR/LF를 넣지 않는다.

```powershell
$env:PESC_SECURE_SECRETS_DIR = '<비밀 파일 디렉터리 절대 경로>'
$env:SECURE_MONGODB_DATABASE = '<새 앱 DB 이름>'
docker compose --profile secure up -d --build --wait backend-secure
```

`backend-secure`와 `mongodb-secure`만 시작되며 일반 앱·Melo·데모 계정은 시작하지 않는다.
중지는 `docker compose stop backend-secure mongodb-secure`다.
기존 `pesc-mate-secure_mongodb_secure_data` 볼륨을 그대로 사용하고 네트워크는 앱 DB와 분리한다.
API 기본 포트는 loopback 8001이며 웹·HTTPS 게이트웨이가 포함된 운영 전체 구성이 아니다.
감사 서명·검증·보관 정리는 backend의 `python -m app.audit`로 명시 실행한다.
감사 키·출력은 저장소 밖 승인된 위치에 보관하며 개인정보 삭제는 과거 지문과 달라질 수 있다.
`seal`, `verify`, `retain`을 구분하고 보관 정리의 실제 적용은 DB 확인·writer 중단·
복원 확인된 백업 참조·감사 기준선이 필요하다. 기간은 승인된 30·90·365·1095일 중 명시한다.

## 개발 기준과 확인 범위

기존 React/Vite·FastAPI 구조를 유지한다. 카드 자료는 `frontend/src/assets/cards/`,
공개 기본 카탈로그는 backend가 관리한다. 그림 파일 수와 실제 카드 수는 같다고 가정하지 않는다.
아이콘은 로컬 `UiIcon`과 Google Material Symbols Outlined를 사용하고 버튼에 접근 가능한 이름을 제공한다.
[공식 아이콘 원본](https://github.com/google/material-design-icons/tree/10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7/symbols/web)의
path를 추출했으며 [Apache 2.0 원문](../frontend/src/assets/material-symbols-LICENSE.txt)을 보존한다.

필요한 개발 검사 명령은 다음과 같다. 실제 MongoDB 검사는 별도 시험 DB를 사용한다.

```powershell
npm --prefix frontend test -- --run
python -m pytest backend/tests
python backend/tools/check_refactor_mutations.py
node --test scripts/check-promo-presentation.test.mjs
node scripts/check-promo-layout.mjs --live
```

현재 문서는 실제 기기 검사나 배포 승인 완료를 의미하지 않는다.
iPad 음성·오프라인 재시작, 실제 1/2/3개 RFID 입력, OCR 사진·인쇄 크기,
로그인 후 보호자 전체 흐름과 음성 묶음의 청음은 해당 환경에서 확인해야 한다.
날짜별 검사 수치·실패·중단 이력은 해당 기능 커밋의 본문과 Git의 이전 문서에서 확인한다.

### 문서 정리 확인

실행·기능·정책·운영 설명을 이 문서로 통합하고, 사용자 승인에 따라 기존 문서 34개를 삭제했다.
중복 목차·완료 TODO·과거 작업 대장과 임시 검증 폴더 3개·기타 임시 파일 약 1.1GB를 정리했다.
프로젝트 README와 커밋 규칙은 유지한다. 소스·배포·하드웨어 펌웨어는 변경하지 않는다.
통합 당시 남긴 문서 4개의 로컬 경로·앵커 22개, 코드 블록 짝과 diff 공백 검사에 통과했다.
외부 URL 접속, 앱 테스트·빌드와 기기 검수는 이번 문서 정리 범위에서 실행하지 않는다.
`oma docs verify`는 CLI가 설치되지 않아 미실행이며 로컬 링크는 직접 검사했다.
처음 정리 시 프로세스 조회와 빈 백업 폴더 접근이 권한 오류로 중단되었고,
권한 있는 환경에서 사용 중인 프로세스가 없음을 확인한 뒤 임시 자료를 정리했다.
`.local-backups/`는 실제 데이터가 있어 삭제하지 않고 보존했다.


### 루트 파일 정리 (2026-11-16)

요청에 따라 루트의 `PECS-MATE-all-cards-A4.html`과 AI 작업 지침 `AGENTS.md`를 삭제했다.
환경변수 예제는 내용을 바꾸지 않고 `docs/env.example`로 이동하고 README의 복사 명령을 수정했다.
앱의 발표용 `frontend/public/promo-ipad.html`, 소스·실행 설정과 실제 `.env`는 유지한다.
예제 이동 전후 SHA-256과 커밋 원본의 내용 일치를 확인했다.
남은 Markdown 3개의 로컬 경로·앵커 24개, 코드 블록 짝과 diff 공백 검사에 통과했다.
Compose 설정 6개에 이전 예제 경로 참조가 없음을 확인했다.
이동에 따라 사용하지 않는 `.gitignore`의 루트 예제 예외도 제거했다.
앱 테스트·빌드·실제 인쇄는 이번 파일 정리에서 실행하지 않는다.


### Compose 단일 파일 통합 (2026-11-16)

루트 실행 YAML 6개를 `compose.yaml` 하나로 합쳤다. 기본 4개 서비스의 설정을 유지하고,
Qwen·음색 생성·인증 DB는 선택 프로필과 대상 서비스로 구분했다.
태블릿·RFID 포트 바인딩은 환경변수로 선택한다. 기존 DB·모델·공개 음성 캐시 볼륨 이름은 유지한다.
이 변경에서는 실행 중 컨테이너를 재시작하거나 DB·모델 볼륨을 변경하지 않는다.
검증 결과:

- 기존 파일과 통합 파일의 `docker compose config --format json` 비교 7개 항목 통과:
  기본 서비스 4개, 태블릿 바인딩, RFID 바인딩·허용 설정, Qwen 설정·의존성,
  음색 생성 설정·모델 볼륨, 인증 DB·권한·격리·기존 데이터 볼륨, 공개 음성 캐시 볼륨.
- 기본·qwen·voice-design·secure의 최종 `docker compose config --quiet` 4개 구성 통과.
  실제 컨테이너·모델·DB를 시작하지 않는 설정 검사다.
- 문서의 로컬 링크·앵커 24개, 코드 블록 짝, 이전 다중 파일 명령 제거와 diff 공백 검사 통과.
- Qwen은 `frontend-qwen`을 대상으로 지정해 기본 Melo 앱과 의존성을 분리한다.
  인증 DB는 `backend-secure` 대상으로 지정해 인증 DB/API만 실행한다.
- 실행·중지 명령과 환경변수 예제를 새 방식으로 수정했다.
- 실제 기동·전환·음성 합성·DB 접속·전체 앱 테스트·빌드는 미실행이다.
  외부 문서 URL의 자동 링크 검사는 미실행이며 로컬 참조를 직접 검사했다.


### 프런트엔드 설치 중 ECONNRESET (2026-11-16)

`npm ci`의 `ECONNRESET / network aborted`는 패키지 다운로드 연결이 중단된 오류다.
`whatwg-encoding` deprecated 경고와 npm 새 버전 안내는 이 실패의 원인이 아니다.
프런트엔드 `.npmrc`에서 네트워크 요청 재시도를 5회, 지수 증가 배수를 2로 설정했다.
재시도 대기는 10~60초, 개별 요청 제한은 기존 기본값과 같은 300초다.
Docker 설치 단계에 BuildKit npm 캐시와 `--prefer-offline --no-audit --no-fund`를 적용했다.
잠금 파일과 패키지 버전은 변경하지 않았으며 SSL 검증·registry 주소도 유지한다.

실패 후 프런트엔드만 다시 빌드·적용하려면 다음을 실행한다.

```powershell
docker compose build frontend
docker compose up -d --no-deps frontend
```

캐시를 지우는 `--no-cache`는 붙이지 않는다. 연결이 계속 끊기면 npm registry 접근과
Docker Desktop의 네트워크·프록시를 확인한다. 지속적인 연결 장애는 재시도 설정만으로 해결되지 않는다.

검증: 실제 npm 설정 5개 값 확인. 로컬 registry에서 연결을 두 번 강제 종료한 뒤
세 번째 요청 성공을 확인했다. 계속 종료하는 경우는 총 6회 요청 후 실패해 무한 재시도하지 않았다.
probe의 대기 시간만 100~200ms로 줄였으며 실제 설치 설정은 10~60초다.
`git diff --check` 통과. 실제 Docker 이미지 빌드·전체 `npm ci`·컨테이너 재시작과 앱 테스트는 미실행이다.
