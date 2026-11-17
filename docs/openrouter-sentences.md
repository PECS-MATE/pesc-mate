# OpenRouter를 통한 Qwen 문장 생성

카드 → 문장 생성만 OpenRouter API로 전환합니다. 문장 → 음성 제공자는 별도이며
이 설정으로 바뀌지 않습니다. PC에서 인터넷에 접속할 수 있어야 합니다.

## 설정

루트 `.env`에 다음 값을 저장합니다. API 키는 Git이나 `VITE_` 변수에 넣지 않습니다.

```dotenv
SENTENCE_PROVIDER=openrouter
OPENROUTER_API_KEY=your-key
OPENROUTER_MODEL=qwen/qwen3-30b-a3b-instruct-2507
OPENROUTER_TIMEOUT_SECONDS=8
OPENROUTER_MAX_TOKENS=96
```

```powershell
docker compose up -d --no-build backend frontend
```

기존 컨테이너가 있으면 변경된 환경변수로 재생성합니다. 네이티브 Python 서버를
실행한다면 서버 실행 환경에도 위 변수를 로드해야 합니다.

## 동작

- 서버에서 선택한 카드명과 문장 생성 지침을 OpenRouter에 전송합니다.
- 비추론 Qwen 모델에 짧은 존댓말 한 문장만 요청합니다. 출력 상한은 기본 96토큰입니다.
- 공급자 선택은 지연 시간 순이며, 100만 토큰당 입력 $0.50·출력 $1.00 이하의
  공급자로 제한합니다. 이는 요청 단가 제한이며 하루 누적 금액의 강제 한도가 아닙니다.
  총 지출은 OpenRouter 키의 사용 한도 및 충전액으로 별도 관리하세요.
- 시간 초과·인증·잔액 오류·불완전 응답은 로컬 규칙 문장으로 대체합니다.
- 기존 의미·안전 검증을 동일하게 수행합니다. 검증 실패 응답도 규칙 문장으로 대체합니다.
- 같은 사용자·카드 순서·카드 의미·모델·제공자·정책의 검증된 결과는 기존 5분 재사용
  로직을 사용합니다. 명시적인 재생성은 다시 API를 호출합니다.
- 모델 준비용 유료 호출은 자동 실행하지 않습니다.
- 기존 `/api/health`의 `checks.ollama` 항목에 `provider: openrouter`를 표시합니다.
  `configured_not_verified`는 키가 설정됐다는 뜻이며 실시간 API 상태를 보장하지 않습니다.

## 검증 기록

2026-11-17 개인정보 없는 두 예제로 실제 호출을 확인했습니다.

| 카드 | 소요 시간 | 입력/출력 토큰 | 결과 |
|---|---:|---:|---|
| 물, 마시다 | 1.34초 | 333 / 9 | 의미·안전 검증 통과 |
| 사과, 먹다 | 0.97초 | 334 / 11 | 의미·안전 검증 통과 |

위 시간은 문장 생성만 측정했으며, 음성 합성·재생 시간은 포함하지 않습니다.
네트워크·공급자 부하에 따라 달라집니다.

테스트:

```powershell
cd backend
.venv/Scripts/python.exe -m pytest tests/test_openrouter_sentences.py tests/test_sentence_reuse.py tests/test_model_warmup.py tests/test_communication.py -q
```

문장 생성을 다시 로컬로 돌리려면 `.env`의 `SENTENCE_PROVIDER=ollama`로 변경하고
백엔드를 재시작합니다.

공식 문서:
- https://openrouter.ai/docs/api/reference/overview
- https://openrouter.ai/qwen/qwen3-30b-a3b-instruct-2507
