<div align="center">
  <img src="frontend/public/pecsmate.png" width="300" alt="PECS MATE 대표 이미지" />
  <h1>PECS MATE</h1>
  <p><strong>그림과 실물 카드로 마음을 전하는 AAC 플랫폼</strong></p>
  <p>카드를 고르고, 문장을 만들고, 목소리로 전합니다.</p>
</div>

<p align="center">
  <img src="https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white" alt="MongoDB" />
  <img src="https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/Arduino-00878F?logo=arduino&logoColor=white" alt="Arduino" />
</p>

[소개](#프로젝트-소개) · [기능과 화면](#주요-기능과-화면) · [기술 스택](#기술-스택) · [설계](#시스템-설계) · [실행](#시작-가이드) · [팀](#팀-소개)

## 프로젝트 소개

PECS MATE는 말로 의사를 표현하기 어려운 사용자가 그림·사진·글자 카드를 이용해 자신의 뜻을 전하는 AAC(보완대체의사소통) 웹 애플리케이션입니다.

실물 카드가 많아질수록 휴대와 분류가 어려워지고, 필요한 표현을 추가할 때마다 새 카드를 제작해야 합니다. PECS MATE는 이 과정을 **말하기 → 카드 등록·제작 → 연습 → 보호자 지원**으로 연결합니다. 화면에서 카드를 터치하거나 실물 카드를 태그해 문장을 구성하고, 음성으로 전달할 수 있습니다. 보호자는 익숙한 실물 카드를 사진으로 등록하고, 필요한 카드판을 편집·인쇄해 다시 일상에서 사용할 수 있습니다.

| 항목 | 내용 |
| --- | --- |
| 개발 형태 | 팀 프로젝트 · 로컬 실행형 MVP |
| 개발 기간 | 2026.09–2026.11 |
| 사용자 | AAC 사용자, 보호자, 지원 담당자 |
| 운영 기능 | 공용 카드·공유 카드판 검토, 공용 태그 등록, 계정별 운영 권한 |
| 실행 환경 | Windows PC의 Docker Desktop · PC/태블릿 브라우저 |

## 주요 기능과 화면

### 1. 그림으로 말하기

- 기본 카드 120종을 카테고리·폴더·검색·즐겨찾기로 탐색합니다.
- 빠른 표현을 바로 말하거나, 최대 12장으로 ‘나의 문장’을 구성합니다.
- 카드 순서를 바꾸고 문장 생성·음성 재생을 실행할 수 있습니다.
- 홈은 빠른 표현·말하기·연습하기를 중심으로 구성하고, 설정은 프로필 메뉴에 모았습니다.

### 2. 실물 카드로 말하기

- PC 브라우저에서 Arduino를 USB로 연결하고 카드 UID를 표현에 매핑합니다.
- 순차 태그는 감지된 순서대로 문장판에 추가합니다.
- 서로 다른 리더기의 입력이 150ms 안에 들어오면 한 묶음으로 처리하고, 묶음 안에서는 리더기 번호순으로 정렬합니다.
- 등록된 카드 두 장 이상의 동시 입력은 문장 생성·자동 발화로 연결합니다. 단일 태그는 문장판만 갱신합니다.
- 소프트웨어는 리더기 1~3개 입력을 지원하며, 보호자 화면에서 장치별 상태를 확인합니다.

공용 태그와 아동별 개인 태그를 구분합니다. USB 연결은 PC의 Chrome/Edge에서 사용하며, iPad가 USB 리더기에 직접 연결되는 방식은 아닙니다.

### 3. 카드 등록과 OCR

- 보호자는 개인 카드를, 운영 권한이 있는 담당자는 공용 카드를 등록합니다.
- 사진 한 장에서 여러 실물 카드 영역을 분리하고 OCR로 이름을 추출합니다.
- 추출한 이미지·이름을 확인하고 수정한 뒤 선택한 카드만 저장합니다.
- 사진 카드뿐 아니라 글자로 표현하는 카드도 제작할 수 있습니다.

Hugging Face/Gemini 이미지 생성과 rembg 배경 제거는 별도 설정으로 사용하는 선택 기능입니다.

### 4. A4 편집·공유·전체 인쇄

- 카드와 사진을 A4 칸에 넣고, 칸별 이름·그림 크기·배치를 조정합니다.
- 인쇄 미리보기에서 방향·행/열·카드 크기·이름 표시·양면 구성을 선택합니다.
- 보호자 홈에서 카테고리별 기본 카드판 14개와 사용자 공유 카드판을 탐색합니다.
- 기본 카드판을 복사해 편집하거나, 만든 카드판을 저장하고 공유 승인을 요청합니다.
- 지원 홈에서는 기본 카드 120장을 이미지가 내장된 HTML 인쇄 파일로 내려받습니다.

전체 인쇄는 **A4 한 장에 모두 넣기**와 **4cm 카드로 여러 쪽 인쇄**를 선택할 수 있습니다. 현재 한 장 배치는 10열×12행, 4cm 배치는 A4 5쪽입니다. 다운로드한 파일을 브라우저에서 열어 인쇄하거나 PDF로 저장합니다. 개인 사진은 전체 기본 카드 인쇄에 포함하지 않습니다.

### 5. 연습과 보호자 지원

| 영역 | 기능 |
| --- | --- |
| 연습하기 | 단어·그림 맞추기, 소리 듣고 카드 찾기, 카드 순서로 문장 만들기, 상황에 맞는 카드 고르기 |
| 맞춤 코스 | 보호자가 고른 카드 세트, 30일 일일 코스, 완료 기록 기반 복습 제안 |
| 아이 관리 | 연결된 아이의 카드·카드판·음성·접근 설정과 지원 메모 |
| 기록 | 의사소통 기록과 학습 결과를 구분해 조회 |
| 접근성 | 카드·글자 크기, 고대비, 동작 줄이기, 키보드 조작 |
| 오프라인 | 미리 준비된 카드·음성 사용과 재연결 시 대기 기록 동기화 |

기록 동의 전에도 새 이력을 저장하지 않는 기본 말하기와 연습을 사용할 수 있습니다. 기록 저장과 연결 사용자 관리는 동의·기능별 권한에 따라 처리합니다.

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| Frontend | React · JavaScript · Vite · Bootstrap Grid/Utilities · CSS · Google Material Symbols |
| Backend | Python 3.12 · FastAPI · Uvicorn · PyMongo |
| Database / 기기 저장 | MongoDB 8.0 · IndexedDB |
| 문장 생성 | Ollama · qwen2.5:0.5b · 규칙 기반 대체 문장 |
| 음성 합성 | 기본 MeloTTS · 선택형 Qwen3-TTS · PyTorch · PCM WAV |
| OCR / 이미지 | Tesseract 한국어·영어 · OpenCV · Pillow |
| Hardware | Arduino UNO R4 WiFi · RFID 리더기 · Web Serial API |
| 개발·실행 | Docker Desktop · Docker Compose · Git / GitHub |

기본 실행은 MeloTTS입니다. Qwen 구성에서는 설명 기반 VoiceDesign 참조 음성과 Base 모델을 사용해 여자아이·남자아이 두 합성 음색을 제공합니다. 참조 음성 파일은 별도로 준비하며 기본 속도는 0.90배입니다.

## 시스템 설계

~~~mermaid
flowchart LR
    User["AAC 사용자"] --> Web["React / Vite"]
    Support["보호자 · 담당자"] --> Web
    Tag["실물 카드 · Arduino"] -->|"USB / PC 브라우저"| Web
    Web -->|"/api 프록시"| API["FastAPI"]
    Web <--> Local["IndexedDB · 기기 캐시"]
    API --> DB[("MongoDB")]
    API --> TTS["MeloTTS / 선택형 Qwen"]
    API -. "문장 생성" .-> AI["호스트 Ollama"]
    TTS -->|"WAV"| API
    API -->|"카드 · 문장 · 음성"| Web
~~~

### 구현에서 중점을 둔 부분

| 주제 | 설계 |
| --- | --- |
| 입력 순서 보존 | USB 입력을 묶음별로 직렬 처리하고, 오래된 입력·생성 응답이 최신 문장판을 덮어쓰지 않도록 처리 |
| 문장 생성 지연 | 모델·공통 프롬프트 준비, 같은 계정의 검증된 반복 조합 재사용, AI 실패 시 규칙 기반 대체 |
| 음성 캐시 | 브라우저·서버 메모리 재사용, Qwen 구성의 기본 카드 전용 영속 캐시, 음색·속도·참조 버전별 분리 |
| 카드판 일관성 | revision·이미지 버전으로 동시 수정 충돌 감지, 핵심 카드 위치 보호 |
| 동의와 삭제 | 기록 저장 직전 동의·삭제 상태 재확인, 관련 쓰기와 삭제 직렬화 |
| 권한 분리 | 서버에서 계정 소유자·지원 연결·기능별 권한 확인, 공용 기본 카드와 개인 카드 조회 경로 분리 |
| 사진 보관 | 원본은 로컬 MongoDB에 보관하고 화면용 WebP·썸네일을 별도로 제공 |

모델 준비와 반복 조합 재사용은 새 문장의 첫 생성·음성 합성 지연까지 없애는 기능은 아닙니다. 측정 조건과 결과는 [문장 생성 지연 기록](docs/development/SENTENCE_LATENCY.md), 캐시 보관 범위는 [음성과 AI](docs/development/SPEECH_AND_AI.md#현재-실행과-캐시)에 정리했습니다.

### 디렉터리 구조

~~~text
.
├── frontend/                 화면·컴포넌트·상태 관리·카드 이미지
├── backend/                  API·권한·문장·OCR·기록·회귀 검사
├── services/
│   ├── melotts/              기본 한국어 음성 서버
│   └── qwen-voice-design/    선택형 음색 생성·Qwen 합성 서버
├── hardware/                 Arduino 펌웨어·배선·기기 연결 안내
├── scripts/                  음성 준비 등 개발 도구
├── deployment/               MongoDB 배포 설정
├── docs/                     개발·정책·운영·검증 기록
├── compose.yaml              기본 PC 실행
├── compose.tablet.yaml       태블릿 LAN 접속
├── compose.qwen.yaml         선택형 Qwen 실행
└── .env.example              선택 기능 환경변수 예시
~~~

## 시작 가이드

### 요구 사항

- Git, Docker Desktop의 Linux 컨테이너 모드, Docker Compose v2
- 태블릿·Qwen 구성: Compose 2.24.4 이상
- 최초 패키지·모델 다운로드를 위한 인터넷과 디스크·메모리 여유
- USB 태그 사용 시 PC의 Chrome/Edge와 펌웨어를 올린 Arduino

Docker 실행에는 호스트의 Python·Node.js 별도 설치가 필요하지 않습니다. 직접 개발할 경우 Python 3.12와 Node.js 22.13 이상 22.x, 24.x 또는 26 이상을 사용합니다.

### 1. PC에서 실행

~~~powershell
git clone https://github.com/PESC-MATE/pesc-mate.git
cd pesc-mate
docker compose up -d --build
docker compose ps
~~~

| 대상 | 접속 주소 |
| --- | --- |
| 웹 | [http://localhost:5173](http://localhost:5173) |
| API 문서 | [http://localhost:8000/docs](http://localhost:8000/docs) |
| 서버 상태 | [http://localhost:8000/api/health](http://localhost:8000/api/health) |

기본 실행에 외부 API 키는 필요하지 않습니다. 첫 실행에는 음성 모델 준비 시간이 포함됩니다.

선택 기능을 설정할 때만 .env.example을 .env로 복사해 필요한 값을 입력합니다. 기존 .env는 덮어쓰지 않습니다.

~~~powershell
# .env가 없는 최초 설정에서만 실행
Copy-Item .env.example .env
~~~

### 2. 시연 계정으로 접속

| 역할 | 아이디 | 비밀번호 |
| --- | --- | --- |
| AAC 사용자 | demo | demo1234 |
| 보호자 | caregiver | caregiver1234 |
| 지원 담당자 | support | support1234 |
| 공용 콘텐츠 운영 담당자 | admin | admin1234 |

기본 Compose의 데모 설정입니다. 기존 계정 비밀번호와 회수된 운영 권한은 초기화하지 않습니다. 아이 관리 메뉴는 연결·동의·지원 권한 상태에 따라 표시됩니다.

### 3. iPad를 PC 모바일 핫스팟으로 연결

1. Windows **설정 → 네트워크 및 인터넷 → 모바일 핫스팟**에서 공유 연결을 선택하고 Wi-Fi 공유를 켭니다.
2. iPad를 **PC가 만든 Wi-Fi**에 연결합니다.
3. 태블릿 접속 구성을 실행합니다.

~~~powershell
docker compose -f compose.yaml -f compose.tablet.yaml up -d --build
~~~

4. iPad의 **설정 → Wi-Fi → 연결한 네트워크 옆 ⓘ → IPv4 주소 → 라우터**를 확인합니다.
5. Safari에서 `http://라우터주소:5173`에 접속합니다.

예를 들어 라우터가 192.168.137.1이면 `http://192.168.137.1:5173`입니다. 실제 표시된 주소를 사용합니다. iPad의 localhost는 PC가 아니라 iPad 자신입니다.

태블릿 구성은 웹 포트만 LAN에 공개하고 API·DB 포트는 PC 내부에 유지합니다. 연결이 되지 않으면 [핫스팟·방화벽 확인 방법](docs/development/LOCAL_DEVELOPMENT.md#pc-모바일-핫스팟으로-ipad-연결)을 참고하세요. 기본 데모 계정이 있는 로컬 서버는 신뢰할 수 있는 사설망에서 사용합니다.

### 4. 선택형 AI·음성 설정

| 기능 | 준비 |
| --- | --- |
| AI 문장 생성 | 호스트에 Ollama 설치 후 아래 모델 준비. Compose는 host.docker.internal:11434로 접근 |
| Qwen 두 음색 | [음성 준비·실행 안내](docs/development/SPEECH_AND_AI.md#현재-실행과-캐시)에 따라 참조 생성 후 compose.qwen.yaml 포함 |
| 이미지 생성·배경 제거 | [카드 등록 안내](docs/development/CARD_MANAGEMENT.md)의 공급자·토큰·로컬 모델 설정 |

~~~powershell
ollama pull qwen2.5:0.5b
~~~

Qwen 참조 파일은 Git에 포함하지 않습니다. Qwen을 사용 중이라면 태블릿 실행·재시작에도 같은 Compose 파일 조합을 유지합니다. 기본/태블릿 구성만 실행하면 MeloTTS 설정으로 돌아갈 수 있습니다.

기본 서비스 종료는 `docker compose down`, 태블릿 구성 종료는 아래 명령입니다. 볼륨 삭제 옵션을 붙이지 않으면 DB 볼륨은 유지됩니다.

~~~powershell
docker compose -f compose.yaml -f compose.tablet.yaml down
~~~

직접 개발과 회귀 검사 실행 방법은 [로컬 개발 안내](docs/development/LOCAL_DEVELOPMENT.md)를 참고하세요.

## 구현 상태와 검증 기록

현재 범위는 로컬 실행형 MVP입니다. 자동 회귀 검사, 합성 데이터·격리 DB 검사, 실제 기기 검수 결과를 구분해 기록합니다.

2026-11-13에 회귀 실행 기반을 다시 추가했으며, 이후 App·API·잠금·학습 코스 구조 분리에는 검증 미실행 변경이 있습니다. 이전 단계의 통과 결과를 현재 전체 버전의 검증 완료로 간주하지 않습니다. 최신 범위와 남은 작업은 [리팩터링 실행 기록](docs/development/REFACTORING_VERIFICATION.md)과 [통합 TODO](docs/planning/TODO.md)를 기준으로 확인할 수 있습니다.

## 팀 소개

김은비 · 강지민 · 박근우 · 이동현

## 관련 문서

| 문서 | 내용 |
| --- | --- |
| [문서 목차](docs/README.md) | 기능·정책·운영 안내 전체 |
| [카드 등록·제작·공유](docs/development/CARD_MANAGEMENT.md) | OCR, 카테고리별 카드판, A4 편집, 전체 카드 인쇄 |
| [음성과 AI](docs/development/SPEECH_AND_AI.md) | 음성 구성·준비·캐시 |
| [USB 카드 태그](docs/development/RFID_USB_INTEGRATION.md) | 배선·포트 연결·칩 매핑·순서·동시 입력 |
| [학습과 기록](docs/development/LEARNING_AND_RECORDS.md) | 연습 4종·맞춤 세트·코스·복습 |
| [API 가이드](docs/development/API_GUIDE.md) | 인증·역할·요청 규약과 실행 서버 OpenAPI |
| [개인정보 정책](docs/policies/PRIVACY_POLICY.md) | 동의·보존·내보내기·삭제 |

PECS MATE는 의사소통 보조·연습용 소프트웨어이며 임상 효과·진단 기능·공식 PECS 인증을 주장하지 않습니다.

