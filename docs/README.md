# PECS MATE 문서 안내

> 갱신: 2026-11-12 · 현재 안내와 과거 구현 이력을 구분합니다.

## 먼저 읽을 문서

| 목적 | 문서 |
| --- | --- |
| 프로젝트 소개·기본 실행·팀 | [프로젝트 README](../README.md) |
| 지금 구현된 기능과 남은 검수 | [통합 TODO](planning/TODO.md) |
| Docker·태블릿·핫스팟·장애 확인 | [로컬 실행](development/LOCAL_DEVELOPMENT.md) |
| 여자아이/남자아이 음성·0.90배·캐시·Qwen 실행 | [음성과 AI](development/SPEECH_AND_AI.md#현재-실행과-캐시) |
| 최신 안정화 검사 범위와 미검증 항목 | [2026-11-12 안정화 기록](development/LOCAL_DEVELOPMENT.md#안정화-회귀-점검--2026-11-12) |
| API 요청·권한·오류 처리 | [빠른 가이드](development/API_GUIDE.md) · [상세 명세](development/API_SPECIFICATION.md) |

기본 Compose는 MeloTTS, Qwen overlay는 여자아이·남자아이 두 합성 음색을 사용합니다.
기본 카드는 120종(그림 PNG 94종·글자 26종)입니다.
구현·격리 검사 통과와 실제 iPad/RFID/사용자 검수·운영 승인은 서로 다른 상태입니다.

## 기능별 안내

| 문서 | 범위 |
| --- | --- |
| [화면과 계정 설정](development/USER_INTERFACE.md) | 아동·보호자 화면, 프로필, 접근 설정 |
| [카드 등록·OCR·A4 제작·공유](development/CARD_MANAGEMENT.md) | 기존 카드 등록, 편집·인쇄·공유 |
| [카드 이미지 제작과 어휘](development/CARD_ASSETS.md) | 규격·프롬프트·제작 체크리스트·매핑 |
| [학습과 기록](development/LEARNING_AND_RECORDS.md) | 학습 4종·맞춤 세트·30일 코스·복습 |
| [음성과 문장 생성](development/SPEECH_AND_AI.md) | Qwen/Melo·음성 캐시·Ollama·지연 |
| [원본 이미지 저장](development/IMAGE_STORAGE.md) | 원본·화면용 이미지·저장 한도·삭제 |
| [운영 지표](development/OPERATIONS_METRICS.md) | API·클라이언트 재생·오프라인 동기화 |
| [USB 리더기](development/RFID_USB_INTEGRATION.md) | PC 포트 연결·칩 매핑·기기 상태 |
| [선택형 Wi-Fi 연동](development/RFID_WIFI_INTEGRATION.md) | 장치 키·세 위치 스냅샷·세션 |
| [데이터 스키마](development/DATA_SCHEMA_MIGRATIONS.md) | 버전·마이그레이션 경계 |
| [추천 정책](development/RECOMMENDATION_POLICY.md) | 보호자 확인형 추천·탐색 보조 |
| [아이콘](development/UI_ICONS.md) | 공통 규격·라이선스 |

## 동작 정책

| 주제 | 문서 |
| --- | --- |
| 개인정보·동의·삭제 | [개인정보 정책](policies/PRIVACY_POLICY.md) |
| 음성·저장 범위 | [TTS 정책](policies/TTS_POLICY.md) · [오프라인 정책](policies/OFFLINE_POLICY.md) |
| 문장·의사표현 | [문장 정책](policies/SENTENCE_POLICY.md) · [복구 표현](policies/RECOVERY_SPEECH_POLICY.md) |
| 카드판 보호·충돌 | [핵심 카드 잠금](policies/CORE_CARD_LOCK_POLICY.md) · [동시 수정](policies/BOARD_CONFLICT_POLICY.md) |
| 프로필 | [프로필 정책](policies/PROFILE_POLICY.md) |

## 운영 절차

로컬 시연 실행과 외부 운영 준비를 혼동하지 않습니다. 기본 데모 계정·무인증 DB를 인터넷에 공개하지 마세요.

- [권한 관리](operations/ACCOUNT_PERMISSION_MANAGEMENT.md)
- [중요 작업 재인증](operations/OPERATION_REAUTHENTICATION.md)
- [인증 MongoDB](operations/AUTHENTICATED_MONGODB.md)
- [백업과 격리 복구](operations/MIGRATION_BACKUP_RECOVERY.md)
- [장애 대응](operations/INCIDENT_RESPONSE.md)
- [감사 보관·무결성](operations/AUDIT_RETENTION_INTEGRITY.md)

## 기획 원문과 하드웨어

[과제 계획서](planning/project_plan.md)와 [기능요구사양서](planning/functional_requirements_specification.md)는
과제 목표 원문입니다. 현재 구현·검수 여부는 [TODO](planning/TODO.md)가 우선합니다.
각 기능 안내서의 접힌 상세 기록은 당시 실패·미실행 상태까지 보존하며 현행 명령으로 간주하지 않습니다.

- [하드웨어 전체](../hardware/README.md) · [USB 펌웨어](../hardware/arduino/rfid-usb-board/README.md)
- [Wi-Fi 펌웨어](../hardware/arduino/rfid-wifi-board/README.md) · [진단 스케치](../hardware/arduino/card-reader-test/README.md)
- 통합된 과거 계획: [보호자 UI](development/USER_INTERFACE.md#caregiver-ui-plan-history) · [MVP 이후](development/USER_INTERFACE.md#post-mvp-plan-history) · [하드웨어 최초 계획](development/RFID_USB_INTEGRATION.md#hardware-mvp-plan-history)

## 문서 관리 기준

- 실행은 루트 README, 기능별 동작은 안내서·정책, 진행 상태는 TODO, API 스키마는 실행 서버의 OpenAPI를 기준으로 합니다.
- 같은 설명·실측은 주제 문서 한 곳에 두고 다른 문서는 링크합니다. 작은 변경마다 새 문서를 만들지 않습니다.
- 미실행 검사를 통과로 표시하지 않으며, 과거 통과 수치를 현재 버전의 검수로 재사용하지 않습니다.
- 문서 전용 정리는 앱 테스트·배포 승인과 다릅니다. 변경 시 검증 범위와 미실행 사항을 기록합니다.
- [AGENTS.md](../AGENTS.md)와 [커밋 규칙](development/COMMIT_CONVENTION.md)을 따릅니다.

표시 이름은 **PECS MATE**, 새 공백 없는 식별자는 `pecsmate`입니다.
기존 DB·Docker 볼륨·브라우저 저장 키·Git 원격의 이전 이름은 데이터 호환을 위해 유지합니다.
새 A4 형식은 `pecsmate-a4`이며 이전 `pecs-mate-a4`도 읽습니다. 문서 정리를 이유로 저장소를 초기화하지 않습니다.

### 이번 정리의 확인 범위 — 2026-11-12

현재 카드 수·두 음색·캐시·API/health 안내를 소스와 대조했습니다.
Markdown 40개·내부 파일/절 링크 315개와 접힘 태그·diff 공백 검사에서 오류가 없었습니다.
과거 계획·실패·미실행 기록은 보존했으며 중복된 오래된 문서 집계 설명만 정리했습니다.
문서만 변경했으므로 이번 정리의 앱 빌드·모델 호출·브라우저/기기 검사는 미실행입니다.
실제 정책·운영 절차는 범위가 달라 독립 문서로 유지했습니다. 검사 도구·문서를 새로 추가하지 않았습니다.

<details>
<summary>이전 문서 통합 작업의 실패·미실행 기록</summary>

과거 통합 목차 생성 도구에서 누락 필드와 링크 검사 문자열 구성 오류가 발생했고,
도구 수정 후 통합·링크 검사를 다시 실행해 통과했습니다. 당시 앱 빌드·브라우저·기기 검사는
미실행이었습니다. 이 기록과 당시 문서/링크 수를 현재 버전 검수로 해석하지 않습니다.

</details>
