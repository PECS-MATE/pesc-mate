# 포트폴리오 README 정리 기록

## 범위 — 2026-10-24

사용자 요청에 따라 루트 README를 프로젝트 마무리·포트폴리오 소개용으로 재구성한다.
제품 배경, 구현 기능, 설계 선택, 구조, 시연, 자동 검증과 남은 승인 조건을 구분한다.
기존 실행 안내의 상세 내용은 `docs/development/LOCAL_DEVELOPMENT.md`로 옮긴다.
애플리케이션 코드·설정·사용자 DB·사진·기존 TODO 완료 상태는 바꾸지 않는다.

## 근거와 표현 기준

| README 내용 | 대조 근거 |
|---|---|
| 실행 주소·개발 계정·선택형 모델 | compose.yaml, compose.tablet.yaml, backend/app/services/authentication.py, model.py |
| 기술·명령·지원 Node 범위 | 루트·frontend/package.json, backend/requirements.txt, backend/Dockerfile, frontend/vite.config.js |
| 카드판·사진·잠금·충돌 | 상황별 카드판·사진 등록/교체·로컬 이미지 저장 문서, 핵심 카드 잠금·보드 충돌 정책 |
| 동의 전 기본 사용의 범위 | GUARDIAN_CONSENT_FLOW.md, 개인정보 정책 |
| 두 학습 활동과 최신 검증 | SOUND_CARD_LEARNING.md, 통합 TODO |
| 전체 검증 810개가 해당하는 과거 범위 | SITUATION_BOARDS.md의 2026-10-24 전체 실행 기록 |
| 실제 기기·운영 승인 미완료 | ACTUAL_USE_VALIDATION.md, 통합 TODO의 완료 게이트 |

최신 기능 커밋 `5ac2902`의 범위별 결과와 앞선 전체 810개 결과를 합산하지 않는다.
Chromium의 음성 재생 스텁과 실제 기기 음질 검수의 차이를 명시한다.
최신 변경까지 포함한 전체 `verify:full`을 통과했다고 표현하지 않는다.
개인 기여 비율·사용자 수·임상 효과·운영 배포·라이선스는 확인 없이 주장하지 않는다.
새 스크린샷 대신 저장소의 기존 마스코트만 사용한다.

## 문서 검증

- Markdown 로컬 링크·README 내부 앵커·마스코트 경로 확인: 통과.
  4개 문서의 로컬 링크 77개·내부 앵커 4개·이미지 1개를 확인하고 코드 펜스 짝도 검사했다.
- README·로컬 가이드의 npm 명령과 package.json 스크립트 대조: 5개 통과.
- `node scripts/verify.mjs full --dry-run`: 종료 코드 0, 전체 실행 계획 확인.
  Docker 기동이나 실제 테스트 실행을 의미하지 않는다.
- `git diff --check`: 통과.

앱 테스트·빌드·실제 Docker 기동·전체 통합/E2E는 이 문서 전용 변경에서 **미실행**이다.
기존 기능 검증은 위 근거 문서의 당시 결과를 인용하며 새 실행으로 취급하지 않는다.
GitHub Markdown/Mermaid 렌더링·실제 태블릿·스크린리더 확인도 **미실행**이다.
원격 푸시와 배포는 수행하지 않는다.
