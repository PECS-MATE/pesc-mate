# pesc-mate

PESC MATE는 실물 PECS 카드가 늘어날수록 발생하는 휴대·분류·관리 부담을
줄이고, 발화장애 아동이 태블릿 한 대에서 익숙한 그림·사진·글자로 자신의
의사를 음성으로 전달하며 어휘와 의사소통을 학습할 수 있도록 지원하는
개인 맞춤형 디지털 AAC 플랫폼입니다.

## 프로젝트 구조

백엔드 테스트: `cd backend` 후 `pip install -r requirements-test.txt`를 실행하고
`python -m unittest discover -s tests -t . -p "test_*.py"`로 전체 검증한다.
프런트엔드 검증: `cd frontend` 후 `npm test`와 `npm run build`.
`main` 브랜치 push와 Pull Request마다 GitHub Actions(`.github/workflows/ci.yml`)가
위 백엔드·프런트엔드 검증을 자동으로 실행한다.

### 소스 구성

- `frontend`: React와 Vite 기반 웹 클라이언트
- `backend`: FastAPI 기반 API 서버와 카드 추천·문장 생성 기능
- `backend/tests`: 백엔드 API·서비스 회귀 테스트
- `docs`: 기획, 개발, 기능 정책 및 검증 문서. [문서 목차](docs/README.md)에서 확인합니다.

### MongoDB 실행

Docker Compose는 MongoDB를 함께 실행하므로 별도 설치가 필요하지 않습니다.
개별 실행에서는 MongoDB를 먼저 시작해야 하며 기본 연결 주소는
`mongodb://127.0.0.1:27017`, 기본 데이터베이스 이름은 `pesc_mate`입니다.

VS Code MongoDB 확장에서는 다음 연결 문자열을 사용합니다.

```text
mongodb://127.0.0.1:27018/pesc_mate
```

MongoDB 포트는 로컬 PC에서만 접근할 수 있도록 `127.0.0.1`에 바인딩됩니다.
백엔드는 프로세스당 하나의 MongoDB 연결 풀을 재사용하며 컨테이너 헬스체크는
30초 간격으로 실행하여 개발 로그의 반복 출력을 줄입니다.
MongoDB 컨테이너의 내부 로그, Uvicorn 접근 로그와 애플리케이션 DB CRUD 로그는
기본 출력에서 제외합니다. 앱에 접속한 브라우저는 로컬 저장소에서 만든 익명 기기
식별자와 기기·브라우저 종류만 `DEVICE | CONNECT` 형식으로 출력하며 동일 기기는
10분간 중복 출력하지 않습니다.
DB 진단이 꼭 필요할 때만 백엔드의 `DB_CRUD_LOG_ENABLED=true`를 설정합니다.

HTTP 응답의 `X-Request-ID`로 요청을 추적할 수 있습니다. API 요청 로그는 요청 ID,
메서드, 경로 템플릿, 상태 코드와 처리 시간을 JSON으로 남기며, 문장·아동 이름·토큰·
실제 이미지 경로·요청 본문은 포함하지 않습니다. 오류 응답의 `error.request_id`도
같은 ID를 사용합니다.

`/api/health`는 MongoDB 준비 상태와 선택형 Ollama 상태를 구분합니다.
MongoDB 연결 실패는 `503/unavailable`, 선택형 AI 장애는 규칙 기반 문장 생성을
유지하며 `200/degraded`로 응답합니다. 기기 TTS는 서버에서 확인할 수 없어
`client_side`로 표시합니다. [API 공통 규칙과 상태 확인](docs/development/API_SPECIFICATION.md)을 참고합니다.

장애 등급, 요청 ID 추적, 대기 기록 보존과 호출·복구 확인 순서는
[장애 대응 절차와 연락 체계](docs/operations/INCIDENT_RESPONSE.md)에 있습니다.
실제 담당자·비공개 연락망·모의훈련은 별도로 확정해야 하며 문서 작성만으로
현장 대응이 준비된 것으로 판단하지 않습니다.

## 로컬 실행

### Docker Compose로 한 번에 실행

Docker Desktop을 실행한 뒤 프로젝트 루트에서 다음 명령을 사용합니다.

