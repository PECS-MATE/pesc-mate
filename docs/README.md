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
| [실물 카드 입력 MVP TODO](planning/HARDWARE_MVP.md) | 최초 USB 계획 이력과 최신 Wi-Fi 3개 위치 구현 문서 안내 |

## 개발 — `development/`

API, 데이터 구조, 카드·마스코트 자산과 협업 규칙을 관리한다.

| 문서 | 내용 |
|---|---|
| [API 명세서](development/API_SPECIFICATION.md) | 엔드포인트, 권한, 요청과 응답 |
| [RFID Wi-Fi 연동](development/RFID_WIFI_INTEGRATION.md) | RC522 3개·UNO R4 WiFi, 장치 인증·태그 매핑·웹 적용·배선표·실물 검수 |
| [RFID USB 연동·장치 로그](development/RFID_USB_INTEGRATION.md) | 현재 PC 연결 방식, Web Serial·기존 진단 출력·USB 펌웨어·문장 추가·브라우저/backend 로그 |
| [관리자 공용 칩 등록](development/RFID_CHIP_REGISTRATION.md) | USB로 칩 하나씩 인식·공용 카드 선택·등록/변경/해제·전체 아동 적용과 개인 매핑 우선 |
| [로컬 개발과 시연](development/LOCAL_DEVELOPMENT.md) | Docker·개별 실행, 선택형 AI, 태블릿 연결과 상태 확인 |
| [하드웨어 확장](../hardware/README.md) | Arduino 진단 스케치 현황·시연 환경·실물 입력 MVP와 기기 검증 기록 안내 |
| [API 지표](development/API_METRICS.md) | 오류율·처리 시간 집계, 조회 권한과 해석 범위 |
| [TTS 지표](development/TTS_METRICS.md) | 클라이언트 재생 결과·시작 지연, 중복 방지와 집계 분모 |
| [오프라인 동기화 지표](development/OFFLINE_SYNC_METRICS.md) | 신규·중복·실패·미처리 집계, 기기 재시도 표시와 해석 한계 |
| [운영 알림](development/OPERATIONAL_ALERTS.md) | 공용 카드 검수 대기·반복 실패 기준, 조회 실패와 갱신 정책 |
| [데이터 버전·마이그레이션](development/DATA_SCHEMA_MIGRATIONS.md) | 저장 형식 기준선, 조회 전용 계획·명시적 적용·잠금·재개 규칙 |
| [학습 기록 데이터 모델](development/LEARNING_DATA_MODEL.md) | 학습 컬렉션과 의사소통 기록의 구분 |
| [소리 듣고 카드 찾기](development/SOUND_CARD_LEARNING.md) | 명시 재생·그림 보기·기존 학습 설정·콘텐츠 버전·재개와 오프라인 결과 |
| [카드 순서로 문장 만들기](development/SENTENCE_ORDER_LEARNING.md) | 예문 따라 놓기·재도전·선택 재개·학습 전용 결과와 단어 집계 분리 |
| [의사소통·학습 기록 화면 분리](development/SUPPORT_RECORD_DASHBOARD.md) | 기록 탭·연결 권한·집계 기준과 늦은 응답 차단 |
| [추천 통제·탐색 보조](development/RECOMMENDATION_POLICY.md) | 추천 근거·승인·숨김·노출 기록과 장애 격리 |
| [업로드 이미지 정규화·원본 보관](development/IMAGE_UPLOAD_NORMALIZATION.md) | 로컬 원본 보관과 화면용 WebP 분리, 형식 검증·메타데이터 제거·삭제 연동 |
| [로컬 이미지 저장 안정화](development/LOCAL_IMAGE_STORAGE.md) | 화면·썸네일 규격, ETag, 저장 한도, 고아 정리·보강·백업 삭제 연동 |
| [개인 카드 사진 일괄 등록](development/BULK_CARD_IMPORT.md) | 다중 사진 미리보기·이름/분류·중복 후보·부분 실패 재시도와 대상 경계 |
| [개인 카드 사진 교체](development/PRIVATE_CARD_PHOTO_REPLACEMENT.md) | 카드 ID·문구·배치 유지, 사진 버전 충돌·원본 교체와 권한 경계 |
| [상황별 카드판과 보드 복사](development/SITUATION_BOARDS.md) | 같은 아동의 독립 보드 생성·복사·삭제, 명시 전환과 오프라인 캐시 |
| [보호자 동의 관리 흐름](development/GUARDIAN_CONSENT_FLOW.md) | 아동의 강제 동의 화면 제거, 확정 동의·초안 분리와 기록 없는 기본 사용 |
| [마이페이지와 통합 설정](development/MY_PAGE_SETTINGS.md) | 프로필 클릭, 프로필·접근·음성·보호자 설정 창과 계정별 진입 권한 |
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
| [핵심 카드 잠금 정책](policies/CORE_CARD_LOCK_POLICY.md) | 명시 잠금·해제, 슬롯 이동·제외·사진 교체 보호와 권한 경계 |
| [오프라인 정책](policies/OFFLINE_POLICY.md) | 로컬 저장, 음성 지원과 재연결 처리 |
| [사용자 프로필 정책](policies/PROFILE_POLICY.md) | 프로필 설정, 자산과 접근 권한 |
| [개인정보 정책](policies/PRIVACY_POLICY.md) | 수집, 접근, 보관, 내보내기와 삭제 |

