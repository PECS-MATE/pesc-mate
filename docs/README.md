# PECS MATE 문서 안내

> 정리일: 2026-11-06 · 저장소 Markdown 40개. 과거 개별 계획 3개를 주제별 문서로 통합했습니다.

실행 방법은 [프로젝트 README](../README.md), 현재 작업은 [통합 TODO](planning/TODO.md)에서 확인합니다.
작은 변경마다 별도 문서를 만들지 않고 아래 주제별 안내서에 사용법·구현 경계·검증 상태를 함께 관리합니다.
현재 사용 안내를 먼저 읽고, 각 문서의 접힌 상세 기록에서 과거 날짜의 구현·실패·미실행 내용을 확인하세요.

## 개발과 사용 안내

| 문서 | 내용 |
| --- | --- |
| [로컬 실행과 태블릿 접속](development/LOCAL_DEVELOPMENT.md) | 로컬 실행과 태블릿 접속 |
| [화면 UX와 계정 설정](development/USER_INTERFACE.md) | 아동은 홈의 빠른 표현과 말하기·연습하기를 사용합니다 |
| [카드 등록과 카드판 관리](development/CARD_MANAGEMENT.md) | 보호자의 아이 관리 → 개인 카드 관리에서 사진·실물 카드를 등록합니다 |
| [카드 이미지 제작과 어휘 목록](development/CARD_ASSETS.md) | 기본 카드 113종(그림 87·글자 26), 추가 원본 7장 매핑 대기 |
| [학습 활동과 의사소통 기록](development/LEARNING_AND_RECORDS.md) | 학습 4종·보호자 맞춤 세트·30일 코스·복습 제안 |
| [음성 합성과 문장 생성](development/SPEECH_AND_AI.md) | 온라인 음성은 로컬 MeloTTS 서버를 사용하고, 기기 음성·핵심 표현 녹음·오프라인 캐시는 별도 대체 경로입니다 |
| [이미지 업로드와 로컬 저장](development/IMAGE_STORAGE.md) | 사용자가 업로드한 원본과 화면용 WebP·썸네일을 구분해 로컬 MongoDB에 저장합니다 |
| [API 음성 동기화 지표와 운영 알림](development/OPERATIONS_METRICS.md) | API 처리·클라이언트 음성 재생·오프라인 동기화·운영 알림은 서로 다른 지표입니다 |
| [USB 리더기 연결과 칩 등록](development/RFID_USB_INTEGRATION.md) | USB 리더기 연결과 칩 등록 |
| [선택형 Wi-Fi 하드웨어 연동](development/RFID_WIFI_INTEGRATION.md) | 선택형 Wi-Fi 하드웨어 연동 |
| [API 연동 빠른 안내](development/API_GUIDE.md) | API 연동 빠른 안내 |
| [API 상세 명세](development/API_SPECIFICATION.md) | API 상세 명세 |
| [데이터 스키마와 마이그레이션](development/DATA_SCHEMA_MIGRATIONS.md) | 데이터 스키마와 마이그레이션 |
| [추천 정책과 탐색 보조](development/RECOMMENDATION_POLICY.md) | 추천 정책과 탐색 보조 |
| [아이콘 규격과 라이선스](development/UI_ICONS.md) | 아이콘 규격과 라이선스 |
| [커밋 규칙](development/COMMIT_CONVENTION.md) | 커밋 규칙 |

## 기획과 진행 상태

계획의 목표와 실제 구현·검수 완료 여부는 다릅니다. 실물·사용자·운영 배포 게이트는 TODO를 따릅니다.

| 문서 | 내용 |
| --- | --- |
| [PECS MATE 기능요구사양서](planning/functional_requirements_specification.md) | PECS MATE 기능요구사양서 |
| [project_plan.md](planning/project_plan.md) | project_plan.md |
| [PECS MATE 통합 TODO](planning/TODO.md) | PECS MATE 통합 TODO |

