# 데이터 모델 버전과 마이그레이션 규칙

## 범위와 버전 의미

신규 MongoDB 문서는 정수 `schema_version=1`로 현재 저장 형식의 기준선을 표시한다.
정의는 `backend/app/services/schema_versions.py`의 `SCHEMA_VERSION`과
`VERSIONED_COLLECTIONS`에서 관리한다. 대상은 다음 23개 컬렉션이다.

- 계정·세션: `users`, `auth_sessions`, `login_attempts`
- 카드·감사: `card_categories`, `card_submissions`, `card_audit_logs`
- 의사소통·음성: `communication_sessions`, `tts_settings`, `tts_events`
- 설정·보드: `accessibility_settings`, `board_layouts`, `board_audit_logs`
- 연결·지원: `caregiver_links`, `caregiver_notes`
- 개인정보: `privacy_settings`, `privacy_audit_logs`
- 오프라인·학습: `offline_events`, `learning_settings`, `learning_attempts`, `learning_audit_logs`
- 운영 권한 감사: `account_permission_audit_logs`
- 추천 정책·노출: `recommendation_settings`, `recommendation_batches`

| 값 | 판정 | 처리 |
|---|---|---|
| 필드 없음 또는 BSON 정수 0 | `legacy` | 명시적 기준선 마이그레이션의 대상 |
| BSON 정수 1 | `current` | 변경하지 않음 |
| BSON 정수 2 이상 | `future` | 적용 전체 차단, 상위 버전의 데이터로 취급 |
| null·문자열·실수·불리언·배열·객체·음수 등 | `invalid` | 적용 전체 차단, 값을 추정·강제 변환하지 않음 |

`int`·`long`만 정수로 인정한다. `true`, `1.0`, `[0]`을 버전 1·0으로 취급하지 않는다.
기존의 버전 누락을 읽기 중 자동으로 고치지 않는다. 새 문서를 insert할 때와 upsert의
`$setOnInsert`에만 버전을 지정하므로 일반 수정은 기존 버전을 올리거나 내리지 않는다.

| 다른 버전 | 구분 |
|---|---|
| 카드판 `revision` | 동시 편집 충돌 감지. schema_version과 별개이며 마이그레이션이 증가시키지 않음 |
| 추천 설정 `revision` / `aac-candidates-v1` | 정책 동시 편집 / 후보 계산 버전. 카드판 revision·문서 스키마 버전과 독립 |
| IndexedDB 버전 3 | 브라우저 스토어 구조. 이번 MongoDB 기준선과 무관하며 변경하지 않음 |
| 문장 정책·동의 버전 | 정책 적용 근거. 저장 형식 버전과 교체하거나 일괄 갱신하지 않음 |

## 최초 마이그레이션

`python -m app.migrations`가 `0001_schema_version_baseline` 하나를 실행한다.
버전 누락·정수 0에 `schema_version=1`만 조건부로 추가한다. 원문·이미지 바이너리·
소유자·역할·권한·기록 UUID·시각·TTL 만료 시각·보드 revision을 변환하지 않는다.
형식 내부의 모든 필수 필드나 업무 데이터의 정합성을 검증하는 도구는 아니다.

신규 버전은 일반 API 응답에 추가하지 않는다. 기존 개인정보 내보내기처럼 원본
문서를 반환하는 항목에는 이 저장 메타데이터가 포함될 수 있다. 개인정보 삭제와
TTL은 원래 정책을 유지하며 마이그레이션이 삭제된 데이터를 복원하지 않는다.

대상은 고정 허용 목록이고 알 수 없는 컬렉션·시스템 DB·브라우저 저장소를 건드리지 않는다.
`schema_migrations`는 도구 전용 실행 상태 컬렉션이며 사용자 데이터의 별도 복제본이 아니다.

## 조회 전용 확인

저장소 루트 PowerShell의 현재 로컬 기본 구성 예시다. 실제 환경·대상 DB를 확인한다.

```powershell
docker compose exec -T backend python -m app.migrations --database pesc_mate --dry-run
```

`--database`는 항상 필수이며 `MONGODB_DATABASE` 기본값을 대상 선택에 사용하지 않는다.
모드를 생략해도 `dry_run`이다. DB 이름은 영문 시작의 영문·숫자·`_`·`-` 1~63자만
허용하며 `admin`, `config`, `local`은 금지한다. 인증 정보는 기존 `MONGODB_URI` 환경
설정만 사용하고 명령행 인자·결과·공개 문서에 연결 문자열을 넣지 않는다.

결과는 컬렉션별 `legacy`, `current`, `future`, `invalid` 건수와 전체 합계다.
개별 문서 ID·사용자·원문·임의 버전 값은 출력하지 않는다. 분류는 DB에서 네 개의
고정 그룹으로 집계하며 컬렉션별 `maxTimeMS=2000`을 적용한다. 조회는 비어 있는
컬렉션이나 실행 기록을 생성하지 않는다. `status=ready`는 분포상 적용 가능이라는
뜻이지 백업·쓰기 중단·잠금 해제·내용 정합성이 확인됐다는 뜻이 아니다.

