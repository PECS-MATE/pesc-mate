# 오프라인 사용 및 한국어 음성 정책

## 구현 범위

- 프로덕션 빌드는 서비스 워커로 앱 셸과 이미 한 번 사용한 정적 자산을 캐시한다. `/api/` 응답은 서비스 워커 캐시에 넣지 않는다.
- 로그인에 성공한 AAC 사용자의 기본·개인 카드, 개인 카드 이미지, 추천, 음성·접근 설정과 최소 화면 상태는 브라우저의 origin 단위 IndexedDB에 저장한다.
- 서버 연결이 끊기면 인증 토큰을 임의로 지우지 않고 마지막 저장본으로 진입한다. 오프라인 계정 저장본도 서버가 발급한 12시간 세션 만료 시각까지만 사용한다. 즉시 발화와 선택 카드 그대로 발화는 Web Speech API를 통해 계속 실행한다. 서버가 필요한 자연 문장 생성은 연결 전까지 비활성화한다.
- 로그아웃과 이용 데이터 삭제 시 계정 저장본과 대기 중 이력을 기기에서도 제거한다. IndexedDB는 디스크 암호화를 자체 제공하지 않으므로 공용 기기에서는 반드시 로그아웃한다.
- 오프라인 발화 이력에는 UUID, 이벤트 유형, 카드 ID와 시각만 저장하며 발화 원문은 저장하지 않는다. 재연결하면 동일 UUID로 재시도하고 서버 확인을 받은 항목만 삭제한다.

처음 설치하는 기기에서는 온라인 상태로 한 번 로그인하고 카드와 설정을 모두 불러와야 한다. 브라우저 저장 공간 삭제, 시크릿 모드 종료 또는 사이트 데이터 초기화 후에는 다시 온라인 준비가 필요하다.

## 한국어 음성 지원 판단

웹 앱은 `speechSynthesis.getVoices()`가 현재 기기에서 제공하는 음성만 사용한다. 이 API가 기기의 사용 가능 음성 목록을 반환한다는 점은 [MDN Web Speech API 문서](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices)를 기준으로 한다. 브라우저 이름만으로 오프라인 재생을 보장하지 않고, `ko` 음성과 `localService` 표시 및 실제 비행기 모드 재생을 함께 확인한다.

| 환경 | 현장 준비 | 판정 및 대체 |
|---|---|---|
| Windows 10/11 + Edge/Chrome | Windows 음성 설정에서 한국어 음성을 내려받는다. Microsoft는 한국어 Heami와 자연 음성 InJoon·SunHi를 안내하며 내려받은 자연 음성은 기기에서 인터넷 없이 작동한다고 설명한다. | 앱의 미리 듣기를 실행한 뒤 네트워크를 끄고 다시 재생한다. 실패하면 Windows 내레이터 또는 설치된 한국어 음성을 먼저 확인한다. |
| macOS + Safari/Chrome | 시스템 설정 → 손쉬운 사용 → 읽기 및 말하기에서 한국어 시스템 음성을 내려받는다. | 브라우저별 노출 음성이 다를 수 있으므로 두 브라우저에서 각각 비행기 모드 시험을 한다. 실패하면 macOS의 선택 항목 말하기 또는 Live Speech를 사용한다. |
| iPhone/iPad + Safari 홈 화면 | 설정 → 손쉬운 사용 → VoiceOver/콘텐츠 말하기에서 한국어 음성을 선택하고 필요한 고품질 음성을 Wi‑Fi에서 내려받는다. | Safari Web Speech 재생을 비행기 모드에서 확인한다. 실패하면 iOS Live Speech에 같은 문구를 입력하거나 화면의 카드·문장을 상대에게 보여 준다. |
| Android + Chrome | 설정 → 접근성 → 텍스트 음성 변환 출력에서 엔진·한국어를 선택하고 `음성 데이터 설치`를 완료한다. 제조사별 엔진이 다를 수 있다. | Chrome에서 미리 듣기 후 비행기 모드 시험을 한다. 실패하면 기기 TTS 엔진을 Google 또는 제조사 엔진으로 바꾸거나 카드·문장 텍스트를 보여 준다. |

설치 근거와 경로는 [Microsoft 한국어 음성 및 설치 안내](https://support.microsoft.com/ko-kr/accessibility/windows/narrator/appendix-a-supported-languages-and-voices), [Microsoft의 내려받은 자연 음성 오프라인 안내](https://support.microsoft.com/en-us/accessibility/windows/narrator/complete-guide-to-narrator), [Apple macOS 음성 다운로드 안내](https://support.apple.com/en-ph/guide/mac-help/mchlp2290/mac), [Apple iPhone/iPad 음성 다운로드 안내](https://support.apple.com/en-ie/111798), [Android 음성 데이터 설치 안내](https://support.google.com/accessibility/android/answer/6006983)를 따른다.

## 배포 전 비행기 모드 점검

1. 온라인으로 로그인하고 개인 카드 이미지, 접근 설정과 음성 설정을 연다.
2. 한국어 미리 듣기를 재생한 뒤 브라우저를 완전히 종료하고 비행기 모드를 켠다.
3. 앱을 다시 열어 `도와주세요` 즉시 발화와 `물 → 마시다` 선택 카드 발화를 실행한다.
4. 새로고침 후에도 개인 카드 그림과 설정이 복원되는지 확인한다.
5. 발화 2건을 만든 뒤 네트워크를 연결하고 대기 건수가 0으로 바뀌는지 확인한다.
6. 같은 이벤트 UUID를 다시 보내 서버에 한 건만 남는지 확인한다.

어느 단계든 실패하면 해당 기기는 현장 기본 기기로 승인하지 않는다. 중요한 의사표현은 화면 텍스트와 그림을 항상 유지하며, OS의 Live Speech/텍스트 음성 변환 기능을 대체 수단으로 준비한다.
