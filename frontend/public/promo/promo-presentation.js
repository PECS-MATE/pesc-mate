// Seven-chapter exhibition loop; use manual chapter controls for the capstone talk.
export const chapters = [
  { label: '서비스 소개', eyebrow: 'PECS · 그림교환 의사소통 체계', title: '그림카드로\n마음을 전해요.', description: '그림카드를 상대에게 건네며\n원하는 것을 표현하는 방법, PECS.\n이 경험을 실물 카드와 웹으로 연결해요.', note: 'Picture Exchange Communication System · 디지털 AAC(보완대체의사소통) 서비스', duration: 8000, visual: 'demo', tags: ['그림카드', '문장 구성', '음성 출력'], cues: [[0, 0]] },
  { label: '제작 배경', eyebrow: '01 / 사용 대상과 해결할 문제', title: '늘어나는 카드,\n더 간편하게.', description: '말로 의사를 표현하기 어려운 아동과\n카드를 준비하는 보호자·담당자를 위해.\n휴대·분류·관리의 부담을 줄이고자 했어요.', note: '익숙한 그림은 유지하고, 필요한 표현은 사용자에 맞게', duration: 9000, visual: 'demo', tags: ['아동의 의사 표현', '보호자·담당자 지원'], cues: [[0, 1]] },
  { label: '말하기 시연', eyebrow: '02 / 그림으로 말하기', title: '고르고, 모으고,\n목소리로 전해요.', description: '선택한 카드로 짧은 한국어 문장을 만들고,\n선택한 아이 목소리로 전달해요.', note: '자동 시연은 무음 예시 · 실제 앱에서 문장 생성과 음성 출력', duration: 18000, visual: 'demo', tags: ['카드 선택', 'Qwen 문장 생성', '로컬 Qwen TTS'], cues: [[0, 1], [2000, 2], [4500, 3], [7000, 4], [10000, 5], [13000, 6]] },
  { label: '맞춤 카드', eyebrow: '03 / 나만의 그림카드', title: '우리 아이에게\n필요한 표현으로.', description: '그림과 단어를 직접 등록·편집하고,\n인쇄해서 실물 카드로도 사용해요.\n기존 카드 사진의 글자도 인식할 수 있어요.', note: '익숙한 실물 카드도 디지털로 함께', duration: 10000, visual: 'cards', tags: ['직접 등록·편집', '카드 인쇄', '사진 글자 인식'], cues: [[0, 4]] },
  { label: 'RFID 연결', eyebrow: '04 / 실물 카드와 웹의 연결', title: '카드를 태그하면,\n화면의 문장으로.', description: 'RFID 태그를 읽은 실물 카드가\nUSB 시리얼 연결을 통해\n디지털 문장에 추가됩니다.', note: 'Arduino + RC522 RFID 리더기', duration: 12000, visual: 'rfid', tags: ['실물 카드', 'RFID 인식', '디지털 문장'], cues: [[0, 4]] },
  { label: '발전 과정', eyebrow: '05 / 제작 발전 과정', title: '기본 AAC에서\n실물 카드 연결까지.', description: '웹 화면과 API, MongoDB를 연결하고,\n문장 생성·음성·RFID를 통합했어요.', note: '향후 계획 · 아동별 학습지 제작 기능', duration: 10000, visual: 'journey', tags: ['React', 'FastAPI', 'MongoDB', 'RFID'], cues: [[0, 7]] },
  { label: '함께 체험하기', eyebrow: 'PECS MATE', title: '작은 선택이\n나의 목소리가 되도록.', description: '그림카드 등록부터 문장 구성, 음성 출력까지.\n옆의 시연 스테이션에서 직접 만나보세요.', note: '유한대학교 · 인공지능전공 · 캡스톤디자인', duration: 8000, visual: 'demo', tags: ['그림카드로 마음을 전해요'], cues: [[0, 10]] },
];
export const totalDuration = chapters.reduce((sum, chapter) => sum + chapter.duration, 0);
export function demoStepAt(chapter, elapsed) {
  return chapter.cues.reduce((step, [time, next]) => elapsed >= time ? next : step, chapter.cues[0][1]);
}
