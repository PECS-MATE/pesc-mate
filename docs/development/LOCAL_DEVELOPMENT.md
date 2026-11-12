# 로컬 개발과 시연

## 안정화 회귀 점검 — 2026-11-12

별도 MongoDB와 합성 계정으로 인증·개인정보·카드·학습을 검사하고, 실행 중인 웹의
공개 화면은 분리된 headless Edge 프로필로 확인했습니다. 기존 자동 테스트 도구는
다시 추가하지 않았으며 아래는 이번 실행의 범위이지 전체 플랫폼 검수 완료 선언이 아닙니다.

### 발견 및 수정

- 학습 코스 저장의 최초 권한 확인 이후 동의가 철회돼도 코스 revision 1과 설정 1건이
  저장되는 문제를 실제 MongoDB에서 재현했습니다(동의 False 상태).
- 코스 저장 전에 동의 revision을 보관하고 최종 쓰기·감사 저장을 삭제와 같은 잠금으로
  직렬화했습니다. 잠금 안에서 연결 권한도 다시 확인합니다. 일반 학습 설정 저장에도
  동의/삭제 보호를 적용했습니다. 동의가 없는 기본 카드 조회·말하기는 계속 허용합니다.
- 동의 철회 403, 삭제 후 재동의한 이전 요청 409, 저장 직전 연결 해제 403,
  코스 revision 충돌 409 및 일반 설정의 삭제 잠금 충돌 409를 재검증했습니다.
  거부된 경합 요청은 코스/감사를 새로 만들지 않았습니다.

### 통과한 검사

| 범위 | 확인 내용 |
| --- | --- |
| 격리 MongoDB | 보호자 실제 카드 세트 코스 저장 → 아동 조회 → 학습 완료/성취 → 완료 시각 조회 |
| 기록과 삭제 | 문장 생성 중 삭제/재동의 후 지연 저장 409·기록 0건, 새 요청 정상 저장, 학습 결과 재전송 멱등성 |
| 카드 | 두 운영자 동시 승인/반려 중 1건 성공·1건 409·감사 1건, 다른 아동 개인 카드와 초안 비노출 |
| 인증 | 가입 설정 실패 후 재개, 미완료 계정 로그인 거부, 잘못된 비밀번호, 세션 조회/로그아웃, 재가입 재시도로 철회 동의 복원 불가 |
| 격리 HTTP | 실제 가입/로그인·카드 120종/no-store·다른 계정 403·잘못된 입력 422·문장 생성·동의 철회 후 403/기본 카드 200·로그아웃 204/재접근 401 |
| 음성 HTTP 계약 | 모의 PCM WAV로 두 음색과 기본 0.90배, no-store 확인(실제 모델 품질 검사는 아님) |
| 실제 Edge | 랜딩 390/768/1440px 가로 넘침 없음, 로그인 화면 전환, 검사 중 수집한 런타임 예외 없음 |
| 프런트 순수 로직 | A4 크기/양면 정렬·다른 아동 파일 거부, RFID 슬롯 순서/중복 개념 유지/오류 거부, 3종 상황·문장 순서 문제, 일일 코스·복습 계산, 음색/TTL/세션별 캐시 |
| 정적/빌드 | Python 70개 파일 AST·프런트 빌드·Compose 설정·backend 이미지 빌드/실행·diff 공백 검사 통과. 기존 500kB 초과 번들 경고 유지 |

첫 HTTP 검사는 검사용 응답 처리기가 204 빈 본문을 JSON으로 읽어 실패했습니다.
보조 코드를 고치고 새 격리 DB에서 전체 시나리오를 다시 실행해 통과했습니다. 앱 결함이나
최종 통과로 섞어 기록하지 않습니다. 실제 웹 health의 MongoDB/Ollama/Qwen ready도 확인했습니다.

