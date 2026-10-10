# 역할별 브라우저 E2E

Playwright가 실제 브라우저에서 AAC 사용자, 보호자, 일반 담당자, 운영 권한 담당자의 로그인과 메뉴 접근 경계를 확인한다.

## 실행

애플리케이션 전체를 먼저 실행한다.

```powershell
docker compose up -d
cd frontend
npm run test:e2e
```

Windows에서는 설치된 Chrome을 자동으로 사용한다. 다른 브라우저 실행 파일을 사용하려면 `PLAYWRIGHT_BROWSER_PATH`에 절대 경로를 지정한다. Windows 이외의 환경이나 CI에서는 `npx playwright install --with-deps chromium`으로 Playwright 브라우저를 준비한다.

기본 프런트엔드 주소는 `http://127.0.0.1:5173`이며 API는 같은 출처의 `/api`를 사용한다. 다른 서버를 검증하려면 `E2E_BASE_URL`을 지정하고, API를 별도 출처로 직접 검증할 때만 `E2E_API_BASE_URL`을 지정한다.

## 검증 범위

- AAC 사용자에게 의사소통·학습 메뉴만 표시되는지 확인
- AAC 사용자의 다른 아동 대시보드 직접 API 요청이 403인지 확인
- 보호자와 일반 담당자에게 공용 콘텐츠 운영 메뉴가 숨겨지는지 확인
- 콘텐츠 운영 권한을 가진 담당자에게만 운영 메뉴가 표시되는지 확인

실패하면 `frontend/test-results`에 HTML 보고서, 화면, 브라우저 콘솔, 네트워크 요청이 포함된 trace를 남긴다. 이 디렉터리는 테스트 산출물이므로 Git에는 포함하지 않는다.
