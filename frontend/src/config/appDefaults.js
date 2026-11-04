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
].map(([id, label]) => [id, { id, label }]));

export const TTS_PRESETS = {
  child: { label: '어린이 느낌', rate: 0.9, pitch: 1.25 },
  woman: { label: '여성 느낌', rate: 0.95, pitch: 1.05 },
  man: { label: '남성 느낌', rate: 0.85, pitch: 0.8 },
};

export const DEFAULT_TTS_SETTINGS = {
  preset: 'child', voiceName: '', rate: 0.9, pitch: 1.25, volume: 1,
};

export function normalizeTtsSettings(settings = {}) {
  return {
    preset: settings.preset || DEFAULT_TTS_SETTINGS.preset,
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
