# 마이그레이션 전 로컬 백업과 격리 복구

## 범위와 중단 조건

`backend/app/mongo_backup.py`는 **현재 로컬 Compose MongoDB 전용** 호스트 CLI다.
Python 표준 라이브러리, Docker Desktop, 실행 중인 `mongodb` 서비스의
`mongodump`·`mongorestore`·`mongosh`를 사용한다. 컨테이너에 Docker 소켓을
추가하지 않는다. 저장소의 `compose.yaml`과 `pesc-mate` 프로젝트를 명시하며 원격·인증 DB의 연결 정보를
인자로 받지 않는다. 별도 Compose 프로젝트·운영 환경에 그대로 사용하지 않는다.

현재 MongoDB 8.0.29 / Database Tools 100.18.0에서 합성 데이터로 검증했다.
백업과 복원은 승인된 호환 버전에서 실행하고 실행 전 실제 버전을 기록한다.
데이터·인덱스의 SHA-256 일치는 복원 정합성 검사이며 암호화·서명·접근 통제나
업무 과업·구버전 호환성 검증을 대신하지 않는다. 출처 불명의 아카이브를 넣지 않는다.

| 단계 | 보장과 제한 |
|---|---|
| `create` 기본값 | 실행 계획만 출력. Docker·DB·백업 파일에 접근하지 않음 |
| `create --apply` | 대상명·쓰기 중단 선언 필요. 전체 DB의 일반 컬렉션을 압축 BSON 아카이브로 저장 |
| `inspect` | 고정 파일명의 크기·체크섬 검사. 복원 성공이나 현재 source 상태를 보증하지 않음 |
| `restore` 기본값 | 체크섬과 새 대상의 비어 있음만 조회. DB 생성·복원하지 않음 |
| `restore --apply` | UUID 이름의 새 DB만 허용. 문서·컬렉션 옵션·인덱스 지문이 같을 때만 검증 영수증 생성 |

원본 DB나 기존 컬렉션이 있는 DB로는 복원할 수 없다. `--drop`, 자동 DB 삭제,
기존 DB 병합, 설정 변경, 서비스 재시작, 자동 역마이그레이션은 제공하지 않는다.
뷰·시스템 컬렉션·시계열 등 지원하지 않는 구조와 전용 잠금 이름의 컬렉션은 거절한다.

## 백업 범위와 비밀 취급

- DB의 모든 일반 컬렉션과 메타데이터를 포함한다. 사용자·연결·권한·보드 revision·발화/학습 기록·오프라인 UUID·TTL 인덱스·마이그레이션 기록도 대상이다.
- 현재 개인 프로필과 제출 카드의 이미지 바이트는 MongoDB 문서에 저장되므로 포함된다. 정적 카드·프로필 자산·소스는 Git 커밋으로 별도 보존한다.
- `.env`, 외부 업로드 저장소, Docker 볼륨 전체, 브라우저 IndexedDB·전송 대기열·기기 음성·외부 모델은 이 DB 백업에 포함되지 않는다. 향후 저장 위치가 바뀌면 범위를 다시 검토한다.
- `.local-backups/backup_<UUID>/`에 `database.archive.gz`, `manifest.json`과 검증 영수증을 보관한다. 경로 이탈·심볼릭 링크/정션·기존 파일 덮어쓰기를 차단하고 Git에서 제외한다.
- **gzip은 암호화가 아니다.** 비밀번호 해시·세션 정보·개인 이미지와 기록이 들어 있다. 공유 폴더·공개 이슈·원격 저장소·채팅 첨부를 금지한다. Windows ACL과 디스크 암호화 등 승인된 접근 제한을 별도로 확인한다.
- 호스트 백업 외에 MongoDB 컨테이너의 `/tmp/pesc_mate_backup_<UUID>.archive.gz`를 잠시 사용한다. 정확히 생성한 파일만 정리하며 실패 시 `container_temporary_removed=false`가 반환될 수 있다. 오류 후 잔여 파일/불완전 백업도 민감 데이터로 취급하고 승인된 담당자가 정확한 경로를 확인해 정리한다.
- manifest·영수증은 DB 이름, 시각, 건수, 지문·체크섬만 담고 개별 ID·사용자·발화·이미지를 출력하지 않는다. 도구의 예외/표준 오류 원문도 CLI에 출력하지 않는다.