| 종료 코드 | 의미 |
|---|---|
| 0 | 정상 조회 또는 적용 완료. 모드와 본문 상태도 함께 확인 |
| 1 | 적용 조건·잠금·DB·실행 오류. 고정 오류 코드만 출력 |
| 2 | 조회 결과 future/invalid 존재 또는 명령행 입력 오류. 본문·사용법 메시지 구분 |

## 실제 적용 전제와 순서

기존 로컬 DB의 실제 일괄 적용은 실행하지 않았다.
[로컬 백업·격리 복구 절차](../operations/MIGRATION_BACKUP_RECOVERY.md)를 사용할 수
있지만 합성 데이터 시험은 운영 DB의 백업·복구/전환 승인 증빙이 아니다.
아래 확인 없이 바로 적용하지 않는다.

1. TECH·LEAD가 대상 환경·DB·배포 커밋·유지보수 시간과 영향을 승인한다.
2. 모든 API 인스턴스·수동 작업·구버전 writer를 중단하고 진행 중 쓰기가 끝났는지 확인한다. 기기의 문장·대기열을 지우거나 로그아웃시키지 않는다. MongoDB 자체는 유지한다.
3. 쓰기가 멈춘 상태에서 백업을 만들고 새 DB로 복원 가능성을 확인한다. 제한된 위치에 보관하고 불투명한 참조 코드만 사용한다. 검증된 backup ID를 기록하고 writer를 계속 닫아 둔다. 백업·복구 검증 증빙이 없으면 적용하지 않는다.
4. 조회 전용 결과에서 future·invalid가 0인지 확인한다. 해당 컬렉션의 TTL 삭제는 계속될 수 있으므로 단순 전후 총건수 일치만으로 정합성을 판정하지 않는다.
5. 별도 일회용 프로세스에서 하나의 적용 명령만 실행한다. 중단한 backend에 `exec`하지 말고 `run --rm --no-deps`로 HTTP 서버 없이 실행한다.
6. 완료 결과와 조회 전용 재검사에서 legacy·future·invalid가 0인지 확인한다. 원문·권한·보드·개인 이미지·UUID·TTL과 실제 과업은 별도 검증한다.
7. 실행 기록·백업 참조·검증·재개 승인을 제한된 운영 기록에 남긴 뒤 승인된 버전의 writer만 다시 연다.

적용 명령의 **형식 예시**다. 두 자리표시는 그대로 실행하면 대상 이름 검사에서
거절된다. 실제 확인된 값으로 바꾸기 전에는 실행하지 않는다. 민감 정보나 경로 대신
영문·숫자·`.`·`_`·`-`의 1~64자 백업 참조 코드만 사용한다.

```powershell
$migrationDb = '<승인된 DB 이름>'
$migrationBackupRef = '<복원 확인된 백업 참조 코드>'
docker compose run --rm --no-deps backend python -m app.migrations --database $migrationDb --apply --confirm-database $migrationDb --writers-stopped --backup-ref $migrationBackupRef
```

`--confirm-database`는 실제 대상과 정확히 같아야 한다. `--writers-stopped`와
`--backup-ref`는 운영자의 확인 선언이며, 도구가 writer를 중단하거나 백업 존재·
복원 성공을 자동 검증하는 기능은 아니다. 다른 Compose 파일 조합·인증 환경은
같은 승인된 설정을 유지한다. 일반 사용자 화면에서 실행할 수 있는 관리 API는 만들지 않는다.

## 분할·잠금·재개

- `_id`만 최대 `--batch-size`개씩 읽어 변경하고, 쓰기 직전에도 legacy 조건을 재검사한다. 필드 값 전체 교체·upsert·삭제는 하지 않는다.
- `--batch-size`: 기본 500, 허용 1~1000. `--max-batches`: 기본 1000, 허용 1~10000, 모든 컬렉션의 변경 묶음을 합친 상한이다.
- 각 묶음은 클라이언트 작업 제한 10초와 ID 조회 제한 2초를 적용한다. 제한 초과·응답 유실 시 서버 반영 여부가 불확실할 수 있으므로 새 계획에서 재확인한다.
- 알려진 legacy 수가 묶음 크기×묶음 상한보다 크면 실행 기록 생성 전 거절한다. 컬렉션별 작은 묶음 때문에 실제 상한에 먼저 도달하면 일부만 완료된 실패가 될 수 있다.
- `schema_migrations`의 고정 마이그레이션 ID로 실행을 잠근다. 기록은 `running` → `completed` 또는 `failed`이며 실행 UUID·시각·백업 참조·컬렉션별 변경 수·고정 오류 코드를 담는다.
- 실행 중 기록은 시간 경과만으로 빼앗지 않는다. 다른 실행은 `migration_locked`로 중단한다. 알 수 없는 실행 기록 버전도 덮어쓰지 않는다.
- `failed`·`completed` 기록만 새 실행 UUID로 원자적으로 재획득할 수 있다. 이미 1인 문서는 재변경하지 않으므로 재실행은 남은 legacy만 처리한다.
- 처리·검증 중 오류가 나면 첫 실패에서 중단한다. 앞선 변경은 자동 취소하지 않고, 기록을 가능한 범위에서 failed로 남긴다. 사용자 데이터 ID·원문·예외 원문은 기록하지 않는다.
- 강제 종료·DB 단절로 running 잠금이 남으면 실제 이전 프로세스 종료와 쓰기 상태를 먼저 확인한다. 자동 강탈·잠금 해제 옵션은 없다. 대상 실행 기록만 정리하는 작업도 별도 승인·증거 보존 후 처리한다.