임시 컨테이너 `pecsmate-stability-20261111`은 생성 ID를 대조한 후 합성 DB 볼륨과 함께
제거했고 분리 브라우저 프로필도 삭제했습니다. 이 검사용 데이터는 복구하지 않습니다.
실제 사용자 DB·카드 사진·음성 캐시는 삭제/변경하지 않았습니다. 임시 HTTP 서버도 종료했습니다.

### 미검증·남은 경계

- 로그인 후 전체 화면의 브라우저 회귀·실제 AAC 사용자 과업·iPad 음량/잠금 복귀·실물 리더기 3개는 별도 검수입니다.
- 실제 장기/다중 사용자 부하, 유료 이미지 생성·배경 제거, 인쇄물 크기·양면 급지 검수는 미실행입니다.
- 첫 CPU 음성 합성 지연과 이미지/번들 용량은 남아 있습니다. 이번에는 실제 TTS를 재합성하지 않았습니다.
- 코스 상태와 감사 저장은 단일 DB 트랜잭션이 아닙니다. 링크 재확인은 최종 쓰기 직전 보강이며
  권한 변경 전 과정을 트랜잭션으로 묶은 것은 아닙니다. 이미지 최적화·라우터 대규모 분리는 제외했습니다.

## 이미지 제외 안정화 결과 — 2026-11-10

개인정보 삭제/동의 revision과 기록 쓰기 잠금, 카드 상태 CAS, 가입 재시도,
카드 조회 범위/인덱스, 서버 TTS 준비 상태를 수정했습니다. 이미지 원본·용량·포맷은 변경하지 않았습니다.
`OfflineSpeechStatus.jsx`, `SituationBoardPicker.jsx`, `movedSlots()`는 현재 소스의 import/호출
검색에서 참조가 없어 제거했습니다. 기본 음성 캐시와 폴더 기반 상황 카드 탐색은 유지합니다.
보존 기간의 적용 시점은 기존 UI에도 ‘설정 저장 시 삭제’로 표시돼 있어 문서 설명만 보완했습니다.
대규모 App/라우터 분리는 이번 오류 수정에 포함하지 않았습니다.

검증은 기존 사용자 DB와 별도의 임시 MongoDB 컨테이너에서 합성 계정으로 수행했습니다.
동의/삭제/재동의 경쟁, 승인/반려·초안 제출/수정 경쟁, 가입 설정·세션 장애 재시도,
조회 권한·중복 이름·인덱스 계획 검사를 통과했습니다. 첫 카드 동시성 검사는 합성 fixture의
created_at 누락으로 실패했으며 보완 후 통과했습니다. 상세 결과는 각 정책/API/카드 문서를 따릅니다.
임시 DB를 연결한 HTTP 검사에서 가입 → 인증된 카드 조회/문장 생성 → 동의 철회 후 403,
비인증 카드 조회 401, TTS 미설정의 degraded/200을 확인했습니다. 모델 생성은 대역을 사용했습니다.

백엔드 app의 Python 66개 파일 AST, FastAPI import/OpenAPI 생성, 미사용 참조 재검색,
프론트 빌드를 통과했습니다. 기존 500kB 초과 JS 번들 경고는 남습니다.
초기 전체 diff 검사에서는 작업 전부터 있던 README 끝의 빈 줄을 지적했으며 임의 수정하지 않았습니다.
미사용 함수 삭제 후 staged 공백 검사에서도 파일 끝의 빈 줄 1개를 발견해 후속 정리했습니다.
실제 모델 장애 주입·브라우저 전체 회귀·iPad/RFID·접근성·운영 부하 검수는 미실행입니다.
실제 사용자 DB와 사진/기록은 이 검사에서 읽거나 변경하지 않았습니다.
최종 추가 검사에서 기록 저장이 잠금을 보유한 동안 삭제는 409로 거부되고,
저장 완료 후 삭제 재시도 시 기록 0건·잠금 해제를 실제 MongoDB에서 확인했습니다.
검사에 생성한 임시 컨테이너의 ID를 대조한 뒤 해당 컨테이너와 합성 DB 볼륨만 제거했습니다.
이 임시 데이터는 삭제되어 복구하지 않으며 실제 사용자 데이터는 대상이 아닙니다.

