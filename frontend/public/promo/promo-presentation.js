// Exhibition loop; use manual chapter controls for the capstone talk.
export const chapters = [
  { label: '서비스 소개', eyebrow: 'PECS · 그림교환 의사소통 체계', title: '그림카드로\n마음을 전해요.', description: '그림카드를 상대에게 건네며\n원하는 것을 표현하는 방법, PECS.\n이 경험을 실물 카드와 웹으로 연결해요.', note: 'Picture Exchange Communication System · 디지털 AAC(보완대체의사소통) 서비스', duration: 8000, visual: 'demo', tags: ['그림카드', '문장 구성', '음성 출력'], cues: [[0, 0]] },
  { label: '제작 배경', eyebrow: '01 / 사용 대상과 해결할 문제', title: '늘어나는 카드,\n더 간편하게.', description: '말로 의사를 표현하기 어려운 아동과\n카드를 준비하는 보호자·담당자를 위해.\n휴대·분류·관리의 부담을 줄이고자 했어요.', note: '익숙한 그림은 유지하고, 필요한 표현은 사용자에 맞게', duration: 9000, visual: 'demo', tags: ['아동의 의사 표현', '보호자·담당자 지원'], cues: [[0, 1]] },
  { label: '말하기 시연', eyebrow: '02 / 그림으로 말하기', title: '고르고, 모으고,\n목소리로 전해요.', description: '선택한 카드로 짧은 한국어 문장을 만들고,\n선택한 아이 목소리로 전달해요.', note: '자동 시연은 무음 예시 · 실제 앱에서 문장 생성과 음성 출력', duration: 18000, visual: 'demo', tags: ['카드 선택', 'Qwen 문장 생성', '로컬 Qwen TTS'], cues: [[0, 1], [2000, 2], [4500, 3], [7000, 4], [10000, 5], [13000, 6]] },
  { label: '맞춤 카드', eyebrow: '03 / 나만의 그림카드', title: '우리 아이에게\n필요한 표현으로.', description: 'Gemini로 그림 시안을 만들고,\nTesseract OCR로 카드 사진의 글자를 읽어요.\n확인한 결과를 등록·편집하고 인쇄해요.', note: '익숙한 실물 카드도 디지털로 함께', duration: 10000, visual: 'cards', tags: ['Gemini 그림 생성', 'OCR 문자 인식', '카드 인쇄'], cues: [[0, 4]] },
  { label: 'RFID 연결', eyebrow: '04 / 실물 카드와 웹의 연결', title: '카드를 태그하면,\n화면의 문장으로.', description: 'RFID 태그를 읽은 실물 카드가\nUSB 시리얼 연결을 통해\n디지털 문장에 추가됩니다.', note: 'Arduino + RC522 RFID 리더기', duration: 12000, visual: 'rfid', tags: ['실물 카드', 'RFID 인식', '디지털 문장'], cues: [[0, 4]] },
  { label: 'AI 활용 기술', eyebrow: '05 / 인공지능 활용과 직접 구현', title: '네 가지 AI를,\n하나의 의사소통으로.', description: '문장·음성·그림 생성과 문자 인식을 연결.\n생성 문장은 검증하고, 그림과 카드명은\n보호자가 확인한 뒤 사용해요.', note: '기존 AI 모델 활용 · 웹/API/DB 통합 구현 · 향후 계획: 아동별 학습지', duration: 10000, visual: 'journey', tags: ['외부 API + 로컬 AI', '결과 검증', '사용자 확인'], cues: [[0, 7]] },
  { label: '시스템 구조', eyebrow: '06 / 전체 시스템 아키텍처', title: '입력부터 음성까지,\n하나로 연결합니다.', description: '사용자와 실물 카드의 입력을 웹과 서버에서 처리하고, 데이터와 AI로 연결합니다.', note: '현재 로컬 시연 구성', duration: 15000, visual: 'architecture', tags: ['React', 'FastAPI', 'MongoDB', 'Docker Compose'], cues: [[0, 7]] },
  { label: '함께 체험하기', eyebrow: 'PECS MATE', title: '작은 선택이\n나의 목소리가 되도록.', description: '그림카드 등록부터 문장 구성, 음성 출력까지.\n옆의 시연 스테이션에서 직접 만나보세요.', note: '유한대학교 · 인공지능전공 · 캡스톤디자인', duration: 8000, visual: 'demo', tags: ['그림카드로 마음을 전해요'], cues: [[0, 10]] },
];
export const totalDuration = chapters.reduce((sum, chapter) => sum + chapter.duration, 0);
export function demoStepAt(chapter, elapsed) {
  return chapter.cues.reduce((step, [time, next]) => elapsed >= time ? next : step, chapter.cues[0][1]);
}