완료 후 재실행은 사용자 문서 변경 수 0으로 끝난다. 실행 기록은 마지막 실행 정보로
갱신되며 위변조 방지 감사 이력이나 영구 작업 이력을 대신하지 않는다. 다른 버전으로
바뀐 문서는 쓰기 조건에서 제외하고 최종 검사에서 차단한다. 이 도구는 모든 컬렉션을
하나의 트랜잭션으로 감싸지 않으며 writer 중단 확인을 대체하지 않는다.

## 향후 변경과 한계

버전 1은 현재 형식에 이름을 붙이는 기준선이다. 이후 내용 변환은 별도 고정 ID의
순차 마이그레이션과 출발/도착 버전·허용 변환·검증·중단/복구 규칙을 코드·테스트로
추가해야 한다. 현재 도구에 버전 2 이상으로 변경하는 옵션은 없다.
전역 버전 숫자만 변경해 기존 기준선의 도착 버전을 바꾸면 `migration_definition_mismatch`로
차단한다. 이미 배포한 마이그레이션 ID에 다른 변환을 덮어씌우지 않는다.

앱 시작·로그인에서 이 일괄 마이그레이션을 자동 실행하지 않는다. 기존 데모 seed와
로그인 내부의 과거 admin 역할 변환 등 이미 있던 동작은 별도이며 이번 기준선으로
이동시키지 않았다. 일반 API가 모든 미래 버전 문서를 자동 차단하는 기능도 아직
없으므로 기동·업데이트 전 조회 결과가 불명확하면 writer를 열지 않는다.

로컬 백업·격리 복구 도구와 실패 시 수동 되돌리기 절차는 별도 문서에 있다.
운영 백업 암호화·보관 정책·정기 리허설, 자동 잠금 해제, 자동 역마이그레이션·
DB 전환과 구버전 writer와의 동시 운영은 구현 범위 밖이다. 백업 참조나
schema_version을 바꾸는 것으로 복구했다고 처리하지 않는다.
장애 시 [대응 절차](../operations/INCIDENT_RESPONSE.md)를 따른다.

## 검증

- `backend/tests/test_migrations.py`: 조회 무변경, 적용 확인 인자, 고정 분류·대상, 잠금, 조건부 갱신, 상한·실패 기록, CLI 오류 비노출, 신규 생성 경로 정적 검증
- `backend/integration_tests/test_migrations.py`: 실제 MongoDB의 20개 컬렉션 합성 문서·바이너리·revision 보존, 무변경 조회, 재실행·부분 실패 재개·미래/잘못된 버전·잠금·신규 발화/학습 버전

통합 테스트는 환경의 기존 DB가 아니라 `pesc_mate_migration_test_`와 UUID로 만든
각자의 임시 DB만 사용한다. 정리 전 이름 전체·접두사·환경 DB와의 불일치를 확인하고
테스트 DB만 삭제한다. 합성 fixture 참조는 실제 운영 백업·복구 검증 증빙이 아니다.
일반 단위 테스트와 별도로 실행하며 CI의 MongoDB integration and browser workflows
작업에서도 브라우저 시험 전에 실행한다. 호스트 백업 통합 시험은 이 실행에 포함하지 않는다.

의존성을 준비한 backend 디렉터리에서, 테스트용 MongoDB 연결을 확인한 뒤 실행한다.

```powershell
python -m unittest discover -s integration_tests -p "test_*.py" -v
```

2026-10-17 최종 백엔드 단위 테스트 235개와 실제 임시 DB 통합 테스트 5개를 통과했다.
Windows Chrome·로컬 스택에서 브라우저 전체 25개도 통과해 새 버전 문서와 기존
누락 문서가 함께 있는 상태의 로그인·기기 음성·카드·학습·동기화·보드 충돌을 확인했다.
기존 `pesc_mate`에는 조회 전용으로 legacy 283건·future/invalid 0건을 확인했으며
일괄 적용하지 않았다. 수치는 그 조회 시점의 값이고 이후 시험·TTL에 따라 변할 수 있다.
이번에 프런트엔드 코드는 변경하지 않았고 프런트엔드 단위 테스트·빌드 및 원격 CI는
재실행하지 않았다. 실제 운영 백업·복구와 태블릿 검수는 이 결과에 포함하지 않는다.
