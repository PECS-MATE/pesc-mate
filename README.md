# pesc-mate

PESC MATE는 실물 PECS 카드가 늘어날수록 발생하는 휴대·분류·관리 부담을
줄이고, 발화장애 아동이 태블릿 한 대에서 익숙한 그림·사진·글자로 자신의
의사를 음성으로 전달하며 어휘와 의사소통을 학습할 수 있도록 지원하는
개인 맞춤형 디지털 AAC 플랫폼입니다.

## 프로젝트 구조

백엔드 테스트: `cd backend` 후 `python -m unittest test_communication -v`.
프런트엔드 검증: `cd frontend` 후 `npm run build`.

### 소스 구성

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
MongoDB 컨테이너의 내부 로그와 Uvicorn 접근 로그는 숨기고, 백엔드 터미널에는
문서 내용과 인증 정보를 제외한 `DB CRUD | 작업 | 컬렉션` 형식의 변경 로그만 출력합니다.
반복되는 `READ` 로그는 디버그 레벨에서만 확인할 수 있습니다.

- `frontend`: React와 Vite 기반 웹 클라이언트
- `backend`: FastAPI 기반 API 서버
- `ai`: 카드 추천 및 문장 생성 기능
- `docs`: 기획, API, 회의 및 개발 문서

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

### 개별 실행

#### 백엔드

```bash
cd backend
python -m venv .venv
pip install -r requirements.txt
uvicorn app.main:app --reload
```

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
이미지 콘텐츠 안전성 검사 API를 사용하려면 `IMAGE_SAFETY_API_URL`과
선택적으로 `IMAGE_SAFETY_API_TOKEN`을 설정합니다. 공급자가 없거나 장애가
발생하면 운영 권한 담당자의 수동 검토 상태로 자동 전환됩니다.

## 개발 문서

- [개발 TODO 및 요구사항 진행표](docs/TODO.md)
- [커밋 메시지 규칙](docs/COMMIT_CONVENTION.md)
- [API 명세서](docs/API_SPECIFICATION.md)
