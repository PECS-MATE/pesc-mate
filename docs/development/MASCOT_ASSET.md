# PESC MATE 마스코트

- 자산: `frontend/src/assets/pesc-mate-mascot.png`
- 생성 도구: 내장 image_gen 도구와 imagegen 스킬
- 형식: 투명 배경 PNG. 생성 원본의 알파 채널을 그대로 보존했다.
- 기존 초안 파일이 없어 새 자산으로 생성했다.
- 적용: 로그인, 홈 제목과 세 활동 메뉴, 도움말, 문장 보드와 카드 및 기록의 빈 상태.
- 장식 이미지로 사용하여 대체 텍스트는 비우고, 기능과 안내는 주변 텍스트로 제공한다.
- 홈 메뉴는 말풍선, 통계, 그림 아이콘으로 기능을 구분한다.

## 최종 생성 프롬프트

```text
Use case: illustration-story. Asset type: a single reusable mascot PNG for PESC MATE, a gentle Korean picture-card communication web app for children. Primary request: create one original friendly small rounded speech-bubble creature with a warm cream body, simple dark eyes, a small reassuring smile, short rounded arms and feet, and a small teal accent. One hand waves hello. Soft flat children's illustration, clean thick smooth outlines, restrained pastel teal and warm yellow accents matching a white, pale-yellow and teal interface. Centered full body, generous clear margins, clear silhouette readable at 48 pixels. Genuinely transparent background with alpha, no ground plane, no checkerboard, no text, no letters, no watermark, no extra objects or other characters. One square image, not a sprite sheet. This is a final web application asset.
```