루트 [README](../../README.md)는 프로젝트 소개와 빠른 실행을 다룬다.
이 문서는 개별 실행·태블릿 연결·선택형 서비스와 개발 환경의 한계를 정리한다.
모든 명령의 시작 위치는 별도 표시가 없으면 저장소 루트다.

## Docker Compose

Qwen 두 음색을 사용할 때는 [현재 음성 실행 안내](SPEECH_AND_AI.md#현재-실행과-캐시)의 환경변수와
`compose.qwen.yaml`을 유지합니다. 아래 기본 Compose 명령은 MeloTTS 구성입니다.

Docker Desktop의 Linux 컨테이너와 Docker Compose v2를 사용한다.

```sh
docker compose up --build
```

웹은 `http://127.0.0.1:5173`, API 문서는 `http://127.0.0.1:8000/docs`다.
소스는 컨테이너에 연결되어 저장 시 자동 반영된다. 백엔드는 `backend/app`만 폴링 감시해
가상환경·테스트 캐시 감시를 피한다. 종료는 `docker compose down`이며 데이터 볼륨을 유지한다.

### 개발 로그

MongoDB는 `attach: false`로 기본 `docker compose up`의 실시간 로그에서 제외한다.
기존 `logging.driver: none`은 Docker의 MongoDB 로그 저장을 끄는 설정으로 유지한다.
실행 중인 터미널의 기존 연결에는 소급 적용되지 않으며 다음 `up`부터 적용된다.
백엔드·프런트엔드 로그만 별도로 확인하려면 다음 명령을 사용한다.

```sh
docker compose logs -f --tail 100 backend frontend
```

태블릿·RFID 실행도 기본 Compose의 MongoDB 표시 설정을 상속한다. 지원 조건은
[Docker Compose의 attach 명세](https://docs.docker.com/reference/compose-file/services/#attach)를 따른다.

2026-10-27 변경 검증: 개발·RFID·태블릿·RFID+태블릿 네 구성의 `docker compose config`에서
MongoDB `attach: false`와 로그 드라이버 `none`을 확인했다. 현재 컨테이너도 `none / healthy`이며
DB ping은 `ok: 1`이다. 실행 중인 앱은 재시작하지 않았으며 새 포그라운드 출력 검수는 미실행이다.
앱 코드 변경은 없으며 전체 앱 테스트·빌드는 이 변경에서 미실행이다.

기본 MongoDB는 개발용 무인증 구성이다. PC 외부로 DB 포트를 공개하지 않는다.
VS Code MongoDB 확장 등 호스트 클라이언트의 연결 문자열은 다음과 같다.

```text
mongodb://127.0.0.1:27018/pesc_mate
```

Compose 내부의 백엔드는 `mongodb://mongodb:27017`을 사용한다.
인증 DB는 [별도 구성과 전환 절차](../operations/AUTHENTICATED_MONGODB.md)를 따른다.
기본 Compose를 실행한 것만으로 운영 보안 설정이 적용되지는 않는다.

## Python·Node.js 개별 실행

Python 3.12, Node.js 22.13 이상 22.x·24.x 또는 26 이상, 실행 중인 MongoDB가 필요하다.
아래는 PowerShell 기준이다. 기본 MongoDB 주소는 `mongodb://127.0.0.1:27017`, DB는
`pesc_mate`다. 위 Compose의 DB를 사용한다면 포트를 27018로 명시한다.
웹·API를 개별 실행하면서 DB만 Docker로 시작하려면 먼저 루트에서 실행한다.

```sh
docker compose up -d mongodb
```

### 백엔드

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:MONGODB_URI = 'mongodb://127.0.0.1:27018'
$env:DEMO_ACCOUNTS_ENABLED = 'true'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --reload-dir app --no-access-log
```

`MONGODB_URI`는 실제 실행 중인 DB에 맞게 바꾼다. 개별 실행은 MongoDB를 자동 시작하지 않는다.
시연 계정 생성은 `DEMO_ACCOUNTS_ENABLED=true`일 때만 켜며, 기존 비밀번호는 덮어쓰지 않는다.
운영 환경에서는 활성화하지 않는다.

### 프런트엔드

다른 터미널에서 실행한다.

```powershell
cd frontend
npm ci
npm run dev
```

`/api` 요청은 기본적으로 `http://127.0.0.1:8000`으로 프록시된다.
빌드는 `npm run build`, 정적 산출물 감시는 `npm run build:watch`다.
자동 검증 실행기는 2026-10-28 제거했다. PC USB 연결은
[USB 연동 안내](RFID_USB_INTEGRATION.md)를 참고한다.

## 선택형 로컬 AI와 이미지 검수

Compose의 Ollama 설정은 PC의 `http://host.docker.internal:11434`와 모델
`qwen2.5:0.5b`를 가리킨다. Ollama와 모델은 Compose가 설치하지 않는다.
이미 Ollama를 설치했다면 호스트에서 다음과 같이 모델을 준비한다.

```sh
ollama pull qwen2.5:0.5b
```

Ollama 서버가 백엔드에서 접근 가능한지 확인한다. 개별 백엔드 실행에서 사용하려면
`OLLAMA_ENABLED=true`, `OLLAMA_BASE_URL=http://127.0.0.1:11434`,
`OLLAMA_MODEL=qwen2.5:0.5b`를 서버 실행 전에 설정한다.
모델이 없어도 기본 발화와 규칙 기반 문장을 사용할 수 있다. 응답 지연과 의미 보존 기준은
[문장 생성 정책](../policies/SENTENCE_POLICY.md)을 따른다.

이미지 안전성 검사 공급자는 `IMAGE_SAFETY_API_URL`, 선택형 `IMAGE_SAFETY_API_TOKEN`으로
연결한다. 미설정·공급자 실패는 자동 승인 대신 운영 권한 담당자의 수동 검토로 처리한다.

## 같은 Wi-Fi의 태블릿 연결

### PC 모바일 핫스팟으로 iPad 연결

2026-11-10 시연 연결 안내: PC가 iPhone 핫스팟의 인터넷을 받더라도 iPad는
Windows가 만든 별도 모바일 핫스팟에 연결합니다. 사용이 허용된 개인 연결에서만 진행하며
학교 네트워크의 제한을 우회하지 않습니다. 서로 다른 네트워크의 주소를 혼용하지 않습니다.

1. Windows 설정 → 네트워크 및 인터넷 → 모바일 핫스팟에서 공유 연결과 Wi-Fi 공유를 선택합니다.
2. iPad를 PC가 만든 Wi-Fi 이름에 연결합니다.
3. `docker compose -f compose.yaml -f compose.tablet.yaml up -d --build`로 실행합니다.
4. iPad 설정 → Wi-Fi → 해당 이름 옆 ⓘ의 IPv4 **라우터** 주소를 확인합니다.
5. Safari에서 `http://라우터주소:5173`으로 접속합니다. 예시 `192.168.137.1`을 고정값으로 간주하지 않습니다.

라우터는 이 구성에서 PC의 핫스팟 어댑터 주소입니다. PC의 `ipconfig`로도 확인할 수 있습니다.
일반 공유기에 두 기기를 연결한 경우에는 라우터가 아니라 **PC의 Wi-Fi IPv4**를 사용합니다.
태블릿에서는 localhost를 사용하지 않습니다.

PC에서 같은 주소가 열리는데 iPad에서만 실패하고 방화벽 허용 규칙이 없다면,
관리자 PowerShell에서 로컬 서브넷의 TCP 5173만 허용합니다. 방화벽 전체를 끄지 않습니다.

```powershell
New-NetFirewallRule -DisplayName "PECS MATE 5173" -Direction Inbound -Protocol TCP -LocalPort 5173 -RemoteAddress LocalSubnet -Action Allow -Profile Any
```

기존 동일 규칙이 있으면 중복 생성하지 않습니다. 추가한 규칙을 되돌릴 때만 다음 명령을 사용합니다.

```powershell
Remove-NetFirewallRule -DisplayName "PECS MATE 5173"
```

사용자와 확인한 시연 연결 방식을 README에 반영했습니다. 이번 문서 작업에서는
기기 재연결·명령 실행·방화벽 변경·앱 빌드/테스트를 수행하지 않았습니다.
일회성 문서 검사에서 로컬 링크·이미지·앵커 23개, 코드 블록 짝,
팀원 이름·카드 수·선택형 Qwen 상태 대조와 `git diff --check`를 통과했습니다.
GitHub 실제 렌더링·외부 배지 이미지 로딩은 미검수입니다.

### 일반 사설 Wi-Fi

신뢰할 수 있는 사설망에서 다음 검수용 구성으로 실행한다.

```sh
docker compose -f compose.yaml -f compose.tablet.yaml up --build
```

PC의 사설 IPv4가 `192.168.0.10`이라면 태블릿에서 `http://192.168.0.10:5173`을 연다.
PC와 태블릿을 같은 Wi-Fi에 연결하고, Windows 방화벽의 비공개 네트워크에서 TCP 5173
인바운드를 허용한다. 프런트엔드만 LAN에 열며 API·DB의 loopback 바인딩은 유지한다.

개발 계정이 있으므로 공용 Wi-Fi·인터넷에 공개하지 않는다. LAN HTTP는 서비스 워커의
안전한 출처가 아니므로 설치·완전 오프라인 검수에는 사용하지 않는다. 해당 검수는 HTTPS
환경에서 별도로 한다. 태블릿의 음성 지원도 따로 확인한다.

검수 종료:

```sh
docker compose -f compose.yaml -f compose.tablet.yaml down
```

실제 기기·사용자 확인은 사용하는 환경에서 별도로 진행한다.

## 상태 확인과 장애 진단

`/api/health`는 DB와 선택형 AI 상태를 구분한다. DB 연결 실패는 `503/unavailable`,
선택형 AI 장애는 기본 경로를 유지하며 `200/degraded`로 응답한다.
`checks.tts`는 현재 선택된 MeloTTS/Qwen `/health`의 ready 응답을 실제 점검한다.
미설정·네트워크 장애·warming/비정상 응답은 음성 unavailable과 API degraded로 표시한다.
각 검사 2초 제한을 병렬 수행해 세 검사 지연이 Compose 5초 제한을 넘도록 누적되지 않게 한다.
`device_check: client_side`는 여전히 실제 기기 청음이 필요하다는 뜻이며 서버 합성 성공과 다르다.
모의 검사에서 정상·미설정·네트워크/형식/크기 오류·degraded와 DB 실패 503 분기를 통과했다.
실제 TTS 서비스 장애 주입·iPad/PC 청음은 이번 수정에서 미실행이다.

MongoDB 내부 로그·Uvicorn 접근 로그·정상 CRUD 및 기기 접속 추적은 기본 출력에서 제외한다.
서버 오류·필수 경고·감사 이력·운영 지표와 검증 리포트는 유지한다. 응답의 `X-Request-ID`와
오류 응답의 `error.request_id`로 장애를 추적한다. 요청 본문·문장·이름·토큰을 진단 로그에
추가하지 않는다. 자세한 절차는 [장애 대응](../operations/INCIDENT_RESPONSE.md)을 따른다.
