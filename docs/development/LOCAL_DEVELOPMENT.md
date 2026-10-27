# 로컬 개발과 시연

루트 [README](../../README.md)는 프로젝트 소개와 빠른 실행을 다룬다.
이 문서는 개별 실행·태블릿 연결·선택형 서비스와 개발 환경의 한계를 정리한다.
모든 명령의 시작 위치는 별도 표시가 없으면 저장소 루트다.

## Docker Compose

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
검증 실행은 [로컬 검증 가이드](../validation/ONE_COMMAND_VALIDATION.md)를 참고한다.

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

실제 기기·사용자 검수표는 [실제 사용 환경 검증](../validation/ACTUAL_USE_VALIDATION.md)에 있다.

## 상태 확인과 장애 진단

`/api/health`는 DB와 선택형 AI 상태를 구분한다. DB 연결 실패는 `503/unavailable`,
선택형 AI 장애는 기본 경로를 유지하며 `200/degraded`로 응답한다. 기기 TTS는 서버에서
확인하지 못하므로 `client_side`로 표시한다.

MongoDB 내부 로그·Uvicorn 접근 로그·정상 CRUD 및 기기 접속 추적은 기본 출력에서 제외한다.
서버 오류·필수 경고·감사 이력·운영 지표와 검증 리포트는 유지한다. 응답의 `X-Request-ID`와
오류 응답의 `error.request_id`로 장애를 추적한다. 요청 본문·문장·이름·토큰을 진단 로그에
추가하지 않는다. 자세한 절차는 [장애 대응](../operations/INCIDENT_RESPONSE.md)을 따른다.
