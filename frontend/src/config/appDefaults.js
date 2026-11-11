export const TEXT_CARDS = [
  { id: 'confirm', label: '맞아요', category: '요청과 선택', meaning: '내용이 맞다는 긍정 확인' },
  { id: 'deny', label: '아니에요', category: '요청과 선택', meaning: '내용이 아니라는 부정 확인' },
  { id: 'wrong_tap', label: '잘못 눌렀어요', category: '요청과 선택', meaning: '실수로 카드를 선택했음을 알림' },
  { id: 'not_that', label: '그 뜻이 아니에요', category: '요청과 선택', meaning: '전달된 의미가 의도와 다름을 알림' },
  { id: 'hold_on', label: '잠깐만요', category: '요청과 선택', meaning: '잠시 기다려 달라는 요청' },
  { id: 'say_again', label: '다시 말할게요', category: '요청과 선택', meaning: '자신이 다시 표현하겠다고 알림' },
  { id: 'please_wait', label: '제 말을 기다려 주세요', category: '요청과 선택', meaning: '자신이 표현할 때까지 기다려 달라는 요청' },
  { id: 'dont_understand', label: '질문을 잘 모르겠어요', category: '요청과 선택', meaning: '상대의 질문을 이해하지 못했음을 알림' },
  { id: 'change_it', label: '바꿔 주세요', category: '요청과 선택', meaning: '선택한 대상을 바꿔 달라는 요청' },
  { id: 'show_me', label: '보여 주세요', category: '요청과 선택', meaning: '대상을 보여 달라는 요청' },
  { id: 'slow_down', label: '천천히 해 주세요', category: '요청과 선택', meaning: '진행 속도를 늦춰 달라는 요청' },
  { id: 'do_it_myself', label: '내가 할래요', category: '요청과 선택', meaning: '자신이 직접 하겠다는 의사 표현' },
  { id: 'want_rest', label: '쉬고 싶어요', category: '요청과 선택', meaning: '휴식이 필요함을 표현' },
  { id: 'now', label: '지금', category: '시간과 일정', meaning: '현재 이 순간을 나타내는 표현' },
  { id: 'later', label: '나중에', category: '시간과 일정', meaning: '현재보다 뒤의 때를 나타내는 표현' },
  { id: 'today', label: '오늘', category: '시간과 일정', meaning: '현재 날짜를 나타내는 표현' },
  { id: 'tomorrow', label: '내일', category: '시간과 일정', meaning: '오늘의 다음 날을 나타내는 표현' },
  { id: 'yesterday', label: '어제', category: '시간과 일정', meaning: '오늘의 전날을 나타내는 표현' },
  { id: 'morning', label: '아침', category: '시간과 일정', meaning: '하루 중 아침 시간대를 나타내는 표현' },
  { id: 'noon', label: '점심', category: '시간과 일정', meaning: '하루 중 점심 무렵의 시간대를 나타내는 표현' },
  { id: 'evening', label: '저녁', category: '시간과 일정', meaning: '하루 중 저녁 시간대를 나타내는 표현' },
  { id: 'hello', label: '안녕하세요', category: '사회적 표현', meaning: '상대방을 만났을 때 하는 인사' },
  { id: 'goodbye', label: '안녕히 가세요', category: '사회적 표현', meaning: '떠나는 상대방에게 하는 인사' },
  { id: 'thanks', label: '고마워요', category: '사회적 표현', meaning: '상대방에게 고마움을 전하는 표현' },
  { id: 'sorry', label: '미안해요', category: '사회적 표현', meaning: '상대방에게 사과하는 표현' },
  { id: 'okay', label: '괜찮아요', category: '사회적 표현', meaning: '괜찮다는 의사를 전하는 표현' },
];

