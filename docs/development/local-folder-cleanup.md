# 로컬 숨김 폴더 정리 기록

2026-11-17 사용자의 요청으로 프로젝트 루트의 점으로 시작하는 폴더를 정리했다.

## 삭제한 폴더

현재 Codex 작업에 사용하지 않는 다른 AI 도구용 설정 10개를 삭제했다.

```text
.commandcode
.cursor
.grok
.kilo
.kimi-code
.kiro
.opencode
.pi
.qwen
.zcode
```

이 폴더들은 Git 추적 대상이 아니었다. 도구별 설정과 중복 에이전트 연결을 제거했으며,
심볼릭 링크는 링크 자체만 삭제하고 대상인 `.agents`와 `.codex`는 보존했다.
해당 AI 도구를 다시 사용할 경우 도구별 설정을 다시 구성해야 한다.

브라우저 레이아웃 검사로 생성된 `.local-validation/promo-layout/`와
`.local-validation/promo-presentation/` 안의 임시 `chrome-*` 프로필도 정리했다.
검사 결과 JSON과 스크린샷은 유지했다.

## 보존한 폴더

| 폴더 | 보존 이유 |
|---|---|
| `.git` | 프로젝트 이력과 브랜치 |
| `.agents`, `.codex` | 현재 에이전트의 스킬 및 설정 |
| `.githooks` | 활성 Git 커밋 훅 |
| `.github` | 워크플로 및 GitHub 도구 설정 |
| `.vscode` | 편집기 설정 |
| `.serena` | 프로젝트 코드 탐색 설정과 메모리 |
| `.local-backups` | 데이터베이스 백업 |
| `.local-voice-design` | 음성 합성에 필요한 원본 참조 자료 |
| `.local-validation` | 카드 음성 재개 파일과 검증 결과 |

`.env`는 폴더가 아닌 인증 설정 파일이며 수정하거나 삭제하지 않았다.
`docs/PROJECT_GUIDE.md`에서 보존하도록 지정한 음성 생성 자료는 삭제하지 않았다.

## 확인 범위

- 삭제 대상의 절대경로가 작업 폴더 내부인지 확인했다.
- 재분석 지점과 심볼릭 링크의 목적지로 재귀 진입하지 않았다.
- 보존 대상 폴더와 공통 스킬 경로가 남아 있음을 확인했다.
- 앱 소스 변경이 없어 앱 빌드 및 테스트는 재실행하지 않았다.
- 발표 대본은 Git에서 제외된 루트 임시 파일 대신
  `docs/presentation-rehearsal.md`로 작성하고 README에서 연결했다.
- 대본은 시연 포함 약 2분 40초를 목표로 작성했으며 실제 낭독 시간은 미측정이다.
