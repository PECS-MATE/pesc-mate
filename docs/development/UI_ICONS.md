# UI 아이콘 규칙

UI 조작 아이콘은 Google Material Symbols **Outlined**로 통일한다.
기본 사양은 24px 원본·weight 400·FILL 0이며, 표시 크기는 기존 UiIcon의 size를 따른다.
즐겨찾기 선택 상태는 공식 별 FILL 1로 표시한다. 색상은 currentColor를 사용한다.

## 적용 방식

- 모든 화면에서 `UiIcon`을 사용한다. 새로운 손그림 SVG나 이모지를 조작 버튼에 추가하지 않는다.
- 공식 SVG 경로를 로컬 JS에 포함한다. Google Fonts CDN·외부 폰트·런타임 요청은 사용하지 않는다.
  앱 번들에 함께 포함되므로 아이콘 때문에 별도 네트워크 연결이 필요하지 않다.
- 아이콘은 장식으로 숨기고 실제 버튼·링크에 이름이나 aria-label을 제공한다.
- 열기·닫기 화살표용 CSS 마스크도 같은 공식 expand_more 도형을 사용한다.
- AAC 그림카드·마스코트·폴더 모양 카드의 테두리는 의미 콘텐츠와 레이아웃이므로 바꾸지 않는다.
  데이터 관계를 보여 주는 문장 속 화살표도 조작 아이콘과 구별한다.
- 공식 SVG는 0 -960 960 960 좌표와 면 채움을 사용한다. 기존 stroke 기반 경로를 섞지 않는다.

## 출처와 라이선스