통합된 과거 계획: [보호자 UI](development/USER_INTERFACE.md#caregiver-ui-plan-history), [MVP 이후 요청](development/USER_INTERFACE.md#post-mvp-plan-history), [하드웨어 최초 계획](development/RFID_USB_INTEGRATION.md#hardware-mvp-plan-history). 원문과 미실행 검수 기록을 접힌 절에 보존했습니다.

## 동작 정책

개인정보·동의·오프라인·음성·카드 잠금과 충돌 기준은 독립 문서로 유지합니다.

| 문서 | 내용 |
| --- | --- |
| [카드판 동시 수정 정책](policies/BOARD_CONFLICT_POLICY.md) | 카드판 동시 수정 정책 |
| [핵심 카드 잠금과 개인 사진 교체](policies/CORE_CARD_LOCK_POLICY.md) | 핵심 카드 잠금과 개인 사진 교체 |
| [오프라인 사용 및 한국어 음성 정책](policies/OFFLINE_POLICY.md) | 오프라인 사용 및 한국어 음성 정책 |
| [아동 기록과 개인 카드 통제 정책](policies/PRIVACY_POLICY.md) | 아동 기록과 개인 카드 통제 정책 |
| [사용자 프로필 정책](policies/PROFILE_POLICY.md) | 사용자 프로필 정책 |
| [복구 표현 정책](policies/RECOVERY_SPEECH_POLICY.md) | 복구 표현 정책 |
| [문장 생성 정책](policies/SENTENCE_POLICY.md) | 문장 생성 정책 |
| [TTS MVP 정책](policies/TTS_POLICY.md) | TTS MVP 정책 |

## 운영 절차

권한·재인증·장애·감사·백업·인증 DB 절차는 구현 이력과 구분합니다. 비밀키나 실제 연락처를 문서에 넣지 않습니다.

| 문서 | 내용 |
| --- | --- |
| [운영 권한 관리](operations/ACCOUNT_PERMISSION_MANAGEMENT.md) | 운영 권한 관리 |
| [감사 로그 보관과 무결성 검증](operations/AUDIT_RETENTION_INTEGRITY.md) | 감사 로그 보관과 무결성 검증 |
| [인증 MongoDB와 DB별 앱 계정](operations/AUTHENTICATED_MONGODB.md) | 인증 MongoDB와 DB별 앱 계정 |
| [장애 대응 절차와 연락 체계](operations/INCIDENT_RESPONSE.md) | 장애 대응 절차와 연락 체계 |
| [마이그레이션 전 로컬 백업과 격리 복구](operations/MIGRATION_BACKUP_RECOVERY.md) | 마이그레이션 전 로컬 백업과 격리 복구 |
| [중요 운영 작업 재인증](operations/OPERATION_REAUTHENTICATION.md) | 중요 운영 작업 재인증 |

## 하드웨어

- [하드웨어 전체 안내](../hardware/README.md)
- [USB 카드판 펌웨어](../hardware/arduino/rfid-usb-board/README.md)
- [Wi-Fi 카드판 펌웨어](../hardware/arduino/rfid-wifi-board/README.md)
- [진단 스케치](../hardware/arduino/card-reader-test/README.md)

## 문서 관리 규칙

- 기능 변경은 해당 주제 안내서와 필요한 정책·API·TODO를 갱신합니다.
- 스타일 수정·버튼 이동마다 새 Markdown 파일을 만들지 않습니다.
- 명령·소스 경로는 저장소 루트 기준, Markdown 링크는 해당 문서 기준 상대 경로를 사용합니다.
- 검사를 하지 않았다면 미실행으로 남깁니다. 문서 통합·커밋을 테스트 통과나 운영 승인으로 해석하지 않습니다.
- 개발·커밋 지시는 [AGENTS.md](../AGENTS.md)와 [커밋 규칙](development/COMMIT_CONVENTION.md)을 따릅니다.

### 플랫폼 이름과 기존 데이터 호환

- 사용자에게 보이는 공식 표기는 대문자와 공백을 포함한 **PECS MATE**로 통일한다.
  파일명·패키지명·편집본 형식처럼 공백을 쓰지 않는 새 식별자는 `pecsmate`를 사용한다.
- 화면·문서·웹/PWA 제목·API 소개·내보내기 파일명과 브랜드 이미지 경로를 정정했다.
- 기존 MongoDB DB명, Docker 프로젝트/볼륨, 복구 잠금, 로그인 localStorage·오프라인 IndexedDB·
  카드판/즐겨찾기 키, 내부 이벤트/헤더의 이전 식별자는 데이터·세션 호환을 위해 유지한다.
  이 식별자에 남은 기존 철자는 플랫폼 표시명이 아니며 데이터를 새 이름의 빈 저장소로 옮기지 않는다.
- Git 원격 URL과 로컬 저장소 폴더 이름은 실제 연결 경로이므로 그대로 둔다. 원격 저장소 이름 변경·푸시는 하지 않는다.
- 새 A4 편집본 형식과 파일명은 `pecsmate-a4`를 사용한다. 이전 `pecs-mate-a4` 형식도 읽는다.
- 서비스 워커의 앱 셸 캐시는 새 버전으로 갱신한다. 이전 앱 셸 캐시만 만료시키며
  로그인 저장 키·오프라인 DB·서버 데이터는 삭제하지 않는다. 이미지 파일은 내용 변경 없이 이름만 바꿨다.

## 이번 문서 정리 기록

- 개발 문서 51개를 주제별 안내서 7개와 기존 USB 안내서로 통합했습니다.
  원래 상세 내용·실패·미실행 기록은 각 안내서의 접힌 절에 보존했습니다.
- 이미 제거된 전용 사진 일괄 업로드 화면 문서 1개는 삭제하고 카드 관리 안내서에 상태만 남겼습니다.
  원문은 Git 이력에서 복구할 수 있습니다. 예: `git show 90f8f32:docs/development/BULK_CARD_IMPORT.md`.
- 목차의 이전 일회성 브랜드 검증 기록은 통합 이전 Git 이력에 남깁니다.
  실제 사용자·기기·PWA·운영 검수 미완료 상태는 TODO와 통합 안내서에서 계속 관리합니다.
- 루트 README·기획·정책·운영·하드웨어 문서의 이전 링크도 새 절 주소로 연결합니다.
- 코드·이미지·사용자 데이터·실행 중인 서버는 변경하거나 삭제하지 않습니다.
- 검증: Markdown 43개와 내부 링크·절 주소 292개를 검사했고 끊어진 참조는 없었습니다.
  통합 대상 51개 원문의 본문과 실패·미실행·권한·동의·삭제 관련 문구가 보존됐음을 대조했습니다.
- 초기 통합 목차 생성의 누락 필드와 링크 검사 도구의 문자열 구성 오류가 있었습니다.
  도구를 수정한 뒤 통합·링크 검사를 재실행해 통과했습니다. 공백 검사도 통과했습니다.
- 앱 빌드·브라우저·기기 검사는 문서만 정리한 이번 작업에서 미실행입니다.
