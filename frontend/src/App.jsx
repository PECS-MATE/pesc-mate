import Mascot, { EmptyState } from './Mascot';
import { Avatar, ProfileEditor } from './Profile';
import { useEffect, useRef, useState } from "react";

import { hasToken, request, requestBlob, setToken } from "./services/api";
import { clearBoard, loadBoard, saveBoard } from "./services/boardStorage";
import { learningQuestions } from "./services/learningGame";
import { localKoreanVoices as installedKoreanVoices, selectTtsVoice } from "./services/ttsVoice";
import {
  cacheAccount, cachedAccount, cacheSnapshot, cachedSnapshot, clearCachedAccount,
  clearOfflineUserData, pendingOfflineEvents, queueOfflineEvent, removeOfflineEvents,
} from "./services/offlineStore";
import cardSprite from "./assets/cards/pecs-card-sprite.png";

const CARD_IMAGE_MODULES = import.meta.glob('./assets/cards/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

const CARD_IMAGE_NAMES = {
  me: '나.png',
  water: '물.png',
  rice: '밥.png',
  apple: '사과.png',
  drink: '물을 마시다.png',
  eat: '밥을 먹다.png',
  go: '가다.png',
  rest: '쉬다.png',
};

const CARD_IMAGES = Object.fromEntries(Object.entries(CARD_IMAGE_NAMES).map(([id, filename]) => [
  id,
  CARD_IMAGE_MODULES[`./assets/cards/${filename}`],
]));

const CARD_META = Object.fromEntries([
  ['me', '나'], ['mom', '엄마'], ['water', '물'], ['rice', '밥'], ['apple', '사과'], ['milk', '우유'],
  ['drink', '마시다'], ['eat', '먹다'], ['go', '가다'], ['rest', '쉬다'], ['play', '놀다'], ['help', '도와주세요'],
  ['toilet', '화장실'], ['home', '집'], ['happy', '좋아요'], ['hurt', '아파요'], ['no', '싫어요'], ['yes', '네'],
  ['stop', '그만'], ['more', '더'], ['again', '다시'], ['wait', '기다려 주세요'], ['unknown', '모르겠어요'], ['other', '다른 것'],
  ['head', '머리'], ['stomach', '배'], ['hand', '손'], ['leg', '다리'], ['here_hurts', '여기가 아파요'],
  ['uncomfortable', '불편해요'], ['scared', '무서워요'], ['noisy', '시끄러워요'],
].map(([id, label], image_index) => [id, { id, label, image_index: image_index < 18 ? image_index : null }]));

const TTS_PRESETS = {
  child: { label: '어린이 느낌', rate: 0.9, pitch: 1.25 },
  woman: { label: '여성 느낌', rate: 0.95, pitch: 1.05 },
  man: { label: '남성 느낌', rate: 0.85, pitch: 0.8 },
};

const DEFAULT_TTS_SETTINGS = {
  preset: 'child', voiceName: '', rate: 0.9, pitch: 1.25, volume: 1,
};

function normalizeTtsSettings(settings = {}) {
  return {
    preset: settings.preset || DEFAULT_TTS_SETTINGS.preset,
    voiceName: settings.voiceName ?? settings.voice_name ?? '',
    rate: settings.rate ?? DEFAULT_TTS_SETTINGS.rate,
    pitch: settings.pitch ?? DEFAULT_TTS_SETTINGS.pitch,
    volume: settings.volume ?? DEFAULT_TTS_SETTINGS.volume,
  };
}

const DEFAULT_QUICK_EXPRESSIONS = [
  { id: 'hurt', label: '아파요', symbol: '🤕' },
  { id: 'no', label: '싫어요', symbol: '🙅' },
  { id: 'help', label: '도와주세요', symbol: '🤝' },
  { id: 'toilet', label: '화장실', symbol: '🚻' },
  { id: 'stop', label: '그만', symbol: '✋' },
];

const RECOVERY_EXPRESSIONS = [
  { id: 'wrong_tap', label: '잘못 눌렀어요', symbol: '↩' },
  { id: 'not_that', label: '그 뜻이 아니에요', symbol: '✕' },
  { id: 'say_again', label: '다시 말할게요', symbol: '↻' },
  { id: 'please_wait', label: '제 말을 기다려 주세요', symbol: '✋' },
  { id: 'dont_understand', label: '질문을 잘 모르겠어요', symbol: '?' },
  { id: 'yes', label: '맞아요', symbol: '✓' },
  { id: 'no', label: '아니에요', symbol: '✕' },
];

const DEFAULT_ACCESSIBILITY = {
  display_mode: 'image_text', cards_per_page: 12, card_size: 'medium', text_size: 'medium',
  reduced_motion: false, high_contrast: false,
};

const DEFAULT_PRIVACY = {
  guardian_consent: false, retention_days: 365, deletion_status: 'none', deleted_at: null,
};

const SUPPORT_PERMISSION_LABELS = {
  records_read: '의사소통 기록 조회',
  notes_write: '지원 메모 작성',
  quick_speech_manage: '빠른 표현 관리',
  board_manage: '보드 구성 관리',
  voice_access_manage: '음성·접근 설정 관리',
  learning_manage: '학습 설정 관리',
};

function App() {
  const [user, setUser] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState('');
  const [authReady, setAuthReady] = useState(false);
  const [username, setUsername] = useState('demo');
  const [password, setPassword] = useState('demo1234');
  const [authMode, setAuthMode] = useState('login');
  const [name, setName] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [registrationConsent, setRegistrationConsent] = useState(false);
  const [cards, setCards] = useState([]);
  const [cardCategories, setCardCategories] = useState([]);
  const [recommended, setRecommended] = useState([]);
  const [board, setBoard] = useState([]);
  const [cardPage, setCardPage] = useState(0);
  const [outputMode, setOutputMode] = useState('natural');
  const [category, setCategory] = useState('전체');
  const [search, setSearch] = useState('');
  const [selectedCard, setSelectedCard] = useState(null);
  const [showCardForm, setShowCardForm] = useState(false);
  const [cardSubmissions, setCardSubmissions] = useState([]);
  const [cardFormBusy, setCardFormBusy] = useState(false);
  const [cardFormError, setCardFormError] = useState('');
  const [editingSubmission, setEditingSubmission] = useState(null);
  const [adminSubmissions, setAdminSubmissions] = useState([]);
  const [adminCategories, setAdminCategories] = useState([]);
  const [categoryEdits, setCategoryEdits] = useState({});
  const [categoryBusy, setCategoryBusy] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [reviewDrafts, setReviewDrafts] = useState({});
  const [reviewBusy, setReviewBusy] = useState('');
  const [tab, setTab] = useState('home');
  const [text, setText] = useState('');
  const [generationSource, setGenerationSource] = useState('');
  const [generatedSessionId, setGeneratedSessionId] = useState('');
  const [generationAttempt, setGenerationAttempt] = useState(1);
  const [sentenceConfirmed, setSentenceConfirmed] = useState(false);
  const [generationFailed, setGenerationFailed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [stats, setStats] = useState(null);
  const [period, setPeriod] = useState('all');
  const [statsBusy, setStatsBusy] = useState(false);
  const [speechState, setSpeechState] = useState({ status: 'idle', content: '' });
  const [speechFailure, setSpeechFailure] = useState(null);
  const [lastUtterance, setLastUtterance] = useState(null);
  const [lastSentence, setLastSentence] = useState(null);
  const speechRunRef = useRef(0);
  const speechEventRef = useRef(null);
  const lastSpeechTapRef = useRef({ content: '', at: 0 });
  const [ttsVoices, setTtsVoices] = useState([]);
  const [ttsSettings, setTtsSettings] = useState(DEFAULT_TTS_SETTINGS);
  const [ttsSettingsBusy, setTtsSettingsBusy] = useState(false);
  const [ttsSettingsSaved, setTtsSettingsSaved] = useState(false);
  const [accessibility, setAccessibility] = useState(DEFAULT_ACCESSIBILITY);
  const [accessibilityBusy, setAccessibilityBusy] = useState(false);
  const [accessibilitySaved, setAccessibilitySaved] = useState(true);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [linkedUsers, setLinkedUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [noteDrafts, setNoteDrafts] = useState({});
  const [noteBusy, setNoteBusy] = useState('');
  const [privacy, setPrivacy] = useState(DEFAULT_PRIVACY);
  const [privacyCaregivers, setPrivacyCaregivers] = useState([]);
  const [privacyAudit, setPrivacyAudit] = useState([]);
  const [privacyBusy, setPrivacyBusy] = useState('');
  const [caregiverUsername, setCaregiverUsername] = useState('');
  const [newSupportPermissions, setNewSupportPermissions] = useState(['records_read']);
  const [supportPermissionDrafts, setSupportPermissionDrafts] = useState({});
  const [boardLayout, setBoardLayout] = useState(null);
  const [boardLayoutAudit, setBoardLayoutAudit] = useState([]);
  const [quickDraft, setQuickDraft] = useState([]);
  const [recoveryDraft, setRecoveryDraft] = useState([]);
  const [slotDraft, setSlotDraft] = useState([]);
  const [boardConfigBusy, setBoardConfigBusy] = useState('');
  const [learningSettings, setLearningSettings] = useState(null);
  const [learningProgress, setLearningProgress] = useState(null);
  const [learningBusy, setLearningBusy] = useState(false);
  const [practiceCategory, setPracticeCategory] = useState('all');
  const [learningGame, setLearningGame] = useState(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  const dashboardPath = (value = period, target = selectedUser) => {
    const params = new URLSearchParams();
    if (value !== 'all') params.set('days', value);
    if (target?.id) params.set('user_id', target.id);
    const query = params.toString();
    return `/dashboard${query ? `?${query}` : ''}`;
  };

  function cacheableCards(items) {
    return items.map(({ image_src: _temporaryUrl, ...item }) => item);
  }

  function restoreCachedCards(items = []) {
    return items.map(item => item.image_blob
      ? { ...item, image_src: URL.createObjectURL(item.image_blob) }
      : item);
  }

  async function applyOfflineSnapshot(account, snapshot) {
    if (!snapshot) return false;
    const all = restoreCachedCards(snapshot.cards);
    const rec = restoreCachedCards(snapshot.recommended);
    setCards(all); setCardCategories(snapshot.categories || []); setRecommended(rec);
    setStats(snapshot.dashboard || null); setCardSubmissions(snapshot.submissions || []);
    setBoard(loadBoard(account.id, all)); setTtsSettings(normalizeTtsSettings(snapshot.tts_settings));
    setAccessibility(snapshot.accessibility); setAccessibilitySaved(true);
    setPrivacy(snapshot.privacy); setPrivacyCaregivers(snapshot.caregivers || []);
    setPrivacyAudit(snapshot.privacy_audit || []); setTtsSettingsSaved(true);
    setBoardLayout(snapshot.board_layout || null);
    setLoaded(true); setOffline(true);
    if (!snapshot.privacy?.guardian_consent) setTab('privacy');
    setPendingSyncCount((await pendingOfflineEvents(account.id).catch(() => [])).length);
    return true;
  }

  async function syncPendingEvents(account = user) {
    if (!account || account.role !== 'user' || !navigator.onLine) return;
    const events = await pendingOfflineEvents(account.id).catch(() => []);
    setPendingSyncCount(events.length);
    if (!events.length) return;
    try {
      const result = await request('/offline/events/sync', {
        method: 'POST', body: JSON.stringify({ events: events.map(({ user_id: _userId, ...event }) => event) }),
      });
      await removeOfflineEvents(result.accepted_ids);
      setPendingSyncCount(Math.max(0, events.length - result.accepted_ids.length));
    } catch { /* Retry with the same UUIDs on the next online event. */ }
  }

  function primeOfflineAssets() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(registration => registration.active?.postMessage({
      type: 'CACHE_ASSETS', urls: [cardSprite, ...Object.values(CARD_IMAGE_MODULES)],
    })).catch(() => {});
  }

  async function load(account = user) {
    setError('');
    if (account?.role === 'user' && !navigator.onLine) {
      const snapshot = await cachedSnapshot(account.id).catch(() => null);
      if (await applyOfflineSnapshot(account, snapshot)) return;
    }
    try {
      if (['caregiver', 'support_staff'].includes(account?.role)) {
        const canOperateContent = account?.account_permissions?.includes('content_manage');
        const [people, submissions, categories, activeCategories] = await Promise.all([
          request('/care/linked-users'),
          canOperateContent ? request('/admin/card-submissions') : Promise.resolve([]),
          canOperateContent ? request('/admin/categories') : Promise.resolve([]),
          request('/categories'),
        ]);
        const target = people[0] || null;
        setLinkedUsers(people); setSelectedUser(target); setCards([]); setCardCategories(activeCategories); setRecommended([]);
        setAdminSubmissions(await hydrateImages(submissions));
        setAdminCategories(categories);
        setCategoryEdits(Object.fromEntries(categories.map(item => [item.id, { name: item.name, display_order: item.display_order }])));
        setTab(people.length ? 'support_home' : canOperateContent ? 'admin' : 'support_home');
        setStats(null); setLoaded(true);
        return;
      }
      const [rawCards, rawCategories, rawRecommended, dashboard, submissions, voiceSettings, accessibilitySettings, privacySettings, caregivers, privacyHistory, layout] = await Promise.all([request('/cards'), request('/categories'), request('/recommendations'), request(dashboardPath()), request('/cards/submissions'), request('/tts/settings'), request('/accessibility/settings'), request('/privacy/settings'), request('/support/links'), request('/privacy/audit'), request('/board/layout')]);
      const [all, rec] = await Promise.all([hydrateImages(rawCards), hydrateImages(rawRecommended)]);
      setCards(all); setCardCategories(rawCategories); setRecommended(rec); setStats(dashboard); setCardSubmissions(submissions); setBoard(loadBoard(account?.id, all));
      setTtsSettings(normalizeTtsSettings(voiceSettings));
      setAccessibility(accessibilitySettings); setAccessibilitySaved(true);
      setPrivacy(privacySettings); setPrivacyCaregivers(caregivers); setPrivacyAudit(privacyHistory);
      setBoardLayout(layout);
      setSupportPermissionDrafts(Object.fromEntries(caregivers.map(item => [item.supporter_id, item.permissions])));
      if (!privacySettings.guardian_consent) setTab('privacy');
      setTtsSettingsSaved(true); setLoaded(true); setOffline(false);
      cacheSnapshot(account.id, {
        cards: cacheableCards(all), categories: rawCategories,
        recommended: cacheableCards(rec), dashboard, submissions,
        tts_settings: normalizeTtsSettings(voiceSettings),
        accessibility: accessibilitySettings, privacy: privacySettings,
        caregivers, privacy_audit: privacyHistory, board_layout: layout,
      }).catch(() => {});
      primeOfflineAssets();
      syncPendingEvents(account);
    } catch (e) {
      if (e.status === 401) { setToken(null); setUser(null); setLoaded(false); setError('로그인이 만료되었습니다. 다시 로그인해 주세요.'); }
      else if (account?.role === 'user' && await applyOfflineSnapshot(account, await cachedSnapshot(account.id).catch(() => null))) {
        setError('');
      } else setError(e.message || '서버에 연결하지 못했습니다.');
    }
  }
  useEffect(() => {
    async function restoreLogin() {
      if (!hasToken()) { setAuthReady(true); return; }
      if (!navigator.onLine) {
        const account = await cachedAccount().catch(() => null);
        if (account) { setUser(account); await load(account); }
        else setToken(null);
        setAuthReady(true);
        return;
      }
      try {
        const account = await request('/auth/me');
        setUser(account);
        cacheAccount(account, account.session_expires_at).catch(() => {});
        await load(account);
      } catch (error) {
        if (error.status === 401) { setToken(null); await clearCachedAccount().catch(() => {}); }
        else {
          const account = await cachedAccount().catch(() => null);
          if (account) { setUser(account); await load(account); }
          else setToken(null);
        }
      }
      finally { setAuthReady(true); }
    }
    restoreLogin();
    return () => window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    const synthesis = window.speechSynthesis;
    if (!synthesis) return undefined;
    const updateVoices = () => setTtsVoices(synthesis.getVoices().filter(voice => voice.lang.toLowerCase().startsWith('ko')));
    updateVoices();
    synthesis.addEventListener('voiceschanged', updateVoices);
    return () => synthesis.removeEventListener('voiceschanged', updateVoices);
  }, []);

  useEffect(() => {
    setCardPage(0);
  }, [category, search, accessibility.cards_per_page, tab, cards.length, boardLayout?.updated_at]);

  useEffect(() => {
    const online = () => { setOffline(false); syncPendingEvents(user); if (user) load(user); };
    const offlineNow = () => setOffline(true);
    window.addEventListener('online', online); window.addEventListener('offline', offlineNow);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offlineNow); };
  }, [user]);

  async function handleLogin(event) {
    event.preventDefault();
    if (authMode === 'register' && password !== passwordConfirm) { setError('비밀번호가 일치하지 않습니다.'); return; }
    setBusy(true); setError('');
    try {
      const path = authMode === 'register' ? '/auth/register' : '/auth/login';
      const body = authMode === 'register' ? { username, password, name, guardian_consent: registrationConsent } : { username, password };
      const result = await request(path, { method: 'POST', body: JSON.stringify(body) });
      setToken(result.access_token); setUser(result.user); setShowProfile(false); setProfileNotice('');
      cacheAccount(result.user, result.expires_at).catch(() => {});
      await load(result.user);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); setAuthReady(true); }
  }

  async function handleLogout() {
    setBusy(true);
    await stopSpeech();
    try { await request('/auth/logout', { method: 'POST' }); } catch { /* local logout still applies */ }
    clearBoard(user?.id);
    await clearCachedAccount().catch(() => {});
    if (user?.id) await clearOfflineUserData(user.id).catch(() => {});
    setToken(null); setUser(null); setLoaded(false); setShowProfile(false); setProfileNotice('');
    [...cards, ...recommended, ...adminSubmissions].forEach(item => { if (item.image_src) URL.revokeObjectURL(item.image_src); });
    setCards([]); setCardCategories([]); setRecommended([]); setStats(null); setBoard([]); setCardSubmissions([]); setAdminSubmissions([]); setAdminCategories([]); setCategoryEdits({}); setCategoryError(''); setLinkedUsers([]); setSelectedUser(null); setBoardLayout(null); setBoardLayoutAudit([]); setQuickDraft([]); setRecoveryDraft([]); setSlotDraft([]); setLearningSettings(null); setLearningProgress(null); setLearningGame(null); setPracticeCategory('all'); setText(''); setGeneratedSessionId(''); setGenerationAttempt(1); setSentenceConfirmed(false); setGenerationFailed(false); setError(''); setTab('home');
    setTtsSettings(DEFAULT_TTS_SETTINGS); setTtsSettingsSaved(false); setAccessibility(DEFAULT_ACCESSIBILITY); setAccessibilitySaved(true); setPrivacy(DEFAULT_PRIVACY); setPrivacyCaregivers([]); setPrivacyAudit([]); setSpeechFailure(null); setLastUtterance(null); setLastSentence(null); setBusy(false);
  }

  function updateBoard(next) {
    stopSpeech();
    setBoard(next); saveBoard(user?.id, next); setText(''); setGenerationSource(''); setGeneratedSessionId(''); setGenerationAttempt(1); setSentenceConfirmed(false); setGenerationFailed(false); setSpeechFailure(null); setRequestId(crypto.randomUUID());
  }
  function add(card) {
    if (board.length >= 12) { setError('카드는 최대 12장까지 선택할 수 있어요.'); return; }
    setError(''); updateBoard([...board, card]);
  }
  function move(index, offset) {
    const next = [...board];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    updateBoard(next);
  }
  async function generate() {
    setBusy(true); setError(''); setGenerationFailed(false); setSentenceConfirmed(false);
    try {
      const result = await request('/sentences', { method: 'POST', body: JSON.stringify({ cards: board.map(c => c.id), request_id: requestId }) });
      setText(result.sentence);
      setGenerationSource(result.generation_source || 'rule');
      setGeneratedSessionId(result.id);
      setGenerationAttempt(result.generation_attempt || 1);
      try {
        const [rec, dashboard] = await Promise.all([request('/recommendations'), request(dashboardPath())]);
        setRecommended(rec); setStats(dashboard);
      } catch { setError('문장은 저장되었습니다. 통계 갱신은 다시 연결을 눌러 주세요.'); }
    } catch (e) { setGenerationFailed(true); setError(`${e.message} 선택한 카드는 유지되며 로컬 음성은 계속 사용할 수 있어요.`); }
    finally { setBusy(false); }
  }
  async function regenerate() {
    if (!generatedSessionId) return;
    setBusy(true); setError(''); setGenerationFailed(false); setSentenceConfirmed(false);
    try {
      const result = await request(`/sentences/${generatedSessionId}/regenerate`, {
        method: 'POST', body: JSON.stringify({ request_id: crypto.randomUUID() }),
      });
      setText(result.sentence);
      setGenerationSource(result.generation_source || 'rule');
      setGeneratedSessionId(result.id);
      setGenerationAttempt(result.generation_attempt || generationAttempt + 1);
      try {
        const [rec, dashboard] = await Promise.all([request('/recommendations'), request(dashboardPath())]);
        setRecommended(rec); setStats(dashboard);
      } catch { setError('재생성 문장은 저장되었습니다. 통계 갱신은 다시 연결을 눌러 주세요.'); }
    } catch (e) { setGenerationFailed(true); setError(`${e.message} 선택한 카드는 유지되며 로컬 음성은 계속 사용할 수 있어요.`); }
    finally { setBusy(false); }
  }
  function finishSpeechEvent(event, status, errorCode = '') {
    if (!event) return Promise.resolve();
    if (event.finished) return event.completion || Promise.resolve();
    event.finished = true;
    event.completion = event.started.then(started => started ? request(`/tts/events/${event.id}`, {
      method: 'PATCH', body: JSON.stringify({ status, error_code: errorCode }),
    }) : null).catch(e => setError(e.message));
    return event.completion;
  }
  function speechFailureMessage(errorCode) {
    if (errorCode === 'volume-zero') return '기본 볼륨이 0입니다. 음성 설정에서 볼륨을 올려 주세요.';
    if (errorCode === 'not-allowed') return '브라우저의 음성 재생 권한과 기기 음량을 확인한 뒤 다시 시도해 주세요.';
    if (['language-unavailable', 'voice-unavailable'].includes(errorCode)) return '기기에 한국어 음성을 설치하거나 음성 설정에서 다른 음성을 선택해 주세요.';
    if (errorCode === 'unsupported') return '이 브라우저에서는 음성 재생을 지원하지 않습니다. 최신 Chrome 또는 Edge에서 다시 열어 주세요.';
    return '기기의 한국어 음성 설정과 음량을 확인한 뒤 다시 재생해 주세요.';
  }
  function speakText(content, contentType = 'sentence', cardIds = []) {
    if (ttsSettings.volume <= 0) {
      setSpeechFailure({ content, contentType, cardIds, errorCode: 'volume-zero', retryable: false });
      return;
    }
    const tappedAt = Date.now();
    if (lastSpeechTapRef.current.content === content && tappedAt - lastSpeechTapRef.current.at < 600) return;
    lastSpeechTapRef.current = { content, at: tappedAt };
    if (contentType !== 'preview') setLastUtterance({ content, contentType, cardIds });
    finishSpeechEvent(speechEventRef.current, 'cancelled', 'replaced');
    const speechEvent = {
      id: crypto.randomUUID(), finished: false,
      started: null,
    };
    const startTracking = () => request('/tts/events', { method: 'POST', body: JSON.stringify({
      request_id: speechEvent.id, content_type: contentType, char_count: content.length,
    }) }).then(() => true).catch(async e => {
      if (!e.status && cardIds.length && user?.id && privacy.guardian_consent) {
        await queueOfflineEvent({
          id: speechEvent.id, user_id: user.id,
          event_type: contentType === 'card' ? 'immediate_speech' : 'selection_speech',
          card_ids: cardIds, occurred_at: new Date().toISOString(),
        }).catch(() => {});
        setPendingSyncCount((await pendingOfflineEvents(user.id).catch(() => [])).length);
        setOffline(true);
      } else if (e.status) setError(e.message);
      return false;
    });
    speechEvent.started = Promise.resolve(false);
    speechEventRef.current = speechEvent;
    setSpeechFailure(null);
    if (!window.speechSynthesis) {
      speechEvent.started = startTracking();
      finishSpeechEvent(speechEvent, 'failed', 'unsupported');
      lastSpeechTapRef.current = { content: '', at: 0 };
      setSpeechFailure({ content, contentType, cardIds, errorCode: 'unsupported', retryable: false });
      return;
    }
    const runId = ++speechRunRef.current;
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = 'ko-KR'; utterance.rate = ttsSettings.rate; utterance.pitch = ttsSettings.pitch;
    utterance.volume = ttsSettings.volume;
    const voice = selectTtsVoice(ttsVoices, ttsSettings.voiceName, offline);
    if (voice) utterance.voice = voice;
    utterance.onstart = () => { if (speechRunRef.current === runId) setSpeechState({ status: 'playing', content }); };
    utterance.onpause = () => { if (speechRunRef.current === runId) setSpeechState({ status: 'paused', content }); };
    utterance.onresume = () => { if (speechRunRef.current === runId) setSpeechState({ status: 'playing', content }); };
    utterance.onend = () => {
      finishSpeechEvent(speechEvent, 'succeeded');
      if (speechRunRef.current === runId) setSpeechState({ status: 'idle', content: '' });
    };
    utterance.onerror = (errorEvent) => {
      finishSpeechEvent(speechEvent, ['canceled', 'interrupted'].includes(errorEvent.error) ? 'cancelled' : 'failed', errorEvent.error);
      if (speechRunRef.current !== runId) return;
      setSpeechState({ status: 'idle', content: '' });
      if (!['canceled', 'interrupted'].includes(errorEvent.error)) {
        lastSpeechTapRef.current = { content: '', at: 0 };
        setSpeechFailure({ content, contentType, cardIds, errorCode: errorEvent.error || 'unknown', retryable: true });
      }
    };
    setSpeechState({ status: 'starting', content }); window.speechSynthesis.speak(utterance);
    speechEvent.started = startTracking();
  }
  function rememberAndSpeakSentence(content) {
    const cardIds = board.map(card => card.id);
    setLastSentence({ content, cards: [...board] });
    speakText(content, 'sentence', cardIds);
  }
  function speak() { if (sentenceConfirmed) rememberAndSpeakSentence(text); }
  function speakSelection() { rememberAndSpeakSentence(board.map(card => card.label).join(' ')); }
  function restoreLastSentence() {
    if (!lastSentence) return;
    updateBoard([...lastSentence.cards]);
    setText(lastSentence.content); setSentenceConfirmed(true);
  }
  function pauseSpeech() {
    if (speechState.status !== 'playing') return;
    window.speechSynthesis.pause();
    setSpeechState(current => ({ ...current, status: 'paused' }));
  }
  function resumeSpeech() {
    if (speechState.status !== 'paused') return;
    window.speechSynthesis.resume();
    setSpeechState(current => ({ ...current, status: 'playing' }));
  }
  function stopSpeech() {
    const completion = finishSpeechEvent(speechEventRef.current, 'cancelled', 'user-stopped');
    speechRunRef.current += 1;
    window.speechSynthesis?.cancel();
    if (window.speechSynthesis?.paused) window.speechSynthesis.resume();
    setSpeechState({ status: 'idle', content: '' });
    return completion;
  }
  function updateTtsSettings(changes) {
    setTtsSettings(current => ({ ...current, ...changes }));
    setTtsSettingsSaved(false);
  }
  function changeTtsPreset(preset) {
    const values = TTS_PRESETS[preset];
    updateTtsSettings({ preset, rate: values.rate, pitch: values.pitch });
  }
  async function saveTtsSettings() {
    setTtsSettingsBusy(true); setError('');
    try {
      const targetQuery = ['caregiver', 'support_staff'].includes(user.role) && selectedUser ? `?user_id=${encodeURIComponent(selectedUser.id)}` : '';
      const saved = await request(`/tts/settings${targetQuery}`, { method: 'PUT', body: JSON.stringify({
        preset: ttsSettings.preset, voice_name: ttsSettings.voiceName,
        rate: ttsSettings.rate, pitch: ttsSettings.pitch, volume: ttsSettings.volume,
      }) });
      setTtsSettings(normalizeTtsSettings(saved));
      setTtsSettingsSaved(true);
      if (user.role === 'user') await load(user);
    } catch (e) { setError(e.message); }
    finally { setTtsSettingsBusy(false); }
  }
  function updateAccessibility(changes) {
    setAccessibility(current => ({ ...current, ...changes }));
    setAccessibilitySaved(false);
  }
  async function saveAccessibility() {
    setAccessibilityBusy(true); setError('');
    try {
      const targetQuery = ['caregiver', 'support_staff'].includes(user.role) && selectedUser ? `?user_id=${encodeURIComponent(selectedUser.id)}` : '';
      setAccessibility(await request(`/accessibility/settings${targetQuery}`, {
        method: 'PUT', body: JSON.stringify(accessibility),
      }));
      setAccessibilitySaved(true);
      if (user.role === 'user') await load(user);
    } catch (e) { setError(e.message); }
    finally { setAccessibilityBusy(false); }
  }
  async function changePeriod(value) {
    setPeriod(value); setStatsBusy(true); setError('');
    try { setStats(await request(dashboardPath(value))); }
    catch (e) { setError(e.message); }
    finally { setStatsBusy(false); }
  }
  async function changeLinkedUser(value) {
    const target = linkedUsers.find(person => person.id === value);
    if (!target) return;
    setSelectedUser(target); setStatsBusy(true); setLearningBusy(tab === 'learning_progress'); setError(''); setStats(null);
    try {
      if (tab === 'dashboard' && target.permissions.includes('records_read')) setStats(await request(dashboardPath(period, target)));
      if (tab === 'support_settings' && target.permissions.includes('voice_access_manage')) await loadSupportSettings(target);
      if (tab === 'board_settings' && target.permissions.some(permission => ['quick_speech_manage', 'board_manage'].includes(permission))) await loadBoardConfiguration(target);
      if (tab === 'learning_progress' && target.permissions.includes('learning_manage')) await loadLearning(target);
    }
    catch (e) { setError(e.message); }
    finally { setStatsBusy(false); setLearningBusy(false); }
  }
  async function openSupportSection(nextTab) {
    if (!selectedUser) return;
    setTab(nextTab); setStatsBusy(true); setError('');
    try {
      if (nextTab === 'dashboard') setStats(await request(dashboardPath(period, selectedUser)));
      if (nextTab === 'support_settings') await loadSupportSettings(selectedUser);
      if (nextTab === 'board_settings') await loadBoardConfiguration(selectedUser);
    } catch (e) { setError(e.message); }
    finally { setStatsBusy(false); }
  }
  async function loadSupportSettings(target) {
    const query = `?user_id=${encodeURIComponent(target.id)}`;
    const [voiceSettings, accessSettings] = await Promise.all([
      request(`/tts/settings${query}`), request(`/accessibility/settings${query}`),
    ]);
    setTtsSettings(normalizeTtsSettings(voiceSettings));
    setTtsSettingsSaved(true); setAccessibility(accessSettings); setAccessibilitySaved(true);
  }
  async function loadBoardConfiguration(target) {
    const query = `?user_id=${encodeURIComponent(target.id)}`;
    const [layout, audit] = await Promise.all([
      request(`/board/layout${query}`), request(`/board/layout/audit${query}`),
    ]);
    setBoardLayout(layout); setBoardLayoutAudit(audit);
    setQuickDraft(layout.quick_expression_ids); setRecoveryDraft(layout.recovery_expression_ids);
    setSlotDraft(layout.slots.map(slot => slot.card_id));
  }
  async function loadLearning(target = null) {
    const isLinkedTarget = ['caregiver', 'support_staff'].includes(user.role);
    const query = isLinkedTarget && target ? `?user_id=${encodeURIComponent(target.id)}` : '';
    const separator = query ? '&' : '?';
    const [settings, progress] = await Promise.all([
      request(`/learning/settings${query}`),
      request(`/learning/progress${query}${separator}days=30`),
    ]);
    setLearningSettings(settings); setLearningProgress(progress);
  }
  function updateLearningSetting(changes) {
    setLearningSettings(current => ({ ...current, ...changes }));
  }
  async function saveLearningConfiguration(event) {
    event.preventDefault();
    if (!selectedUser || !learningSettings?.category_ids?.length) {
      setError('학습 카테고리를 하나 이상 선택해 주세요.');
      return;
    }
    setLearningBusy(true); setError('');
    try {
      const query = `?user_id=${encodeURIComponent(selectedUser.id)}`;
      setLearningSettings(await request(`/learning/settings${query}`, {
        method: 'PUT', body: JSON.stringify({
          category_ids: learningSettings.category_ids,
          question_count: Number(learningSettings.question_count),
          option_count: Number(learningSettings.option_count),
          repeat_frequency: Number(learningSettings.repeat_frequency),
          time_limit_seconds: Number(learningSettings.time_limit_seconds),
          retry_enabled: learningSettings.retry_enabled,
        }),
      }));
    } catch (e) { setError(e.message); }
    finally { setLearningBusy(false); }
  }
  async function openLearning(target = selectedUser) {
    setTab(['caregiver', 'support_staff'].includes(user.role) ? 'learning_progress' : 'practice');
    setLearningBusy(true); setError('');
    try {
      if (!navigator.onLine) throw new Error('학습 기록은 온라인 연결 후 확인할 수 있습니다. 말하기와 빠른 표현은 계속 사용할 수 있습니다.');
      await loadLearning(target);
    } catch (e) { setError(e.message); }
    finally { setLearningBusy(false); }
  }
  function availablePracticeCards(categoryId = practiceCategory) {
    const configured = learningSettings?.category_ids?.length
      ? cardCategories.filter(item => learningSettings.category_ids.includes(item.id))
      : cardCategories;
    const allowedNames = new Set(configured.map(item => item.name));
    const selectedName = cardCategories.find(item => item.id === categoryId)?.name;
    return cards.filter(card => {
      const hasPicture = Boolean(card.image_src || CARD_IMAGES[card.id]) || Number.isInteger(card.image_index);
      const allowed = categoryId === 'all'
        ? (!allowedNames.size || allowedNames.has(card.category))
        : card.category === selectedName;
      return hasPicture && allowed;
    });
  }
  function startLearningGame() {
    const source = availablePracticeCards();
    const optionCount = learningSettings?.option_count || 3;
    if (source.length < optionCount) {
      setError(`선택한 범위에 그림이 있는 카드가 ${optionCount}개 이상 필요합니다.`);
      return;
    }
    const questions = learningQuestions(
      source, learningSettings?.question_count || 10,
      optionCount, learningSettings?.repeat_frequency || 1,
    );
    if (!questions.length) {
      setError('선택한 범위에 그림이 있는 카드가 2개 이상 필요합니다.');
      return;
    }
    setError('');
    setLearningGame({
      phase: 'playing', questions, questionIndex: 0, correctAnswers: 0,
      hadWrong: false, feedback: '', selectedId: '', startedAt: Date.now(),
      requestId: crypto.randomUUID(), attempt: null,
    });
  }
  function answerLearningQuestion(cardId) {
    setLearningGame(current => {
      if (!current || current.phase !== 'playing' || current.feedback === 'correct') return current;
      const question = current.questions[current.questionIndex];
      const correct = cardId === question.target.id;
      if (correct) return {
        ...current, selectedId: cardId, feedback: 'correct',
        correctAnswers: current.correctAnswers + (current.hadWrong ? 0 : 1),
      };
      return {
        ...current, selectedId: cardId, hadWrong: true,
        feedback: learningSettings?.retry_enabled === false ? 'incorrect' : 'retry',
      };
    });
  }
  async function finishLearningGame(snapshot) {
    if (!snapshot || snapshot.phase === 'saving') return;
    const durationSeconds = Math.max(1, Math.round((Date.now() - snapshot.startedAt) / 1000));
    setLearningGame(current => ({ ...current, phase: 'saving' }));
    setError('');
    try {
      const attempt = await request('/learning/attempts', { method: 'POST', body: JSON.stringify({
        request_id: snapshot.requestId, activity_type: 'word_picture_match',
        category_id: practiceCategory === 'all' ? 'mixed' : practiceCategory,
        total_questions: snapshot.questions.length,
        correct_answers: snapshot.correctAnswers,
        duration_seconds: durationSeconds,
      }) });
      setLearningGame(current => ({ ...current, phase: 'complete', attempt }));
      try { setLearningProgress(await request('/learning/progress?days=30')); }
      catch { setError('연습 결과는 저장되었지만 최근 진행 현황은 새로고침이 필요합니다.'); }
    } catch (e) {
      setError(`${e.message} 결과를 저장하지 못했지만 말하기 기능은 계속 사용할 수 있습니다.`);
      setLearningGame(current => ({ ...current, phase: 'complete', attempt: null }));
    }
  }
  function nextLearningQuestion() {
    if (!learningGame || !['correct', 'incorrect'].includes(learningGame.feedback)) return;
    if (learningGame.questionIndex === learningGame.questions.length - 1) {
      finishLearningGame(learningGame);
      return;
    }
    setLearningGame(current => ({
      ...current, questionIndex: current.questionIndex + 1,
      hadWrong: false, feedback: '', selectedId: '',
    }));
  }
  function moveDraft(setter, index, offset) {
    setter(current => {
      const next = [...current];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  }
  function toggleDraft(setter, current, cardId, maximum) {
    if (current.includes(cardId)) setter(current.filter(id => id !== cardId));
    else if (current.length < maximum) setter([...current, cardId]);
    else setError(`카드는 최대 ${maximum}개까지 선택할 수 있습니다.`);
  }
  async function saveBoardConfiguration(kind) {
    if (!selectedUser) return;
    const quick = kind === 'quick';
    const recovery = kind === 'recovery';
    const values = quick ? quickDraft : recovery ? recoveryDraft : slotDraft;
    if (!values.length) { setError('항목을 하나 이상 선택해 주세요.'); return; }
    setBoardConfigBusy(kind); setError('');
    try {
      const path = quick ? 'quick-expressions' : recovery ? 'recovery-expressions' : 'slots';
      const query = `?user_id=${encodeURIComponent(selectedUser.id)}`;
      const layout = await request(`/board/layout/${path}${query}`, {
        method: 'PUT', body: JSON.stringify(recovery ? { expression_ids: values } : { card_ids: values }),
      });
      setBoardLayout(layout);
      setBoardLayoutAudit(await request(`/board/layout/audit${query}`));
    } catch (e) { setError(e.message); }
    finally { setBoardConfigBusy(''); }
  }
  async function saveCaregiverNote(sessionId) {
    const content = (noteDrafts[sessionId] ?? stats.recent.find(row => row.id === sessionId)?.caregiver_note ?? '').trim();
    if (!content) { setError('메모 내용을 입력해 주세요.'); return; }
    setNoteBusy(sessionId); setError('');
    try {
      const saved = await request(`/care/notes/${sessionId}`, { method: 'PUT', body: JSON.stringify({ user_id: selectedUser.id, content }) });
      setStats(current => ({ ...current, recent: current.recent.map(row => row.id === sessionId ? { ...row, caregiver_note: saved.content } : row) }));
      setNoteDrafts(current => ({ ...current, [sessionId]: saved.content }));
    } catch (e) { setError(e.message); }
    finally { setNoteBusy(''); }
  }
  async function removeCaregiverNote(sessionId) {
    setNoteBusy(sessionId); setError('');
    try {
      await request(`/care/notes/${sessionId}?user_id=${encodeURIComponent(selectedUser.id)}`, { method: 'DELETE' });
      setStats(current => ({ ...current, recent: current.recent.map(row => row.id === sessionId ? { ...row, caregiver_note: null } : row) }));
      setNoteDrafts(current => ({ ...current, [sessionId]: '' }));
    } catch (e) { setError(e.message); }
    finally { setNoteBusy(''); }
  }
  async function savePrivacySettings() {
    setPrivacyBusy('settings'); setError('');
    try {
      setPrivacy(await request('/privacy/settings', {
        method: 'PUT', body: JSON.stringify({
          guardian_consent: privacy.guardian_consent,
          retention_days: Number(privacy.retention_days),
        }),
      }));
      await load(user);
    } catch (e) { setError(e.message); }
    finally { setPrivacyBusy(''); }
  }
  async function addPrivacyCaregiver(event) {
    event.preventDefault();
    setPrivacyBusy('caregiver'); setError('');
    try {
      const links = await request('/support/links', {
        method: 'POST', body: JSON.stringify({ username: caregiverUsername.trim(), permissions: newSupportPermissions }),
      });
      setPrivacyCaregivers(links);
      setSupportPermissionDrafts(Object.fromEntries(links.map(item => [item.supporter_id, item.permissions])));
      setCaregiverUsername('');
      setPrivacyAudit(await request('/privacy/audit'));
    } catch (e) { setError(e.message); }
    finally { setPrivacyBusy(''); }
  }
  async function removePrivacyCaregiver(item) {
    if (!window.confirm(`${item.name}님의 지원 연결을 해제할까요?`)) return;
    setPrivacyBusy(item.supporter_id); setError('');
    try {
      await request(`/support/links/${encodeURIComponent(item.supporter_id)}`, { method: 'DELETE' });
      setPrivacyCaregivers(current => current.filter(row => row.supporter_id !== item.supporter_id));
      setPrivacyAudit(await request('/privacy/audit'));
    } catch (e) { setError(e.message); }
    finally { setPrivacyBusy(''); }
  }
  function toggleSupportPermission(current, permission) {
    return current.includes(permission) ? current.filter(value => value !== permission) : [...current, permission];
  }
  async function saveSupportPermissions(item) {
    const permissions = supportPermissionDrafts[item.supporter_id] || [];
    if (!permissions.length) { setError('권한을 하나 이상 선택해 주세요.'); return; }
    setPrivacyBusy(item.supporter_id); setError('');
    try {
      const links = await request(`/support/links/${encodeURIComponent(item.supporter_id)}`, {
        method: 'PUT', body: JSON.stringify({ permissions }),
      });
      setPrivacyCaregivers(links); setPrivacyAudit(await request('/privacy/audit'));
    } catch (e) { setError(e.message); }
    finally { setPrivacyBusy(''); }
  }
  async function downloadPrivacyData() {
    setPrivacyBusy('export'); setError('');
    try {
      const exported = await request('/privacy/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `pesc-mate-${user.id}-data.json`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); }
    finally { setPrivacyBusy(''); }
  }
  async function deletePrivacyData() {
    if (!window.confirm('개인 카드, 문장·음성 기록, 보호자 연결과 설정을 삭제할까요? 복구할 수 없습니다.')) return;
    setPrivacyBusy('delete'); setError('');
    try {
      const receipt = await request('/privacy/data', { method: 'DELETE', body: JSON.stringify({ confirmation: 'DELETE' }) });
      clearBoard(user.id); await clearOfflineUserData(user.id).catch(() => {}); setBoard([]); setPrivacy(receipt); setPrivacyCaregivers([]); setPrivacyAudit(await request('/privacy/audit'));
      await load(user); setTab('privacy');
    } catch (e) { setError(e.message); }
    finally { setPrivacyBusy(''); }
  }
  async function submitCard(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set('submission_mode', event.nativeEvent.submitter?.value || 'submit');
    setCardFormBusy(true); setCardFormError(''); setError('');
    try {
      const saved = editingSubmission
        ? await request(`/cards/submissions/${editingSubmission.id}`, {
          method: 'PATCH', body: JSON.stringify(Object.fromEntries(['label', 'meaning', 'category', 'visibility'].map(key => [key, formData.get(key)]))),
        })
        : await request('/cards/submissions', { method: 'POST', body: formData });
      setCardSubmissions(current => editingSubmission
        ? current.map(item => item.id === saved.id ? saved : item)
        : [saved, ...current]);
      setShowCardForm(false);
      setEditingSubmission(null);
      form.reset();
      if (saved.status === 'approved') await load(user);
    } catch (e) { setCardFormError(e.message); }
    finally { setCardFormBusy(false); }
  }
  async function submitDraft(item) {
    setReviewBusy(item.id); setError('');
    try {
      const saved = await request(`/cards/submissions/${item.id}/submit`, { method: 'POST' });
      setCardSubmissions(current => current.map(row => row.id === item.id ? saved : row));
      if (saved.status === 'approved') await load(user);
    } catch (e) { setError(e.message); }
    finally { setReviewBusy(''); }
  }
  async function hydrateImages(items) {
    return Promise.all(items.map(async item => {
      if (!item.image_url) return item;
      try { const imageBlob = await requestBlob(item.image_url); return { ...item, image_blob: imageBlob, image_src: URL.createObjectURL(imageBlob) }; }
      catch { return { ...item, image_failed: true }; }
    }));
  }
  async function reviewCard(item, decision) {
    const reason = (reviewDrafts[item.id] || '').trim();
    if (decision === 'rejected' && !reason) { setError('반려 사유를 입력해 주세요.'); return; }
    setReviewBusy(item.id); setError('');
    try {
      const saved = await request(`/admin/card-submissions/${item.id}`, {
        method: 'PATCH', body: JSON.stringify({ decision, reason }),
      });
      setAdminSubmissions(current => current.map(row => row.id === item.id ? { ...row, ...saved } : row));
    } catch (e) { setError(e.message); }
    finally { setReviewBusy(''); }
  }
  async function addCategory(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setCategoryBusy('new'); setCategoryError('');
    try {
      const saved = await request('/admin/categories', { method: 'POST', body: JSON.stringify({
        name: formData.get('name'), display_order: Number(formData.get('display_order')),
      }) });
      setAdminCategories(current => [...current, saved].sort((a, b) => a.display_order - b.display_order));
      setCategoryEdits(current => ({ ...current, [saved.id]: { name: saved.name, display_order: saved.display_order } }));
      form.reset();
    } catch (e) { setCategoryError(e.message); }
    finally { setCategoryBusy(''); }
  }
  async function saveCategory(item, active = item.active) {
    if (item.active && !active && !window.confirm(`${item.name} 카테고리를 비활성화할까요? 사용자 화면에서 숨겨집니다.`)) return;
    const draft = categoryEdits[item.id] || item;
    setCategoryBusy(item.id); setCategoryError('');
    try {
      const saved = await request(`/admin/categories/${item.id}`, { method: 'PATCH', body: JSON.stringify({
        name: draft.name, display_order: Number(draft.display_order), active,
      }) });
      setAdminCategories(current => current.map(row => row.id === item.id ? saved : row).sort((a, b) => a.display_order - b.display_order));
      setCategoryEdits(current => ({ ...current, [saved.id]: { name: saved.name, display_order: saved.display_order } }));
    } catch (e) { setCategoryError(e.message); }
    finally { setCategoryBusy(''); }
  }
  function artStyle(card) {
    if (card.image_src) return { backgroundImage: `url(${card.image_src})`, backgroundPosition: 'center', backgroundSize: 'cover' };
    if (CARD_IMAGES[card.id]) return { backgroundImage: `url(${CARD_IMAGES[card.id]})`, backgroundPosition: 'center', backgroundSize: 'cover' };
    return { backgroundImage: `url(${cardSprite})`, backgroundPosition: `${(card.image_index % 6) * 20}% ${Math.floor(card.image_index / 6) * 50}%` };
  }
  function cardArt(card, className = 'card-art') {
    const hasImage = Boolean(card.image_src) || Number.isInteger(card.image_index);
    return <span className={`${className}${hasImage ? '' : ' image-fallback'}`} role="img" aria-label={hasImage ? `${card.label} 그림` : `${card.label} 대체 이미지`} style={hasImage ? artStyle(card) : undefined}>
      {!hasImage && <><b aria-hidden="true">🖼️</b><small>{card.label}</small></>}
    </span>;
  }
  function cardSpeaker(card) {
    function play(event) {
      event.preventDefault(); event.stopPropagation();
      if (!busy) speakText(card.label, 'card', [card.id]);
    }
    return <span className="card-speaker" role="button" tabIndex="0" aria-label={`${card.label} 단어 듣기`} onClick={play} onKeyDown={event => { if (['Enter', ' '].includes(event.key)) play(event); }}>🔊</span>;
  }
  function cardPicture(card, className = 'mini-card') {
    const hasImage = Boolean(card.image_src) || Number.isInteger(card.image_index);
    return <span key={card.id} className={`${className}${hasImage ? '' : ' image-fallback'}`} title={card.label} aria-label={card.label} role="img" style={hasImage ? artStyle(card) : undefined}>{!hasImage && <small>{card.label}</small>}</span>;
  }
  function tile(card) {
    const speakOnTap = outputMode === 'word';
    return <button className={`card${speakOnTap ? ' speak-on-tap' : ''}`} key={card.id} disabled={busy} aria-label={`${card.label} ${speakOnTap ? '바로 말하기' : '문장에 담기'}`} onClick={() => speakOnTap ? speakText(card.label, 'card', [card.id]) : add(card)}>
      {cardArt(card)}
      <strong>{card.label}</strong>{card.reason && <small>{card.reason}</small>}{cardSpeaker(card)}
    </button>;
  }
  const layoutCards = boardLayout?.available_cards || cards;
  const layoutCardsById = new Map(layoutCards.map(card => [card.id, card]));
  const configuredBoardCards = boardLayout
    ? boardLayout.slots.map(slot => cards.find(card => card.id === slot.card_id) || layoutCardsById.get(slot.card_id)).filter(Boolean)
    : cards;
  const activeCardSource = tab === 'cards' ? configuredBoardCards : cards;
  const quickExpressionCards = boardLayout
    ? boardLayout.quick_expression_ids.map(id => cards.find(card => card.id === id) || layoutCardsById.get(id)).filter(Boolean)
    : DEFAULT_QUICK_EXPRESSIONS;
  const recoveryExpressions = (boardLayout?.recovery_expression_ids || ['wrong_tap', 'not_that', 'say_again'])
    .map(id => RECOVERY_EXPRESSIONS.find(item => item.id === id)).filter(Boolean);
  const practiceCategories = (learningSettings?.category_ids?.length
    ? cardCategories.filter(item => learningSettings.category_ids.includes(item.id))
    : cardCategories).filter(item => availablePracticeCards(item.id).length >= (learningSettings?.option_count || 3));
  const currentLearningQuestion = learningGame?.questions?.[learningGame.questionIndex];
  const filteredCards = activeCardSource.filter(card =>
    (category === '전체' || card.category === category)
    && card.label.includes(search.trim())
  );
  const cardPageCount = Math.max(1, Math.ceil(filteredCards.length / accessibility.cards_per_page));
  const visibleCards = filteredCards.slice(
    cardPage * accessibility.cards_per_page,
    (cardPage + 1) * accessibility.cards_per_page,
  );
  function cardPagination() {
    if (cardPageCount <= 1) return null;
    return <nav className="card-pagination" aria-label="카드 페이지"><button disabled={cardPage === 0} onClick={() => setCardPage(page => page - 1)}>이전</button><span>{cardPage + 1} / {cardPageCount}</span><button disabled={cardPage >= cardPageCount - 1} onClick={() => setCardPage(page => page + 1)}>다음</button></nav>;
  }
  const todayLabel = new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit', day: '2-digit', weekday: 'long',
  }).format(new Date());
  const speechActive = speechState.status !== 'idle';
  const isSupporter = ['caregiver', 'support_staff'].includes(user?.role);
  const canManageContent = user?.role === 'support_staff' && user?.account_permissions?.includes('content_manage');
  const selectedPermissions = selectedUser?.permissions || [];
  const canReadRecords = selectedPermissions.includes('records_read');
  const canWriteNotes = selectedPermissions.includes('notes_write');
  const canManageVoice = selectedPermissions.includes('voice_access_manage');
  const canManageQuick = selectedPermissions.includes('quick_speech_manage');
  const canManageBoard = selectedPermissions.includes('board_manage');
  const canManageLearning = selectedPermissions.includes('learning_manage');
  const localKoreanVoices = installedKoreanVoices(ttsVoices);
  const speechStatusLabel = ({ starting: '음성 준비 중', playing: '음성 재생 중', paused: '음성 일시 정지' })[speechState.status];
  const pageTitle = tab === 'admin' && canManageContent
    ? '카드 등록 요청을 검토해요.'
    : isSupporter
    ? tab === 'support_home' ? '연결된 사용자를 지원해요.' : `${selectedUser?.name || '연결 사용자'}의 설정과 기록을 살펴봐요.`
    : tab === 'home'
      ? '오늘은 무엇을 해볼까요?'
      : tab === 'cards'
      ? `오늘의 추천 카드 ${recommended.length}개를 준비했어요.`
      : tab === 'catalog'
      ? `그림 카드 ${cards.length}개를 살펴보세요.`
      : tab === 'privacy'
      ? '내 기록과 열람 권한을 관리해요.'
      : tab === 'practice'
      ? '카드로 차근차근 연습해요.'
      : '나의 의사소통 기록을 확인해요.';
  if (!authReady) return <main className="login-page"><p role="status">로그인 정보를 확인하는 중입니다…</p></main>;
  if (!user) return <main className="login-page"><section className="login-card">
    <div className="login-mascot"><Mascot /></div><p className="eyebrow">그림으로 전하는 나의 이야기</p><h1>PESC MATE</h1>
    <h2>{authMode === 'login' ? '로그인' : '사용자 가입'}</h2><p className="muted">{authMode === 'login' ? '내 카드 기록과 추천을 불러옵니다.' : 'AAC 사용자 계정을 만들고 바로 시작합니다.'}</p>
    {error && <div role="alert" className="error">{error}</div>}
    <form onSubmit={handleLogin}>
      {authMode === 'register' && <label>이름<input autoFocus autoComplete="name" value={name} onChange={e => setName(e.target.value)} required minLength="1" maxLength="30" /></label>}
      <label>아이디<input autoFocus={authMode === 'login'} autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required minLength={authMode === 'register' ? 4 : 1} maxLength={authMode === 'register' ? 32 : 64} pattern={authMode === 'register' ? '[A-Za-z0-9_-]+' : undefined} /></label>
      <label>비밀번호<input type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={authMode === 'register' ? 8 : 1} maxLength="128" /></label>
      {authMode === 'register' && <><label>비밀번호 확인<input type="password" autoComplete="new-password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} required minLength="8" maxLength="128" /></label><label className="registration-consent"><input type="checkbox" checked={registrationConsent} onChange={event => setRegistrationConsent(event.target.checked)} required />법정대리인이 개인정보 수집·이용과 기본 1년 보존에 동의했습니다.</label></>}
      <button className="primary full" disabled={busy}>{busy ? '처리 중…' : authMode === 'login' ? '로그인' : '가입하고 시작하기'}</button>
    </form>
    <button className="auth-switch" disabled={busy} onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setError(''); setUsername(''); setPassword(''); setPasswordConfirm(''); setName(''); setRegistrationConsent(false); }}>{authMode === 'login' ? '처음 이용하시나요? 사용자 가입' : '이미 계정이 있나요? 로그인'}</button>
    {authMode === 'login' && <p className="demo-account">사용자: <code>demo</code> / <code>demo1234</code><br />보호자: <code>caregiver</code> / <code>caregiver1234</code><br />담당자: <code>support</code> / <code>support1234</code><br />운영 권한 담당자: <code>admin</code> / <code>admin1234</code></p>}
  </section></main>;
  if (!user.profile || showProfile) return <main className="login-page"><ProfileEditor key={user.id} user={user}
    onSaved={account => { setUser(account); cacheAccount(account).catch(() => {}); setShowProfile(false); setProfileNotice('프로필을 저장했습니다.'); }}
    onCancel={user.profile ? () => setShowProfile(false) : handleLogout} /></main>;
  return <main className={`app display-${accessibility.display_mode} card-size-${accessibility.card_size} text-size-${accessibility.text_size}${accessibility.reduced_motion ? ' reduced-motion' : ''}${accessibility.high_contrast ? ' high-contrast' : ''}`}>
    <a className="skip-link" href="#main-content">본문 바로가기</a>
    <aside className="sidebar">
      <div className="sidebar-brand"><Mascot className="mascot-brand" /><strong>PESC<br />MATE</strong></div>
      <div className="profile"><Avatar user={user} /><div><strong>{user.name}</strong><small>{user.role === 'caregiver' ? '보호자 계정' : canManageContent ? '운영 권한 담당자 계정' : user.role === 'support_staff' ? '지원 담당자 계정' : 'AAC 사용자'}</small></div></div>
      <nav aria-label="주 메뉴">{isSupporter ? <>
          <button className={tab === 'support_home' ? 'active' : ''} onClick={() => setTab('support_home')}><span aria-hidden="true">⌂</span>지원 홈</button>
          {canReadRecords && <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => openSupportSection('dashboard')}><span aria-hidden="true">▥</span>의사소통 기록</button>}
          {(canManageQuick || canManageBoard) && <button className={tab === 'board_settings' ? 'active' : ''} onClick={() => openSupportSection('board_settings')}><span aria-hidden="true">▦</span>빠른 표현·카드판</button>}
          {canManageVoice && <button className={tab === 'support_settings' ? 'active' : ''} onClick={() => openSupportSection('support_settings')}><span aria-hidden="true">♿</span>음성·접근 설정</button>}
          {canManageLearning && <button className={tab === 'learning_progress' ? 'active' : ''} onClick={() => openLearning(selectedUser)}><span aria-hidden="true">★</span>학습 성취</button>}
          {canManageContent && <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}><span aria-hidden="true">☑</span>공용 콘텐츠 운영<i aria-label={`승인 대기 ${adminSubmissions.filter(item => item.status === 'pending').length}개`}>{adminSubmissions.filter(item => item.status === 'pending').length}</i></button>}
        </> : <>
          <button className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}><span aria-hidden="true">⌂</span>홈</button>
          <button className={tab === 'cards' ? 'active' : ''} onClick={() => setTab('cards')}><span aria-hidden="true">▦</span>그림으로 말하기<i aria-label={`추천 카드 ${recommended.length}개`}>{recommended.length}</i></button>
          <button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}><span aria-hidden="true">▤</span>카드</button>
          <button className={tab === 'practice' ? 'active' : ''} onClick={() => openLearning(null)}><span aria-hidden="true">★</span>연습하기</button>
          <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}><span aria-hidden="true">▥</span>나의 이용 기록</button>
          <button className={tab === 'privacy' ? 'active' : ''} onClick={() => setTab('privacy')}><span aria-hidden="true">⚿</span>개인정보</button>
        </>}</nav>
      <button type="button" onClick={() => { stopSpeech(); setShowProfile(true); setProfileNotice(''); }}>프로필 설정</button>
      {user.role === 'user' && <details className="accessibility-settings"><summary>♿ 접근 설정</summary><div>
        <label>카드 표시<select value={accessibility.display_mode} onChange={event => updateAccessibility({ display_mode: event.target.value })}><option value="image">그림 중심</option><option value="image_text">그림 + 글자</option><option value="text">글자 중심</option></select></label>
        <label>한 페이지 카드 수<select value={accessibility.cards_per_page} onChange={event => updateAccessibility({ cards_per_page: Number(event.target.value) })}>{[6, 12, 18, 24, 30].map(value => <option key={value} value={value}>{value}개</option>)}</select></label>
        <label>카드 크기<select value={accessibility.card_size} onChange={event => updateAccessibility({ card_size: event.target.value })}><option value="small">작게</option><option value="medium">보통</option><option value="large">크게</option></select></label>
        <label>글자 크기<select value={accessibility.text_size} onChange={event => updateAccessibility({ text_size: event.target.value })}><option value="small">작게</option><option value="medium">보통</option><option value="large">크게</option></select></label>
        <label className="check-setting"><input type="checkbox" checked={accessibility.reduced_motion} onChange={event => updateAccessibility({ reduced_motion: event.target.checked })} />애니메이션·장식 줄이기</label>
        <label className="check-setting"><input type="checkbox" checked={accessibility.high_contrast} onChange={event => updateAccessibility({ high_contrast: event.target.checked })} />고대비 표시</label>
        <button className="primary" disabled={accessibilityBusy || accessibilitySaved} onClick={saveAccessibility}>{accessibilityBusy ? '저장 중…' : accessibilitySaved ? '저장됨' : '설정 저장'}</button>
      </div></details>}
      {user.role === 'user' && <><div className="sidebar-summary"><small>오늘의 의사소통</small><strong>{stats?.today_sessions || 0}개 문장</strong><span>{stats?.today_selections || 0}장의 카드를 사용했어요</span></div>
      <div className="sidebar-tip"><Mascot className="mascot-help" /><div><small>도움말</small><strong>그림을 차례대로 눌러<br />마음을 표현해 보세요.</strong></div></div></>}
      <button className="logout" onClick={handleLogout} disabled={busy}>로그아웃</button>
    </aside>
    <div className="app-content" id="main-content" tabIndex="-1">
      {profileNotice && <p role="status">{profileNotice}</p>}
      <header className="topbar"><div><p className="eyebrow">오늘은 {todayLabel}</p><h1>{pageTitle}</h1></div><div className="topbar-statuses"><span className={`status${offline ? ' offline' : ''}`}><b className={!offline && loaded ? 'online' : ''}></b>{offline ? '오프라인 사용 중' : loaded ? '서비스 연결됨' : '연결 대기'}</span>{speechActive && <div className={`speech-player ${speechState.status}`} role="status" aria-live="polite"><span><b aria-hidden="true">🔊</b><strong>{speechStatusLabel}</strong><small title={speechState.content}>{speechState.content}</small></span>{speechState.status === 'playing' && <button type="button" onClick={pauseSpeech}>일시 정지</button>}{speechState.status === 'paused' && <button type="button" onClick={resumeSpeech}>재개</button>}<button type="button" onClick={stopSpeech}>중지</button></div>}</div></header>
      {offline && <p className="offline-notice" role="status">인터넷 연결 없이 저장된 카드를 사용 중입니다. 즉시 발화와 선택 카드 그대로 발화는 계속 사용할 수 있습니다.{localKoreanVoices.length ? ` 기기에 저장된 한국어 음성 ${localKoreanVoices.length}개를 확인했습니다.` : ' 한국어 음성이 재생되지 않으면 기기 설정에서 음성 데이터를 설치해 주세요.'}{pendingSyncCount ? ` 재연결 후 동기화할 이력 ${pendingSyncCount}건이 있습니다.` : ''}</p>}
      {user.role === 'user' && <section className="recovery-speech" aria-labelledby="recovery-speech-title" data-scan-group="recovery-speech"><div><strong id="recovery-speech-title">다시 말하기·고치기</strong><small>잘못 전했을 때 바로 말해요</small></div>{recoveryExpressions.map(item => <button key={item.id} disabled={speechState.status === 'starting'} aria-label={`${item.label} 복구 표현 말하기`} onClick={() => speakText(item.label, 'recovery')}><span aria-hidden="true">{item.symbol}</span>{item.label}</button>)}<button disabled={!lastUtterance || speechState.status === 'starting'} onClick={() => lastUtterance && speakText(lastUtterance.content, lastUtterance.contentType, lastUtterance.cardIds)}><span aria-hidden="true">🔊</span>마지막 말 다시 듣기</button><button disabled={!board.length && !text} onClick={() => updateBoard([])}><span aria-hidden="true">⌫</span>현재 문장 취소</button><button disabled={!lastSentence} onClick={restoreLastSentence}><span aria-hidden="true">↶</span>직전 문장 불러오기</button></section>}
      {user.role === 'user' && <section className="quick-speech" aria-labelledby="quick-speech-title" data-scan-group="quick-speech"><div><strong id="quick-speech-title">빠른 표현</strong><small>누르면 바로 말해요</small></div>{quickExpressionCards.map(item => <button key={item.id} disabled={speechState.status === 'starting'} aria-label={`${item.label} 바로 말하기`} onClick={() => speakText(item.label, 'card', [item.id])}><span aria-hidden="true">{item.symbol}</span>{item.label}</button>)}</section>}
      {error && <div role="alert" className="error">{error} <button disabled={busy} onClick={() => load(user)}>다시 연결</button></div>}
      {speechFailure && <div role="alert" className="speech-error"><span aria-hidden="true">🔇</span><div><strong>음성을 재생하지 못했어요.</strong><p>{speechFailureMessage(speechFailure.errorCode)} 선택한 카드와 문장은 그대로 유지됩니다.</p></div><div className="speech-error-actions">{speechFailure.retryable && <button className="primary" onClick={() => speakText(speechFailure.content, speechFailure.contentType, speechFailure.cardIds || [])}>다시 재생</button>}<button onClick={() => setSpeechFailure(null)}>닫기</button></div></div>}
      {!loaded && !error && <p role="status">카드를 불러오는 중입니다…</p>}
      {tab === 'support_home' && isSupporter ? <section className="support-home">
        <div className="panel-heading"><span aria-hidden="true">🤝</span><div><h2>{user.role === 'caregiver' ? '보호자 지원 홈' : '담당자 지원 홈'}</h2><p className="muted">연결 사용자를 선택하면 부여된 권한 범위의 메뉴만 표시됩니다.</p></div></div>
        {linkedUsers.length ? <><label className="user-picker">지원할 사용자<select value={selectedUser?.id || ''} onChange={event => changeLinkedUser(event.target.value)}>{linkedUsers.map(person => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}</select></label>
          <div className="support-action-grid">
            {canReadRecords && <button onClick={() => openSupportSection('dashboard')}><span>📊</span><strong>의사소통 기록</strong><small>사용 기록과 안전 관련 표현 확인</small></button>}
            {(canManageQuick || canManageBoard) && <button onClick={() => openSupportSection('board_settings')}><span>▦</span><strong>빠른 표현·카드판</strong><small>표현과 카드 위치를 사용자별로 고정</small></button>}
            {canManageVoice && <button onClick={() => openSupportSection('support_settings')}><span>♿</span><strong>음성·접근 설정</strong><small>목소리와 화면 표시 방식 조정</small></button>}
            {canManageLearning && <button onClick={() => openLearning(selectedUser)}><span>★</span><strong>학습 성취</strong><small>최근 연습 결과와 카테고리별 성취 확인</small></button>}
            {selectedPermissions.includes('notes_write') && <article><span>✓</span><strong>{SUPPORT_PERMISSION_LABELS.notes_write}</strong><small>의사소통 기록 화면에서 사용할 수 있습니다.</small></article>}
          </div></> : <EmptyState>연결된 사용자가 없습니다.</EmptyState>}
      </section> : tab === 'home' && user.role === 'user' ? <section className="home-screen">
        <div className="home-heading"><div><p>원하는 활동을 선택해 주세요</p><h2>나의 PESC MATE</h2></div><Mascot className="mascot-heading" /></div>
        <div className="home-mode-grid" aria-label="주요 활동">
          <button className="home-launch-card communication" onClick={() => setTab('cards')}>
            <span className="home-card-visual" aria-hidden="true"><Mascot className="mascot-launch" /><i>💬</i></span>
            <span className="home-card-label"><small>카드를 골라 마음을 전해요</small><strong>말하기</strong><b aria-hidden="true">→</b></span>
          </button>
          <button className="home-launch-card practice" onClick={() => openLearning(null)}>
            <span className="home-card-visual" aria-hidden="true"><Mascot className="mascot-launch" /><i>★</i></span>
            <span className="home-card-label"><small>그림과 단어를 차근차근 익혀요</small><strong>연습하기</strong><b aria-hidden="true">→</b></span>
          </button>
        </div>
        <nav className="home-secondary-actions" aria-label="추가 활동"><button onClick={() => setTab('catalog')}>🖼️ 카드 살펴보기</button><button onClick={() => setTab('dashboard')}>📊 나의 이용 기록</button></nav>
        <div className="home-note"><Avatar user={user} /><div><strong>{user.name}님, 반가워요!</strong><p>그림 카드를 눌러 오늘의 이야기를 시작해 보세요.</p></div></div>
      </section> : tab === 'cards' && user.role === 'user' ? <div className="communication-layout">
      <section className="recommend-panel"><div className="stage-title"><span className="stage-back" aria-hidden="true">‹‹</span><div><strong>오늘의 추천 카드</strong><i aria-hidden="true"><b></b><b></b><b></b></i><p>자주 쓰는 카드를 골라 문장을 시작해요</p></div><span className="stage-helper" aria-hidden="true">🌱</span></div><div className="cards recommendations">{recommended.map(tile)}</div><div className="stage-ground" aria-hidden="true">▲　▲　　▲　　　▲　▲</div></section>
      <div className="workspace"><section><div className="section-title"><h2>무엇을 말하고 싶나요?</h2><input aria-label="카드 검색" placeholder="카드 이름 검색" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div className="output-mode" role="group" aria-label="출력 방식" data-scan-group="output-mode"><span>출력 방식</span><button aria-pressed={outputMode === 'word'} className={outputMode === 'word' ? 'active' : ''} onClick={() => setOutputMode('word')}>🔊 단어 즉시 발화</button><button aria-pressed={outputMode === 'selection'} className={outputMode === 'selection' ? 'active' : ''} onClick={() => setOutputMode('selection')}>선택 카드 그대로</button><button aria-pressed={outputMode === 'natural'} className={outputMode === 'natural' ? 'active' : ''} onClick={() => setOutputMode('natural')}>자연스러운 문장</button></div>
        <div className="categories" aria-label="카테고리" data-scan-group="categories">{['전체', ...cardCategories.map(item => item.name)].map(c => <button key={c} aria-pressed={category === c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>{c}</button>)}</div>
        <div className="cards" data-scan-group="cards">{visibleCards.map(tile)}</div>
        {cardPagination()}
        {loaded && !filteredCards.length && <EmptyState>검색 결과가 없어요.</EmptyState>}
      </section>
      <section className="board"><div className="section-title"><h2>나의 문장 <small>{board.length}/12</small></h2><button disabled={!board.length || busy} onClick={() => { if (window.confirm('선택한 카드를 모두 지울까요?')) updateBoard([]); }}>비우기</button></div>
        {!board.length && <EmptyState>왼쪽 카드를 눌러 보세요.<br />나 → 물 → 마시다</EmptyState>}
        <ol>{board.map((c, i) => <li key={`${c.id}-${i}`}><span>{c.symbol} {c.label}</span><div><button aria-label={`${i + 1}번째 카드 앞으로`} disabled={i === 0 || busy} onClick={() => move(i, -1)}>←</button><button aria-label={`${i + 1}번째 카드 뒤로`} disabled={i === board.length - 1 || busy} onClick={() => move(i, 1)}>→</button><button aria-label={`${i + 1}번째 카드 삭제`} disabled={busy} onClick={() => updateBoard(board.filter((_, n) => n !== i))}>×</button></div></li>)}</ol>
        {outputMode === 'word' ? <p className="mode-guide">카드 본체를 누르면 단어를 바로 말해요.</p> : outputMode === 'selection' ? <button className="primary full" disabled={!board.length || busy} onClick={speakSelection}>🔊 선택 카드 그대로 말하기</button> : <button className="primary full" disabled={!board.length || busy || offline} onClick={generate}>{offline ? '온라인 연결 후 문장 만들기' : busy ? '문장을 만드는 중…' : '자연스러운 문장 만들기 · 저장'}</button>}
        {generationFailed && <div className="generation-fallback" role="status"><strong>문장 생성 없이도 말할 수 있어요.</strong><span>선택한 카드는 그대로 유지됐습니다.</span><div><button className="primary" disabled={!board.length} onClick={speakSelection}>🔊 선택 카드 그대로 말하기</button><button onClick={() => setOutputMode('word')}>단어 즉시 발화로 전환</button></div></div>}
        <div className="sentence" aria-live="polite">{text ? <><div className="original-order"><small>선택한 카드 순서</small><div>{board.map((card, index) => <span key={`${card.id}-${index}`}>{card.symbol} {card.label}</span>)}</div></div><strong>{text}</strong><small className={`source-badge ${generationSource}`}>{generationSource === 'ollama' ? 'Qwen · Ollama 생성' : '규칙 기반 생성'}{generationAttempt > 1 ? ` · 재생성 ${generationAttempt - 1}회` : ''}</small></> : '만든 문장이 여기에 표시돼요.'}</div>
        <div className="actions">{text && !sentenceConfirmed ? <button className="primary" disabled={busy} onClick={() => setSentenceConfirmed(true)}>✓ 문장을 확인했어요</button> : <button className="primary" disabled={!text || busy || speechActive} onClick={speak}>🔊 확인한 문장 읽기</button>}<button disabled={!generatedSessionId || busy || speechActive} onClick={regenerate}>{busy ? '만드는 중…' : '↻ 다시 만들기'}</button>{speechState.status === 'playing' && <button onClick={pauseSpeech}>일시 정지</button>}{speechState.status === 'paused' && <button onClick={resumeSpeech}>재개</button>}<button disabled={!speechActive} onClick={stopSpeech}>중지</button></div>
        <details className="tts-settings">
          <summary>⚙️ 음성 설정</summary>
          <div className="tts-settings-grid">
            <label>음성 느낌<select value={ttsSettings.preset} onChange={event => changeTtsPreset(event.target.value)}>{Object.entries(TTS_PRESETS).map(([value, preset]) => <option key={value} value={value}>{preset.label}</option>)}</select></label>
            <label>기기 한국어 음성<select value={ttsSettings.voiceName} onChange={event => updateTtsSettings({ voiceName: event.target.value })}><option value="">한국어 음성 자동 선택</option>{ttsSettings.voiceName && !ttsVoices.some(voice => voice.name === ttsSettings.voiceName) && <option value={ttsSettings.voiceName}>{ttsSettings.voiceName} (현재 기기에 없음)</option>}{ttsVoices.map(voice => <option key={voice.voiceURI} value={voice.name}>{voice.name}{voice.localService === true ? ' · 기기 저장' : voice.localService === false ? ' · 온라인 음성' : ' · 오프라인 확인 필요'}</option>)}</select></label>
            <label>속도 <output>{ttsSettings.rate.toFixed(2)}배</output><input type="range" min="0.5" max="1.5" step="0.05" value={ttsSettings.rate} onChange={event => updateTtsSettings({ rate: Number(event.target.value) })} /></label>
            <label>음높이 <output>{ttsSettings.pitch.toFixed(2)}</output><input type="range" min="0.5" max="1.5" step="0.05" value={ttsSettings.pitch} onChange={event => updateTtsSettings({ pitch: Number(event.target.value) })} /></label>
            <label>기본 볼륨 <output>{Math.round(ttsSettings.volume * 100)}%</output><input type="range" min="0" max="1" step="0.05" value={ttsSettings.volume} onChange={event => updateTtsSettings({ volume: Number(event.target.value) })} /></label>
          </div>
          <div className="tts-preview"><small role="status">{localKoreanVoices.length ? `기기에 저장된 한국어 음성 ${localKoreanVoices.length}개를 확인했습니다.` : ttsVoices.length ? `한국어 음성 ${ttsVoices.length}개가 있지만 오프라인 사용 여부는 비행기 모드에서 확인해 주세요.` : '한국어 음성이 없으면 기기 설정에서 음성 데이터를 설치해 주세요.'}</small><span><button type="button" disabled={busy || ttsSettingsBusy} onClick={() => speakText('안녕하세요. 목소리를 확인해 보세요.', 'preview')}>미리 듣기</button><button type="button" className="primary" disabled={ttsSettingsBusy || ttsSettingsSaved} onClick={saveTtsSettings}>{ttsSettingsBusy ? '저장 중…' : '설정 저장'}</button></span></div>
        </details>
        <p className="muted">Ollama Qwen으로 문장을 만들며, 모델을 사용할 수 없으면 규칙 기반 문장으로 자동 전환합니다.</p>
      </section></div>
    </div> : tab === 'practice' && user.role === 'user' ? <section className="learning-hub">
      <div className="panel-heading"><span aria-hidden="true">★</span><div><h2>연습하기</h2><p className="muted">연습 결과는 실제 의사소통 기록과 섞이지 않고 따로 저장됩니다.</p></div></div>
      {learningBusy ? <p role="status">학습 정보를 불러오는 중입니다…</p> : learningGame?.phase === 'playing' || learningGame?.phase === 'saving' ? <article className="learning-game" aria-labelledby="learning-question-title">
        <div className="learning-game-progress"><strong>{learningGame.questionIndex + 1} / {learningGame.questions.length}</strong><progress value={learningGame.questionIndex + (learningGame.feedback ? 1 : 0)} max={learningGame.questions.length} /><span>천천히 골라도 괜찮아요.</span></div>
        {currentLearningQuestion && <><p className="eyebrow">그림과 같은 단어를 골라 보세요</p><h3 id="learning-question-title">이 그림은 무엇일까요?</h3><span className="learning-question-art" role="img" aria-label="문제 그림" style={artStyle(currentLearningQuestion.target)} /><div className="learning-options" role="group" aria-label="단어 보기">{currentLearningQuestion.options.map(option => { const selected = learningGame.selectedId === option.id; const correct = learningGame.feedback === 'correct' && option.id === currentLearningQuestion.target.id; const incorrect = selected && ['retry', 'incorrect'].includes(learningGame.feedback); const locked = ['correct', 'incorrect'].includes(learningGame.feedback); return <button key={option.id} className={correct ? 'correct' : incorrect ? 'incorrect' : ''} aria-pressed={selected} disabled={learningGame.phase === 'saving' || locked || (learningGame.feedback === 'retry' && selected)} onClick={() => answerLearningQuestion(option.id)}>{option.label}</button>; })}</div></>}
        <div className={`learning-feedback ${learningGame.feedback || 'waiting'}`} role="status" aria-live="polite">{learningGame.feedback === 'correct' ? '잘 찾았어요! 다음 문제로 가 볼까요?' : learningGame.feedback === 'retry' ? '괜찮아요. 다른 단어를 다시 골라 보세요.' : learningGame.feedback === 'incorrect' ? `괜찮아요. 정답은 ${currentLearningQuestion?.target.label}이에요.` : '정답을 골라 주세요.'}</div>
        {['correct', 'incorrect'].includes(learningGame.feedback) && <button className="primary learning-next" disabled={learningGame.phase === 'saving'} onClick={nextLearningQuestion}>{learningGame.phase === 'saving' ? '결과 저장 중…' : learningGame.questionIndex === learningGame.questions.length - 1 ? '연습 마치기' : '다음 문제'}</button>}
      </article> : learningGame?.phase === 'complete' ? <article className="learning-result"><span aria-hidden="true">🌟</span><h3>연습을 마쳤어요!</h3><p>처음 선택으로 <strong>{learningGame.attempt?.correct_answers ?? learningGame.correctAnswers}</strong>개를 찾았어요. 틀린 문제도 다시 살펴본 것이 중요한 연습이에요.</p>{learningGame.attempt ? <small>학습 기록에만 안전하게 저장했습니다.</small> : <small>결과가 저장되지 않았습니다. 다시 연결한 뒤 한 번 더 연습해 주세요.</small>}<div><button onClick={() => setLearningGame(null)}>연습 목록</button><button className="primary" onClick={startLearningGame}>같은 범위 다시 연습</button></div></article> : <div className="learning-overview-grid">
        <article className="learning-activity-card"><span aria-hidden="true">🧩</span><div><h3>단어·그림 맞추기</h3><p>그림과 알맞은 단어를 찾아보는 연습입니다.</p>{learningSettings && <small>{learningSettings.question_count}문제 · 보기 {learningSettings.option_count}개 · 카드 반복 {learningSettings.repeat_frequency}회 · 권장 시간 {learningSettings.time_limit_seconds}초 · {learningSettings.retry_enabled ? '재도전 가능' : '정답 확인 후 진행'}</small>}</div><label>연습 범위<select value={practiceCategory} onChange={event => setPracticeCategory(event.target.value)}><option value="all">설정된 카드 전체</option>{practiceCategories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="primary" disabled={availablePracticeCards().length < (learningSettings?.option_count || 3)} onClick={startLearningGame}>연습 시작</button></article>
        <article><h3>최근 30일 연습</h3><div className="learning-metrics"><div><strong>{learningProgress?.attempts || 0}</strong><span>완료 횟수</span></div><div><strong>{learningProgress?.average_score || 0}점</strong><span>평균 점수</span></div><div><strong>{learningProgress?.correct_answers || 0}</strong><span>처음에 맞힌 문제</span></div></div>{!learningProgress?.attempts && <p className="muted">아직 완료한 연습이 없습니다.</p>}</article>
      </div>}
      <button className="primary communication-return" onClick={() => setTab('cards')}>💬 말하기로 이동</button>
    </section> : tab === 'catalog' && user.role === 'user' ? <section className="card-catalog">
      <div className="catalog-toolbar">
        <div><h2>카드 보기</h2><p className="muted">카드를 눌러 그림과 뜻을 확인해 보세요.</p></div>
        <div className="catalog-actions"><input aria-label="카드 검색" placeholder="카드 이름 검색" value={search} onChange={event => setSearch(event.target.value)} /><button className="primary" onClick={() => { setEditingSubmission(null); setCardFormError(''); setShowCardForm(true); }}>+ 카드 등록</button></div>
      </div>
      <div className="categories" aria-label="카테고리">{['전체', ...cardCategories.map(item => item.name)].map(item => <button key={item} aria-pressed={category === item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
      <div className="catalog-layout">
        <div className="catalog-grid" aria-label="카드 목록">{visibleCards.map(card => <button className="catalog-card" key={card.id} aria-pressed={selectedCard?.id === card.id} onClick={() => setSelectedCard(card)}>
          {cardArt(card)}
          <span><strong>{card.label}</strong><small>{card.category}</small></span>{cardSpeaker(card)}
        </button>)}</div>
        {cardPagination()}
        <aside className="card-detail" aria-live="polite">
          {selectedCard ? <>{cardArt(selectedCard, 'detail-art')}<span className="detail-category">{selectedCard.category}</span><h3>{selectedCard.label}</h3><p>{selectedCard.label}을(를) 표현하는 PECS 카드예요.</p><div className="detail-actions"><button aria-label={`${selectedCard.label} 단어 듣기`} onClick={() => speakText(selectedCard.label, 'card', [selectedCard.id])}>🔊 단어 듣기</button><button className="primary" onClick={() => { add(selectedCard); setTab('cards'); }}>문장에 사용하기</button></div></> : <div className="detail-empty"><Mascot /><strong>카드를 선택해 주세요</strong><p>선택한 카드의 그림과 뜻이 여기에 보여요.</p></div>}
        </aside>
      </div>
      <div className="submission-list"><h3>나의 카드</h3>{cardSubmissions.length ? <ul>{cardSubmissions.map(item => <li key={item.id}><span><strong>{item.label}</strong><small>{item.category} · {item.sharing_notice || (item.visibility === 'private' ? '나만 사용' : '공개 요청')}</small></span><div className="submission-actions"><b className={`submission-status ${item.status}`}>{item.visibility === 'private' && item.status === 'approved' ? '나만 사용 중' : ({ draft: '작성 중', pending: '승인 대기', approved: '공개 승인', rejected: '반려', inactive: '비활성' })[item.status] || item.status}</b>{['draft', 'rejected'].includes(item.status) && <button disabled={reviewBusy === item.id} onClick={() => { setEditingSubmission(item); setCardFormError(''); setShowCardForm(true); }}>수정</button>}{item.status === 'draft' && <button className="primary" disabled={reviewBusy === item.id} onClick={() => submitDraft(item)}>{item.visibility === 'private' ? '나만 사용 시작' : '공개 승인 요청'}</button>}</div></li>)}</ul> : <p className="muted">아직 등록한 카드가 없어요.</p>}</div>
      {loaded && !filteredCards.length && <EmptyState>조건에 맞는 카드가 없어요. 다른 검색어나 카테고리를 선택해 보세요.</EmptyState>}
      {showCardForm && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowCardForm(false); }}>
        <section className="card-form-modal" role="dialog" aria-modal="true" aria-labelledby="card-form-title">
          <div className="modal-heading"><div><h2 id="card-form-title">{editingSubmission ? '카드 수정' : '새 카드 등록'}</h2><p className="muted">{editingSubmission ? '반려 사유를 확인하고 정보를 수정해 주세요.' : '등록할 카드의 정보를 입력해 주세요.'}</p></div><button type="button" aria-label="등록 폼 닫기" onClick={() => { setShowCardForm(false); setEditingSubmission(null); }}>×</button></div>
          <form key={editingSubmission?.id || 'new'} className="card-form" onSubmit={submitCard}>
            {cardFormError && <div role="alert" className="error">{cardFormError}</div>}
            <label>카드명<input name="label" required maxLength="30" placeholder="예: 연필" defaultValue={editingSubmission?.label || ''} /></label>
            <label>카드 뜻<textarea name="meaning" required maxLength="120" rows="3" placeholder="카드가 나타내는 뜻을 적어 주세요." defaultValue={editingSubmission?.meaning || ''} /></label>
            <label>카테고리<select name="category" required defaultValue={editingSubmission?.category || ''}><option value="" disabled>카테고리 선택</option>{cardCategories.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
            <label>공개 범위<select name="visibility" defaultValue={editingSubmission?.visibility || 'private'}><option value="private">나만 사용 · 운영 담당자에게 공유되지 않음</option><option value="shared">운영 담당자 승인 후 모든 사용자에게 공개</option></select></label>
            {!editingSubmission && <label>카드 이미지<input name="image" required type="file" accept="image/jpeg,image/png,image/webp" capture="environment" /></label>}
            <p className="form-notice">개인 카드는 운영 담당자에게 공유되지 않고 저장 즉시 나만 사용할 수 있어요. 공개 카드는 운영 담당자 승인 후 모두에게 표시됩니다. JPG, PNG, WebP 파일을 5MB 이하, 가로·세로 128~4096px로 올려 주세요.</p>
            <div className="modal-actions"><button type="button" disabled={cardFormBusy} onClick={() => { setShowCardForm(false); setEditingSubmission(null); }}>취소</button>{!editingSubmission && <button type="submit" value="draft" disabled={cardFormBusy}>임시 저장</button>}<button type="submit" value="submit" className="primary" disabled={cardFormBusy}>{cardFormBusy ? '저장 중…' : editingSubmission ? '수정 저장' : '저장 또는 공개 요청'}</button></div>
          </form>
        </section>
      </div>}
    </section> : tab === 'learning_progress' && isSupporter && canManageLearning ? <section className="learning-hub">
      <div className="panel-heading"><span aria-hidden="true">★</span><div><h2>연결 사용자 학습 성취</h2><p className="muted">학습 결과는 의사소통 기록과 분리된 최근 30일 집계입니다.</p></div></div>
      <label className="user-picker">조회 사용자<select value={selectedUser?.id || ''} onChange={event => changeLinkedUser(event.target.value)} disabled={learningBusy}>{linkedUsers.filter(person => person.permissions.includes('learning_manage')).map(person => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}</select></label>
      {learningBusy ? <p role="status">학습 성취를 불러오는 중입니다…</p> : <div className="learning-overview-grid">
        <article><h3>{selectedUser?.name}님의 학습 설정</h3>{learningSettings ? <form className="learning-settings-form" onSubmit={saveLearningConfiguration}><fieldset><legend>학습 카테고리</legend><div className="learning-category-options">{cardCategories.map(item => <label key={item.id}><input type="checkbox" checked={learningSettings.category_ids.includes(item.id)} onChange={event => updateLearningSetting({ category_ids: event.target.checked ? [...learningSettings.category_ids, item.id] : learningSettings.category_ids.filter(id => id !== item.id) })} />{item.name}</label>)}</div></fieldset><div className="learning-setting-fields"><label>문제 수<select value={learningSettings.question_count} onChange={event => updateLearningSetting({ question_count: Number(event.target.value) })}>{[5, 10, 15, 20, 30].map(value => <option key={value} value={value}>{value}개</option>)}</select></label><label>단어 보기 수<select value={learningSettings.option_count} onChange={event => updateLearningSetting({ option_count: Number(event.target.value) })}>{[2, 3, 4].map(value => <option key={value} value={value}>{value}개</option>)}</select></label><label>카드 반복<select value={learningSettings.repeat_frequency} onChange={event => updateLearningSetting({ repeat_frequency: Number(event.target.value) })}>{[1, 2, 3].map(value => <option key={value} value={value}>{value}회</option>)}</select></label><label>권장 시간<select value={learningSettings.time_limit_seconds} onChange={event => updateLearningSetting({ time_limit_seconds: Number(event.target.value) })}>{[30, 60, 120, 300, 600].map(value => <option key={value} value={value}>{value}초</option>)}</select></label></div><label className="privacy-check"><input type="checkbox" checked={learningSettings.retry_enabled} onChange={event => updateLearningSetting({ retry_enabled: event.target.checked })} />오답을 다시 선택할 수 있게 해요</label><button className="primary" disabled={!learningSettings.category_ids.length}>학습 설정 저장</button></form> : <p className="muted">기본 학습 설정을 사용합니다.</p>}</article>
        <article><h3>최근 30일 성취</h3><div className="learning-metrics"><div><strong>{learningProgress?.attempts || 0}</strong><span>완료 횟수</span></div><div><strong>{learningProgress?.average_score || 0}점</strong><span>평균 점수</span></div><div><strong>{learningProgress?.correct_answers || 0}/{learningProgress?.total_questions || 0}</strong><span>정답</span></div></div>{learningProgress?.last_completed_at ? <p className="muted">최근 완료 {new Date(learningProgress.last_completed_at).toLocaleString('ko-KR')}</p> : <p className="muted">아직 완료한 연습이 없습니다.</p>}</article>
      </div>}
    </section> : tab === 'board_settings' && isSupporter && (canManageQuick || canManageBoard) ? <section className="board-settings-panel">
      <div className="panel-heading"><span aria-hidden="true">▦</span><div><h2>복구·빠른 표현·고정 카드판</h2><p className="muted">저장한 순서가 {selectedUser?.name} 사용자의 다른 기기에도 동일하게 적용됩니다.</p></div></div>
      <label className="user-picker">설정 사용자<select value={selectedUser?.id || ''} onChange={event => changeLinkedUser(event.target.value)} disabled={statsBusy}>{linkedUsers.filter(person => person.permissions.some(permission => ['quick_speech_manage', 'board_manage'].includes(permission))).map(person => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}</select></label>
      {boardLayout && <div className="board-config-grid">
        {canManageQuick && <article><h3>다시 말하기·고치기 <small>{recoveryDraft.length}/4</small></h3><p className="muted">아동 화면의 고정 영역에 표시할 표현을 2~4개 선택하고 순서를 정하세요.</p><div className="config-card-options">{RECOVERY_EXPRESSIONS.map(item => <button key={item.id} aria-pressed={recoveryDraft.includes(item.id)} onClick={() => toggleDraft(setRecoveryDraft, recoveryDraft, item.id, 4)}>{item.symbol} {item.label}</button>)}</div><ol className="config-order-list">{recoveryDraft.map((id, index) => { const item = RECOVERY_EXPRESSIONS.find(expression => expression.id === id); return <li key={id}><span>{index + 1}. {item?.symbol} {item?.label}</span><div><button aria-label={`${item?.label} 앞으로`} disabled={index === 0} onClick={() => moveDraft(setRecoveryDraft, index, -1)}>↑</button><button aria-label={`${item?.label} 뒤로`} disabled={index === recoveryDraft.length - 1} onClick={() => moveDraft(setRecoveryDraft, index, 1)}>↓</button><button aria-label={`${item?.label} 제외`} disabled={recoveryDraft.length <= 2} onClick={() => setRecoveryDraft(current => current.filter(expressionId => expressionId !== id))}>×</button></div></li>; })}</ol><button className="primary" disabled={boardConfigBusy === 'recovery' || recoveryDraft.length < 2} onClick={() => saveBoardConfiguration('recovery')}>{boardConfigBusy === 'recovery' ? '저장 중…' : '복구 표현 저장'}</button></article>}
        {canManageQuick && <article><h3>빠른 표현 <small>{quickDraft.length}/8</small></h3><p className="muted">카드를 선택하고 화살표로 표시 순서를 정하세요.</p><div className="config-card-options">{layoutCards.map(card => <button key={card.id} aria-pressed={quickDraft.includes(card.id)} onClick={() => toggleDraft(setQuickDraft, quickDraft, card.id, 8)}>{card.symbol} {card.label}</button>)}</div><ol className="config-order-list">{quickDraft.map((id, index) => { const card = layoutCardsById.get(id); return <li key={id}><span>{index + 1}. {card?.symbol} {card?.label || id}</span><div><button aria-label={`${card?.label || id} 앞으로`} disabled={index === 0} onClick={() => moveDraft(setQuickDraft, index, -1)}>↑</button><button aria-label={`${card?.label || id} 뒤로`} disabled={index === quickDraft.length - 1} onClick={() => moveDraft(setQuickDraft, index, 1)}>↓</button><button aria-label={`${card?.label || id} 제외`} onClick={() => setQuickDraft(current => current.filter(cardId => cardId !== id))}>×</button></div></li>; })}</ol><button className="primary" disabled={boardConfigBusy === 'quick' || !quickDraft.length} onClick={() => saveBoardConfiguration('quick')}>{boardConfigBusy === 'quick' ? '저장 중…' : '빠른 표현 저장'}</button></article>}
        {canManageBoard && <article><h3>고정 카드 슬롯 <small>{slotDraft.length}/30</small></h3><p className="muted">선택한 카드만 번호 순서대로 표시되며 이용 빈도로 위치가 바뀌지 않습니다.</p><div className="config-card-options">{layoutCards.map(card => <button key={card.id} aria-pressed={slotDraft.includes(card.id)} onClick={() => toggleDraft(setSlotDraft, slotDraft, card.id, 30)}>{card.symbol} {card.label}</button>)}</div><ol className="config-order-list">{slotDraft.map((id, index) => { const card = layoutCardsById.get(id); return <li key={id}><span>슬롯 {index + 1} · {card?.symbol} {card?.label || id}</span><div><button aria-label={`${card?.label || id} 앞으로`} disabled={index === 0} onClick={() => moveDraft(setSlotDraft, index, -1)}>↑</button><button aria-label={`${card?.label || id} 뒤로`} disabled={index === slotDraft.length - 1} onClick={() => moveDraft(setSlotDraft, index, 1)}>↓</button><button aria-label={`${card?.label || id} 제외`} onClick={() => setSlotDraft(current => current.filter(cardId => cardId !== id))}>×</button></div></li>; })}</ol><button className="primary" disabled={boardConfigBusy === 'slots' || !slotDraft.length} onClick={() => saveBoardConfiguration('slots')}>{boardConfigBusy === 'slots' ? '저장 중…' : '카드판 저장'}</button></article>}
      </div>}
      <article className="board-audit"><h3>최근 구성 변경</h3>{boardLayoutAudit.length ? <ul>{boardLayoutAudit.slice(0, 10).map(item => <li key={item.id}><span>{({ recovery_expressions_changed: '복구 표현 변경', quick_expressions_changed: '빠른 표현 변경', board_slots_changed: '카드 슬롯 변경' })[item.action] || item.action} · 변경자 {item.actor_id}</span><time>{new Date(item.created_at).toLocaleString('ko-KR')}</time></li>)}</ul> : <p className="muted">아직 변경 기록이 없습니다.</p>}</article>
    </section> : tab === 'support_settings' && isSupporter && canManageVoice ? <section className="support-settings-panel">
      <div className="panel-heading"><span aria-hidden="true">♿</span><div><h2>음성·접근 설정</h2><p className="muted">{selectedUser?.name} 사용자에게 적용할 설정입니다.</p></div></div>
      <label className="user-picker">설정 사용자<select value={selectedUser?.id || ''} onChange={event => changeLinkedUser(event.target.value)} disabled={statsBusy}>{linkedUsers.filter(person => person.permissions.includes('voice_access_manage')).map(person => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}</select></label>
      <div className="support-settings-grid">
        <article><h3>목소리 설정</h3><div className="tts-settings-grid">
          <label>음성 느낌<select value={ttsSettings.preset} onChange={event => changeTtsPreset(event.target.value)}>{Object.entries(TTS_PRESETS).map(([value, preset]) => <option key={value} value={value}>{preset.label}</option>)}</select></label>
          <label>기기 한국어 음성<select value={ttsSettings.voiceName} onChange={event => updateTtsSettings({ voiceName: event.target.value })}><option value="">한국어 음성 자동 선택</option>{ttsVoices.map(voice => <option key={voice.voiceURI} value={voice.name}>{voice.name}{voice.localService === true ? ' · 기기 저장' : voice.localService === false ? ' · 온라인 음성' : ' · 오프라인 확인 필요'}</option>)}</select></label>
          <label>속도 <output>{ttsSettings.rate.toFixed(2)}배</output><input type="range" min="0.5" max="1.5" step="0.05" value={ttsSettings.rate} onChange={event => updateTtsSettings({ rate: Number(event.target.value) })} /></label>
          <label>음높이 <output>{ttsSettings.pitch.toFixed(2)}</output><input type="range" min="0.5" max="1.5" step="0.05" value={ttsSettings.pitch} onChange={event => updateTtsSettings({ pitch: Number(event.target.value) })} /></label>
          <label>기본 볼륨 <output>{Math.round(ttsSettings.volume * 100)}%</output><input type="range" min="0" max="1" step="0.05" value={ttsSettings.volume} onChange={event => updateTtsSettings({ volume: Number(event.target.value) })} /></label>
        </div><button className="primary" disabled={ttsSettingsBusy || ttsSettingsSaved} onClick={saveTtsSettings}>{ttsSettingsBusy ? '저장 중…' : ttsSettingsSaved ? '저장됨' : '목소리 저장'}</button></article>
        <article><h3>화면 접근 설정</h3><div className="support-access-fields">
          <label>카드 표시<select value={accessibility.display_mode} onChange={event => updateAccessibility({ display_mode: event.target.value })}><option value="image">그림 중심</option><option value="image_text">그림 + 글자</option><option value="text">글자 중심</option></select></label>
          <label>한 페이지 카드 수<select value={accessibility.cards_per_page} onChange={event => updateAccessibility({ cards_per_page: Number(event.target.value) })}>{[6, 12, 18, 24, 30].map(value => <option key={value} value={value}>{value}개</option>)}</select></label>
          <label>카드 크기<select value={accessibility.card_size} onChange={event => updateAccessibility({ card_size: event.target.value })}><option value="small">작게</option><option value="medium">보통</option><option value="large">크게</option></select></label>
          <label>글자 크기<select value={accessibility.text_size} onChange={event => updateAccessibility({ text_size: event.target.value })}><option value="small">작게</option><option value="medium">보통</option><option value="large">크게</option></select></label>
          <label className="privacy-check"><input type="checkbox" checked={accessibility.reduced_motion} onChange={event => updateAccessibility({ reduced_motion: event.target.checked })} />애니메이션·장식 줄이기</label>
          <label className="privacy-check"><input type="checkbox" checked={accessibility.high_contrast} onChange={event => updateAccessibility({ high_contrast: event.target.checked })} />고대비 표시</label>
        </div><button className="primary" disabled={accessibilityBusy || accessibilitySaved} onClick={saveAccessibility}>{accessibilityBusy ? '저장 중…' : accessibilitySaved ? '저장됨' : '접근 설정 저장'}</button></article>
      </div>
    </section> : tab === 'privacy' && user.role === 'user' ? <section className="privacy-panel">
      <div className="panel-heading"><span aria-hidden="true">🔐</span><div><h2>개인정보와 열람 권한</h2><p className="muted">누가 기록을 볼 수 있는지 확인하고 내 데이터를 관리합니다.</p></div></div>
      {privacy.deletion_status === 'completed' && <p className="privacy-receipt" role="status">이용 데이터 삭제 완료 · {privacy.deleted_at ? new Date(privacy.deleted_at).toLocaleString('ko-KR') : ''}</p>}
      <div className="privacy-grid">
        <article><h3>동의와 보존 기간</h3><label className="privacy-check"><input type="checkbox" checked={privacy.guardian_consent} onChange={event => setPrivacy(current => ({ ...current, guardian_consent: event.target.checked }))} />법정대리인이 개인정보 수집·이용에 동의했음을 확인합니다.</label><label>기록 보존 기간<select value={privacy.retention_days} onChange={event => setPrivacy(current => ({ ...current, retention_days: Number(event.target.value) }))}><option value="30">30일</option><option value="90">90일</option><option value="365">1년</option><option value="1095">3년</option></select></label><p className="muted">기간이 지난 문장·음성 이력은 설정 저장 시 삭제됩니다.</p><button className="primary" disabled={privacyBusy === 'settings'} onClick={savePrivacySettings}>{privacyBusy === 'settings' ? '저장 중…' : '동의 및 기간 저장'}</button></article>
        <article className="support-access-manager"><h3>보호자·담당자 연결</h3>{privacyCaregivers.length ? <ul className="privacy-caregivers">{privacyCaregivers.map(item => <li key={item.supporter_id}><div className="support-link-heading"><span><strong>{item.name}</strong><small>{item.username} · {item.role === 'caregiver' ? '보호자' : '지원 담당자'}</small></span><button disabled={privacyBusy === item.supporter_id} onClick={() => removePrivacyCaregiver(item)}>연결 해제</button></div><div className="permission-options">{Object.entries(SUPPORT_PERMISSION_LABELS).map(([permission, label]) => <label key={permission}><input type="checkbox" checked={(supportPermissionDrafts[item.supporter_id] || item.permissions).includes(permission)} onChange={() => setSupportPermissionDrafts(current => ({ ...current, [item.supporter_id]: toggleSupportPermission(current[item.supporter_id] || item.permissions, permission) }))} />{label}</label>)}</div><button className="primary" disabled={privacyBusy === item.supporter_id || JSON.stringify(supportPermissionDrafts[item.supporter_id] || item.permissions) === JSON.stringify(item.permissions)} onClick={() => saveSupportPermissions(item)}>권한 저장</button></li>)}</ul> : <p className="muted">연결된 보호자나 담당자가 없습니다.</p>}<form className="privacy-connect" onSubmit={addPrivacyCaregiver}><label>보호자·담당자 아이디<input required maxLength="64" value={caregiverUsername} onChange={event => setCaregiverUsername(event.target.value)} /></label><fieldset><legend>부여할 권한</legend><div className="permission-options">{Object.entries(SUPPORT_PERMISSION_LABELS).map(([permission, label]) => <label key={permission}><input type="checkbox" checked={newSupportPermissions.includes(permission)} onChange={() => setNewSupportPermissions(current => toggleSupportPermission(current, permission))} />{label}</label>)}</div></fieldset><button className="primary" disabled={privacyBusy === 'caregiver' || !newSupportPermissions.length}>연결</button></form></article>
        <article><h3>연결 변경 이력</h3>{privacyAudit.length ? <ul className="privacy-audit">{privacyAudit.slice(0, 10).map(item => <li key={item.id}><span>{({ caregiver_connected: '보호자 연결', caregiver_disconnected: '보호자 연결 해제', support_granted: '지원 연결 및 권한 부여', support_permissions_changed: '지원 권한 변경', support_revoked: '지원 연결 해제', personal_data_deleted: '이용 데이터 삭제' })[item.action] || item.action}<small>처리자 {item.actor_id}</small></span><time>{new Date(item.created_at).toLocaleString('ko-KR')}</time></li>)}</ul> : <p className="muted">변경 이력이 없습니다.</p>}</article>
        <article className="privacy-data"><h3>다운로드와 삭제</h3><p>다운로드에는 계정 정보, 문장·음성 이력, 개인 카드와 현재 열람자가 포함됩니다. 이미지 원본과 비밀번호는 포함되지 않습니다.</p><div><button disabled={privacyBusy === 'export'} onClick={downloadPrivacyData}>{privacyBusy === 'export' ? '준비 중…' : '내 데이터 다운로드'}</button><button className="danger" disabled={privacyBusy === 'delete'} onClick={deletePrivacyData}>{privacyBusy === 'delete' ? '삭제 중…' : '이용 데이터 삭제'}</button></div><small>삭제하면 개인 카드, 의사소통·음성 기록, 보호자 연결, 프로필 이미지와 사용자 설정이 제거됩니다. 로그인 계정과 삭제 확인 기록은 유지됩니다.</small></article>
      </div>
    </section> : tab === 'admin' && canManageContent ? <section className="admin-review">
      <div className="category-admin">
        <div className="panel-heading"><span aria-hidden="true">▦</span><div><h2>카테고리 관리</h2><p className="muted">카테고리를 추가하고 표시 순서와 활성 상태를 관리하세요.</p></div></div>
        {categoryError && <div role="alert" className="error">{categoryError}</div>}
        <form className="category-create" onSubmit={addCategory}><label>이름<input name="name" required maxLength="30" placeholder="예: 운동" /></label><label>표시 순서<input name="display_order" required type="number" min="1" max="999" defaultValue={adminCategories.length + 1} /></label><button className="primary" disabled={categoryBusy === 'new'}>{categoryBusy === 'new' ? '추가 중…' : '카테고리 추가'}</button></form>
        <div className="category-admin-list">{adminCategories.map(item => <article className={!item.active ? 'inactive' : ''} key={item.id}>
          <label>이름<input value={categoryEdits[item.id]?.name ?? item.name} maxLength="30" onChange={event => setCategoryEdits(current => ({ ...current, [item.id]: { ...(current[item.id] || item), name: event.target.value } }))} /></label>
          <label>순서<input type="number" min="1" max="999" value={categoryEdits[item.id]?.display_order ?? item.display_order} onChange={event => setCategoryEdits(current => ({ ...current, [item.id]: { ...(current[item.id] || item), display_order: event.target.value } }))} /></label>
          <b className={`submission-status ${item.active ? 'approved' : 'inactive'}`}>{item.active ? '활성' : '비활성'}</b>
          <div><button disabled={categoryBusy === item.id} onClick={() => saveCategory(item)}>수정 저장</button><button className={item.active ? 'danger' : 'primary'} disabled={categoryBusy === item.id} onClick={() => saveCategory(item, !item.active)}>{item.active ? '비활성' : '활성화'}</button></div>
        </article>)}</div>
      </div>
      <div className="panel-heading"><span aria-hidden="true">🛡️</span><div><h2>카드 승인 관리</h2><p className="muted">사용자가 제출한 카드를 확인하고 승인하거나 반려해 주세요.</p></div></div>
      <div className="review-summary"><strong>{adminSubmissions.filter(item => item.status === 'pending').length}</strong><span>승인 대기</span><strong>{adminSubmissions.filter(item => item.status === 'approved').length}</strong><span>승인 완료</span><strong>{adminSubmissions.filter(item => item.status === 'rejected').length}</strong><span>반려</span></div>
      <div className="review-grid">{adminSubmissions.map(item => <article className="review-card" key={item.id}>
        {cardArt(item, 'review-image')}
        <div className="review-content"><div className="review-title"><span><small>{item.category} · {item.visibility === 'private' ? '개인 카드' : '공개 카드'}</small><h3>{item.label}</h3></span><b className={`submission-status ${item.status}`}>{({ pending: '승인 대기', approved: '승인', rejected: '반려', inactive: '비활성' })[item.status] || item.status}</b></div><p>{item.meaning}</p><small>제출자 {item.owner_id} · {new Date(item.created_at).toLocaleString('ko-KR')}</small>
          {item.language_flags?.length > 0 && <div className="language-review"><strong>표현 검토 참고</strong>{item.language_flags.map(flag => <div key={`${flag.term}-${flag.kind}`}><b>{flag.term}</b><span>{flag.kind} · {flag.meaning}</span><small>{flag.source}</small></div>)}</div>}
          {item.image_safety && <div className={`image-safety ${item.image_safety.status}`}><strong>{item.image_safety.status === 'passed' ? '자동 안전성 검사 통과' : '이미지 수동 검토 필요'}</strong><span>{item.image_safety.provider}</span>{item.image_safety.reasons?.map(reason => <small key={reason}>{reason}</small>)}</div>}
          {item.status === 'pending' ? <><textarea aria-label={`${item.label} 검토 사유`} maxLength="500" placeholder="반려 시 사유를 입력해 주세요." value={reviewDrafts[item.id] || ''} onChange={event => setReviewDrafts(current => ({ ...current, [item.id]: event.target.value }))} /><div className="review-actions"><button className="primary" disabled={reviewBusy === item.id} onClick={() => reviewCard(item, 'approved')}>승인</button><button className="danger" disabled={reviewBusy === item.id} onClick={() => reviewCard(item, 'rejected')}>반려</button></div></> : <>{item.review_reason && <p className="review-reason">처리 사유: {item.review_reason}</p>}{item.status === 'approved' && <div className="review-actions"><button className="danger" disabled={reviewBusy === item.id} onClick={() => reviewCard(item, 'inactive')}>비활성</button></div>}{item.status === 'inactive' && <div className="review-actions"><button className="primary" disabled={reviewBusy === item.id} onClick={() => reviewCard(item, 'approved')}>재활성</button></div>}</>}
        </div>
      </article>)}</div>
      {!adminSubmissions.length && <EmptyState>아직 제출된 카드가 없습니다.</EmptyState>}
    </section> : <section className="dashboard"><div className="panel-heading"><span aria-hidden="true">🏆</span><div><h2>{isSupporter ? '연결 사용자 의사소통 기록' : '나의 의사소통 기록'}</h2><p className="muted">{(selectedUser || user).name} · {period === 'all' ? '전체 기간' : `최근 ${period}일`} · 문장 저장 기준</p></div></div>
      {isSupporter && selectedUser && <div className="profile"><Avatar user={selectedUser} /><strong>{selectedUser.name}</strong></div>}
      {isSupporter && <label className="user-picker">조회 사용자<select value={selectedUser?.id || ''} onChange={event => changeLinkedUser(event.target.value)} disabled={statsBusy}>{linkedUsers.filter(person => person.permissions.includes('records_read')).map(person => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}</select></label>}
      <div className="period-filter" aria-label="조회 기간">{[['7', '최근 7일'], ['30', '최근 30일'], ['all', '전체']].map(([value, label]) => <button key={value} className={period === value ? 'active' : ''} aria-pressed={period === value} disabled={statsBusy} onClick={() => changePeriod(value)}>{label}</button>)}</div>
      {statsBusy && <p className="muted" role="status">통계를 불러오는 중입니다…</p>}
      {isSupporter && loaded && !selectedUser && <EmptyState>연결된 사용자가 없습니다.</EmptyState>}
      {stats && <div className={statsBusy ? 'stats-content loading' : 'stats-content'}>
        {isSupporter && <><div className="guardian-summary">
          <div><span>오늘 문장</span><strong>{stats.today_sessions}개</strong></div><div><span>오늘 사용 카드</span><strong>{stats.today_selections}장</strong></div>
          <div><span>자주 사용한 감정·상태 표현</span><strong>{stats.frequent_emotion_state?.label || '기록 없음'}</strong></div><div><span>마지막 표현</span><strong>{stats.last_activity ? new Date(stats.last_activity).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '기록 없음'}</strong></div>
        </div><div className="guardian-grid"><article className="activity-panel"><h3>최근 7일 의사소통</h3><div className="activity-chart">{stats.daily_activity.map(day => { const max = Math.max(...stats.daily_activity.map(item => item.sessions), 1); return <div key={day.date}><span className="activity-value">{day.sessions}</span><i style={{ height: `${Math.max((day.sessions / max) * 100, 4)}%` }}></i><time>{new Date(`${day.date}T00:00:00`).toLocaleDateString('ko-KR', { weekday: 'short' })}</time></div>; })}</div></article>
          <article className="attention-panel"><h3>최근 안전 관련 표현</h3><p className="safety-note">위험을 자동 판단하는 항목이 아니며, 최근 의사표현을 확인하기 위한 기록입니다.</p>{stats.recent_safety_expressions.length ? stats.recent_safety_expressions.map(item => <div className="attention-item" key={item.id}>{cardPicture(item)}<span><strong>{item.label} · {item.count}회</strong><small>최근 {new Date(item.last_used_at).toLocaleString('ko-KR')}</small></span></div>) : <p className="muted">선택한 기간에 안전 관련 표현 기록이 없어요.</p>}</article>
        </div></>}
        <div className="metrics"><div>저장한 문장<strong>{stats.sessions}개</strong></div><div>사용한 카드<strong>{stats.selections}장</strong></div></div>
        <h3>카테고리별 사용</h3>{Object.entries(stats.categories).map(([name, count]) => <div className="bar" key={name}><span>{name}</span><meter min="0" max={Math.max(stats.selections, 1)} value={count} /> {count}회</div>)}
        <h3>자주 사용한 카드</h3><div className="categories">{stats.top_cards.slice(0, 8).map(c => <span className="status" key={c.id}>{c.symbol} {c.label} · {c.count}회</span>)}</div>
        <h3>{isSupporter ? '최근 의사소통 타임라인' : '최근 문장'}</h3>{!stats.recent.length ? <EmptyState>선택한 기간에 기록이 없어요.</EmptyState> : <ul className="history">{stats.recent.map(r => <li key={r.id}>{isSupporter && <div className="history-cards">{r.cards.map((id, index) => cardPicture({ ...(CARD_META[id] || { id, label: id, image_index: 0 }), id: `${id}-${index}` }))}</div>}<span>{r.sentence}</span><time>{new Date(r.created_at).toLocaleString('ko-KR')}</time>{isSupporter && canWriteNotes && <div className="caregiver-note"><textarea aria-label={`${r.sentence} 지원 메모`} maxLength="500" placeholder="상황이나 반응을 메모해 주세요" value={noteDrafts[r.id] ?? r.caregiver_note ?? ''} onChange={event => setNoteDrafts(current => ({ ...current, [r.id]: event.target.value }))} /><div><small>{(noteDrafts[r.id] ?? r.caregiver_note ?? '').length}/500</small><button disabled={noteBusy === r.id} onClick={() => saveCaregiverNote(r.id)}>메모 저장</button>{r.caregiver_note && <button disabled={noteBusy === r.id} onClick={() => removeCaregiverNote(r.id)}>삭제</button>}</div></div>}</li>)}</ul>}</div>}
      </section>}
      <footer>실행용 프로토타입 · 실제 개인정보를 입력하지 마세요.</footer>
    </div>
  </main>;
}

export default App;