## 실행 순서

저장소 루트 PowerShell에서 실행한다. 아래 자리표시자는 **승인된 값으로 바꿔야 하며**
그대로 실행하면 거절된다. 실제 사용자 DB의 중단·백업·적용·전환은 별도 승인 작업이다.

1. TECH·LEAD가 환경, 대상 DB, 배포 커밋, 유지보수 시간, 백업 보관 위치·접근자를 확인한다. 복구 담당자와 승인자가 없으면 진행하지 않는다.
2. 모든 API 인스턴스·관리 스크립트·구버전 writer를 중단하고 진행 중 쓰기가 끝났는지 확인한다. MongoDB는 유지한다. 기기 문장·대기열을 지우거나 강제 로그아웃시키지 않는다.
3. 마이그레이션 조회 전용 결과와 저장소/배포 버전을 확인한다. HTTP 서버를 띄우지 않는 `docker compose run --rm --no-deps backend python -m app.migrations ... --dry-run`을 사용한다.
4. 아래 백업을 생성하고 격리 복원을 확인한다. `created_not_restore_verified`만으로 마이그레이션에 들어가지 않는다.
5. 백업 이후에도 writer를 계속 닫아 둔다. 검증 영수증과 source·시각·커밋을 확인한 backup ID만 마이그레이션의 `--backup-ref`에 넣는다. 두 CLI는 별개이며 migration CLI가 백업 파일·영수증을 자동 확인하는 것은 아니다.
6. [마이그레이션 규칙](../development/DATA_SCHEMA_MIGRATIONS.md)에 따라 적용·후검사한다. 실패하면 writer를 재개하지 말고 아래 실패 절차를 따른다.
7. 실제 과업·권한·이미지·보드·UUID·TTL·기기 대기 상태까지 확인한 뒤 승인된 writer만 재개한다. 실행 상태·백업 참조·검증·재개 승인을 제한된 운영 기록에 남긴다.

```powershell
$migrationDb = '<승인된 DB 이름>'
python backend/app/mongo_backup.py create --database $migrationDb
python backend/app/mongo_backup.py create --database $migrationDb --apply --confirm-database $migrationDb --writers-stopped
```

두 번째 결과에서 받은 `backup_id`를 사용한다. ID는 `backup_`와 소문자 UUID 32자리다.
임의 URI·전체 경로 대신 ID만 전달한다. 다른 백업을 덮어쓰지 않고 새 디렉터리를 만든다.

```powershell
$migrationBackupRef = '<생성 결과의 backup_id>'
python backend/app/mongo_backup.py inspect --backup-id $migrationBackupRef
$restoreDb = 'pesc_mate_restore_' + [guid]::NewGuid().ToString('N')
python backend/app/mongo_backup.py restore --backup-id $migrationBackupRef --target-database $restoreDb
python backend/app/mongo_backup.py restore --backup-id $migrationBackupRef --target-database $restoreDb --apply --confirm-database $restoreDb
```

성공 결과는 `restore_verified`이며 백업 디렉터리에 `<restoreDb>.verified.json`이 생긴다.
아카이브의 source 네임스페이스만 새 DB로 매핑하고 인덱스도 복원한다. `_id` 순서의
문서를 BSON 타입을 보존하는 EJSON으로 스트리밍 해시한다. 컬렉션 옵션·인덱스의
복합 키 순서도 해시에 포함한다. 값·행을 셸 출력으로 내보내거나 전체 목록을 메모리에
쌓지 않는다. 동일 대상 재실행은 거절하므로 새 UUID를 사용한다.