## 운영 — `operations/`

장애 판단, 현장 중단·재개와 승인된 연락 절차를 관리한다. 실제 담당자 연락처는 비공개 연락망에 보관한다.

| 문서 | 내용 |
|---|---|
| [장애 대응 절차와 연락 체계](operations/INCIDENT_RESPONSE.md) | 등급, 읽기 전용 점검, 상태 보존, 호출·상향·복구 확인 |
| [마이그레이션 백업·격리 복구](operations/MIGRATION_BACKUP_RECOVERY.md) | 로컬 압축 BSON 백업, 새 DB 검증 복원, 실패 격리와 수동 되돌리기 절차 |
| [감사 보관·무결성](operations/AUDIT_RETENTION_INTEGRITY.md) | 명시적 기간 정리, 외부 HMAC 체크포인트, 개인정보 삭제와 변조 탐지 한계 |
| [운영 권한 관리](operations/ACCOUNT_PERMISSION_MANAGEMENT.md) | 책임자 지정·담당자 운영 권한·재인증·감사·세션 차단 |
| [인증 MongoDB 운영 준비](operations/AUTHENTICATED_MONGODB.md) | 독립 인증 DB·DB별 앱 계정·파일 자격 증명·격리 검증과 이전 주의사항 |

## 검증 — `validation/`

자동 검증 절차와 실제 기기·사용자 검수 기록을 관리한다. 실행 방법, 기대 결과와 실제 수행 결과를 구분해 기록한다.

| 문서 | 내용 |
|---|---|
| [역할별 브라우저 E2E](validation/BROWSER_E2E.md) | Playwright 실행과 역할별 접근 경계 |
| [한 명령으로 로컬 검증](validation/ONE_COMMAND_VALIDATION.md) | 빠른/범위별/전체 Docker 검사, 실행 격리·캐시·결과·정리 |
| [포트폴리오 README 정리 기록](validation/PORTFOLIO_README_REVIEW.md) | 소개 문서의 구현 근거, 검증 수치 범위와 문서 검사 결과 |
| [React 컴포넌트 테스트](validation/COMPONENT_TESTS.md) | 화면 조작, 비동기 실패와 상태 보존 회귀 검증 |
| [아동 데이터 경계 검증](validation/DATA_BOUNDARY_VALIDATION.md) | 다른 아동 접근 차단, 의사소통·학습 저장소/API와 권한 분리 |
| [기기 TTS 검수표](validation/DEVICE_TTS_VALIDATION.md) | 기기별 음성, 오프라인과 복귀 동작 확인 |
| [접근성 사용성 평가](validation/ACCESSIBILITY_USABILITY_TEST.md) | 사용자별 접근 방식과 과업 평가 |
| [접근성 브라우저 회귀 검증](validation/ACCESSIBILITY_BROWSER_VALIDATION.md) | 키보드·포커스·독립 듣기 버튼과 자동/수동 검증의 구분 |
| [실제 사용 환경 검증](validation/ACTUAL_USE_VALIDATION.md) | 기기 연결과 사용자·보호자·담당자 현장 검수 |
| [장애 대응 검증 기록](validation/INCIDENT_RESPONSE_VALIDATION.md) | 절차 대조·읽기 전용 점검과 미실행 모의훈련 구분 |

## 문서 관리

- 새 문서는 목적에 맞는 폴더에 추가하고 이 목차에 링크를 등록한다.
- 문서를 이동하거나 이름을 바꿀 때 해당 문서를 참조하는 링크도 갱신한다.
- Markdown 링크는 해당 문서 기준의 상대 경로를 사용한다. 본문에 적힌 `frontend/`, `backend/` 등의 소스 경로와 실행 명령은 저장소 루트를 기준으로 한다.
- 기능별 상세 기준은 해당 정책·개발 문서에, 개발 진행 상태와 다음 작업은 TODO에 기록한다.