- [Google Material Symbols 안내](https://developers.google.com/fonts/docs/material_symbols)
- [공식 원본 저장소](https://github.com/google/material-design-icons/tree/10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7/symbols/web)
- 고정 버전: `10ecc14790612ca8fd164e3f4ffe9c16fc50d5b7`
- Apache License 2.0 원문: `frontend/src/assets/material-symbols-LICENSE.txt`
- 원본에서 SVG의 path를 추출하고 공통 렌더러에서 크기·색상을 적용했다.

## 이름 대응

기존 컴포넌트 호출 이름은 호환성을 위해 유지한다.

| UiIcon 이름 | Google 아이콘 |
| --- | --- |
| `share` | `ios_share` |
| `menu` | `menu` |
| `home` | `home` |
| `message` | `chat` |
| `cards` | `style` |
| `grid` | `grid_view` |
| `chart` | `bar_chart` |
| `book` | `menu_book` |
| `accessibility` | `accessibility_new` |
| `check` | `check` |
| `check-square` | `fact_check` |
| `key` | `key` |
| `settings` | `settings` |
| `user` | `person` |
| `users` | `group` |
| `shield` | `verified_user` |
| `reader` | `contactless` |
| `tag` | `sell` |
| `volume` | `volume_up` |
| `volume-off` | `volume_off` |
| `arrow-left` | `arrow_back` |
| `arrow-right` | `arrow_forward` |
| `arrow-up` | `arrow_upward` |
| `arrow-down` | `arrow_downward` |
| `chevron-down` | `expand_more` |
| `chevron-right` | `chevron_right` |
| `chevron-left` | `chevron_left` |
| `search` | `search` |
| `close` | `close` |
| `undo` | `undo` |
| `refresh` | `refresh` |
| `erase` | `ink_eraser` |
| `trash` | `delete` |
| `sparkles` | `auto_awesome` |
| `star` | `star` |
| `text` | `text_fields` |
| `sequence` | `swap_horiz` |
| `heart` | `favorite` |
| `image` | `image` |
| `camera` | `photo_camera` |
| `download` | `download` |
| `info` | `info` |
| `logout` | `logout` |
| `plus` | `add` |
| `clock` | `schedule` |
| `folder` | `folder` |
| `print` | `print` |
| `save` | `save` |
| `edit` | `edit` |
| `copy` | `content_copy` |
| `discover` | `public` |
| `archive` | `inventory_2` |
| `pause` | `pause` |
| `play` | `play_arrow` |
| `stop` | `stop` |

## 반복 문구와 조작 버튼 단순화

- 공통 `IconButton`은 Google 아이콘과 `aria-label`·`title`을 함께 제공한다.
  기본 크기는 44×44px이며 원래 disabled·클릭·폼 전송 동작을 유지한다.
- 공유 목록 탭·새 카드판·복사·편집·공유 중단·삭제·닫기, 보호자 빠른 관리 도구,
  말하기 카드 도구·폴더 돌아가기·페이지 이동, 홈 카드 목록 이동,
  편집기의 쪽 추가·삭제·칸 비우기·인쇄·저장·새로고침, 마이페이지 돌아가기와 로그아웃을
  아이콘형으로 전환했다. 저장과 공개 요청의 아이콘·접근성 이름은 상태에 따라 바뀐다.
- 보호자 관리 화면의 반복 설명·온라인 상태 문장과 마이페이지 중복 소개를 줄였다.
- 모든 글자를 지우지는 않는다. 탐색 메뉴·페이지 제목·카드/폴더 이름·숫자 페이지·입력 라벨,
  권한·동의·승인/반려·오류와 파괴적 작업 확인은 사용자가 의미와 결과를 판단하도록 유지한다.
  아이콘 이름 자체를 외우도록 강제하거나 동의 내용을 장식 아이콘으로 대체하지 않는다.
- 기존 고정 버전에서 공식 아이콘 9종을 추가했다. 현재 기본 아이콘은 55종이다.

### 단순화 검증

- 프런트엔드 빌드·`git diff --check` 통과. 기존 큰 JS 청크 경고 유지.
- 격리 Chrome/모의 API에서 아이콘으로 공유 카드판 복사 → 편집 → 명시적 승인 요청,
  실제 출력 설정을 반영한 공유·양면 설정·중첩 취소를 확인했다.
- 보호자 여섯 도구의 이름·title·44px 이상 영역과 1440/390/320px 넘침 없음을 확인했다.
  Enter 키 활성화와 기존 메뉴·프로필 고정 검사도 통과했다.
- 첫 공유 검수는 검수 스크립트의 선택자 인용 오류로 실행되지 않아 보완 후 통과했다.
  첫 키보드 검수는 Chrome 입력의 Enter 문자·페이지 포커스 누락으로 실패했고,
  입력 조건을 보완한 재검사는 통과했다. 앱 이벤트 처리는 변경하지 않았다.
- 실제 iPad 터치·스크린리더·아이콘 의미 이해도·실계정 전체 왕복은 미실행이다.
  전체 문구 제거 또는 모든 화면 검수 완료로 간주하지 않는다.

## 검증 기록

- 프런트엔드 빌드와 `git diff --check` 통과. 기존 큰 JS 청크 경고 유지.
- 46종의 경로가 고정 버전 공식 SVG와 일치하고 JSX의 정적 UiIcon 이름이 모두 대응됨을 확인했다.
- 격리 Chrome에서 46종과 채워진 별의 도형·공통 좌표·접근성 숨김·색상 상속을 확인했다.
  외부 폰트 링크가 없고 네트워크를 끊어도 47개 SVG가 표시됨을 확인했다.
- 보호자 메뉴·프로필 고정 검사를 1440/390/320px에서 통과했다.
  공유 카드판 상세 → 독립 복사 → 편집 → 공유 확인과 모바일 넘침 검사도 통과했다.
- 첫 파일 적용 명령은 동일 파일에 삭제·추가를 함께 요청해 거절되었다.
  파일 업데이트 방식으로 수정해 정상 적용했다. 런타임/빌드 검증 실패는 없었다.
- 실제 iPad·스크린리더·실계정 전체 왕복 검수는 미실행이다. 새 영구 테스트 도구는 추가하지 않았다.
