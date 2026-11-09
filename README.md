<div align="center">
  <img src="frontend/public/pecsmate.png" width="300" alt="PECS MATE 대표 이미지" />
  <h1>PECS MATE</h1>
  <p><strong>그림과 실물 카드로 마음을 전하는 개인 맞춤형 AAC 플랫폼</strong></p>
  <p>카드 선택 · 문장 생성 · 음성 출력 · 보호자 카드 제작</p>
</div>

<p align="center">
  <img src="https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white" alt="MongoDB" />
  <img src="https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/Arduino-00878F?logo=arduino&logoColor=white" alt="Arduino" />
</p>

[소개](#프로젝트-소개) · [주요 기능](#주요-기능) · [화면 구성](#화면-구성) · [기술 스택](#기술-스택) · [아키텍처](#아키텍처) · [시작 가이드](#시작-가이드) · [팀 소개](#팀-소개)

## 프로젝트 소개

PECS MATE는 말로 의사를 표현하기 어려운 아동이 그림·사진·글자 카드로 자신의 뜻을 전하는 AAC(보완대체의사소통) 웹 애플리케이션입니다.
실물 카드가 늘어날수록 커지는 휴대·분류·교체 부담을 줄이고, 익숙한 카드를 디지털 화면에서도 사용할 수 있도록 만들었습니다.


| 항목 | 내용 |
| --- | --- |
| 프로젝트 유형 | 팀 프로젝트 |
| 개발 기간 | 2026.09–2026.11 |
| 주요 사용자 | AAC 사용자, 보호자, 담당자, 공용 콘텐츠 관리자 |
| 실행 환경 | Windows PC의 Docker Desktop · 같은 사설망의 PC/태블릿 브라우저 |

## 주요 기능

| 기능 | 구현 내용 |
| --- | --- |
| 그림으로 말하기 | 기본 카드 120종, 카테고리·폴더·검색·즐겨찾기, 빠른 표현과 긴급·복구 표현 |
| 문장과 음성 | 최대 12장 문장 구성, 카드 순서 변경, 규칙 기반/선택형 AI 문장 생성, 카드·문장 음성 재생 |
| 음성 재사용 | 브라우저와 서버의 제한된 메모리 캐시로 동일 표현의 반복 합성을 줄임 |
| 실물 카드 태그 | USB 리더기 연결, 최대 세 리더기 상태 확인, 공용/개인 UID 매핑, 읽힌 카드를 문장에 추가 |
| 카드 등록·OCR | 보호자 개인 카드와 관리자 공용 카드, 여러 실물 카드 영역 분리·OCR 이름 확인·선택 저장 |
| A4 카드 편집 | 사진·카드 배치, 칸별 문구와 크기 조정, 인쇄 미리보기·방향·행/열·양면 설정 |
| 카드판 공유 | 보호자 홈의 카드판 갤러리, 검색·보관함·가져오기·복사 편집 |
| 연습하기 | 단어·그림, 소리·그림, 문장 순서, 상황 카드 선택 4종과 맞춤 세트·30일 코스·복습 제안 |
| 보호자 지원 | 연결된 아이의 카드·카드판·음성/접근 설정·의사소통/학습 기록과 지원 메모 관리 |
| 접근성·오프라인 | 글자/카드 크기·고대비·동작 줄이기·키보드 조작, 사전 캐시와 대기 기록 동기화 |

기록 저장 동의 전에도 새 이력을 저장하지 않는 기본 말하기와 연습을 유지합니다.
기록 저장과 보호자 관리 기능에는 해당 동의·연결 권한이 필요합니다.
오프라인은 사전 준비된 카드·음성과 기기 지원 범위에 한정되며, 모든 기능의 완전 오프라인 동작을 뜻하지 않습니다.

## 화면 구성

| 화면 | 주요 동선 |
| --- | --- |
| 랜딩 | 서비스 소개 → 로그인/시작하기 |
| 아동 홈 | 빠른 표현 → 말하기 또는 연습하기 |
| 그림으로 말하기 | 카드 터치/태그 → 나의 문장 → 음성 재생 |
| 연습하기 | 활동·범위 선택 → 문제 풀이 → 결과 확인 |
| 보호자 홈 | 공유 카드판 탐색 → 보관·복사·편집 |
| 아이 관리 | 아이 선택 → 기록·개인 카드·카드판·음성/접근·연습·RFID 관리 |
| 카드 편집기 | 사진/등록 카드 가져오기 → A4 배치 → 저장·공유·인쇄 |
| 공용 콘텐츠 운영 | 글자/사진 카드 등록 → 카테고리·공개 승인·공용 칩 관리 |

## 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| Frontend | React, JavaScript, Vite, Bootstrap Grid/Utilities, CSS, Google Material Symbols |
| Backend | Python 3.12, FastAPI, Uvicorn, PyMongo, Pillow |
| Database / Cache | MongoDB 8.0, IndexedDB, 브라우저·서버 메모리 캐시 |
| 문장 생성 | Ollama, 기본 설정 모델 qwen2.5:0.5b, 규칙 기반 대체 문장 |
| 음성 합성 | MeloTTS 기본 / Qwen3-TTS 선택형, CPU PyTorch, PCM WAV, 기기 음성·핵심 표현 녹음 대체 경로 |
| OCR / 이미지 처리 | Tesseract 한국어·영어, OpenCV, Pillow |
| Hardware | Arduino UNO R4 WiFi, RFID 카드 리더기, Web Serial API |
| Environment | Docker Desktop, Docker Compose, Git / GitHub |

Hugging Face/Gemini 이미지 생성과 rembg 배경 제거는 별도 설정이 필요한 선택 기능입니다.
Qwen은 VoiceDesign으로 설명 기반 합성 음색을 만든 뒤 0.6B Base로 새 문장을 읽는 선택형 구성입니다.
CPU의 첫 합성은 지연이 있으며 반복 재생은 캐시를 사용합니다. [설정·실측·제약](docs/development/SPEECH_AND_AI.md#qwen-합성-서버-선택형-연결-2026-11-10)

## 아키텍처

~~~mermaid
flowchart LR
    Child["아동 브라우저"] --> Web["React / Vite :5173"]
    Caregiver["보호자 · 담당자 브라우저"] --> Web
    RFID["실물 카드 / Arduino"] -->|"USB · PC 브라우저"| Web
    Web -->|"/api 프록시"| API["FastAPI :8000"]
    API --> DB[("MongoDB")]
    API --> Speech["로컬 MeloTTS / 선택형 Qwen"]
    API -. "선택형 문장 생성" .-> Ollama["호스트 Ollama"]
    Speech -->|"WAV"| API
    API -->|"카드 · 문장 · 음성"| Web
    Web <--> Cache["계정별 기기 캐시"]
~~~

브라우저는 프런트엔드의 /api 프록시를 통해 백엔드에 접근합니다.
태블릿 접속 구성에서도 프런트엔드 포트만 LAN에 공개하고 API와 DB 포트는 PC 내부로 제한합니다.
USB 리더기는 PC의 Chrome/Edge에서 연결하며, iPad 브라우저가 USB 리더기에 직접 연결되는 구성은 아닙니다.

- **배치 안정성:** 카드판 revision·사진 버전으로 충돌을 감지하고 핵심 카드의 위치를 보호합니다.
- **접근 경계:** 서버에서 아동 소유자·지원 연결·기능별 권한을 확인합니다.
- **사진 보관:** 원본은 로컬 MongoDB에 보관하고 화면용 WebP·썸네일을 별도로 제공합니다.
- **음성 캐시:** 계정·텍스트·속도·서버 모델 버전을 구분하며 새 문장을 영구 저장하지 않습니다.
- **실패 처리:** AI 생성 실패 시 규칙 기반 문장으로 대체합니다. 음성 서버 장애 시 모든 문장의 재생을 보장하지는 않습니다.

### 디렉터리 구조

~~~text
.
├── frontend/                   React 화면·카드 이미지·기기 캐시
├── backend/                    API·권한·문장·OCR·카드·기록 서비스
├── services/
│   ├── melotts/                로컬 한국어 음성 서버
│   └── qwen-voice-design/      선택형 음색 시안 제작 도구
├── hardware/                   Arduino USB/Wi-Fi 펌웨어·배선 안내
├── scripts/                    핵심 표현 음성 생성 도구
├── deployment/                 인증 MongoDB 설정
├── docs/                       기획·개발·정책·운영 문서
├── compose.yaml                기본 로컬 실행
├── compose.tablet.yaml         태블릿 LAN 접속
└── .env.example                선택형 이미지 도구 환경변수 예시
~~~

## 시작 가이드

### 요구 사항

| 항목 | 요구 사항 |
| --- | --- |
| 기본 실행 | Git, Docker Desktop의 Linux 컨테이너 모드, Docker Compose v2 |
| 태블릿 구성 | Compose 2.24.4 이상 — [포트 교체 태그 지원](https://docs.docker.com/reference/compose-file/merge/#replace-value) |
| 첫 실행 | 패키지·음성 모델 다운로드를 위한 인터넷과 충분한 디스크/메모리 여유 |
| USB 태그 | PC의 Chrome/Edge, Arduino 펌웨어 업로드, 시리얼 모니터 종료 |
| 호스트에서 직접 개발할 때 | Python 3.12, Node.js 22.13 이상 22.x 또는 24.x·26 이상, MongoDB |

Docker 기본 실행에는 호스트의 Python·Node.js 별도 설치가 필요하지 않습니다.
MeloTTS와 Qwen 도구/서버는 별도 컨테이너이며 Python·모델 의존성도 분리되어 있습니다.

### 설치 및 PC 실행

~~~powershell
git clone https://github.com/PESC-MATE/pesc-mate.git
cd pesc-mate
docker compose up -d --build
docker compose ps
~~~

기본 실행에 API 키는 필요하지 않습니다. 선택형 이미지 생성 등을 설정할 때만
새로 clone한 저장소에서 .env.example을 .env로 복사하고 필요한 값을 입력하세요.
기존 .env가 있다면 덮어쓰지 말고 항목을 병합하며 실제 토큰은 커밋하지 않습니다.

~~~powershell
# .env가 없는 최초 설정에서만 실행
Copy-Item .env.example .env
~~~

| 대상 | PC 접속 주소 |
| --- | --- |
| 웹 | [http://localhost:5173](http://localhost:5173) |
| Swagger API 문서 | [http://localhost:8000/docs](http://localhost:8000/docs) |
| 서버 상태 | [http://localhost:8000/api/health](http://localhost:8000/api/health) |

최초 실행은 빌드와 음성 모델 준비에 시간이 걸립니다. 웹이 열려도 음성 서버는 아직 준비 중일 수 있습니다.

### iPad 연결 — PC 모바일 핫스팟

시연에서는 iPad를 **Windows PC가 만든 모바일 핫스팟**에 연결하는 방식을 사용합니다.
PC가 iPhone 핫스팟으로 인터넷을 받고 있다면 그 Wi-Fi 연결을 PC 핫스팟으로 공유할 수 있습니다.

1. PC **설정 → 네트워크 및 인터넷 → 모바일 핫스팟**에서 공유 연결을 선택하고 공유 방식을 Wi-Fi로 설정합니다.
2. 모바일 핫스팟을 켜고 iPad를 **PC의 네트워크 이름**에 연결합니다.
3. 프로젝트 루트에서 태블릿 접속 구성을 실행합니다.

~~~powershell
docker compose -f compose.yaml -f compose.tablet.yaml up -d --build
~~~

4. iPad **설정 → Wi-Fi → 연결한 PC 핫스팟 옆 ⓘ → IPv4 주소 → 라우터**를 확인합니다.
5. Safari에서 http://라우터주소:5173을 엽니다. 예를 들어 라우터가 192.168.137.1이면 다음 주소입니다.

~~~text
http://192.168.137.1:5173
~~~

예시 주소를 고정 사용하지 말고 실제 라우터 값을 확인하세요. iPad에서 localhost는 PC가 아닌 iPad 자신입니다.
접속되지 않으면 [포트·방화벽·핫스팟 확인 방법](docs/development/LOCAL_DEVELOPMENT.md#pc-모바일-핫스팟으로-ipad-연결)을 따릅니다.
신뢰할 수 있는 사설망에서만 사용하고 기본 계정이 있는 개발 서버를 학교 공용망이나 인터넷에 공개하지 마세요.

### 시연 계정

| 역할 | 아이디 | 비밀번호 |
| --- | --- | --- |
| AAC 사용자 | demo | demo1234 |
| 보호자 | caregiver | caregiver1234 |
| 담당자 | support | support1234 |
| 공용 콘텐츠 관리자 | admin | admin1234 |

Compose의 데모 설정으로 생성하며 기존 계정 비밀번호는 덮어쓰지 않습니다.
실제 아동 정보 대신 시연용 사진·문구를 사용하세요. 기록·지원 기능은 동의·연결 상태에 따라 제한됩니다.

### 선택형 AI와 빌드

문장 AI를 사용하려면 호스트에 Ollama를 설치하고 모델을 준비합니다.
기본 Compose는 host.docker.internal:11434로 접근합니다. 모델이 없어도 규칙 기반 문장은 사용할 수 있습니다.

~~~powershell
ollama pull qwen2.5:0.5b
~~~

프런트엔드만 호스트에서 개발하거나 빌드할 때는 다음 명령을 사용합니다.
API·DB·음성 서버는 별도로 실행되어 있어야 합니다.

~~~powershell
cd frontend
npm ci
npm run dev
# 프로덕션 빌드는 개발 서버를 종료하거나 별도 터미널에서 실행
npm run build
~~~

기본 서비스 종료는 docker compose down, 태블릿 구성 종료는 아래 명령입니다.
볼륨 삭제 옵션을 붙이지 않으면 DB 볼륨은 유지됩니다.

~~~powershell
docker compose -f compose.yaml -f compose.tablet.yaml down
~~~

## 팀 소개

김은비 · 강지민 · 박근우 · 이동현

## 구현 문서

| 문서 | 내용 |
| --- | --- |
| [문서 목차](docs/README.md) | 기획·개발·정책·운영 전체 안내 |
| [통합 TODO](docs/planning/TODO.md) | 구현 상태·안정화·확장 백로그 |
| [API 가이드](docs/development/API_GUIDE.md) / [명세](docs/development/API_SPECIFICATION.md) | 인증·역할·요청/응답 규격 |
| [카드 등록과 제작](docs/development/CARD_MANAGEMENT.md) | OCR·A4 편집·공유·등록 반영 |
| [음성과 AI](docs/development/SPEECH_AND_AI.md) | MeloTTS·캐시·문장 생성·Qwen 음색/서버 |
| [USB 태그 연결](docs/development/RFID_USB_INTEGRATION.md) | 장치 연결·칩 등록·기기 지원 범위 |
| [로컬 개발](docs/development/LOCAL_DEVELOPMENT.md) | 개별 실행·태블릿·진단 |

본 프로젝트는 의사소통 보조·연습용 소프트웨어이며 임상 효과·진단 기능·공식 PECS 인증을 주장하지 않습니다.