복구 대상의 고정 ID 잠금 insert로 동시 복구를 배제한다. 복원·지문 검사 실패 시 부분
데이터와 잠금은 격리 상태로 남기며 자동 삭제하지 않는다. 검사 통과 후 자신의 잠금만
제거한다. 이후 영수증 파일 기록이 실패하면 잠금이 없어도 성공으로 처리하지 않는다.
영수증은 그 시점의 검사 결과이지 이후 대상 DB의 변경/삭제 여부나 서비스 가용성을
보증하는 서명은 아니다. CLI 종료 코드 0도 `mode`와 `status`를 함께 확인한다.
실패는 코드 1과 고정 오류 코드, 인자 오류는 코드 2다.

## 일관성·TTL과 실패 처리

standalone `mongodump`는 동시 쓰기가 있을 때 한 시점의 스냅샷을 보장하지 않는다.
쓰기 중단 선언을 실제 중단으로 오인하지 않는다. 도구는 dump 전후에 source의 문서·
옵션·인덱스 지문이 같아야 manifest를 만든다. 이 비교만으로 동시 변경이 없었다는
증명이 되지는 않는다. 백업 후 다시 쓰기를 열었다면 이전 백업의 최신성을 가정하지 않는다.

API를 멈춰도 TTL 삭제는 계속될 수 있고 복원한 TTL 인덱스도 만료 문서를 삭제할 수
있다. 그 결과 지문이 달라지면 성공으로 간주하지 않고 차단한다. 운영 TTL을 자동으로
끄거나 만료 시각을 연장하지 않는다. 재시도해도 안정된 백업/복구를 만들 수 없으면
마이그레이션을 중단하고 별도 승인된 스냅샷/백업 설계를 사용한다.

| 상황 | 조치 |
|---|---|
| source 변경, dump/copy 실패 | manifest 없는 결과는 유효 백업이 아님. 원인·writer·TTL 확인 후 새 백업 생성 |
| 체크섬 불일치·manifest 오류 | 복원을 시작하지 않음. 값을 고쳐 통과시키지 말고 별도 정상 백업 확보 |
| 복원 오류·지문 불일치 | 원본 유지, 새 DB 격리. 실패 대상에서 서비스하지 않고 증거 보존 후 새 대상으로 재시도 |
| 마이그레이션 일부 적용 | 기준선 도구의 failed/잠금 상태 확인. 검증된 재개 또는 격리 복구 중 승인된 경로 선택 |
| 프로세스 단절/timeout | 서버 반영 여부가 불명확할 수 있음. 재실행·삭제 전에 실행 종료와 대상 상태부터 확인 |

## 실패 시 되돌리기 판단과 수동 전환

기본 선택은 원본을 보존한 채 원인을 해결하고 안전하게 재개하는 것이다. 기준선
마이그레이션은 이미 반영된 버전을 건너뛰어 재개할 수 있다. `schema_version`을
일괄 제거하거나 `schema_migrations`를 지워 복구했다고 처리하지 않는다.

데이터 복원이 필요한 경우 다음 절차를 따른다. **도구는 마지막 설정 전환을 실행하지 않는다.**

1. 장애 대응 책임자가 writer를 닫고 실패 DB·로그·배포 커밋·기기 미전송 상태를 보존한다. 원본 DB 삭제/덮어쓰기와 Docker 볼륨 제거를 금지한다.
2. 검증된 백업과 시점을 선택한다. 백업 이후 성공한 쓰기와 사용자에게 보인 결과, 개인정보 삭제·권한 회수·동의 철회·세션 폐기·오프라인 처리 UUID의 차이를 확인한다.
3. 백업을 **새 UUID DB**로 복원하고 지문 일치를 확인한다. 백업에 이미 있던 `schema_migrations`나 버전 상태도 그대로 복원하므로 필요 시 별도 검토한다.
4. 삭제된 개인정보·폐기된 세션/권한이 부활하거나 처리 완료 UUID가 사라져 중복 저장되지 않도록 승인된 정합성 보정과 검증을 수행한다. 자동 병합 도구는 없으므로 차이를 해결할 수 없으면 전환하지 않는다.
5. 복원 DB와 호환되는 정확한 앱 커밋·정적 자산·설정을 준비하고 모든 writer가 같은 DB를 바라보는지 검토한다. 단순 구버전 이미지 재기동만으로 데이터 롤백이 되지 않는다.
6. TECH·PRIVACY·LEAD의 필요한 검토/승인 후, 승인된 별도 설정에서 모든 backend의 `MONGODB_DATABASE`를 검증 DB 이름으로 함께 전환한다. 이 로컬 기본 Compose는 값을 고정하므로 셸 환경 변수만 바꿔 전환됐다고 가정하지 않는다. 변경 파일·대상·승인을 기록하고 그 구성으로 서비스를 재생성한다.
7. 쓰기를 열기 전 로그인·역할별 아동 접근·이미지·보드 revision·기록·재전송 중복 제거를 점검한다. 선택형 AI 실패가 의사소통을 막지 않는지도 확인한다. 새 오류나 권한 불일치면 재중단하고 임의로 이전/새 DB 쓰기를 섞지 않는다.
8. 재개 시각·손실/보정 범위·기기 재연결 결과를 기록한다. 원본/격리 DB·백업의 삭제는 보존·개인정보 정책에 따른 별도 승인 작업이다.

