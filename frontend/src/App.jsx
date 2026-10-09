import Mascot, { EmptyState } from './Mascot';
import { Avatar, ProfileEditor } from './Profile';
import { useEffect, useRef, useState } from "react";

import { hasToken, request, requestBlob, setToken } from "./services/api";
import { clearBoard, loadBoard, saveBoard } from "./services/boardStorage";
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

const QUICK_EXPRESSIONS = [
  { id: 'hurt', label: '아파요', symbol: '🤕' },
  { id: 'no', label: '싫어요', symbol: '🙅' },
  { id: 'help', label: '도와주세요', symbol: '🤝' },
  { id: 'toilet', label: '화장실', symbol: '🚻' },
  { id: 'stop', label: '그만', symbol: '✋' },
];

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
  const [cards, setCards] = useState([]);
  const [cardCategories, setCardCategories] = useState([]);
  const [recommended, setRecommended] = useState([]);
  const [board, setBoard] = useState([]);
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
  const speechRunRef = useRef(0);
  const speechEventRef = useRef(null);
  const [ttsVoices, setTtsVoices] = useState([]);
  const [ttsSettings, setTtsSettings] = useState({ preset: 'child', voiceName: '', rate: 0.9, pitch: 1.25 });
  const [ttsSettingsBusy, setTtsSettingsBusy] = useState(false);
  const [ttsSettingsSaved, setTtsSettingsSaved] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [linkedUsers, setLinkedUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [noteDrafts, setNoteDrafts] = useState({});
  const [noteBusy, setNoteBusy] = useState('');

  const dashboardPath = (value = period, target = selectedUser) => {
    const params = new URLSearchParams();
    if (value !== 'all') params.set('days', value);
    if (target?.id) params.set('user_id', target.id);
    const query = params.toString();
    return `/dashboard${query ? `?${query}` : ''}`;
  };

  async function load(account = user) {
    setError('');
    try {
      if (account?.role === 'admin') {
        const [submissions, categories] = await Promise.all([
          request('/admin/card-submissions'), request('/admin/categories'),
        ]);
        setAdminSubmissions(await hydrateImages(submissions));
        setAdminCategories(categories);
        setCategoryEdits(Object.fromEntries(categories.map(item => [item.id, { name: item.name, display_order: item.display_order }])));
        setTab('admin'); setLoaded(true);
        return;
      }
      if (account?.role === 'caregiver') {
        const people = await request('/care/linked-users');
        const target = people[0] || null;
        setLinkedUsers(people); setSelectedUser(target); setCards([]); setRecommended([]); setTab('dashboard');
        setStats(target ? await request(dashboardPath(period, target)) : null); setLoaded(true);
        return;
      }
      const [rawCards, rawCategories, rawRecommended, dashboard, submissions, voiceSettings] = await Promise.all([request('/cards'), request('/categories'), request('/recommendations'), request(dashboardPath()), request('/cards/submissions'), request('/tts/settings')]);
      const [all, rec] = await Promise.all([hydrateImages(rawCards), hydrateImages(rawRecommended)]);
      setCards(all); setCardCategories(rawCategories); setRecommended(rec); setStats(dashboard); setCardSubmissions(submissions); setBoard(loadBoard(account?.id, all));
      setTtsSettings({ preset: voiceSettings.preset, voiceName: voiceSettings.voice_name, rate: voiceSettings.rate, pitch: voiceSettings.pitch });
      setTtsSettingsSaved(true); setLoaded(true);
    } catch (e) {
      if (e.status === 401) { setToken(null); setUser(null); setLoaded(false); setError('로그인이 만료되었습니다. 다시 로그인해 주세요.'); }
      else setError(e.message || '서버에 연결하지 못했습니다.');
    }
  }
  useEffect(() => {
    async function restoreLogin() {
      if (!hasToken()) { setAuthReady(true); return; }
      try {
        const account = await request('/auth/me');
        setUser(account);
        await load(account);
      } catch { setToken(null); }
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

  async function handleLogin(event) {
    event.preventDefault();
    if (authMode === 'register' && password !== passwordConfirm) { setError('비밀번호가 일치하지 않습니다.'); return; }
    setBusy(true); setError('');
    try {
      const path = authMode === 'register' ? '/auth/register' : '/auth/login';
      const body = authMode === 'register' ? { username, password, name } : { username, password };
      const result = await request(path, { method: 'POST', body: JSON.stringify(body) });
      setToken(result.access_token); setUser(result.user); setShowProfile(false); setProfileNotice('');
      await load(result.user);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); setAuthReady(true); }
  }

  async function handleLogout() {
    setBusy(true);
    await stopSpeech();
    try { await request('/auth/logout', { method: 'POST' }); } catch { /* local logout still applies */ }
    clearBoard(user?.id);
    setToken(null); setUser(null); setLoaded(false); setShowProfile(false); setProfileNotice('');
    [...cards, ...recommended, ...adminSubmissions].forEach(item => { if (item.image_src) URL.revokeObjectURL(item.image_src); });
    setCards([]); setCardCategories([]); setRecommended([]); setStats(null); setBoard([]); setCardSubmissions([]); setAdminSubmissions([]); setAdminCategories([]); setCategoryEdits({}); setCategoryError(''); setLinkedUsers([]); setSelectedUser(null); setText(''); setGeneratedSessionId(''); setGenerationAttempt(1); setSentenceConfirmed(false); setGenerationFailed(false); setError(''); setTab('home');
    setTtsSettings({ preset: 'child', voiceName: '', rate: 0.9, pitch: 1.25 }); setTtsSettingsSaved(false); setSpeechFailure(null); setBusy(false);
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
    if (errorCode === 'not-allowed') return '브라우저의 음성 재생 권한과 기기 음량을 확인한 뒤 다시 시도해 주세요.';
    if (['language-unavailable', 'voice-unavailable'].includes(errorCode)) return '기기에 한국어 음성을 설치하거나 음성 설정에서 다른 음성을 선택해 주세요.';
    if (errorCode === 'unsupported') return '이 브라우저에서는 음성 재생을 지원하지 않습니다. 최신 Chrome 또는 Edge에서 다시 열어 주세요.';
    return '기기의 한국어 음성 설정과 음량을 확인한 뒤 다시 재생해 주세요.';
  }
  function speakText(content, contentType = 'sentence', speakBeforeTracking = false) {
    finishSpeechEvent(speechEventRef.current, 'cancelled', 'replaced');
    const speechEvent = {
      id: crypto.randomUUID(), finished: false,
      started: null,
    };
    const startTracking = () => request('/tts/events', { method: 'POST', body: JSON.stringify({
      request_id: speechEvent.id, content_type: contentType, char_count: content.length,
    }) }).then(() => true).catch(e => { setError(e.message); return false; });
    speechEvent.started = speakBeforeTracking ? Promise.resolve(false) : startTracking();
    speechEventRef.current = speechEvent;
    setSpeechFailure(null);
    if (!window.speechSynthesis) {
      if (speakBeforeTracking) speechEvent.started = startTracking();
      finishSpeechEvent(speechEvent, 'failed', 'unsupported');
      setSpeechFailure({ content, contentType, errorCode: 'unsupported', retryable: false });
      return;
    }
    const runId = ++speechRunRef.current;
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = 'ko-KR'; utterance.rate = ttsSettings.rate; utterance.pitch = ttsSettings.pitch;
    const voice = ttsVoices.find(item => item.name === ttsSettings.voiceName) || ttsVoices[0];
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
      if (!['canceled', 'interrupted'].includes(errorEvent.error)) setSpeechFailure({ content, contentType, errorCode: errorEvent.error || 'unknown', retryable: true });
    };
    setSpeechState({ status: 'starting', content }); window.speechSynthesis.speak(utterance);
    if (speakBeforeTracking) speechEvent.started = startTracking();
  }
  function speak() { if (sentenceConfirmed) speakText(text); }
  function speakSelection() { speakText(board.map(card => card.label).join(' '), 'sentence'); }
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
      const saved = await request('/tts/settings', { method: 'PUT', body: JSON.stringify({
        preset: ttsSettings.preset, voice_name: ttsSettings.voiceName,
        rate: ttsSettings.rate, pitch: ttsSettings.pitch,
      }) });
      setTtsSettings({ preset: saved.preset, voiceName: saved.voice_name, rate: saved.rate, pitch: saved.pitch });
      setTtsSettingsSaved(true);
    } catch (e) { setError(e.message); }
    finally { setTtsSettingsBusy(false); }
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
    setSelectedUser(target); setStatsBusy(true); setError('');
    try { setStats(await request(dashboardPath(period, target))); }
    catch (e) { setError(e.message); }
    finally { setStatsBusy(false); }
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
    } catch (e) { setCardFormError(e.message); }
    finally { setCardFormBusy(false); }
  }
  async function submitDraft(item) {
    setReviewBusy(item.id); setError('');
    try {
      const saved = await request(`/cards/submissions/${item.id}/submit`, { method: 'POST' });
      setCardSubmissions(current => current.map(row => row.id === item.id ? saved : row));
    } catch (e) { setError(e.message); }
    finally { setReviewBusy(''); }
  }
  async function hydrateImages(items) {
    return Promise.all(items.map(async item => {
      if (!item.image_url) return item;
      try { return { ...item, image_src: URL.createObjectURL(await requestBlob(item.image_url)) }; }
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
      if (!busy) speakText(card.label, 'card');
    }
    return <span className="card-speaker" role="button" tabIndex="0" aria-label={`${card.label} 단어 듣기`} onClick={play} onKeyDown={event => { if (['Enter', ' '].includes(event.key)) play(event); }}>🔊</span>;
  }
  function cardPicture(card, className = 'mini-card') {
    const hasImage = Boolean(card.image_src) || Number.isInteger(card.image_index);
    return <span key={card.id} className={`${className}${hasImage ? '' : ' image-fallback'}`} title={card.label} aria-label={card.label} role="img" style={hasImage ? artStyle(card) : undefined}>{!hasImage && <small>{card.label}</small>}</span>;
  }
  function tile(card) {
    const speakOnTap = outputMode === 'word';
    return <button className={`card${speakOnTap ? ' speak-on-tap' : ''}`} key={card.id} disabled={busy} aria-label={`${card.label} ${speakOnTap ? '바로 말하기' : '문장에 담기'}`} onClick={() => speakOnTap ? speakText(card.label, 'card') : add(card)}>
      {cardArt(card)}
      <strong>{card.label}</strong>{card.reason && <small>{card.reason}</small>}{cardSpeaker(card)}
    </button>;
  }
  const visibleCards = cards.filter(card =>
    (category === '전체' || card.category === category)
    && card.label.includes(search.trim())
  );
  const todayLabel = new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit', day: '2-digit', weekday: 'long',
  }).format(new Date());
  const speechActive = speechState.status !== 'idle';
  const speechStatusLabel = ({ starting: '음성 준비 중', playing: '음성 재생 중', paused: '음성 일시 정지' })[speechState.status];
  const pageTitle = user?.role === 'admin'
    ? '카드 등록 요청을 검토해요.'
    : user?.role === 'caregiver'
    ? `${selectedUser?.name || '보호 대상'}의 기록을 살펴봐요.`
    : tab === 'home'
      ? '오늘은 무엇을 해볼까요?'
      : tab === 'cards'
      ? `오늘의 추천 카드 ${recommended.length}개를 준비했어요.`
      : tab === 'catalog'
      ? `그림 카드 ${cards.length}개를 살펴보세요.`
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
      {authMode === 'register' && <label>비밀번호 확인<input type="password" autoComplete="new-password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} required minLength="8" maxLength="128" /></label>}
      <button className="primary full" disabled={busy}>{busy ? '처리 중…' : authMode === 'login' ? '로그인' : '가입하고 시작하기'}</button>
    </form>
    <button className="auth-switch" disabled={busy} onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setError(''); setUsername(''); setPassword(''); setPasswordConfirm(''); setName(''); }}>{authMode === 'login' ? '처음 이용하시나요? 사용자 가입' : '이미 계정이 있나요? 로그인'}</button>
    {authMode === 'login' && <p className="demo-account">사용자: <code>demo</code> / <code>demo1234</code><br />보호자: <code>caregiver</code> / <code>caregiver1234</code><br />관리자: <code>admin</code> / <code>admin1234</code></p>}
  </section></main>;
  if (!user.profile || showProfile) return <main className="login-page"><ProfileEditor key={user.id} user={user}
    onSaved={account => { setUser(account); setShowProfile(false); setProfileNotice('프로필을 저장했습니다.'); }}
    onCancel={user.profile ? () => setShowProfile(false) : handleLogout} /></main>;
  return <main className="app">
    <aside className="sidebar">
      <div className="sidebar-brand"><Mascot className="mascot-brand" /><strong>PESC<br />MATE</strong></div>
      <div className="profile"><Avatar user={user} /><div><strong>{user.name}</strong><small>{user.role === 'admin' ? '컨텐츠 관리자' : user.role === 'caregiver' ? '보호자 계정' : 'AAC 사용자'}</small></div></div>
      <nav aria-label="주 메뉴">{user.role === 'admin' ? <button className="active" onClick={() => setTab('admin')}><span aria-hidden="true">☑</span>카드 승인<i aria-label={`승인 대기 ${adminSubmissions.filter(item => item.status === 'pending').length}개`}>{adminSubmissions.filter(item => item.status === 'pending').length}</i></button> : <>{user.role !== 'caregiver' && <><button className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}><span aria-hidden="true">⌂</span>홈</button><button className={tab === 'cards' ? 'active' : ''} onClick={() => setTab('cards')}><span aria-hidden="true">▦</span>그림으로 말하기<i aria-label={`추천 카드 ${recommended.length}개`}>{recommended.length}</i></button><button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}><span aria-hidden="true">▤</span>카드</button></>}<button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}><span aria-hidden="true">▥</span>{user.role === 'caregiver' ? '보호자 현황' : '나의 이용 기록'}</button></>}</nav>
      <button type="button" onClick={() => { stopSpeech(); setShowProfile(true); setProfileNotice(''); }}>프로필 설정</button>
      <div className="sidebar-summary"><small>오늘의 의사소통</small><strong>{stats?.today_sessions || 0}개 문장</strong><span>{stats?.today_selections || 0}장의 카드를 사용했어요</span></div>
      <div className="sidebar-tip"><Mascot className="mascot-help" /><div><small>도움말</small><strong>그림을 차례대로 눌러<br />마음을 표현해 보세요.</strong></div></div>
      <button className="logout" onClick={handleLogout} disabled={busy}>로그아웃</button>
    </aside>
    <div className="app-content">
      {profileNotice && <p role="status">{profileNotice}</p>}
      <header className="topbar"><div><p className="eyebrow">오늘은 {todayLabel}</p><h1>{pageTitle}</h1></div><div className="topbar-statuses"><span className="status"><b className={loaded ? 'online' : ''}></b>{loaded ? '서비스 연결됨' : '연결 대기'}</span>{speechActive && <div className={`speech-player ${speechState.status}`} role="status" aria-live="polite"><span><b aria-hidden="true">🔊</b><strong>{speechStatusLabel}</strong><small title={speechState.content}>{speechState.content}</small></span>{speechState.status === 'playing' && <button type="button" onClick={pauseSpeech}>일시 정지</button>}{speechState.status === 'paused' && <button type="button" onClick={resumeSpeech}>재개</button>}<button type="button" onClick={stopSpeech}>중지</button></div>}</div></header>
      {user.role === 'user' && <section className="quick-speech" aria-labelledby="quick-speech-title"><div><strong id="quick-speech-title">빠른 표현</strong><small>누르면 바로 말해요</small></div>{QUICK_EXPRESSIONS.map(item => <button key={item.id} disabled={speechState.status === 'starting'} aria-label={`${item.label} 바로 말하기`} onClick={() => speakText(item.label, 'card', true)}><span aria-hidden="true">{item.symbol}</span>{item.label}</button>)}</section>}
      {error && <div role="alert" className="error">{error} <button disabled={busy} onClick={() => load(user)}>다시 연결</button></div>}
      {speechFailure && <div role="alert" className="speech-error"><span aria-hidden="true">🔇</span><div><strong>음성을 재생하지 못했어요.</strong><p>{speechFailureMessage(speechFailure.errorCode)} 선택한 카드와 문장은 그대로 유지됩니다.</p></div><div className="speech-error-actions">{speechFailure.retryable && <button className="primary" onClick={() => speakText(speechFailure.content, speechFailure.contentType)}>다시 재생</button>}<button onClick={() => setSpeechFailure(null)}>닫기</button></div></div>}
      {!loaded && !error && <p role="status">카드를 불러오는 중입니다…</p>}
      {tab === 'home' && user.role !== 'caregiver' ? <section className="home-screen">
        <div className="home-heading"><div><p>원하는 활동을 선택해 주세요</p><h2>나의 PESC MATE</h2></div><Mascot className="mascot-heading" /></div>
        <div className="home-launch-grid">
          <button className="home-launch-card communication" onClick={() => setTab('cards')}>
            <span className="home-card-visual" aria-hidden="true"><Mascot className="mascot-launch" /><i>💬</i></span>
            <span className="home-card-label"><small>카드를 골라 문장을 만들어요</small><strong>그림으로 말하기</strong><b aria-hidden="true">→</b></span>
          </button>
          <button className="home-launch-card records" onClick={() => setTab('dashboard')}>
            <span className="home-card-visual" aria-hidden="true"><Mascot className="mascot-launch" /><i>📊</i></span>
            <span className="home-card-label"><small>내가 표현한 이야기를 봐요</small><strong>나의 이용 기록</strong><b aria-hidden="true">→</b></span>
          </button>
          <button className="home-launch-card catalog" onClick={() => setTab('catalog')}>
            <span className="home-card-visual" aria-hidden="true"><Mascot className="mascot-launch" /><i>🖼️</i></span>
            <span className="home-card-label"><small>그림과 뜻을 차근차근 살펴봐요</small><strong>카드</strong><b aria-hidden="true">→</b></span>
          </button>
        </div>
        <div className="home-note"><Avatar user={user} /><div><strong>{user.name}님, 반가워요!</strong><p>그림 카드를 눌러 오늘의 이야기를 시작해 보세요.</p></div></div>
      </section> : tab === 'cards' && user.role !== 'caregiver' ? <div className="communication-layout">
      <section className="recommend-panel"><div className="stage-title"><span className="stage-back" aria-hidden="true">‹‹</span><div><strong>오늘의 추천 카드</strong><i aria-hidden="true"><b></b><b></b><b></b></i><p>자주 쓰는 카드를 골라 문장을 시작해요</p></div><span className="stage-helper" aria-hidden="true">🌱</span></div><div className="cards recommendations">{recommended.map(tile)}</div><div className="stage-ground" aria-hidden="true">▲　▲　　▲　　　▲　▲</div></section>
      <div className="workspace"><section><div className="section-title"><h2>무엇을 말하고 싶나요?</h2><input aria-label="카드 검색" placeholder="카드 이름 검색" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div className="output-mode" role="group" aria-label="출력 방식"><span>출력 방식</span><button aria-pressed={outputMode === 'word'} className={outputMode === 'word' ? 'active' : ''} onClick={() => setOutputMode('word')}>🔊 단어 즉시 발화</button><button aria-pressed={outputMode === 'selection'} className={outputMode === 'selection' ? 'active' : ''} onClick={() => setOutputMode('selection')}>선택 카드 그대로</button><button aria-pressed={outputMode === 'natural'} className={outputMode === 'natural' ? 'active' : ''} onClick={() => setOutputMode('natural')}>자연스러운 문장</button></div>
        <div className="categories" aria-label="카테고리">{['전체', ...cardCategories.map(item => item.name)].map(c => <button key={c} aria-pressed={category === c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>{c}</button>)}</div>
        <div className="cards">{visibleCards.map(tile)}</div>
        {loaded && !visibleCards.length && <EmptyState>검색 결과가 없어요.</EmptyState>}
      </section>
      <section className="board"><div className="section-title"><h2>나의 문장 <small>{board.length}/12</small></h2><button disabled={!board.length || busy} onClick={() => { if (window.confirm('선택한 카드를 모두 지울까요?')) updateBoard([]); }}>비우기</button></div>
        {!board.length && <EmptyState>왼쪽 카드를 눌러 보세요.<br />나 → 물 → 마시다</EmptyState>}
        <ol>{board.map((c, i) => <li key={`${c.id}-${i}`}><span>{c.symbol} {c.label}</span><div><button aria-label={`${i + 1}번째 카드 앞으로`} disabled={i === 0 || busy} onClick={() => move(i, -1)}>←</button><button aria-label={`${i + 1}번째 카드 뒤로`} disabled={i === board.length - 1 || busy} onClick={() => move(i, 1)}>→</button><button aria-label={`${i + 1}번째 카드 삭제`} disabled={busy} onClick={() => updateBoard(board.filter((_, n) => n !== i))}>×</button></div></li>)}</ol>
        {outputMode === 'word' ? <p className="mode-guide">카드 본체를 누르면 단어를 바로 말해요.</p> : outputMode === 'selection' ? <button className="primary full" disabled={!board.length || busy} onClick={speakSelection}>🔊 선택 카드 그대로 말하기</button> : <button className="primary full" disabled={!board.length || busy} onClick={generate}>{busy ? '문장을 만드는 중…' : '자연스러운 문장 만들기 · 저장'}</button>}
        {generationFailed && <div className="generation-fallback" role="status"><strong>문장 생성 없이도 말할 수 있어요.</strong><span>선택한 카드는 그대로 유지됐습니다.</span><div><button className="primary" disabled={!board.length} onClick={speakSelection}>🔊 선택 카드 그대로 말하기</button><button onClick={() => setOutputMode('word')}>단어 즉시 발화로 전환</button></div></div>}
        <div className="sentence" aria-live="polite">{text ? <><div className="original-order"><small>선택한 카드 순서</small><div>{board.map((card, index) => <span key={`${card.id}-${index}`}>{card.symbol} {card.label}</span>)}</div></div><strong>{text}</strong><small className={`source-badge ${generationSource}`}>{generationSource === 'ollama' ? 'Qwen · Ollama 생성' : '규칙 기반 생성'}{generationAttempt > 1 ? ` · 재생성 ${generationAttempt - 1}회` : ''}</small></> : '만든 문장이 여기에 표시돼요.'}</div>
        <div className="actions">{text && !sentenceConfirmed ? <button className="primary" disabled={busy} onClick={() => setSentenceConfirmed(true)}>✓ 문장을 확인했어요</button> : <button className="primary" disabled={!text || busy || speechActive} onClick={speak}>🔊 확인한 문장 읽기</button>}<button disabled={!generatedSessionId || busy || speechActive} onClick={regenerate}>{busy ? '만드는 중…' : '↻ 다시 만들기'}</button>{speechState.status === 'playing' && <button onClick={pauseSpeech}>일시 정지</button>}{speechState.status === 'paused' && <button onClick={resumeSpeech}>재개</button>}<button disabled={!speechActive} onClick={stopSpeech}>중지</button></div>
        <details className="tts-settings">
          <summary>⚙️ 음성 설정</summary>
          <div className="tts-settings-grid">
            <label>음성 느낌<select value={ttsSettings.preset} onChange={event => changeTtsPreset(event.target.value)}>{Object.entries(TTS_PRESETS).map(([value, preset]) => <option key={value} value={value}>{preset.label}</option>)}</select></label>
            <label>기기 한국어 음성<select value={ttsSettings.voiceName} onChange={event => updateTtsSettings({ voiceName: event.target.value })}><option value="">한국어 음성 자동 선택</option>{ttsSettings.voiceName && !ttsVoices.some(voice => voice.name === ttsSettings.voiceName) && <option value={ttsSettings.voiceName}>{ttsSettings.voiceName} (현재 기기에 없음)</option>}{ttsVoices.map(voice => <option key={voice.voiceURI} value={voice.name}>{voice.name}</option>)}</select></label>
            <label>속도 <output>{ttsSettings.rate.toFixed(2)}배</output><input type="range" min="0.5" max="1.5" step="0.05" value={ttsSettings.rate} onChange={event => updateTtsSettings({ rate: Number(event.target.value) })} /></label>
            <label>음높이 <output>{ttsSettings.pitch.toFixed(2)}</output><input type="range" min="0.5" max="1.5" step="0.05" value={ttsSettings.pitch} onChange={event => updateTtsSettings({ pitch: Number(event.target.value) })} /></label>
          </div>
          <div className="tts-preview"><small role="status">{ttsSettingsSaved ? '이 계정에 저장된 설정입니다.' : ttsVoices.length ? `한국어 음성 ${ttsVoices.length}개를 사용할 수 있어요.` : '기기의 기본 음성으로 재생합니다.'}</small><span><button type="button" disabled={busy || ttsSettingsBusy} onClick={() => speakText('안녕하세요. 목소리를 확인해 보세요.', 'preview')}>미리 듣기</button><button type="button" className="primary" disabled={ttsSettingsBusy || ttsSettingsSaved} onClick={saveTtsSettings}>{ttsSettingsBusy ? '저장 중…' : '설정 저장'}</button></span></div>
        </details>
        <p className="muted">Ollama Qwen으로 문장을 만들며, 모델을 사용할 수 없으면 규칙 기반 문장으로 자동 전환합니다.</p>
      </section></div>
    </div> : tab === 'catalog' && user.role !== 'caregiver' ? <section className="card-catalog">
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
        <aside className="card-detail" aria-live="polite">
          {selectedCard ? <>{cardArt(selectedCard, 'detail-art')}<span className="detail-category">{selectedCard.category}</span><h3>{selectedCard.label}</h3><p>{selectedCard.label}을(를) 표현하는 PECS 카드예요.</p><div className="detail-actions"><button aria-label={`${selectedCard.label} 단어 듣기`} onClick={() => speakText(selectedCard.label, 'card')}>🔊 단어 듣기</button><button className="primary" onClick={() => { add(selectedCard); setTab('cards'); }}>문장에 사용하기</button></div></> : <div className="detail-empty"><Mascot /><strong>카드를 선택해 주세요</strong><p>선택한 카드의 그림과 뜻이 여기에 보여요.</p></div>}
        </aside>
      </div>
      <div className="submission-list"><h3>나의 등록 요청</h3>{cardSubmissions.length ? <ul>{cardSubmissions.map(item => <li key={item.id}><span><strong>{item.label}</strong><small>{item.category} · {item.visibility === 'private' ? '나만 사용' : '공개 요청'}</small></span><div className="submission-actions"><b className={`submission-status ${item.status}`}>{({ draft: '작성 중', pending: '승인 대기', approved: '승인', rejected: '반려', inactive: '비활성' })[item.status] || item.status}</b>{['draft', 'rejected'].includes(item.status) && <button disabled={reviewBusy === item.id} onClick={() => { setEditingSubmission(item); setCardFormError(''); setShowCardForm(true); }}>수정</button>}{item.status === 'draft' && <button className="primary" disabled={reviewBusy === item.id} onClick={() => submitDraft(item)}>승인 요청</button>}</div></li>)}</ul> : <p className="muted">아직 등록한 카드가 없어요.</p>}</div>
      {loaded && !visibleCards.length && <EmptyState>조건에 맞는 카드가 없어요. 다른 검색어나 카테고리를 선택해 보세요.</EmptyState>}
      {showCardForm && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowCardForm(false); }}>
        <section className="card-form-modal" role="dialog" aria-modal="true" aria-labelledby="card-form-title">
          <div className="modal-heading"><div><h2 id="card-form-title">{editingSubmission ? '카드 수정' : '새 카드 등록'}</h2><p className="muted">{editingSubmission ? '반려 사유를 확인하고 정보를 수정해 주세요.' : '등록할 카드의 정보를 입력해 주세요.'}</p></div><button type="button" aria-label="등록 폼 닫기" onClick={() => { setShowCardForm(false); setEditingSubmission(null); }}>×</button></div>
          <form key={editingSubmission?.id || 'new'} className="card-form" onSubmit={submitCard}>
            {cardFormError && <div role="alert" className="error">{cardFormError}</div>}
            <label>카드명<input name="label" required maxLength="30" placeholder="예: 연필" defaultValue={editingSubmission?.label || ''} /></label>
            <label>카드 뜻<textarea name="meaning" required maxLength="120" rows="3" placeholder="카드가 나타내는 뜻을 적어 주세요." defaultValue={editingSubmission?.meaning || ''} /></label>
            <label>카테고리<select name="category" required defaultValue={editingSubmission?.category || ''}><option value="" disabled>카테고리 선택</option>{cardCategories.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
            <label>공개 범위<select name="visibility" defaultValue={editingSubmission?.visibility || 'private'}><option value="private">승인 후 나만 사용</option><option value="shared">승인 후 모든 사용자에게 공개 요청</option></select></label>
            {!editingSubmission && <label>카드 이미지<input name="image" required type="file" accept="image/jpeg,image/png,image/webp" capture="environment" /></label>}
            <p className="form-notice">제출한 카드는 관리자 승인 전까지 그림으로 말하기에 표시되지 않아요. JPG, PNG, WebP 파일을 5MB 이하, 가로·세로 128~4096px로 올려 주세요.</p>
            <div className="modal-actions"><button type="button" disabled={cardFormBusy} onClick={() => { setShowCardForm(false); setEditingSubmission(null); }}>취소</button>{!editingSubmission && <button type="submit" value="draft" disabled={cardFormBusy}>임시 저장</button>}<button type="submit" value="submit" className="primary" disabled={cardFormBusy}>{cardFormBusy ? '저장 중…' : editingSubmission ? '수정 저장' : '승인 요청'}</button></div>
          </form>
        </section>
      </div>}
    </section> : tab === 'admin' && user.role === 'admin' ? <section className="admin-review">
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
    </section> : <section className="dashboard"><div className="panel-heading"><span aria-hidden="true">🏆</span><div><h2>{user.role === 'caregiver' ? '보호 대상 의사소통 기록' : '나의 의사소통 기록'}</h2><p className="muted">{(selectedUser || user).name} · {period === 'all' ? '전체 기간' : `최근 ${period}일`} · 문장 저장 기준</p></div></div>
      {user.role === 'caregiver' && selectedUser && <div className="profile"><Avatar user={selectedUser} /><strong>{selectedUser.name}</strong></div>}
      {user.role === 'caregiver' && <label className="user-picker">조회 사용자<select value={selectedUser?.id || ''} onChange={event => changeLinkedUser(event.target.value)} disabled={statsBusy}>{linkedUsers.map(person => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}</select></label>}
      <div className="period-filter" aria-label="조회 기간">{[['7', '최근 7일'], ['30', '최근 30일'], ['all', '전체']].map(([value, label]) => <button key={value} className={period === value ? 'active' : ''} aria-pressed={period === value} disabled={statsBusy} onClick={() => changePeriod(value)}>{label}</button>)}</div>
      {statsBusy && <p className="muted" role="status">통계를 불러오는 중입니다…</p>}
      {user.role === 'caregiver' && loaded && !selectedUser && <EmptyState>연결된 사용자가 없습니다.</EmptyState>}
      {stats && <div className={statsBusy ? 'stats-content loading' : 'stats-content'}>
        {user.role === 'caregiver' && <><div className="guardian-summary">
          <div><span>오늘 문장</span><strong>{stats.today_sessions}개</strong></div><div><span>오늘 사용 카드</span><strong>{stats.today_selections}장</strong></div>
          <div><span>자주 사용한 감정·상태 표현</span><strong>{stats.frequent_emotion_state?.label || '기록 없음'}</strong></div><div><span>마지막 표현</span><strong>{stats.last_activity ? new Date(stats.last_activity).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '기록 없음'}</strong></div>
        </div><div className="guardian-grid"><article className="activity-panel"><h3>최근 7일 의사소통</h3><div className="activity-chart">{stats.daily_activity.map(day => { const max = Math.max(...stats.daily_activity.map(item => item.sessions), 1); return <div key={day.date}><span className="activity-value">{day.sessions}</span><i style={{ height: `${Math.max((day.sessions / max) * 100, 4)}%` }}></i><time>{new Date(`${day.date}T00:00:00`).toLocaleDateString('ko-KR', { weekday: 'short' })}</time></div>; })}</div></article>
          <article className="attention-panel"><h3>최근 안전 관련 표현</h3><p className="safety-note">위험을 자동 판단하는 항목이 아니며, 최근 의사표현을 확인하기 위한 기록입니다.</p>{stats.recent_safety_expressions.length ? stats.recent_safety_expressions.map(item => <div className="attention-item" key={item.id}>{cardPicture(item)}<span><strong>{item.label} · {item.count}회</strong><small>최근 {new Date(item.last_used_at).toLocaleString('ko-KR')}</small></span></div>) : <p className="muted">선택한 기간에 안전 관련 표현 기록이 없어요.</p>}</article>
        </div></>}
        <div className="metrics"><div>저장한 문장<strong>{stats.sessions}개</strong></div><div>사용한 카드<strong>{stats.selections}장</strong></div></div>
        <h3>카테고리별 사용</h3>{Object.entries(stats.categories).map(([name, count]) => <div className="bar" key={name}><span>{name}</span><meter min="0" max={Math.max(stats.selections, 1)} value={count} /> {count}회</div>)}
        <h3>자주 사용한 카드</h3><div className="categories">{stats.top_cards.slice(0, 8).map(c => <span className="status" key={c.id}>{c.symbol} {c.label} · {c.count}회</span>)}</div>
        <h3>{user.role === 'caregiver' ? '최근 의사소통 타임라인' : '최근 문장'}</h3>{!stats.recent.length ? <EmptyState>선택한 기간에 기록이 없어요.</EmptyState> : <ul className="history">{stats.recent.map(r => <li key={r.id}>{user.role === 'caregiver' && <div className="history-cards">{r.cards.map((id, index) => cardPicture({ ...(CARD_META[id] || { id, label: id, image_index: 0 }), id: `${id}-${index}` }))}</div>}<span>{r.sentence}</span><time>{new Date(r.created_at).toLocaleString('ko-KR')}</time>{user.role === 'caregiver' && <div className="caregiver-note"><textarea aria-label={`${r.sentence} 보호자 메모`} maxLength="500" placeholder="상황이나 반응을 메모해 주세요" value={noteDrafts[r.id] ?? r.caregiver_note ?? ''} onChange={event => setNoteDrafts(current => ({ ...current, [r.id]: event.target.value }))} /><div><small>{(noteDrafts[r.id] ?? r.caregiver_note ?? '').length}/500</small><button disabled={noteBusy === r.id} onClick={() => saveCaregiverNote(r.id)}>메모 저장</button>{r.caregiver_note && <button disabled={noteBusy === r.id} onClick={() => removeCaregiverNote(r.id)}>삭제</button>}</div></div>}</li>)}</ul>}</div>}
      </section>}
      <footer>실행용 프로토타입 · 실제 개인정보를 입력하지 마세요.</footer>
    </div>
  </main>;
}

export default App;
