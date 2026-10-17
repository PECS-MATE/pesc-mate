# PESC MATE 문서 안내

현재 개발 범위와 진행 상태는 [통합 TODO](planning/TODO.md)에서 확인한다.
구현할 기능은 [기능요구사양서](planning/functional_requirements_specification.md),
API 연동은 [API 명세서](development/API_SPECIFICATION.md),
현장 검수 준비는 [실제 사용 환경 검증 기록](validation/ACTUAL_USE_VALIDATION.md)을 참고한다.
프로젝트 실행 방법은 [루트 README](../README.md)에 있다.

## 기획 — `planning/`

제품 목표, 요구사항, 개발 우선순위를 관리한다. 계획과 요구사항에 적힌 목표의 현재 구현 여부는 TODO에서 확인한다.

| 문서 | 내용 |
|---|---|
| [과제 계획서](planning/project_plan.md) | 과제 배경, 목표, 수행 방법과 기대효과 |
| [기능요구사양서](planning/functional_requirements_specification.md) | 기능 요구사항과 동작 조건 |
| [통합 TODO](planning/TODO.md) | 현재 구현 상태, 파일럿 준비와 이후 발전 계획 |

## 개발 — `development/`

API, 데이터 구조, 카드·마스코트 자산과 협업 규칙을 관리한다.

| 문서 | 내용 |
|---|---|
| [API 명세서](development/API_SPECIFICATION.md) | 엔드포인트, 권한, 요청과 응답 |
| [API 지표](development/API_METRICS.md) | 오류율·처리 시간 집계, 조회 권한과 해석 범위 |
| [TTS 지표](development/TTS_METRICS.md) | 클라이언트 재생 결과·시작 지연, 중복 방지와 집계 분모 |
| [오프라인 동기화 지표](development/OFFLINE_SYNC_METRICS.md) | 신규·중복·실패·미처리 집계, 기기 재시도 표시와 해석 한계 |
| [운영 알림](development/OPERATIONAL_ALERTS.md) | 공용 카드 검수 대기·반복 실패 기준, 조회 실패와 갱신 정책 |
| [학습 기록 데이터 모델](development/LEARNING_DATA_MODEL.md) | 학습 컬렉션과 의사소통 기록의 구분 |
| [카드 사진·단어 목록](development/CARD_PHOTO_WORD_LIST.md) | 카드 제작 기준, 이미지 표현과 제작 우선순위 |
| [마스코트 자산](development/MASCOT_ASSET.md) | 자산 경로, 적용 위치와 생성 프롬프트 |
| [커밋 메시지 규칙](development/COMMIT_CONVENTION.md) | 커밋 유형, 제목과 본문 작성 방법 |

## 정책 — `policies/`

기능 구현과 검수에서 지켜야 할 동작 기준을 관리한다.

| 문서 | 내용 |
|---|---|
| [문장 생성 정책](policies/SENTENCE_POLICY.md) | 선택 카드의 의미 보존과 생성 제약 |
| [TTS 정책](policies/TTS_POLICY.md) | 음성 선택, 출력과 설정 기준 |
| [의사소통 복구 표현 정책](policies/RECOVERY_SPEECH_POLICY.md) | 복구 표현과 즉시 발화 기준 |
| [카드판 동시 수정 정책](policies/BOARD_CONFLICT_POLICY.md) | 버전 충돌 감지, 초안 보존과 최신 구성 재조회 |
| [오프라인 정책](policies/OFFLINE_POLICY.md) | 로컬 저장, 음성 지원과 재연결 처리 |
| [사용자 프로필 정책](policies/PROFILE_POLICY.md) | 프로필 설정, 자산과 접근 권한 |
| [개인정보 정책](policies/PRIVACY_POLICY.md) | 수집, 접근, 보관, 내보내기와 삭제 |

## 검증 — `validation/`

자동 검증 절차와 실제 기기·사용자 검수 기록을 관리한다. 실행 방법, 기대 결과와 실제 수행 결과를 구분해 기록한다.

| 문서 | 내용 |
|---|---|
| [역할별 브라우저 E2E](validation/BROWSER_E2E.md) | Playwright 실행과 역할별 접근 경계 |
| [React 컴포넌트 테스트](validation/COMPONENT_TESTS.md) | 화면 조작, 비동기 실패와 상태 보존 회귀 검증 |
| [아동 데이터 경계 검증](validation/DATA_BOUNDARY_VALIDATION.md) | 다른 아동 데이터에 대한 접근 차단 |
| [기기 TTS 검수표](validation/DEVICE_TTS_VALIDATION.md) | 기기별 음성, 오프라인과 복귀 동작 확인 |
| [접근성 사용성 평가](validation/ACCESSIBILITY_USABILITY_TEST.md) | 사용자별 접근 방식과 과업 평가 |
| [실제 사용 환경 검증](validation/ACTUAL_USE_VALIDATION.md) | 기기 연결과 사용자·보호자·담당자 현장 검수 |

## 문서 관리

- 새 문서는 목적에 맞는 폴더에 추가하고 이 목차에 링크를 등록한다.
- 문서를 이동하거나 이름을 바꿀 때 해당 문서를 참조하는 링크도 갱신한다.
- Markdown 링크는 해당 문서 기준의 상대 경로를 사용한다. 본문에 적힌 `frontend/`, `backend/` 등의 소스 경로와 실행 명령은 저장소 루트를 기준으로 한다.
- 기능별 상세 기준은 해당 정책·개발 문서에, 개발 진행 상태와 다음 작업은 TODO에 기록한다.