```bash
docker compose up --build
```

- 웹 화면: `http://127.0.0.1:5173`
- API 문서: `http://127.0.0.1:8000/docs`
- 상태 확인: `http://127.0.0.1:8000/api/health`

컨테이너를 종료하려면 다음 명령을 사용합니다.

```bash
docker compose down
```

소스 디렉터리가 컨테이너에 연결되어 있어 코드 변경 시 자동으로
새로고침됩니다.
백엔드는 `backend/app`만 감시하므로 로컬 `.venv`나 테스트 캐시를
추적하지 않으며, Docker Desktop에서 메모리 부족으로 감시기가 종료되는
문제를 방지하기 위해 폴링 방식을 사용합니다.

### 같은 로컬망의 태블릿에서 확인

신뢰할 수 있는 사설망에서만 다음 검수용 구성을 실행합니다.

```bash
docker compose -f compose.yaml -f compose.tablet.yaml up --build
```

PC의 사설 IPv4 주소가 `192.168.0.10`이라면 태블릿에서
`http://192.168.0.10:5173`을 엽니다. PC와 태블릿은 같은 Wi-Fi에 연결되어야 하며,
Windows 방화벽에서 비공개 네트워크의 TCP 5173 인바운드 연결을 허용해야 합니다.
검수가 끝나면 `docker compose -f compose.yaml -f compose.tablet.yaml down`으로
종료합니다.

이 구성은 프런트엔드만 로컬망에 열고 API와 MongoDB는 PC 외부에 직접 노출하지
않습니다. 개발용 계정이 포함되어 있으므로 공용 Wi-Fi나 인터넷에 공개하면 안 됩니다.
LAN의 HTTP 주소는 서비스 워커의 안전한 출처가 아니므로 설치·완전 오프라인 검증에는
사용하지 않습니다. 해당 검증은 HTTPS 배포 환경에서 별도로 수행합니다.

### 개별 실행

#### 백엔드

```bash
cd backend
python -m venv .venv
pip install -r requirements.txt
uvicorn app.main:app --reload
```

개별 실행에서 시연용 계정이 필요하면 실행 전에 `DEMO_ACCOUNTS_ENABLED=true`를
설정합니다. Docker Compose는 이 값을 기본으로 켭니다.

API 문서는 `http://127.0.0.1:8000/docs`에서 확인할 수 있습니다.

#### 프런트엔드

```bash
cd frontend
npm install
npm run dev
```

웹 화면은 `http://127.0.0.1:5173`에서 확인할 수 있습니다.
`npm run dev`와 Docker Compose 실행 중에는 소스를 저장하면 브라우저가
자동으로 갱신됩니다. 정적 빌드 산출물을 계속 갱신하려면 다음을 실행합니다.

```bash
cd frontend
npm run build:watch
```

개발용 운영 권한 담당자 계정은 `admin` / `admin1234`이며, 일반 담당자와
같은 역할을 사용하되 `content_manage` 권한으로 공용 카드를 승인하거나 반려할 수 있습니다.
시연용 계정(`demo`, `caregiver`, `support`, `admin`)과 시연 기록은
`DEMO_ACCOUNTS_ENABLED=true`일 때만 만들어지며, 이미 있는 계정의 비밀번호는
다시 덮어쓰지 않습니다. 운영 환경에서는 이 값을 설정하지 않습니다.
이미지 콘텐츠 안전성 검사 API를 사용하려면 `IMAGE_SAFETY_API_URL`과
선택적으로 `IMAGE_SAFETY_API_TOKEN`을 설정합니다. 공급자가 없거나 장애가
발생하면 운영 권한 담당자의 수동 검토 상태로 자동 전환됩니다.

## 개발 문서

- [전체 문서 목차](docs/README.md)
- [개발 TODO 및 요구사항 진행표](docs/planning/TODO.md)
- [커밋 메시지 규칙](docs/development/COMMIT_CONVENTION.md)
- [API 명세서](docs/development/API_SPECIFICATION.md)
- [실제 기기 연결 및 현장 검증 기록](docs/validation/ACTUAL_USE_VALIDATION.md)