export const CARD_META = Object.fromEntries([
  ['me', '나'], ['mom', '엄마'], ['water', '물'], ['rice', '밥'], ['apple', '사과'], ['milk', '우유'],
  ['drink', '마시다'], ['eat', '먹다'], ['go', '가다'], ['rest', '쉬다'], ['play', '놀다'], ['help', '도와주세요'],
  ['toilet', '화장실'], ['home', '집'], ['happy', '좋아요'], ['hurt', '아파요'], ['no', '싫어요'], ['yes', '네'],
  ['stop', '그만'], ['more', '더'], ['again', '다시'], ['wait', '기다려 주세요'], ['unknown', '모르겠어요'], ['other', '다른 것'],
  ['head', '머리'], ['stomach', '배'], ['hand', '손'], ['leg', '다리'], ['here_hurts', '여기가 아파요'],
  ['uncomfortable', '불편해요'], ['scared', '무서워요'], ['noisy', '시끄러워요'], ['snack', '간식'],
  ['dad', '아빠'], ['teacher', '선생님'], ['school', '학교'], ['wash', '씻다'], ['wear', '입다'],
  ['take_off', '벗다'], ['sleep', '자다'], ['watch', '보다'], ['listen', '듣다'], ['take_out', '꺼내다'],
  ['put_in', '넣다'], ['close', '닫다'], ['open', '열다'], ['sit', '앉다'], ['stand', '일어나다'],
  ['come', '오다'], ['give', '주다'], ['please_give', '주세요'], ['want', '원해요'], ['refuse', '안 할래요'],
  ['finished', '끝났어요'], ['this', '이것'], ['alone', '혼자'], ['who', '누구'], ['what', '무엇'],
  ['hungry', '배고파요'], ['thirsty', '목말라요'], ['sleepy', '졸려요'], ['tired', '피곤해요'],
  ['hot', '더워요'], ['cold', '추워요'], ['itchy', '가려워요'], ['dizzy', '어지러워요'],
  ['water_bottle', '물병'], ['soap', '비누'], ['towel', '수건'], ['spoon', '숟가락'],
  ['plate', '접시'], ['toothpaste', '치약'], ['toothbrush', '칫솔'], ['fork', '포크'], ['tissue', '휴지'],
  ['blocks', '블럭'], ['doll', '인형'], ['puzzle', '퍼즐'], ['picture', '그림'], ['paper', '종이'],
  ['walk', '걷다'], ['draw', '그리다'], ['run', '뛰다'], ['wash_hands', '손 씻다'],
  ['read_book', '책을 읽다'], ['ride', '타다'], ['where', '어디'],
  ['cat', '고양이'], ['bear', '곰'], ['why', '왜'], ['doctor', '의사선생님'],
  ['friend', '친구'], ['grandmother', '할머니'], ['grandfather', '할아버지'],
  ...TEXT_CARDS.map(({ id, label }) => [id, label]),
].map(([id, label]) => [id, { id, label }]));

export const TTS_PRESETS = {
  girl: { label: '여자아이', rate: 0.9, pitch: 1.25 },
  boy: { label: '남자아이', rate: 0.9, pitch: 1.15 },
  ...(import.meta.env.VITE_TTS_PROVIDER === 'qwen3-tts' ? {} : {
    child: { label: '어린이 느낌', rate: 0.9, pitch: 1.25 },
    woman: { label: '여성 느낌', rate: 0.95, pitch: 1.05 },
    man: { label: '남성 느낌', rate: 0.85, pitch: 0.8 },
  }),
};

export const DEFAULT_TTS_SETTINGS = {
  preset: 'girl', voiceName: '', rate: 0.9, pitch: 1.25, volume: 1,
};

export function normalizeTtsSettings(settings = {}) {
  const preset = settings.preset || DEFAULT_TTS_SETTINGS.preset;
  return {
    preset: import.meta.env.VITE_TTS_PROVIDER === 'qwen3-tts'
      ? (['boy', 'man'].includes(preset) ? 'boy' : 'girl') : preset,
    voiceName: settings.voiceName ?? settings.voice_name ?? '',
    rate: settings.rate ?? DEFAULT_TTS_SETTINGS.rate,
    pitch: settings.pitch ?? DEFAULT_TTS_SETTINGS.pitch,
    volume: settings.volume ?? DEFAULT_TTS_SETTINGS.volume,
  };
}

export const DEFAULT_QUICK_EXPRESSIONS = [
  { id: 'hurt', label: '아파요', symbol: '🤕' },
  { id: 'no', label: '싫어요', symbol: '🙅' },
  { id: 'help', label: '도와주세요', symbol: '🤝' },
  { id: 'toilet', label: '화장실', symbol: '🚻' },
  { id: 'stop', label: '그만', symbol: '✋' },
];

export const RECOVERY_EXPRESSIONS = [
  { id: 'wrong_tap', label: '잘못 눌렀어요', symbol: '↩', fixed: true },
  { id: 'not_that', label: '그 뜻이 아니에요', symbol: '✕', fixed: true },
  { id: 'hold_on', label: '잠깐만요', symbol: '✋' },
  { id: 'say_again', label: '다시 말할게요', symbol: '↻' },
  { id: 'please_wait', label: '제 말을 기다려 주세요', symbol: '✋' },
  { id: 'dont_understand', label: '질문을 잘 모르겠어요', symbol: '?' },
  { id: 'yes', label: '맞아요', symbol: '✓' },
  { id: 'no', label: '아니에요', symbol: '✕' },
];

export const DEFAULT_ACCESSIBILITY = {
  display_mode: 'image_text', cards_per_page: 12, card_size: 'medium', text_size: 'medium',
  reduced_motion: false, high_contrast: false, start_screen: 'home', output_mode: 'natural',
};
export const normalizeAccessibility = (settings, account) => ({
  ...DEFAULT_ACCESSIBILITY,
  output_mode: account?.default_output_mode || 'natural',
  ...settings,
});

export const DEFAULT_PRIVACY = {
  guardian_consent: false, retention_days: 365, deletion_status: 'none', deleted_at: null,
};

export const SUPPORT_PERMISSION_LABELS = {
  records_read: '의사소통 기록 조회',
  notes_write: '지원 메모 작성',
  cards_manage: '개인 카드 관리',
  quick_speech_manage: '빠른 표현 관리',
  board_manage: '보드 구성 관리',
  voice_access_manage: '음성·접근 설정 관리',
  learning_manage: '학습 기록 조회·설정 관리',
};