이 절차는 자동 전환 구현이나 운영 전환 리허설 완료가 아니다. 암호화·키 관리·
접근 통제·RPO/RTO·보관/삭제 전파·정기 복구·외부 저장소·배포 자동화는 A2-04에 남긴다.

## 과거 검증과 현재 상태

기존 백업 단위·통합 시험과 실행기는 2026-10-28 사용자 요청으로 제거했다.
실제 백업·복구 CLI와 기존 백업 자료는 유지한다. 과거 시험 결과는 현재 복구
리허설 완료를 뜻하지 않으며 운영 자료·설정 전환 리허설은 승인된 절차로 별도 수행해야 한다.

다음은 제거 전 당시의 실행 기록이다.

2026-10-18 백엔드 전체 단위 테스트 **252개**, 기존 마이그레이션 실제 DB 통합
테스트 **5개**, 호스트 백업·복원 통합 테스트 **4개**를 통과했다. 호스트 Windows의
별도 백업 단위 테스트는 17개 중 심볼릭 링크 권한이 없는 1개를 건너뛰었고, 같은
검사는 위 Linux 컨테이너 전체 단위 테스트에서 통과했다. 실패 격리 시험 뒤 자신의
합성 DB와 백업 파일만 정리했다. 프런트엔드 코드·빌드·브라우저 E2E·원격 CI와 실제
사용자 DB의 백업·적용·복구는 이번에 실행하지 않았다.

## 이미지 삭제·30일 수명 보강 — A1-04

이미지 원본이 전체 DB 백업에 포함되므로 [로컬 이미지 저장 정책](../development/LOCAL_IMAGE_STORAGE.md)의
삭제 시각 확인과 30일 보존 상한을 적용한다. `restore`는 소스의 최신 삭제 시각보다 오래된 백업과
만료된 백업을 계획 단계부터 거절한다. 소스 상태를 확인할 수 없을 때도 우회 복원하지 않는다.
`inspect`의 체크섬 유효 결과만으로 복원 가능 상태를 승인한 것은 아니다.

`python backend/app/mongo_backup.py purge --database pesc_mate`는 만료/삭제 이전 백업 목록만
보여 준다. 실제 파기는 작성자 중단·정확한 백업 루트 확인·`--apply`를 모두 요구한다.
안전하게 검증된 관리 archive·manifest·검증 영수증만 제거하고 알 수 없는 파일이나 링크가
있으면 중단한다. 파기된 백업은 복구할 수 없으며 외부에 복사한 사본은 별도 관리해야 한다.

## MongoDB 공식 근거

- [mongodump 예시와 일관성 주의](https://www.mongodb.com/docs/database-tools/mongodump/mongodump-examples/): gzip archive, 동시 쓰기 시 시점 일관성 제한.
- [mongorestore 옵션](https://www.mongodb.com/docs/database-tools/mongorestore/): gzip archive, namespace 포함/재매핑, 오류 중단.
- [복원 호환성과 동작](https://www.mongodb.com/docs/database-tools/mongorestore/mongorestore-behavior-access-usage/): source/target 버전 호환성 확인.
