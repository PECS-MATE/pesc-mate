// Copy adapted from the supplied seven-page capstone PDF.
export const chapters = [
  { label: '서비스 소개', eyebrow: '그림카드로 연결하는 의사소통', title: '그림카드로\n마음을 전해요.', description: '실물 그림카드와 디지털 AAC를 연결하는\n우리의 의사소통 파트너, PECS MATE.', note: '유한대학교 · 인공지능전공 · 캡스톤디자인', duration: 8000, visual: 'demo', tags: ['그림카드', '문장 구성', '음성 출력'], cues: [[0, 0]] },
  { label: '제작 배경', eyebrow: '01 / 제작 배경', title: '늘어나는 카드,\n더 간편하게.', description: '휴대·분류·관리가 어려웠던 실물 카드.\n필요한 표현을 디지털로 모으고,\n아이에게 맞는 카드로 준비해요.', note: 'AAC · 보완대체의사소통', duration: 9000, visual: 'demo', tags: ['디지털 카드 관리', '맞춤형 표현'], cues: [[0, 1]] },
  { label: '말하기 시연', eyebrow: '02 / 그림으로 말하기', title: '고르고, 모으고,\n목소리로 전해요.', description: '그림카드를 선택하고 나의 문장에 담아요.\n완성한 문장은 음성으로 전달해요.', note: '자동 시연 예시 · 전시 화면은 무음으로 재생됩니다', duration: 18000, visual: 'demo', tags: ['01 카드 선택', '02 문장 조합', '03 음성 출력'], cues: [[0, 1], [2000, 2], [4500, 3], [7000, 4], [10000, 5], [13000, 6]] },
  { label: '맞춤 카드', eyebrow: '03 / 나만의 그림카드', title: '우리 아이에게\n필요한 표현으로.', description: '그림과 단어를 직접 등록·편집하고,\n인쇄해서 실물 카드로도 사용해요.\n기존 카드 사진의 글자도 인식할 수 있어요.', note: '익숙한 실물 카드도 디지털로 함께', duration: 10000, visual: 'cards', tags: ['직접 등록·편집', '카드 인쇄', '사진 글자 인식'], cues: [[0, 4]] },
  { label: 'RFID 연결', eyebrow: '04 / 실물 카드와 웹의 연결', title: '카드를 태그하면,\n화면의 문장으로.', description: 'RFID 태그를 읽은 실물 카드가\nUSB 시리얼 연결을 통해\n디지털 문장에 추가됩니다.', note: 'Arduino + RC522 RFID 리더기', duration: 12000, visual: 'rfid', tags: ['실물 카드', 'RFID 인식', '디지털 문장'], cues: [[0, 4]] },
  { label: '발전 과정', eyebrow: '05 / 제작 발전 과정', title: '기본 AAC에서\n실물 카드 연결까지.', description: '필요한 기능을 하나씩 연결하며\n의사소통의 범위를 넓혀왔어요.', note: '향후 계획 · 아동별 학습지 제작 기능', duration: 10000, visual: 'journey', tags: ['카드·문장·음성', '맞춤 카드', 'RFID', '글자 인식'], cues: [[0, 7]] },
  { label: '함께 체험하기', eyebrow: 'PECS MATE', title: '작은 선택이\n나의 목소리가 되도록.', description: '그림카드 등록부터 문장 구성, 음성 출력까지.\n옆의 시연 스테이션에서 직접 만나보세요.', note: '유한대학교 · 인공지능전공 · 캡스톤디자인', duration: 8000, visual: 'demo', tags: ['그림카드로 마음을 전해요'], cues: [[0, 10]] },
];
export const totalDuration = chapters.reduce((sum, chapter) => sum + chapter.duration, 0);
export function demoStepAt(chapter, elapsed) {
  return chapter.cues.reduce((step, [time, next]) => elapsed >= time ? next : step, chapter.cues[0][1]);
}
