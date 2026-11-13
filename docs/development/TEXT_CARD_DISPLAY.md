# 글자 카드 표시 수정

2026-11-13

- 글자 카드 등록 시 생성하는 `text-card.png`를 기존 이미지 파일명으로 구분한다. 카드 목록 응답의 선택 필드 `image_filename`으로 전달하며 DB 저장 형식은 바꾸지 않는다. 기존 카드도 목록 새로고침 후 적용된다.
- 말하기 카드와 카드 보기 목록에서 글자 카드는 중앙의 텍스트 한 번만 표시한다. 사진 카드는 그림과 하단 이름을 유지한다.
- 공통 카드와 카드 보기, 추천 카드 이름은 가운데 정렬한다. 글자 카드는 그림/글자 표시 설정과 관계없이 텍스트를 유지하고 글자 크기 설정을 따른다. 이미지 다운로드 실패 시에도 글자 카드의 텍스트는 표시한다.
- 선택과 즉시 발화 콜백, 접근성 이름을 유지한다.

## 검증

- `npm --prefix frontend test -- --run src/components/SpeakingCardTile.test.jsx`: 3개 통과. 글자 카드 중복 제거, 선택·발화, 사진 카드 유지, 이미지 미수신 시 텍스트 표시 확인.
- `/tmp/pesc-mate-refactor-venv/bin/python -m pytest backend/tests/test_program_and_visibility.py -q`: 5개 통과. 파일명 응답 전달 및 기존 카드 가시성·이미지 접근 권한 검증 포함. Starlette/httpx 사용 중단 예정 경고 1건.
- `git diff --check`: 통과.
- 브라우저 시각 확인과 실기기 검수는 미실행. 빌드는 요청에 따라 실행하지 않았다.
