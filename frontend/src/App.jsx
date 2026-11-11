import Mascot, { EmptyState } from './Mascot';
import { Avatar, ProfileEditor } from './Profile';
import AccountMenu from './AccountMenu';
import AccountSettingsDialog from './AccountSettingsDialog';
import CaregiverHome from './CaregiverHome';
import A4SharingGallery from './A4SharingGallery';
import './assets/caregiverUx.css';
import UiIcon from './UiIcon';
import IconButton from './IconButton';
import CardEditorDialog from './CardEditorDialog';
import AdminContentPage from './pages/AdminContentPage';
import useSidebar from './hooks/useSidebar';
import useCardScroll from './hooks/useCardScroll';
import useLiveCardCatalog from './hooks/useLiveCardCatalog';
import { CardArt, CardPicture, ExpressionVisual } from './components/CardVisuals';
import SpeakingCardTile from './components/SpeakingCardTile';
import PhysicalCardImporter from './PhysicalCardImporter';
import CardPrintEditor from './CardPrintEditor';
import HomeDashboard from './HomeDashboard';
import LandingPage from './LandingPage';
import OperationalAlerts from './OperationalAlerts';
import AccountPermissions from './AccountPermissions';
import SupportRecordTabs from './SupportRecordTabs';
import RecordExport from './RecordExport';
import { CardCombinations, SessionDetails } from './CommunicationInsights';
import CommunicationActivity, { SITUATIONS } from './CommunicationActivity';
import NoteHistory from './NoteHistory';
import DeletionReceipt from './DeletionReceipt';
import PracticeSuggestionsPanel from './PracticeSuggestionsPanel';
import PracticeOverview from './PracticeOverview';
import LearningProgram from './LearningProgram';
import { situationQuestions } from './services/situationLearning';
import RecommendationSettings from './RecommendationSettings';
import CardPhotoReplacement from './CardPhotoReplacement';
import BoardConfiguration, { SettingsDisclosure } from './BoardConfiguration';
import CoreCardLocks from './CoreCardLocks';
import SituationBoards from './SituationBoards';
import BoardOrganizationSuggestions from './BoardOrganizationSuggestions';
import SpeakingCardLibrary from './SpeakingCardLibrary';
import RfidBoard from './RfidBoard';
import UsbRfidReader from './UsbRfidReader';
import RfidChipRegistration from './RfidChipRegistration';
import useReauthentication from './useReauthentication';
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { hasToken, request, requestSpeechAudio, setToken } from "./services/api";
import { clearBoard, loadBoard, saveBoard } from "./services/boardStorage";
import { LEARNING_ACTIVITIES, learningQuestions } from "./services/learningGame";
import LearningQuestion from './LearningQuestion';
import SentenceOrderQuestion from './SentenceOrderQuestion';
import SentenceStrip from './SentenceStrip';
import { availableSentenceExamples, sentenceLearningQuestions, sentenceOrderMatches, validSentenceDraft, validSentenceQuestion } from './services/sentenceLearning';
import { koreanVoices, localKoreanVoices as installedKoreanVoices, selectTtsVoice } from "./services/ttsVoice";
import { createRequestId } from "./services/requestId";
import {
  CARD_META, TTS_PRESETS, DEFAULT_TTS_SETTINGS, normalizeTtsSettings,
  DEFAULT_QUICK_EXPRESSIONS, RECOVERY_EXPRESSIONS, DEFAULT_ACCESSIBILITY,
  normalizeAccessibility, DEFAULT_PRIVACY, SUPPORT_PERMISSION_LABELS,
} from './config/appDefaults';
import {
  CARD_IMAGE_URLS, artStyle, cardImage, hydrateImages, cacheableCards, restoreCachedCards,
  cacheableLearningGame, restoreLearningCards,
} from './services/cardMedia';
import { createCoreSpeechCache } from './services/coreSpeech';
import { createSpeechPlayback } from './services/speechPlayback';
import { createOfflineSync } from './services/offlineSync';
import {
  cacheAccount, cachedAccount, cacheLearningGame, cachedLearningGame, cacheLearningState,
  cachedLearningState, cacheSnapshot, cachedSnapshot, clearCachedAccount, clearLearningGame,
  clearOfflineUserData, pendingLearningAttempts, pendingOfflineEvents, queueLearningAttempt,
  queueOfflineEvent,
} from "./services/offlineStore";

// 렌더 콜백을 사용하는 기존 화면에서도 같은 카드 표시 컴포넌트를 사용한다.
function cardArt(card, className) {
  return <CardArt card={card} className={className} />;
}
function cardPicture(card, className, renderKey = card.id) {
  return <CardPicture key={renderKey} card={card} className={className} />;
}
function expressionVisual(item) {
  return <ExpressionVisual item={item} />;
}

async function cacheAccountForOffline(account, expiresAt) {
  if (account?.role === 'user') return cacheAccount(account, expiresAt);
  return clearCachedAccount();
}

function App() {
  const [user, setUser] = useState(null);
  const activeUserRef = useRef(null);
  activeUserRef.current = user;
  const [myPageOpen, setMyPageOpen] = useState(false);
  const [usbTopbarTarget, setUsbTopbarTarget] = useState(null);
  const [usbStatus, setUsbStatus] = useState({ state: 'disconnected', fresh: false, count: 0 });
  useEffect(() => { setUsbStatus({ state: 'disconnected', fresh: false, count: 0 }); }, [user?.id]);
  const connectionMenuRef = useRef(null);
  const [authReady, setAuthReady] = useState(false);
  const accountButtonRef = useRef(null);
  const {
    sidebarCollapsed, setSidebarCollapsed, compactSidebar,
    sidebarOpenRef, sidebarCloseRef, toggleSidebar,
  } = useSidebar({ authReady, accountId: user?.id, profileReady: Boolean(user?.profile) });
  const [profileNotice, setProfileNotice] = useState('');
  const [username, setUsername] = useState('demo');
  const [password, setPassword] = useState('demo1234');
  const [authMode, setAuthMode] = useState('login');
  const authPanelRef = useRef(null);
  const entryPageRef = useRef(null);
  const [name, setName] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [registrationConsent, setRegistrationConsent] = useState(false);
  const [cards, setCards] = useState([]);
  const [cardCategories, setCardCategories] = useState([]);
  const [board, setBoard] = useState([]);
  const boardCardsRef = useRef(board);
  boardCardsRef.current = board;
  const boardRef = useRef(null);
  const boardFocusRef = useRef(null);
  useLayoutEffect(() => {
    const pending = boardFocusRef.current;
    boardFocusRef.current = null;
    if (!pending || !boardRef.current) return;
    const rows = boardRef.current.querySelectorAll('ol > li');
    const row = rows[Math.min(pending.index, rows.length - 1)];
    const control = row?.querySelector(`[data-board-action="${pending.action}"]:not(:disabled)`)
      || row?.querySelector('button:not(:disabled)')
      || boardRef.current.querySelector('h2');
    control?.focus();
  }, [board]);
  const [outputMode, setOutputMode] = useState('natural');
  const [category, setCategory] = useState('전체');
  const [search, setSearch] = useState('');
  const [selectedCard, setSelectedCard] = useState(null);
  const [showCardForm, setShowCardForm] = useState(false);
  const [cardSubmissions, setCardSubmissions] = useState([]);
  const [cardFormBusy, setCardFormBusy] = useState(false);
  const [cardFormError, setCardFormError] = useState('');
  const [managedCardSearch, setManagedCardSearch] = useState('');
  const [managedCardCategory, setManagedCardCategory] = useState('');
  const [managedCardNotice, setManagedCardNotice] = useState(null);
  const [supportSettingsNotice, setSupportSettingsNotice] = useState(null);
  const supportSettingsRequestRef = useRef(0);
  const [learningDirty, setLearningDirty] = useState(false);
  const [editingSubmission, setEditingSubmission] = useState(null);
  const [adminSubmissions, setAdminSubmissions] = useState([]);
  const [adminCategories, setAdminCategories] = useState([]);
  const [categoryEdits, setCategoryEdits] = useState({});
  const [categoryBusy, setCategoryBusy] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [reviewDrafts, setReviewDrafts] = useState({});
  const [reviewBusy, setReviewBusy] = useState('');
  const [tab, setTab] = useState('home');
  const { askPassword, confirmation } = useReauthentication(`${user?.id || ''}:${tab}:${myPageOpen}`);
  const [text, setText] = useState('');
  const [generatedSessionId, setGeneratedSessionId] = useState('');
  const [generationFailed, setGenerationFailed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const generationInFlightRef = useRef(false);
  const sentenceContextRef = useRef('');
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
  const activityStreamRef = useRef({ id: createRequestId(), sequence: 0 });
  const selectionEventRef = useRef(null);
  const [situation, setSituation] = useState('unspecified');
  const lastSpeechTapRef = useRef({ content: '', at: 0 });
  const [speechPlayback] = useState(() => createSpeechPlayback());
  const [coreSpeechCache] = useState(() => createCoreSpeechCache());
  const [offlineSync] = useState(() => createOfflineSync());
  const [syncState, setSyncState] = useState('idle');
  const [ttsVoices, setTtsVoices] = useState([]);
  const [ttsSettings, setTtsSettings] = useState(DEFAULT_TTS_SETTINGS);
  const [ttsSettingsBusy, setTtsSettingsBusy] = useState(false);
  const [ttsSettingsSaved, setTtsSettingsSaved] = useState(false);
  const [accessibility, setAccessibility] = useState(DEFAULT_ACCESSIBILITY);
  const [accessibilityBusy, setAccessibilityBusy] = useState(false);
  const [accessibilitySaved, setAccessibilitySaved] = useState(true);
  const [requestId, setRequestId] = useState(() => createRequestId());
  const [linkedUsers, setLinkedUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  useEffect(() => { setManagedCardSearch(''); setManagedCardCategory(''); setManagedCardNotice(null); setSupportSettingsNotice(null); setLearningDirty(false); }, [selectedUser?.id]);
  const selectedUserRef = useRef(null);
  selectedUserRef.current = selectedUser;
  const supportRecordRequestRef = useRef(0);
  const supportCardRequestRef = useRef(0);
  const [noteDrafts, setNoteDrafts] = useState({});
  const [noteBusy, setNoteBusy] = useState('');
  const [privacy, setPrivacy] = useState(DEFAULT_PRIVACY);
  const [privacyDraft, setPrivacyDraft] = useState(DEFAULT_PRIVACY);
  useEffect(() => { setPrivacyDraft({ guardian_consent: privacy.guardian_consent, retention_days: privacy.retention_days }); },
    [user?.id, privacy.guardian_consent, privacy.retention_days]);
  useEffect(() => {
    if (loaded && user?.role === 'user' && !privacy.guardian_consent) {
      clearBoard(user.id); clearLearningGame(user.id).catch(() => {});
    }
  }, [loaded, user?.id, user?.role, privacy.guardian_consent]);
  const [privacyCaregivers, setPrivacyCaregivers] = useState([]);
  const [privacyAudit, setPrivacyAudit] = useState([]);
  const [privacyBusy, setPrivacyBusy] = useState('');
  const [localDeletionStatus, setLocalDeletionStatus] = useState('');
  const [caregiverUsername, setCaregiverUsername] = useState('');
  const [newSupportPermissions, setNewSupportPermissions] = useState(['records_read']);
  const [supportPermissionDrafts, setSupportPermissionDrafts] = useState({});
  const [boardLayout, setBoardLayout] = useState(null);
  const [boardLayoutAudit, setBoardLayoutAudit] = useState([]);
  const [quickDraft, setQuickDraft] = useState([]);
  const [recoveryDraft, setRecoveryDraft] = useState([]);
  const [slotDraft, setSlotDraft] = useState([]);
  const [boardConfigBusy, setBoardConfigBusy] = useState('');
  const [boardConflict, setBoardConflict] = useState(false);
  const [learningSettings, setLearningSettings] = useState(null);
  const [learningProgress, setLearningProgress] = useState(null);
  const [learningBusy, setLearningBusy] = useState(false);
  const [practiceCategory, setPracticeCategory] = useState('all');
  const [practiceActivity, setPracticeActivity] = useState('word_picture_match');
  const [practiceSituation, setPracticeSituation] = useState('meal');
  const [learningGame, setLearningGame] = useState(null);
  const [activePracticePlan, setActivePracticePlan] = useState(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const activityConsentRef = useRef(false);
  activityConsentRef.current = user?.role === 'user' && privacy.guardian_consent;
  const sentenceContext = JSON.stringify([user?.id, user?.role, loaded, requestId, board.map(card => [card.id, card.selected_at]),
    tab, myPageOpen, outputMode, offline, privacy.guardian_consent]);
  sentenceContextRef.current = sentenceContext;
  const cardCatalog = useLiveCardCatalog({ account: user, loaded, offline, tab, cards,
    categories: cardCategories, hydrateImages,
    onUpdate: (next, categories) => { setCards(next); setCardCategories(categories); } });
  const caregiverSettingsDirty = user?.role === 'caregiver' && ((tab === 'support_settings' && !statsBusy && (!ttsSettingsSaved || !accessibilitySaved))
    || (tab === 'learning_progress' && learningDirty)
    || (tab === 'board_settings' && boardLayout?.user_id === selectedUser?.id && !statsBusy
      && (JSON.stringify(quickDraft) !== JSON.stringify(boardLayout.quick_expression_ids)
        || JSON.stringify(recoveryDraft) !== JSON.stringify(boardLayout.recovery_expression_ids)
        || JSON.stringify(slotDraft) !== JSON.stringify(boardLayout.slots.map(slot => slot.card_id)))));
  useEffect(() => {
    if (!caregiverSettingsDirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [caregiverSettingsDirty]);
  function confirmCaregiverLeave() {
    return !caregiverSettingsDirty || window.confirm('저장하지 않은 아이 설정이 있어요. 저장하지 않고 이동할까요?');
  }
  useEffect(() => {
    if (user?.role !== 'user' || tab !== 'practice' || !loaded || offline || !privacy.guardian_consent) {
      setActivePracticePlan(null);
      return;
    }
    const accountId = user.id, token = localStorage.getItem('pesc-mate-token');
    let active = true;
    request('/practice-suggestions/active').then(plan => {
      if (active && activeUserRef.current?.id === accountId
          && localStorage.getItem('pesc-mate-token') === token) setActivePracticePlan(plan);
    }).catch(() => { if (active) setActivePracticePlan(null); });
    return () => { active = false; };
  }, [user?.id, user?.role, tab, loaded, offline, privacy.guardian_consent]);

  useEffect(() => {
    if (authReady && !user && error) authPanelRef.current?.scrollIntoView?.({ block: 'start' });
  }, [authReady, user, error]);
  useLayoutEffect(() => {
    if (authReady) entryPageRef.current?.scrollIntoView?.({ block: 'start' });
  }, [authReady, user?.id, Boolean(user?.profile)]);
  useEffect(() => { setSidebarCollapsed(false); }, [user?.id]);

  useEffect(() => {
    activityStreamRef.current = { id: createRequestId(), sequence: 0 };
    selectionEventRef.current = null;
    setSituation('unspecified');
  }, [user?.id]);

  function makeActivity(eventType, cardIds, extra = {}) {
    const account = activeUserRef.current;
    if (!account || !activityConsentRef.current) return null;
    return { userId: account.id, token: localStorage.getItem('pesc-mate-token'), event: {
      id: createRequestId(), event_type: eventType, card_ids: cardIds,
      occurred_at: new Date().toISOString(), situation,
      stream_id: activityStreamRef.current.id, sequence: ++activityStreamRef.current.sequence, ...extra,
    } };
  }
  async function persistActivity(activity) {
    if (!activity) return;
    const isCurrent = () => activeUserRef.current?.id === activity.userId && activityConsentRef.current
      && activity.token && localStorage.getItem('pesc-mate-token') === activity.token;
    if (!isCurrent()) return;
    try {
      if (offline || !navigator.onLine) throw new Error('offline');
      await request('/offline/events/sync', { method: 'POST', body: JSON.stringify({ events: [activity.event] }) });
    } catch (failure) {
      if (!isCurrent() || (failure.status && failure.status < 500)) return;
      try {
        await queueOfflineEvent({ ...activity.event, user_id: activity.userId });
        if (isCurrent()) await updatePendingSyncCount(activity.userId);
      } catch { if (isCurrent()) setError('선택·발화 기록을 저장하지 못했습니다. 말하기는 계속 사용할 수 있어요.'); }
    }
  }

  function clearSupportTargetData() {
    supportRecordRequestRef.current += 1;
    supportCardRequestRef.current += 1;
    selectedUserRef.current = null;
    cardSubmissions.forEach(item => { if (item.image_src) URL.revokeObjectURL(item.image_src); });
    setLinkedUsers([]); setSelectedUser(null); setCardSubmissions([]); setStats(null); setNoteDrafts({});
    setBoardLayout(null); setBoardLayoutAudit([]); setQuickDraft([]); setRecoveryDraft([]); setSlotDraft([]);
    setBoardConflict(false); setBoardConfigBusy('');
    setLearningSettings(null); setLearningProgress(null); setLearningGame(null);
    setStatsBusy(false); setLearningBusy(false);
    setTtsSettings(DEFAULT_TTS_SETTINGS); setTtsSettingsSaved(false);
    setAccessibility(DEFAULT_ACCESSIBILITY); setAccessibilitySaved(true);
  }

  const dashboardPath = (value = period, target = selectedUser) => {
    const params = new URLSearchParams();
    if (value !== 'all') params.set('days', value);
    if (target?.id) params.set('user_id', target.id);
    const query = params.toString();
    return `/dashboard${query ? `?${query}` : ''}`;
  };

  async function restoreLearningSession(account, availableCards) {
    const saved = await cachedLearningGame(account.id).catch(() => null);
    if (!Array.isArray(saved?.game?.questions) || !saved.game.questions.length
        || !Number.isInteger(saved.game.questionIndex) || saved.game.questionIndex < 0
        || saved.game.questionIndex >= saved.game.questions.length) {
      if (saved) await clearLearningGame(account.id).catch(() => {});
      return false;
    }
    const activity = saved.game.activity_type || 'word_picture_match';
    if (!LEARNING_ACTIVITIES[activity] || (saved.game.content_version && saved.game.content_version !== LEARNING_ACTIVITIES[activity].version)
        || (activity === 'sentence_card_order' && (saved.game.content_version !== LEARNING_ACTIVITIES[activity].version
          || !saved.game.questions.every(validSentenceQuestion)
          || !validSentenceDraft(saved.game.questions[saved.game.questionIndex], saved.game.sequenceIds || [])))) {
      setError('저장된 연습의 콘텐츠 버전을 지원하지 않습니다. 연습 목록에서 새 연습을 골라 주세요.');
      return false;
    }
    setLearningSettings(saved.learning_settings);
    setPracticeCategory(saved.practice_category || 'all');
    setPracticeActivity(activity);
    setLearningGame(restoreLearningCards(saved.game, availableCards));
    setTab('practice');
    return true;
  }

  async function updatePendingSyncCount(accountId) {
    const [events, attempts] = await Promise.all([
      pendingOfflineEvents(accountId).catch(() => []),
      pendingLearningAttempts(accountId).catch(() => []),
    ]);
    setPendingSyncCount(events.length + attempts.length);
  }

  async function applyOfflineSnapshot(account, snapshot) {
    if (!snapshot) return false;
    const all = restoreCachedCards(snapshot.cards);
    setCards(all); setCardCategories(snapshot.categories || []);
    setStats(snapshot.dashboard || null); setCardSubmissions(snapshot.submissions || []);
    setBoard(snapshot.privacy?.guardian_consent ? loadBoard(account.id, all) : []); setTtsSettings(normalizeTtsSettings(snapshot.tts_settings));
    const access = normalizeAccessibility(snapshot.accessibility, account);
    setAccessibility(access); setAccessibilitySaved(true);
    setOutputMode(access.output_mode);
    if (!loaded) setTab(access.start_screen);
    setPrivacy(snapshot.privacy); setPrivacyCaregivers(snapshot.caregivers || []);
    setPrivacyAudit(snapshot.privacy_audit || []); setTtsSettingsSaved(true);
    setBoardLayout(snapshot.board_layout || null);
    setLoaded(true); setOffline(true);
    if (snapshot.privacy?.guardian_consent) await restoreLearningSession(account, all);
    await updatePendingSyncCount(account.id);
    return true;
  }

  async function syncPendingEvents(account = user, consent = activityConsentRef.current) {
    if (!consent || !account || account.role !== 'user' || activeUserRef.current?.id !== account.id || !navigator.onLine) return;
    const session = localStorage.getItem('pesc-mate-token');
    const isCurrent = () => Boolean(session) && activeUserRef.current?.id === account.id
      && localStorage.getItem('pesc-mate-token') === session;
    setSyncState('syncing');
    try {
      const result = await offlineSync.sync(account.id, { scope: session, isCurrent });
      if (result.cancelled || !isCurrent()) return;
      setPendingSyncCount(result.remaining);
      setSyncState(result.failed ? 'failed' : 'idle');
      if (!result.syncedAttemptIds.length) return;
      setLearningGame(current => current?.attempt?.pending_sync &&
        result.syncedAttemptIds.includes(current.attempt.request_id)
        ? { ...current, attempt: { ...current.attempt, pending_sync: false } }
        : current);
      try {
        const progress = await request('/learning/progress?days=30');
        if (!isCurrent()) return;
        setLearningProgress(progress);
        if (learningSettings) cacheLearningState(account.id, {
          settings: learningSettings, progress,
        }).catch(() => {});
      } catch { /* The queued attempts are already safe; refresh progress on the next visit. */ }
    } catch {
      if (isCurrent()) setSyncState('failed');
    }
  }

  function primeOfflineAssets() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(registration => registration.active?.postMessage({
      type: 'CACHE_ASSETS', urls: CARD_IMAGE_URLS,
    })).catch(() => {});
  }

  async function load(account = user, { syncOffline = true } = {}) {
    const session = localStorage.getItem('pesc-mate-token');
    const isCurrentSession = () => Boolean(session) && localStorage.getItem('pesc-mate-token') === session;
    setError('');
    if (account?.role === 'user') setOutputMode(account.default_output_mode || 'natural');
    if (account?.role === 'user' && !navigator.onLine) {
      const snapshot = await cachedSnapshot(account.id).catch(() => null);
      if (await applyOfflineSnapshot(account, snapshot)) return;
    }
    try {
      if (['caregiver', 'support_staff'].includes(account?.role)) {
        clearSupportTargetData();
        const canOperateContent = account?.account_permissions?.includes('content_manage');
        const [people, submissions, categories, activeCategories] = await Promise.all([
          request('/care/linked-users'),
          canOperateContent ? request('/admin/card-submissions') : Promise.resolve([]),
          canOperateContent ? request('/admin/categories') : Promise.resolve([]),
          request('/categories'),
        ]);
        if (!isCurrentSession()) return;
        const target = people[0] || null;
        const targetCards = target?.permissions.includes('cards_manage')
          ? await request(`/cards/submissions?user_id=${encodeURIComponent(target.id)}`)
          : [];
        const [targetImages, adminImages] = await Promise.all([hydrateImages(targetCards), hydrateImages(submissions)]);
        if (!isCurrentSession()) {
          [...targetImages, ...adminImages].forEach(item => { if (item.image_src) URL.revokeObjectURL(item.image_src); });
          return;
        }
        setLinkedUsers(people); setSelectedUser(target); setCards([]); setCardCategories(activeCategories);
        setCardSubmissions(targetImages);
        setAdminSubmissions(adminImages);
        setAdminCategories(categories);
        setCategoryEdits(Object.fromEntries(categories.map(item => [item.id, { name: item.name, display_order: item.display_order }])));
        setTab(people.length ? 'support_home' : canOperateContent ? 'admin' : 'support_home');
        setStats(null); setLoaded(true);
        return;
      }
      const [rawCards, rawCategories, dashboard, submissions, voiceSettings, accessibilitySettings, privacySettings, caregivers, privacyHistory, layout] = await Promise.all([request('/cards'), request('/categories'), request(dashboardPath()), request('/cards/submissions'), request('/tts/settings'), request('/accessibility/settings'), request('/privacy/settings'), request('/support/links'), request('/privacy/audit'), request('/board/layout')]);
      if (privacySettings.deletion_status === 'completed' && !privacySettings.guardian_consent) {
        await clearOfflineUserData(account.id);
      }
      const all = await hydrateImages(rawCards);
      setCards(all); setCardCategories(rawCategories); setStats(dashboard); setCardSubmissions(submissions); setBoard(privacySettings.guardian_consent ? loadBoard(account?.id, all) : []);
      setTtsSettings(normalizeTtsSettings(voiceSettings));
      const access = normalizeAccessibility(accessibilitySettings, account);
      setAccessibility(access); setAccessibilitySaved(true);
      setOutputMode(access.output_mode);
      if (!loaded) setTab(access.start_screen);
      setPrivacy(privacySettings); setPrivacyCaregivers(caregivers); setPrivacyAudit(privacyHistory);
      setBoardLayout(layout);
      setSupportPermissionDrafts(Object.fromEntries(caregivers.map(item => [item.supporter_id, item.permissions])));
      if (privacySettings.guardian_consent) await restoreLearningSession(account, all);
      setTtsSettingsSaved(true); setLoaded(true); setOffline(false);
      cacheSnapshot(account.id, {
        cards: cacheableCards(all), categories: rawCategories,
        dashboard, submissions,
        tts_settings: normalizeTtsSettings(voiceSettings),
        accessibility: accessibilitySettings, privacy: privacySettings,
        caregivers, privacy_audit: privacyHistory, board_layout: layout,
      }).catch(() => {});
      primeOfflineAssets();
      if (syncOffline) syncPendingEvents(account, privacySettings.guardian_consent);
    } catch (e) {
      if (!isCurrentSession()) return;
      if (e.status === 401) { setToken(null); setUser(null); setLoaded(false); setError('로그인이 만료되었습니다. 다시 로그인해 주세요.'); }
      else if (account?.role === 'user' && await applyOfflineSnapshot(account, await cachedSnapshot(account.id).catch(() => null))) {
        setError('');
      } else {
        if (['caregiver', 'support_staff'].includes(account?.role)) clearSupportTargetData();
        setError(e.message || '서버에 연결하지 못했습니다.');
      }
    }
  }
  useEffect(() => {
    async function restoreLogin() {
      if (!hasToken()) { setAuthReady(true); return; }
      if (!navigator.onLine) {
        const account = await cachedAccount().catch(() => null);
        if (account?.role === 'user') { setUser(account); await load(account); }
        else if (account) { await clearCachedAccount().catch(() => {}); setToken(null); }
        else setToken(null);
        setAuthReady(true);
        return;
      }
      try {
        const account = await request('/auth/me');
        setUser(account);
        cacheAccountForOffline(account, account.session_expires_at).catch(() => {});
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
    return () => { speechPlayback.stop(); coreSpeechCache.dispose(); };
  }, []);

  useEffect(() => {
    if (user?.role !== 'user') return;
    // Prepare fallback audio in the background; playback failures still have their own alert.
    coreSpeechCache.prepare({ online: !offline }).catch(() => {});
  }, [user?.id, user?.role, offline]);

  useEffect(() => {
    const synthesis = window.speechSynthesis;
    const updateVoices = () => setTtsVoices(koreanVoices(synthesis?.getVoices() || []));
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        finishSpeechEvent(speechEventRef.current, 'cancelled', 'screen-hidden');
        speechRunRef.current += 1;
        speechPlayback.stop();
        setSpeechState({ status: 'idle', content: '' });
        return;
      }
      updateVoices();
    };
    updateVoices();
    synthesis?.addEventListener('voiceschanged', updateVoices);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', updateVoices);
    return () => {
      synthesis?.removeEventListener('voiceschanged', updateVoices);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', updateVoices);
    };
  }, []);

  useEffect(() => {
    // This event owns its sync run; the parallel data refresh must not retry it again.
    const online = () => { setOffline(false); syncPendingEvents(user); if (user) load(user, { syncOffline: false }); };
    const offlineNow = () => {
      setOffline(true);
      if (['caregiver', 'support_staff'].includes(user?.role)) {
        clearSupportTargetData();
        setTab(user?.account_permissions?.includes('content_manage') ? 'admin' : 'support_home');
        setError('보호자·담당자용 사용자 정보는 오프라인에서 보관하지 않습니다. 다시 연결해 주세요.');
      }
    };
    window.addEventListener('online', online); window.addEventListener('offline', offlineNow);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offlineNow); };
  }, [user]);

  useEffect(() => {
    const denySupportAccess = event => {
      if (!['caregiver', 'support_staff'].includes(user?.role)) return;
      if (event.apiPath?.startsWith('/admin/')) return;
      clearSupportTargetData();
      setTab(user?.account_permissions?.includes('content_manage') ? 'admin' : 'support_home');
      setError('지원 권한이 변경되어 사용자 정보를 닫았습니다. 다시 불러와 주세요.');
    };
    window.addEventListener('pesc-mate:access-denied', denySupportAccess);
    return () => window.removeEventListener('pesc-mate:access-denied', denySupportAccess);
  }, [user]);

  useEffect(() => {
    const expireSupportSession = () => {
      if (['caregiver', 'support_staff'].includes(activeUserRef.current?.role)) handleLogout({ sessionExpired: true });
    };
    window.addEventListener('pesc-mate:session-expired', expireSupportSession);
    return () => window.removeEventListener('pesc-mate:session-expired', expireSupportSession);
  }, [user]);

  useEffect(() => {
    if (user?.role !== 'user' || !privacy.guardian_consent || learningGame?.phase !== 'playing' || !learningSettings) return;
    cacheLearningGame(user.id, {
      game: cacheableLearningGame(learningGame),
      practice_category: practiceCategory,
      learning_settings: learningSettings,
      saved_at: new Date().toISOString(),
    }).catch(() => {});
  }, [user?.id, user?.role, privacy.guardian_consent, learningGame, practiceCategory, learningSettings]);

  function openAuthentication(mode, reset = false) {
    if (busy) return;
    if (reset || mode !== authMode) {
      setUsername(''); setPassword(''); setPasswordConfirm(''); setName(''); setRegistrationConsent(false);
    }
    setAuthMode(mode); setError('');
    requestAnimationFrame(() => {
      const panel = authPanelRef.current;
      panel?.scrollIntoView?.({ block: 'start' });
      panel?.querySelector(mode === 'register' ? 'input[autocomplete="name"]' : 'input[autocomplete="username"]')?.focus({ preventScroll: true });
    });
  }
  async function handleLogin(event) {
    event.preventDefault();
    if (authMode === 'register' && password !== passwordConfirm) { setError('비밀번호가 일치하지 않습니다.'); return; }
    setBusy(true); setError('');
    try {
      const path = authMode === 'register' ? '/auth/register' : '/auth/login';
      const body = authMode === 'register' ? { username, password, name, guardian_consent: registrationConsent } : { username, password };
      const result = await request(path, { method: 'POST', body: JSON.stringify(body) });
      setToken(result.access_token); setUser(result.user); setMyPageOpen(false); setProfileNotice('');
      setPassword(''); setPasswordConfirm('');
      cacheAccountForOffline(result.user, result.expires_at).catch(() => {});
      await load(result.user);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); setAuthReady(true); }
  }

  async function handleLogout({ sessionExpired = false } = {}) {
    if (!sessionExpired && !confirmCaregiverLeave()) return;
    setBusy(true);
    setBoardConflict(false); setBoardConfigBusy('');
    if (sessionExpired) {
      activeUserRef.current = null;
      stopSpeech().catch(() => {});
    } else {
      await stopSpeech();
      try { await request('/auth/logout', { method: 'POST' }); } catch { /* local logout still applies */ }
    }
    clearBoard(user?.id);
    const clearCache = clearCachedAccount().catch(() => {});
    const clearUserData = user?.id ? clearOfflineUserData(user.id).catch(() => {}) : Promise.resolve();
    setToken(null); setUser(null); setLoaded(false); setMyPageOpen(false); setProfileNotice(''); setSyncState('idle'); setPendingSyncCount(0);
    setAuthMode('login'); setPassword(''); setPasswordConfirm(''); setName(''); setRegistrationConsent(false);
    [...cards, ...adminSubmissions].forEach(item => { if (item.image_src) URL.revokeObjectURL(item.image_src); });
    setCards([]); setCardCategories([]); setStats(null); setBoard([]); setCardSubmissions([]); setAdminSubmissions([]); setAdminCategories([]); setCategoryEdits({}); setCategoryError(''); setLinkedUsers([]); setSelectedUser(null); setBoardLayout(null); setBoardLayoutAudit([]); setQuickDraft([]); setRecoveryDraft([]); setSlotDraft([]); setLearningSettings(null); setLearningProgress(null); setLearningGame(null); setPracticeCategory('all'); setText(''); setGeneratedSessionId(''); setGenerationFailed(false); setError(''); setTab('home');
    setTtsSettings(DEFAULT_TTS_SETTINGS); setTtsSettingsSaved(false); setAccessibility(DEFAULT_ACCESSIBILITY); setAccessibilitySaved(true); setPrivacy(DEFAULT_PRIVACY); setPrivacyCaregivers([]); setPrivacyAudit([]); setSpeechFailure(null); setBusy(false);
    if (sessionExpired) setError('계정 접근 또는 로그인 상태가 변경되었습니다. 다시 로그인해 주세요.');
    setLocalDeletionStatus('');
    await Promise.all([clearCache, clearUserData]);
  }

  function updateBoard(next) {
    boardCardsRef.current = next;
    // Invalidate pending generation before React commits the new selection.
    sentenceContextRef.current = '';
    stopSpeech();
    const activity = makeActivity('card_selection', next.map(card => card.id));
    selectionEventRef.current = activity?.event.id || null;
    persistActivity(activity);
    setBoard(next); if (privacy.guardian_consent) saveBoard(user?.id, next); setText(''); setGeneratedSessionId(''); setGenerationFailed(false); setSpeechFailure(null); setRequestId(createRequestId());
  }
  function add(card) {
    if (board.length >= 12) { setError('카드는 최대 12장까지 선택할 수 있어요.'); return false; }
    setError(''); updateBoard([...board, { ...card, selected_at: new Date().toISOString() }]);
    return true;
  }
  function move(index, destination) {
    if (index === destination || destination < 0 || destination >= board.length) return;
    rememberBoardFocus(destination, 'move');
    const next = [...board];
    next.splice(destination, 0, next.splice(index, 1)[0]);
    updateBoard(next);
  }
  function rememberBoardFocus(index, action) {
    if (boardRef.current?.contains(document.activeElement)) boardFocusRef.current = { index, action };
  }
  function removeBoardCard(index) {
    rememberBoardFocus(index, 'remove');
    updateBoard(board.filter((_, position) => position !== index));
  }
  async function generate(speakResult = false) {
    if (!privacy.guardian_consent || offline || !board.length || generationInFlightRef.current) return;
    if (speakResult) speechPlayback.unlock();
    generationInFlightRef.current = true;
    const context = sentenceContextRef.current;
    const speechRun = speechRunRef.current;
    const sessionToken = localStorage.getItem('pesc-mate-token');
    const isCurrent = () => sentenceContextRef.current === context && localStorage.getItem('pesc-mate-token') === sessionToken;
    setGenerating(true); setError(''); setGenerationFailed(false);
    try {
      const result = await request('/sentences', { method: 'POST', body: JSON.stringify({ cards: board.map(c => c.id),
        selected_at: board.map(card => card.selected_at || null), request_id: requestId }) });
      if (!isCurrent()) return;
      setText(result.sentence);
      if (speakResult && speechRunRef.current === speechRun) speakBoardSentence(result.sentence, result.id);
      setGeneratedSessionId(result.id);
      request(dashboardPath()).then(stats => {
        if (localStorage.getItem('pesc-mate-token') === sessionToken) setStats(stats);
      }).catch(() => {});
    } catch (e) { if (isCurrent()) { setGenerationFailed(true); setError(`${e.message} 선택한 카드는 유지되며 로컬 음성은 계속 사용할 수 있어요.`); } }
    finally { generationInFlightRef.current = false; setGenerating(false); }
  }
  async function regenerate(speakResult = false) {
    if (!privacy.guardian_consent || offline || !generatedSessionId || generationInFlightRef.current) return;
    if (speakResult) speechPlayback.unlock();
    generationInFlightRef.current = true;
    const context = sentenceContextRef.current;
    const speechRun = speechRunRef.current;
    const sessionToken = localStorage.getItem('pesc-mate-token');
    const isCurrent = () => sentenceContextRef.current === context && localStorage.getItem('pesc-mate-token') === sessionToken;
    setGenerating(true); setError(''); setGenerationFailed(false);
    try {
      const result = await request(`/sentences/${generatedSessionId}/regenerate`, {
        method: 'POST', body: JSON.stringify({ request_id: createRequestId() }),
      });
      if (!isCurrent()) return;
      setText(result.sentence);
      if (speakResult && speechRunRef.current === speechRun) speakBoardSentence(result.sentence, result.id);
      setGeneratedSessionId(result.id);
      request(dashboardPath()).then(stats => {
        if (localStorage.getItem('pesc-mate-token') === sessionToken) setStats(stats);
      }).catch(() => {});
    } catch (e) { if (isCurrent()) { setGenerationFailed(true); setError(`${e.message} 선택한 카드는 유지되며 로컬 음성은 계속 사용할 수 있어요.`); } }
    finally { generationInFlightRef.current = false; setGenerating(false); }
  }
  function finishSpeechEvent(event, status, errorCode = '') {
    if (!event) return Promise.resolve();
    if (event.finished) return event.completion || Promise.resolve();
    event.finished = true;
    const recorded = event.activity ? persistActivity({ ...event.activity, event: {
      ...event.activity.event, speech_status: status, completed_at: new Date().toISOString(),
    } }) : Promise.resolve();
    event.completion = Promise.all([recorded, event.started.then(started => started && activityConsentRef.current
      && activeUserRef.current?.id === event.userId && localStorage.getItem('pesc-mate-token') === event.token ? request(`/tts/events/${event.id}`, {
      method: 'PATCH', body: JSON.stringify({
        status, error_code: errorCode, startup_ms: event.startupMs,
      }),
    }) : null)]).catch(e => {
      if (!event.activity || activeUserRef.current?.id === event.activity.userId) setError(e.message);
    });
    return event.completion;
  }
  function speechFailureMessage(errorCode) {
    if (errorCode === 'server-busy') return '로컬 음성 서버가 사용 중입니다. 잠시 후 다시 눌러 주세요.';
    if (errorCode === 'server-unavailable') return '음성 서버를 확인해 주세요. 첫 실행은 모델 다운로드와 준비에 시간이 필요합니다.';
    if (errorCode === 'volume-zero') return '기본 볼륨이 0입니다. 음성 설정에서 볼륨을 올려 주세요.';
    if (errorCode === 'not-allowed') return '이 기기의 브라우저가 음성 재생을 막았어요. 다시 재생을 직접 눌러 주세요. 기기 음량과 블루투스 출력도 확인해 주세요.';
    if (['language-unavailable', 'voice-unavailable'].includes(errorCode)) return '기기에 한국어 음성을 설치하거나 음성 설정에서 다른 음성을 선택해 주세요.';
    if (errorCode === 'unsupported') return '이 표현의 음성을 재생할 수 없습니다. 기본 긴급·복구 음성을 준비하거나 기기의 한국어 음성을 확인해 주세요.';
    return '기기의 한국어 음성 설정과 음량을 확인한 뒤 다시 재생해 주세요.';
  }
  function speakText(content, contentType = 'sentence', cardIds = [], sessionId = '', playback = {}) {
    if (ttsSettings.volume <= 0) {
      setSpeechFailure({ content, contentType, cardIds, errorCode: 'volume-zero', retryable: false });
      return;
    }
    const tappedAt = Date.now();
    if (lastSpeechTapRef.current.content === content && tappedAt - lastSpeechTapRef.current.at < 600) return;
    lastSpeechTapRef.current = { content, at: tappedAt };
    finishSpeechEvent(speechEventRef.current, 'cancelled', 'replaced');
    const speechEvent = {
      id: createRequestId(), finished: false, requestedAt: Date.now(), startupMs: null,
      userId: user.id, token: localStorage.getItem('pesc-mate-token'), recordingAllowed: privacy.guardian_consent,
      started: null,
    };
    const recoveryId = contentType === 'recovery' ? RECOVERY_EXPRESSIONS.find(item => item.label === content)?.id : null;
    speechEvent.activity = contentType === 'preview' ? null : makeActivity(recoveryId ? 'recovery_speech' : 'speech_result', cardIds,
      { ...(recoveryId ? { recovery_id: recoveryId } : {}),
        ...(contentType === 'sentence' && selectionEventRef.current ? { selection_id: selectionEventRef.current } : {}),
        ...(contentType === 'sentence' && (sessionId || (content === text && generatedSessionId)) ? { session_id: sessionId || generatedSessionId } : {}) });
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
    let resolveStarted;
    speechEvent.started = new Promise(resolve => { resolveStarted = resolve; });
    speechEventRef.current = speechEvent;
    setSpeechFailure(null);
    const runId = ++speechRunRef.current;
    const currentVoices = koreanVoices(window.speechSynthesis?.getVoices() || []);
    const voice = selectTtsVoice(currentVoices.length ? currentVoices : ttsVoices, ttsSettings.voiceName, offline);
    const useServerVoice = !offline && !playback.audioOnly && import.meta.env.VITE_TTS_PROVIDER === 'qwen3-tts';
    const coreAudioUrl = playback.speechOnly || useServerVoice ? null : coreSpeechCache.urlFor(content, { online: !offline });
    setSpeechState({ status: 'starting', content });
    speechPlayback.speak({
      text: content, voice: playback.systemVoice ? null : voice,
      rate: ttsSettings.rate, pitch: ttsSettings.pitch, volume: ttsSettings.volume,
      audioUrl: coreAudioUrl,
      preferAudio: !playback.speechOnly && (Boolean(coreAudioUrl) || playback.preferAudio || offline || !voice),
      resolveAudio: !offline && !coreAudioUrl && !playback.speechOnly && !playback.audioOnly
        ? signal => requestSpeechAudio(content, ttsSettings.rate, signal, ttsSettings.preset) : null,
      allowSpeechFallback: !playback.audioOnly && Boolean(offline || playback.speechOnly),
      onStart: () => {
        speechEvent.startupMs = Math.max(0, Date.now() - speechEvent.requestedAt);
        if (speechRunRef.current === runId) setSpeechState({ status: 'playing', content });
      },
      onPause: () => { if (speechRunRef.current === runId) setSpeechState({ status: 'paused', content }); },
      onResume: () => { if (speechRunRef.current === runId) setSpeechState({ status: 'playing', content }); },
      onEnd: () => {
        finishSpeechEvent(speechEvent, 'succeeded');
        if (speechRunRef.current === runId) setSpeechState({ status: 'idle', content: '' });
      },
      onError: errorCode => {
        finishSpeechEvent(speechEvent, ['canceled', 'interrupted'].includes(errorCode) ? 'cancelled' : 'failed', errorCode);
        if (speechRunRef.current !== runId) return;
        setSpeechState({ status: 'idle', content: '' });
        if (!['canceled', 'interrupted'].includes(errorCode)) {
          lastSpeechTapRef.current = { content: '', at: 0 };
          setSpeechFailure({ content, contentType, cardIds, errorCode, retryable: true, playback });
        }
      },
    });
    resolveStarted(speechEvent.recordingAllowed ? startTracking() : false);
  }
  function speakBoardSentence(content, sessionId = '') {
    const cardIds = board.map(card => card.id);
    speakText(content, 'sentence', cardIds, sessionId);
  }
  function playLearningPrompt(card, callbacks) {
    const currentVoices = koreanVoices(window.speechSynthesis?.getVoices() || []);
    const voice = selectTtsVoice(currentVoices.length ? currentVoices : ttsVoices, ttsSettings.voiceName, offline);
    if (ttsSettings.volume <= 0 || (offline && voice?.localService !== true)) {
      callbacks.onError(ttsSettings.volume <= 0 ? '음량을 올린 뒤 다시 들어 주세요.' : '오프라인 문제 소리는 기기에 저장된 한국어 음성이 필요해요. 다른 연습은 계속 사용할 수 있어요.');
      return () => {};
    }
    finishSpeechEvent(speechEventRef.current, 'cancelled', 'replaced');
    speechEventRef.current = null;
    const run = ++speechRunRef.current;
    const isCurrent = () => speechRunRef.current === run;
    setSpeechFailure(null); setSpeechState({ status: 'starting', content: '학습 문제 음성' });
    // Reuse the shared player so urgent/communication speech can always replace
    // a prompt. Prompts never become communication events or the last utterance.
    speechPlayback.speak({ text: card.label, voice, rate: ttsSettings.rate, pitch: ttsSettings.pitch, volume: ttsSettings.volume,
      resolveAudio: !offline ? signal => requestSpeechAudio(card.label, ttsSettings.rate, signal, ttsSettings.preset) : null,
      allowSpeechFallback: offline,
      onStart: () => { if (isCurrent()) { setSpeechState({ status: 'playing', content: '학습 문제 음성' }); callbacks.onStart(); } },
      onPause: () => { if (isCurrent()) setSpeechState({ status: 'paused', content: '학습 문제 음성' }); },
      onResume: () => { if (isCurrent()) setSpeechState({ status: 'playing', content: '학습 문제 음성' }); },
      onEnd: () => { if (isCurrent()) setSpeechState({ status: 'idle', content: '' }); },
      onError: () => { if (isCurrent()) { setSpeechState({ status: 'idle', content: '' }); callbacks.onError('문제 소리를 재생하지 못했어요. 다시 듣거나 연습 목록에서 다른 연습을 골라 주세요.'); } },
    });
    return () => { if (isCurrent()) { speechRunRef.current += 1; speechPlayback.stop(); setSpeechState({ status: 'idle', content: '' }); } };
  }
  function speakSelection() { speakBoardSentence(board.map(card => card.label).join(' ')); }
  function pauseSpeech() {
    if (speechState.status !== 'playing') return;
    speechPlayback.pause();
  }
  function resumeSpeech() {
    if (speechState.status !== 'paused') return;
    speechPlayback.resume();
  }
  function stopSpeech() {
    const completion = finishSpeechEvent(speechEventRef.current, 'cancelled', 'user-stopped');
    speechRunRef.current += 1;
    speechPlayback.stop();
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
    const targetId = isSupporter ? selectedUser?.id : user.id;
    const actorId = user.id, token = localStorage.getItem('pesc-mate-token');
    const current = () => activeUserRef.current?.id === actorId && token === localStorage.getItem('pesc-mate-token') && (!isSupporter || selectedUserRef.current?.id === targetId);
    setTtsSettingsBusy(true); setError('');
    try {
      const targetQuery = ['caregiver', 'support_staff'].includes(user.role) && selectedUser ? `?user_id=${encodeURIComponent(selectedUser.id)}` : '';
      const saved = await request(`/tts/settings${targetQuery}`, { method: 'PUT', body: JSON.stringify({
        preset: ttsSettings.preset, voice_name: ttsSettings.voiceName,
        rate: ttsSettings.rate, pitch: ttsSettings.pitch, volume: ttsSettings.volume,
      }) });
      if (!current()) return;
      setTtsSettings(normalizeTtsSettings(saved));
      setTtsSettingsSaved(true);
      if (user.role === 'caregiver') setSupportSettingsNotice({ targetId, message: `${selectedUser.name}님의 목소리 설정을 저장했어요.` });
      if (user.role === 'user') await load(user);
    } catch (e) { if (current()) setError(`${isSupporter ? selectedUser.name + '님의 목소리 저장 실패: ' : ''}${e.message}`); }
    finally { setTtsSettingsBusy(false); }
  }
  function updateAccessibility(changes) {
    setAccessibility(current => ({ ...current, ...changes }));
    setAccessibilitySaved(false);
  }
  async function saveAccessibility() {
    const targetId = isSupporter ? selectedUser?.id : user.id;
    const actorId = user.id, token = localStorage.getItem('pesc-mate-token');
    const current = () => activeUserRef.current?.id === actorId && token === localStorage.getItem('pesc-mate-token') && (!isSupporter || selectedUserRef.current?.id === targetId);
    setAccessibilityBusy(true); setError('');
    try {
      const targetQuery = ['caregiver', 'support_staff'].includes(user.role) && selectedUser ? `?user_id=${encodeURIComponent(selectedUser.id)}` : '';
      const saved = await request(`/accessibility/settings${targetQuery}`, {
        method: 'PUT', body: JSON.stringify(accessibility),
      });
      if (!current()) return;
      setAccessibility(saved);
      setAccessibilitySaved(true);
      if (user.role === 'caregiver') setSupportSettingsNotice({ targetId, message: `${selectedUser.name}님의 화면 설정을 저장했어요.` });
      if (user.role === 'user') await load(user);
    } catch (e) { if (current()) setError(`${isSupporter ? selectedUser.name + '님의 화면 저장 실패: ' : ''}${e.message}`); }
    finally { setAccessibilityBusy(false); }
  }
  async function changePeriod(value) {
    if (['caregiver', 'support_staff'].includes(user.role)) {
      setPeriod(value);
      return loadSupportRecords('dashboard', selectedUser, value);
    }
    setPeriod(value); setStatsBusy(true); setError('');
    try { setStats(await request(dashboardPath(value))); }
    catch (e) { setError(e.message); }
    finally { setStatsBusy(false); }
  }
  async function changeLinkedUser(value) {
    if (!confirmCaregiverLeave()) return;
    const target = linkedUsers.find(person => person.id === value);
    if (!target) return;
    const navigationRun = ++supportRecordRequestRef.current;
    const token = localStorage.getItem('pesc-mate-token'), actorId = user.id;
    const current = () => supportRecordRequestRef.current === navigationRun && activeUserRef.current?.id === actorId
      && selectedUserRef.current?.id === target.id && token === localStorage.getItem('pesc-mate-token');
    selectedUserRef.current = target;
    setSelectedUser(target); setStats(null); setLearningSettings(null); setLearningProgress(null); setNoteDrafts({});
    cardSubmissions.forEach(item => { if (item.image_src) URL.revokeObjectURL(item.image_src); });
    setCardSubmissions([]);
    if (['dashboard', 'learning_progress'].includes(tab)) return loadSupportRecords(tab, target);
    setStatsBusy(true); setError('');
    try {
      if (tab === 'support_settings' && target.permissions.includes('voice_access_manage')) await loadSupportSettings(target);
      if (tab === 'card_settings' && target.permissions.includes('cards_manage')) await loadSupportCards(target);
      if (tab === 'board_settings' && target.permissions.some(permission => ['quick_speech_manage', 'board_manage'].includes(permission))) await loadBoardConfiguration(target);
    }
    catch (e) { if (current()) setError(e.message); }
    finally { if (current()) { setStatsBusy(false); setLearningBusy(false); } }
  }
  async function openSupportSection(nextTab) {
    if (!selectedUser) return;
    const navigationRun = ++supportRecordRequestRef.current;
    const token = localStorage.getItem('pesc-mate-token'), actorId = user.id, targetId = selectedUser.id;
    const current = () => supportRecordRequestRef.current === navigationRun && activeUserRef.current?.id === actorId
      && selectedUserRef.current?.id === targetId && token === localStorage.getItem('pesc-mate-token');
    if (nextTab === 'dashboard') {
      if (!selectedUser.permissions.includes('records_read')) return;
      setTab(nextTab);
      return loadSupportRecords(nextTab, selectedUser);
    }
    setTab(nextTab); setStatsBusy(true); setError('');
    try {
      if (nextTab === 'support_settings') await loadSupportSettings(selectedUser);
      if (nextTab === 'card_settings') await loadSupportCards(selectedUser);
      if (nextTab === 'board_settings') await loadBoardConfiguration(selectedUser);
    } catch (e) { if (current()) setError(e.message); }
    finally { if (current()) setStatsBusy(false); }
  }
  async function loadSupportRecords(nextTab, target, value = period) {
    if (nextTab === 'learning_progress') setLearningDirty(false);
    const permission = nextTab === 'dashboard' ? 'records_read' : 'learning_manage';
    const sequence = ++supportRecordRequestRef.current;
    const session = localStorage.getItem('pesc-mate-token');
    const actorId = user.id;
    const isCurrent = () => supportRecordRequestRef.current === sequence
      && Boolean(session) && localStorage.getItem('pesc-mate-token') === session
      && activeUserRef.current?.id === actorId && selectedUserRef.current?.id === target?.id
      && selectedUserRef.current?.permissions.includes(permission) && navigator.onLine;
    setStats(null); setLearningSettings(null); setLearningProgress(null);
    setNoteBusy('');
    setStatsBusy(nextTab === 'dashboard'); setLearningBusy(nextTab === 'learning_progress'); setError('');
    if (!target?.permissions.includes(permission) || !navigator.onLine) {
      setStatsBusy(false); setLearningBusy(false);
      return;
    }
    try {
      if (nextTab === 'dashboard') {
        const result = await request(dashboardPath(value, target));
        if (isCurrent()) setStats(result);
      } else {
        const query = `?user_id=${encodeURIComponent(target.id)}`;
        const [settings, progress] = await Promise.all([
          request(`/learning/settings${query}`), request(`/learning/progress${query}&days=30`),
        ]);
        if (isCurrent()) { setLearningSettings(settings); setLearningProgress(progress); }
      }
    } catch (e) { if (isCurrent()) setError(e.message); }
    finally { if (isCurrent()) { setStatsBusy(false); setLearningBusy(false); } }
  }
  async function loadSupportSettings(target) {
    const run = ++supportSettingsRequestRef.current;
    const actorId = activeUserRef.current?.id, token = localStorage.getItem('pesc-mate-token');
    const query = `?user_id=${encodeURIComponent(target.id)}`;
    const [voiceSettings, accessSettings] = await Promise.all([
      request(`/tts/settings${query}`), request(`/accessibility/settings${query}`),
    ]);
    if (run !== supportSettingsRequestRef.current || activeUserRef.current?.id !== actorId
        || token !== localStorage.getItem('pesc-mate-token') || selectedUserRef.current?.id !== target.id
        || !selectedUserRef.current?.permissions.includes('voice_access_manage')) return;
    setSupportSettingsNotice(null);
    setTtsSettings(normalizeTtsSettings(voiceSettings));
    setTtsSettingsSaved(true); setAccessibility(accessSettings); setAccessibilitySaved(true);
  }
  async function loadSupportCards(target) {
    const actorId = activeUserRef.current?.id;
    const session = localStorage.getItem('pesc-mate-token');
    const sequence = ++supportCardRequestRef.current;
    const isCurrent = () => supportCardRequestRef.current === sequence
      && Boolean(session) && localStorage.getItem('pesc-mate-token') === session
      && activeUserRef.current?.id === actorId && selectedUserRef.current?.id === target.id
      && selectedUserRef.current?.permissions.includes('cards_manage');
    const query = `?user_id=${encodeURIComponent(target.id)}`;
    let items;
    try { items = await hydrateImages(await request(`/cards/submissions${query}`)); }
    catch (failure) { if (isCurrent()) throw failure; return; }
    if (!isCurrent()) {
      items.forEach(item => { if (item.image_src) URL.revokeObjectURL(item.image_src); });
      return;
    }
    cardSubmissions.forEach(item => { if (item.image_src) URL.revokeObjectURL(item.image_src); });
    setCardSubmissions(items);
  }
  async function loadBoardConfiguration(target) {
    const actorId = user.id;
    const query = `?user_id=${encodeURIComponent(target.id)}`;
    const [layout, audit] = await Promise.all([
      request(`/board/layout${query}`), request(`/board/layout/audit${query}`),
    ]);
    if (activeUserRef.current?.id !== actorId || selectedUserRef.current?.id !== target.id) return;
    setBoardConflict(false);
    setBoardLayout(layout); setBoardLayoutAudit(audit);
    setQuickDraft(layout.quick_expression_ids); setRecoveryDraft(layout.recovery_expression_ids);
    setSlotDraft(layout.slots.map(slot => slot.card_id));
  }
  async function reloadBoardConfiguration() {
    if (!selectedUser || boardConfigBusy) return;
    setBoardConfigBusy('reload'); setError('');
    try { await loadBoardConfiguration(selectedUser); }
    catch (e) { setError(e.message); }
    finally { setBoardConfigBusy(''); }
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
    if (!isLinkedTarget) cacheLearningState(user.id, { settings, progress }).catch(() => {});
  }
  function updateLearningSetting(changes) {
    setLearningDirty(true);
    setLearningSettings(current => ({ ...current, ...changes }));
  }
  async function saveLearningConfiguration(event) {
    event.preventDefault();
    if (!selectedUser || !learningSettings?.category_ids?.length) {
      setError('학습 카테고리를 하나 이상 선택해 주세요.');
      return;
    }
    setLearningBusy(true); setError('');
    const targetId = selectedUser.id, actorId = user.id, token = localStorage.getItem('pesc-mate-token');
    const current = () => activeUserRef.current?.id === actorId && selectedUserRef.current?.id === targetId && token === localStorage.getItem('pesc-mate-token');
    try {
      const query = `?user_id=${encodeURIComponent(selectedUser.id)}`;
      const saved = await request(`/learning/settings${query}`, {
        method: 'PUT', body: JSON.stringify({
          category_ids: learningSettings.category_ids,
          question_count: Number(learningSettings.question_count),
          option_count: Number(learningSettings.option_count),
          repeat_frequency: Number(learningSettings.repeat_frequency),
          time_limit_seconds: Number(learningSettings.time_limit_seconds),
          retry_enabled: learningSettings.retry_enabled,
        }),
      });
      if (!current()) return;
      setLearningSettings(saved); setLearningDirty(false);
      if (user.role === 'caregiver') setSupportSettingsNotice({ targetId, message: `${selectedUser.name}님의 연습 설정을 저장했어요.` });
    } catch (e) { if (current()) setError(`${selectedUser.name}님의 연습 저장 실패: ${e.message}`); }
    finally { setLearningBusy(false); }
  }
  async function openLearning(target = selectedUser) {
    if (['caregiver', 'support_staff'].includes(user.role)) {
      if (!target?.permissions.includes('learning_manage')) return;
      setTab('learning_progress');
      return loadSupportRecords('learning_progress', target);
    }
    setTab('practice');
    if (!privacy.guardian_consent) { setLearningSettings(null); setLearningProgress(null); return; }
    setLearningBusy(true); setError('');
    try {
      if (!navigator.onLine) {
        if (user.role !== 'user') throw new Error('학습 기록은 온라인 연결 후 확인할 수 있습니다. 말하기와 빠른 표현은 계속 사용할 수 있습니다.');
        const cached = await cachedLearningState(user.id).catch(() => null);
        if (!cached?.settings) throw new Error('온라인에서 연습하기를 한 번 열어야 오프라인 학습을 사용할 수 있습니다.');
        setLearningSettings(cached.settings); setLearningProgress(cached.progress);
      } else await loadLearning(target);
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
      const hasPicture = Boolean(cardImage(card));
      const allowed = categoryId === 'all'
        ? (!allowedNames.size || allowedNames.has(card.category))
        : card.category === selectedName && allowedNames.has(card.category);
      return hasPicture && allowed;
    });
  }
  function startLearningGame(plan = null) {
    const suggestion = plan?.candidate;
    const activityType = suggestion?.activity_type || practiceActivity;
    const config = suggestion?.settings || learningSettings;
    const source = suggestion?.card_ids?.length
      ? cards.filter(card => suggestion.card_ids.includes(card.id) && cardImage(card))
      : availablePracticeCards(suggestion?.category_id || practiceCategory);
    const sentence = activityType === 'sentence_card_order';
    const optionCount = config?.option_count || 3;
    if (!sentence && source.length < optionCount) {
      setError(`선택한 범위에 그림이 있는 카드가 ${optionCount}개 이상 필요합니다.`);
      return;
    }
    const questions = activityType === 'situation_card_match'
      ? situationQuestions(source, config?.question_count || 5, optionCount, suggestion?.situation_id || practiceSituation)
      : sentence ? sentenceLearningQuestions(source, config?.question_count || 10,
      config?.repeat_frequency || 1, Math.random, suggestion?.content_id || null) : learningQuestions(
      source, config?.question_count || 10,
      optionCount, config?.repeat_frequency || 1,
    );
    if (!questions.length) {
      setError(sentence ? '선택 범위에 예문을 구성할 카드가 없습니다. 설정된 전체 범위나 다른 연습을 골라 주세요.' : '선택한 범위에 그림이 있는 카드가 2개 이상 필요합니다.');
      return;
    }
    setError('');
    setLearningGame({
      activity_type: activityType, content_version: LEARNING_ACTIVITIES[activityType].version,
      plan: suggestion ? plan : null,
      phase: 'playing', questions, questionIndex: 0, correctAnswers: 0,
      hadWrong: false, feedback: '', selectedId: '', sequenceIds: [], startedAt: Date.now(),
      requestId: createRequestId(), attempt: null, results: [],
    });
  }
  async function startPracticePlan() {
    if (!activePracticePlan || offline) return;
    const token = localStorage.getItem('pesc-mate-token'), accountId = user.id;
    setLearningBusy(true); setError('');
    try {
      const fresh = await request('/practice-suggestions/active');
      if (token !== localStorage.getItem('pesc-mate-token') || activeUserRef.current?.id !== accountId) return;
      if (!fresh || fresh.id !== activePracticePlan.id) throw new Error('연습 설정이 변경되었습니다. 다시 확인해 주세요.');
      startLearningGame(fresh);
    } catch (failure) { setError(failure.message); }
    finally { if (token === localStorage.getItem('pesc-mate-token')) setLearningBusy(false); }
  }
  function answerLearningQuestion(cardId) {
    setLearningGame(current => {
      if (!current || current.phase !== 'playing' || ['correct', 'incorrect'].includes(current.feedback)) return current;
      const question = current.questions[current.questionIndex];
      const sentence = current.activity_type === 'sentence_card_order';
      if (sentence ? (!validSentenceDraft(question, cardId) || cardId.length !== question.sequence.length)
        : !question.options.some(option => option.id === cardId)) return current;
      const selectedId = sentence ? cardId.join('|') : cardId;
      if (current.feedback === 'retry' && current.selectedId === selectedId) return current;
      const correct = sentence ? sentenceOrderMatches(question, cardId)
        : question.answer_ids ? question.answer_ids.includes(cardId) : cardId === question.target.id;
      const item = { card_id: question.target.id, label: question.target.label,
        first_try_correct: !current.hadWrong && correct,
        ...(sentence ? { content_id: question.content_id, card_ids: question.sequence.map(card => card.id) } : {}),
      };
      if (correct) return {
        ...current, selectedId, feedback: 'correct',
        correctAnswers: current.correctAnswers + (current.hadWrong ? 0 : 1),
        results: [...current.results, item],
      };
      return {
        ...current, selectedId, hadWrong: true,
        feedback: (current.plan?.candidate?.settings?.retry_enabled ?? learningSettings?.retry_enabled) === false ? 'incorrect' : 'retry',
        results: (current.plan?.candidate?.settings?.retry_enabled ?? learningSettings?.retry_enabled) === false
          ? [...current.results, item]
          : current.results,
      };
    });
  }
  function changeLearningOrder(ids) {
    setLearningGame(current => {
      if (!current || current.activity_type !== 'sentence_card_order' || current.phase !== 'playing'
          || ['correct', 'incorrect'].includes(current.feedback)
          || !validSentenceDraft(current.questions[current.questionIndex], ids)) return current;
      return { ...current, sequenceIds: ids };
    });
  }
  async function finishLearningGame(snapshot) {
    if (!snapshot || snapshot.phase === 'saving') return;
    if (!privacy.guardian_consent) {
      setLearningGame(current => ({ ...current, phase: 'complete', attempt: null, recordingDisabled: true }));
      return;
    }
    const durationSeconds = Math.min(3600, Math.max(1, Math.round((Date.now() - snapshot.startedAt) / 1000)));
    const payload = {
      request_id: snapshot.requestId, activity_type: snapshot.activity_type || 'word_picture_match',
      content_version: snapshot.content_version || LEARNING_ACTIVITIES.word_picture_match.version,
      program_set_id: snapshot.plan?.program_set_id || null,
      category_id: snapshot.plan?.candidate?.category_id === 'all' ? 'mixed'
        : snapshot.plan?.candidate?.category_id || (practiceCategory === 'all' ? 'mixed' : practiceCategory),
      total_questions: snapshot.questions.length,
      correct_answers: snapshot.correctAnswers,
      duration_seconds: durationSeconds,
      items: snapshot.results,
    };
    async function queueForSync() {
      await queueLearningAttempt({ user_id: user.id, ...payload });
      await clearLearningGame(user.id);
      await updatePendingSyncCount(user.id);
      setLearningGame(current => ({
        ...current, phase: 'complete', attempt: { ...payload, pending_sync: true },
      }));
    }
    setLearningGame(current => ({ ...current, phase: 'saving' }));
    setError('');
    if (!navigator.onLine) {
      try { await queueForSync(); }
      catch { setLearningGame(current => ({ ...current, phase: 'playing' })); setError('기기에 학습 결과를 저장하지 못했습니다. 다시 시도해 주세요.'); }
      return;
    }
    try {
      const attempt = await request('/learning/attempts', {
        method: 'POST', body: JSON.stringify(payload),
      });
      await clearLearningGame(user.id).catch(() => {});
      setLearningGame(current => ({ ...current, phase: 'complete', attempt }));
      try {
        const progress = await request('/learning/progress?days=30');
        setLearningProgress(progress);
        cacheLearningState(user.id, { settings: learningSettings, progress }).catch(() => {});
      }
      catch { setError('연습 결과는 저장되었지만 최근 진행 현황은 새로고침이 필요합니다.'); }
    } catch (e) {
      if (!e.status || e.status >= 500) {
        try { await queueForSync(); setError('연습 결과를 기기에 저장했습니다. 온라인 연결 후 자동으로 동기화합니다.'); }
        catch { setLearningGame(current => ({ ...current, phase: 'playing' })); setError('학습 결과를 저장하지 못했습니다. 다시 시도해 주세요.'); }
      } else {
        setLearningGame(current => ({ ...current, phase: 'playing' }));
        setError(`${e.message} 결과를 확인한 뒤 다시 저장해 주세요.`);
      }
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
      hadWrong: false, feedback: '', selectedId: '', sequenceIds: [],
    }));
  }
  async function saveBoardConfiguration(kind) {
    if (!selectedUser || !boardLayout || boardConfigBusy || boardConflict) return;
    const targetId = selectedUser.id;
    const actorId = user.id;
    const isCurrent = () => selectedUserRef.current?.id === targetId && activeUserRef.current?.id === actorId;
    const quick = kind === 'quick';
    const recovery = kind === 'recovery';
    const values = quick ? quickDraft : recovery ? recoveryDraft : slotDraft;
    if (!values.length) { setError('항목을 하나 이상 선택해 주세요.'); return; }
    setBoardConfigBusy(kind); setError('');
    try {
      const path = quick ? 'quick-expressions' : recovery ? 'recovery-expressions' : 'slots';
      const query = `?user_id=${encodeURIComponent(selectedUser.id)}`;
      const layout = await request(`/board/layout/${path}${query}`, {
        method: 'PUT', body: JSON.stringify({
          ...(recovery ? { expression_ids: values } : { card_ids: values }),
          expected_revision: boardLayout.revision ?? 0,
        }),
      });
      if (!isCurrent()) return;
      setBoardLayout(layout);
      const audit = await request(`/board/layout/audit${query}`);
      if (isCurrent()) setBoardLayoutAudit(audit);
    } catch (e) {
      if (!isCurrent()) return;
      if (e.status === 409) setBoardConflict(true);
      else setError(e.message);
    }
    finally { if (isCurrent()) setBoardConfigBusy(''); }
  }
  async function saveCaregiverNote(sessionId) {
    const content = (noteDrafts[sessionId] ?? stats.recent.find(row => row.id === sessionId)?.caregiver_note ?? '').trim();
    if (!content) { setError('메모 내용을 입력해 주세요.'); return; }
    const scope = supportRecordRequestRef.current;
    const actorId = user.id;
    const targetId = selectedUser.id;
    const token = localStorage.getItem('pesc-mate-token');
    const isCurrent = () => supportRecordRequestRef.current === scope && selectedUserRef.current?.id === targetId
      && activeUserRef.current?.id === actorId && localStorage.getItem('pesc-mate-token') === token && navigator.onLine;
    const revision = stats.recent.find(row => row.id === sessionId)?.caregiver_note_details?.revision || 0;
    setNoteBusy(sessionId); setError('');
    try {
      const saved = await request(`/care/notes/${sessionId}`, { method: 'PUT', body: JSON.stringify({ user_id: targetId, content, expected_revision: revision }) });
      if (!isCurrent()) return;
      setStats(current => current && ({ ...current, recent: current.recent.map(row => row.id === sessionId ? { ...row, caregiver_note: saved.content, caregiver_note_details: saved } : row) }));
      setNoteDrafts(current => ({ ...current, [sessionId]: saved.content }));
    } catch (e) { if (isCurrent()) setError(e.message); }
    finally { if (isCurrent()) setNoteBusy(''); }
  }
  async function removeCaregiverNote(sessionId) {
    if (!window.confirm('이 메모와 이전 버전의 본문을 삭제할까요? 작성자·처리 시각 이력만 남습니다.')) return;
    const scope = supportRecordRequestRef.current;
    const actorId = user.id;
    const targetId = selectedUser.id;
    const token = localStorage.getItem('pesc-mate-token');
    const isCurrent = () => supportRecordRequestRef.current === scope && selectedUserRef.current?.id === targetId
      && activeUserRef.current?.id === actorId && localStorage.getItem('pesc-mate-token') === token && navigator.onLine;
    const revision = stats.recent.find(row => row.id === sessionId)?.caregiver_note_details?.revision || 0;
    setNoteBusy(sessionId); setError('');
    try {
      const path = `/care/notes/${sessionId}?user_id=${encodeURIComponent(targetId)}&expected_revision=${revision}`;
      await request(path, { method: 'DELETE' });
      if (!isCurrent()) return;
      const saved = await request(`/care/notes/${sessionId}/history?user_id=${encodeURIComponent(targetId)}`);
      if (!isCurrent()) return;
      setStats(current => current && ({ ...current, recent: current.recent.map(row => row.id === sessionId
        ? { ...row, caregiver_note: saved.content, caregiver_note_details: saved } : row) }));
      setNoteDrafts(current => ({ ...current, [sessionId]: saved.content || '' }));
    } catch (e) { if (isCurrent()) setError(e.message); }
    finally { if (isCurrent()) setNoteBusy(''); }
  }
  async function savePrivacySettings() {
    setPrivacyBusy('settings'); setError('');
    try {
      setPrivacy(await request('/privacy/settings', {
        method: 'PUT', body: JSON.stringify({
          guardian_consent: privacyDraft.guardian_consent,
          retention_days: Number(privacyDraft.retention_days),
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
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `pecsmate-${user.id}-data.json`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); }
    finally { setPrivacyBusy(''); }
  }
  async function deletePrivacyData() {
    if (!window.confirm('개인 카드, 문장·음성 기록, 보호자 연결과 설정을 삭제할까요? 복구할 수 없습니다.')) return;
    setPrivacyBusy('delete'); setError('');
    try {
      await stopSpeech();
      const receipt = await request('/privacy/data', { method: 'DELETE', body: JSON.stringify({ confirmation: 'DELETE' }) });
      activityConsentRef.current = false;
      clearBoard(user.id); setPrivacy(receipt); setBoard([]); setPrivacyCaregivers([]);
      try { await clearOfflineUserData(user.id); setLocalDeletionStatus('completed'); }
      catch { setLocalDeletionStatus('failed'); throw new Error('서버 삭제는 완료했지만 기기 임시 기록을 지우지 못했습니다. 삭제를 다시 실행해 주세요.'); }
      setPrivacyAudit(await request('/privacy/audit'));
      await load(user);
    } catch (e) {
      setError(e.message);
      try { setPrivacy(await request('/privacy/settings')); } catch { /* Keep the last confirmed receipt. */ }
    }
    finally { setPrivacyBusy(''); }
  }
  async function submitCard(event, image) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    if (image) formData.set('image', image, image.name);
    formData.set('submission_mode', event.nativeEvent.submitter?.value || 'submit');
    const targetQuery = isSupporter && selectedUser ? `?user_id=${encodeURIComponent(selectedUser.id)}` : '';
    const actorId = user.id, targetId = selectedUser?.id;
    const token = localStorage.getItem('pesc-mate-token');
    const current = () => activeUserRef.current?.id === actorId && token === localStorage.getItem('pesc-mate-token')
      && (!isSupporter || selectedUserRef.current?.id === targetId);
    if (isSupporter && selectedUser) formData.set('user_id', selectedUser.id);
    setCardFormBusy(true); setCardFormError(''); setError('');
    try {
      const saved = editingSubmission
        ? await request(`/cards/submissions/${editingSubmission.id}${targetQuery}`, {
          method: 'PATCH', body: JSON.stringify(Object.fromEntries(['label', 'category', 'visibility'].map(key => [key, formData.get(key)]))),
        })
        : await request('/cards/submissions', { method: 'POST', body: formData });
      if (!current()) return;
      setCardSubmissions(current => editingSubmission
        ? current.map(item => item.id === saved.id ? saved : item)
        : [saved, ...current]);
      setShowCardForm(false);
      setEditingSubmission(null);
      if (user.role === 'caregiver') {
        setManagedCardSearch(''); setManagedCardCategory('');
        setManagedCardNotice({ targetId, label: saved.label, id: saved.id, draft: saved.status === 'draft' });
      }
      form.reset();
      if (saved.status === 'approved') {
        if (isSupporter) await loadSupportCards(selectedUser);
        else { await load(user); setCategory('전체'); setSearch(''); }
      }
    } catch (e) { if (current()) { setCardFormError(e.message); setError(e.message); } }
    finally { setCardFormBusy(false); }
  }
  async function submitDraft(item) {
    setReviewBusy(item.id); setError('');
    try {
      const targetQuery = isSupporter && selectedUser ? `?user_id=${encodeURIComponent(selectedUser.id)}` : '';
      const saved = await request(`/cards/submissions/${item.id}/submit${targetQuery}`, { method: 'POST' });
      setCardSubmissions(current => current.map(row => row.id === item.id ? saved : row));
      if (saved.status === 'approved') {
        if (isSupporter) await loadSupportCards(selectedUser);
        else await load(user);
      }
    } catch (e) { setError(e.message); }
    finally { setReviewBusy(''); }
  }
  async function refreshAdminCards() {
    const actorId = user.id, token = localStorage.getItem('pesc-mate-token');
    const images = await hydrateImages(await request('/admin/card-submissions'));
    if (activeUserRef.current?.id !== actorId || token !== localStorage.getItem('pesc-mate-token')) {
      images.forEach(item => { if (item.image_src) URL.revokeObjectURL(item.image_src); }); return;
    }
    setAdminSubmissions(current => { current.forEach(item => { if (item.image_src) URL.revokeObjectURL(item.image_src); }); return images; });
  }
  async function performContentOperation(title, description, path, method, fields) {
    const actorId = user?.id;
    const session = localStorage.getItem('pesc-mate-token');
    const isCurrent = () => Boolean(session) && activeUserRef.current?.id === actorId
      && localStorage.getItem('pesc-mate-token') === session;
    if (!isCurrent() || !navigator.onLine) return null;
    const verification = await askPassword(title, description);
    if (!verification || !isCurrent()) return null;
    try {
      const saved = await request(path, { method, body: JSON.stringify({ ...fields, password: verification }) });
      return isCurrent() ? saved : null;
    } catch (error) {
      if (isCurrent()) throw error;
      return null;
    }
  }
  async function reviewCard(item, decision) {
    const reason = (reviewDrafts[item.id] || '').trim();
    if (decision === 'rejected' && !reason) { setError('반려 사유를 입력해 주세요.'); return; }
    setReviewBusy(item.id); setError('');
    try {
      const action = { approved: '승인·재활성', rejected: '반려', inactive: '비활성' }[decision];
      const saved = await performContentOperation(`공용 카드 ${action}`, `대상: ${item.label} · 변경: ${action}${reason ? ` · 사유: ${reason}` : ''}`,
        `/admin/card-submissions/${item.id}`, 'PATCH', { decision, reason });
      if (!saved) return;
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
      const fields = { name: formData.get('name'), display_order: Number(formData.get('display_order')) };
      const saved = await performContentOperation('카테고리 추가', `이름: ${fields.name} · 표시 순서: ${fields.display_order}`,
        '/admin/categories', 'POST', fields);
      if (!saved) return;
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
      const fields = { name: draft.name, display_order: Number(draft.display_order), active };
      const saved = await performContentOperation('카테고리 변경', `대상: ${item.name} → ${fields.name} · 표시 순서: ${fields.display_order} · ${active ? '활성' : '비활성'}`,
        `/admin/categories/${item.id}`, 'PATCH', fields);
      if (!saved) return;
      setAdminCategories(current => current.map(row => row.id === item.id ? saved : row).sort((a, b) => a.display_order - b.display_order));
      setCategoryEdits(current => ({ ...current, [saved.id]: { name: saved.name, display_order: saved.display_order } }));
    } catch (e) { setCategoryError(e.message); }
    finally { setCategoryBusy(''); }
  }
  function tile(card) {
    return <SpeakingCardTile key={card.id} card={card} renderArt={cardArt} disabled={busy}
      compose={outputMode !== 'word'} onAdd={add} onSpeak={item => speakText(item.label, 'card', [item.id])} />;
  }
  const layoutCards = boardLayout?.available_cards || cards;
  const layoutCardsById = new Map(layoutCards.map(card => [card.id, card]));
  const quickExpressionCards = boardLayout
    ? boardLayout.quick_expression_ids.map(id => cards.find(card => card.id === id) || layoutCardsById.get(id)).filter(Boolean)
    : DEFAULT_QUICK_EXPRESSIONS;
  const recoveryExpressions = (boardLayout?.recovery_expression_ids || ['wrong_tap', 'not_that', 'hold_on', 'say_again'])
    .map(id => RECOVERY_EXPRESSIONS.find(item => item.id === id)).filter(Boolean);
  const practiceCategories = (learningSettings?.category_ids?.length
    ? cardCategories.filter(item => learningSettings.category_ids.includes(item.id))
    : cardCategories).filter(item => practiceActivity === 'sentence_card_order'
    ? availableSentenceExamples(availablePracticeCards(item.id)).length > 0
    : availablePracticeCards(item.id).length >= (learningSettings?.option_count || 3));
  const currentLearningQuestion = learningGame?.questions?.[learningGame.questionIndex];
  const filteredCards = cards.filter(card =>
    (category === '전체' || card.category === category)
    && card.label.includes(search.trim())
  );
  const { listRef: catalogListRef, onScroll: scrollCatalog, visibleCards } = useCardScroll(
    filteredCards, accessibility.cards_per_page, [category, search, tab, boardLayout?.updated_at],
  );
  const todayLabel = new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit', day: '2-digit', weekday: 'long',
  }).format(new Date());
  const speechActive = speechState.status !== 'idle';
  const isSupporter = ['caregiver', 'support_staff'].includes(user?.role);
  const isCaregiver = user?.role === 'caregiver';
  const caregiverManagementOpen = isCaregiver && ['caregiver_manage', 'dashboard', 'card_settings', 'board_settings', 'support_settings', 'learning_progress', 'rfid'].includes(tab);
  const visibleManagedCards = isCaregiver ? cardSubmissions.filter(item => (!managedCardCategory || item.category === managedCardCategory)
    && item.label.toLocaleLowerCase('ko-KR').includes(managedCardSearch.trim().toLocaleLowerCase('ko-KR'))) : cardSubmissions;
  const canManageContent = user?.role === 'support_staff' && user?.account_permissions?.includes('content_manage');
  const canManageAccounts = user?.role === 'support_staff' && user?.can_manage_account_permissions === true;
  const selectedPermissions = selectedUser?.permissions || [];
  const canReadRecords = selectedPermissions.includes('records_read');
  const canWriteNotes = selectedPermissions.includes('notes_write');
  const canManageCards = selectedPermissions.includes('cards_manage');
  const canManageVoice = selectedPermissions.includes('voice_access_manage');
  const canManageQuick = selectedPermissions.includes('quick_speech_manage');
  const canManageBoard = selectedPermissions.includes('board_manage');
  const canManageLearning = selectedPermissions.includes('learning_manage');
  const localKoreanVoices = installedKoreanVoices(ttsVoices);
  const usbConnected = usbStatus.state === 'connected' && usbStatus.fresh;
  const usbConnectionLabel = usbStatus.state === 'connected'
    ? usbStatus.fresh ? '기기 연결됨' : '기기 응답 대기'
    : usbStatus.state === 'connecting' ? '기기 연결 중' : '기기 연결';
  const speechStatusLabel = ({ starting: '음성 준비 중', playing: '음성 재생 중', paused: '음성 일시 정지' })[speechState.status];
  const pageTitle = tab === 'account_permissions' && canManageAccounts ? '담당자의 운영 권한을 관리해요.'
    : tab === 'rfid_registration' && canManageContent ? '칩을 읽고 그림카드에 연결해요.'
    : tab === 'admin' && canManageContent
    ? '공용 카드를 관리해요.'
    : isSupporter
    ? tab === 'support_home' ? isCaregiver ? '함께 나누는 그림 카드판' : '연결된 사용자를 지원해요.'
      : tab === 'caregiver_manage' && isCaregiver ? '아이 관리'
      : tab === 'dashboard' ? `${selectedUser?.name || '연결 사용자'}의 의사소통 기록을 살펴봐요.`
      : tab === 'learning_progress' ? isCaregiver ? `${selectedUser?.name || '아이'}의 연습을 관리해요.` : `${selectedUser?.name || '연결 사용자'}의 학습 기록을 살펴봐요.`
      : `${selectedUser?.name || '연결 사용자'}의 설정과 기록을 살펴봐요.`
    : tab === 'home'
      ? '오늘은 무엇을 해볼까요?'
      : tab === 'cards'
      ? '그림카드로 마음을 전해요.'
      : tab === 'catalog'
      ? `그림 카드 ${cards.length}개를 살펴보세요.`
      : tab === 'practice'
      ? '카드로 차근차근 연습해요.'
      : '그림으로 마음을 전해요.';
  if (!authReady) return <main className="login-page"><p role="status">로그인 정보를 확인하는 중입니다…</p></main>;
  if (!user) return <LandingPage pageRef={entryPageRef} onLogin={() => openAuthentication('login')} onStart={() => openAuthentication('register')}
    busy={busy}>
    <section className="login-card" ref={authPanelRef} aria-labelledby="auth-title">
    <div className="login-mascot"><Mascot /></div><p className="auth-brand">PECS MATE</p>
    <h2 id="auth-title">{authMode === 'login' ? '로그인' : '사용자 가입'}</h2><p className="muted">{authMode === 'login' ? '내 카드로 이야기를 시작해요.' : 'AAC 사용자 계정을 만들고 바로 시작합니다.'}</p>
    {error && <div role="alert" className="error">{error}</div>}
    <form onSubmit={handleLogin}>
      {authMode === 'register' && <label>이름<input autoComplete="name" value={name} onChange={e => setName(e.target.value)} required minLength="1" maxLength="30" /></label>}
      <label>아이디<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required minLength={authMode === 'register' ? 4 : 1} maxLength={authMode === 'register' ? 32 : 64} pattern={authMode === 'register' ? '[A-Za-z0-9_-]+' : undefined} /></label>
      <label>비밀번호<input type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={authMode === 'register' ? 8 : 1} maxLength="128" /></label>
      {authMode === 'register' && <><label>비밀번호 확인<input type="password" autoComplete="new-password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} required minLength="8" maxLength="128" /></label><label className="registration-consent"><input type="checkbox" checked={registrationConsent} onChange={event => setRegistrationConsent(event.target.checked)} required />법정대리인이 개인정보 수집·이용과 기본 1년 보존에 동의했습니다.</label></>}
      <button className="primary full" disabled={busy}>{busy ? '처리 중…' : authMode === 'login' ? '로그인' : '가입하고 시작하기'}</button>
    </form>
    <button className="auth-switch" disabled={busy} onClick={() => openAuthentication(authMode === 'login' ? 'register' : 'login', true)}>{authMode === 'login' ? '처음 이용하시나요? 사용자 가입' : '이미 계정이 있나요? 로그인'}</button>
    {authMode === 'login' && <p className="demo-account">사용자: <code>demo</code> / <code>demo1234</code><br />보호자: <code>caregiver</code> / <code>caregiver1234</code><br />담당자: <code>support</code> / <code>support1234</code><br />운영 권한 담당자: <code>admin</code> / <code>admin1234</code></p>}
  </section></LandingPage>;
  const profileSession = localStorage.getItem('pesc-mate-token');
  function profileSaved(account) {
    if (activeUserRef.current?.id !== account.id || localStorage.getItem('pesc-mate-token') !== profileSession) return;
    setUser(account); cacheAccountForOffline(account).catch(() => {});
    setProfileNotice('프로필을 저장했습니다.');
  }
  if (!user.profile) return <main className="login-page" ref={entryPageRef}><ProfileEditor key={user.id} user={user}
    onSaved={profileSaved} onCancel={handleLogout} /></main>;
  const settingsSections = myPageOpen ? [
    { id: 'profile', label: '프로필 설정', content: <ProfileEditor key={user.id} user={user}
      onSaved={profileSaved} onCancel={() => setMyPageOpen(false)} /> },
    ...(user.role === 'user' ? [
      { id: 'accessibility', label: '접근 설정', content: <section className="accessibility-settings"><h3>접근 설정</h3><div>
        <p>시작 화면·발화 방식·카드 배치는 연결된 보호자 또는 담당자 계정에서 바꿀 수 있어요.</p>
        <label>카드 표시<select disabled value={accessibility.display_mode}><option value="image">그림 중심</option><option value="image_text">그림 + 글자</option><option value="text">글자 중심</option></select></label>
        <label>한 번에 불러올 카드 수<select disabled value={accessibility.cards_per_page}><option value={accessibility.cards_per_page}>{accessibility.cards_per_page}개</option></select></label>
        <label>카드 크기<select disabled value={accessibility.card_size}><option value={accessibility.card_size}>{accessibility.card_size === 'small' ? '작게' : accessibility.card_size === 'large' ? '크게' : '보통'}</option></select></label>
        <label>글자 크기<select value={accessibility.text_size} onChange={event => updateAccessibility({ text_size: event.target.value })}><option value="small">작게</option><option value="medium">보통</option><option value="large">크게</option></select></label>
        <label className="check-setting"><input type="checkbox" checked={accessibility.reduced_motion} onChange={event => updateAccessibility({ reduced_motion: event.target.checked })} />애니메이션·장식 줄이기</label>
        <label className="check-setting"><input type="checkbox" checked={accessibility.high_contrast} onChange={event => updateAccessibility({ high_contrast: event.target.checked })} />고대비 표시</label>
        <button className="primary" disabled={accessibilityBusy || accessibilitySaved} onClick={saveAccessibility}>{accessibilityBusy ? '저장 중…' : accessibilitySaved ? '저장됨' : '설정 저장'}</button>
      </div></section> },
      { id: 'voice', label: '음성 설정', content: <section className="tts-settings">
          <h3>음성 설정</h3>
          <p className="form-notice">{import.meta.env.VITE_TTS_PROVIDER === 'qwen3-tts' ? '여자아이·남자아이 합성 음색을 선택할 수 있어요. 기본 속도는 0.90배이며 기기 음성과 음높이는 기기 재생에만 적용됩니다.' : '서버 연결 시 MeloTTS 한국어 음성을 사용합니다. 속도·볼륨을 조절할 수 있고, 음색·음높이는 기기 재생에만 적용됩니다.'}</p>
          <div className="tts-settings-grid">
            <label>음성 느낌<select value={ttsSettings.preset} onChange={event => changeTtsPreset(event.target.value)}>{Object.entries(TTS_PRESETS).map(([value, preset]) => <option key={value} value={value}>{preset.label}</option>)}</select></label>
            <label>기기 한국어 음성<select value={ttsSettings.voiceName} onChange={event => updateTtsSettings({ voiceName: event.target.value })}><option value="">한국어 음성 자동 선택</option>{ttsSettings.voiceName && !ttsVoices.some(voice => voice.name === ttsSettings.voiceName) && <option value={ttsSettings.voiceName}>{ttsSettings.voiceName} (현재 기기에 없음)</option>}{ttsVoices.map(voice => <option key={voice.voiceURI} value={voice.name}>{voice.name}{voice.localService === true ? ' · 기기 저장' : voice.localService === false ? ' · 온라인 음성' : ' · 오프라인 확인 필요'}</option>)}</select></label>
            <label>속도 <output>{ttsSettings.rate.toFixed(2)}배</output><input type="range" min="0.5" max="1.5" step="0.05" value={ttsSettings.rate} onChange={event => updateTtsSettings({ rate: Number(event.target.value) })} /></label>
            <label>음높이 <output>{ttsSettings.pitch.toFixed(2)}</output><input type="range" min="0.5" max="1.5" step="0.05" value={ttsSettings.pitch} onChange={event => updateTtsSettings({ pitch: Number(event.target.value) })} /></label>
            <label>기본 볼륨 <output>{Math.round(ttsSettings.volume * 100)}%</output><input type="range" min="0" max="1" step="0.05" value={ttsSettings.volume} onChange={event => updateTtsSettings({ volume: Number(event.target.value) })} /></label>
          </div>
          <div className="tts-preview"><small role="status">{localKoreanVoices.length ? `이 기기에 저장된 한국어 음성 ${localKoreanVoices.length}개` : ttsVoices.length ? `이 기기의 한국어 음성 ${ttsVoices.length}개 · 오프라인 사용은 별도 확인` : '이 기기에서 한국어 음성을 아직 찾지 못했어요. 기기 음성 테스트를 눌러 확인해 주세요.'}</small><span>
            <button type="button" disabled={busy || ttsSettingsBusy || offline} onClick={() => speakText('안녕하세요. 서버에서 만든 한국어 음성입니다.', 'preview')}>서버 음성 테스트</button>
            <button type="button" disabled={busy || ttsSettingsBusy} onClick={() => speakText('안녕하세요. 목소리를 확인해 보세요.', 'preview', [], '', { speechOnly: true })}>기기 음성 테스트</button>
            <button type="button" disabled={busy || ttsSettingsBusy} onClick={() => speakText('한국어 기본 음성을 확인합니다.', 'preview', [], '', { speechOnly: true, systemVoice: true })}>한국어 기본 음성 테스트</button>
            <button type="button" disabled={busy || ttsSettingsBusy} onClick={() => speakText('도와주세요', 'preview', [], '', { preferAudio: true, audioOnly: true })}>기본 녹음 테스트</button>
            <button type="button" className="primary" disabled={ttsSettingsBusy || ttsSettingsSaved} onClick={saveTtsSettings}>{ttsSettingsBusy ? '저장 중…' : ttsSettingsSaved ? '저장됨' : '설정 저장'}</button></span></div>
        </section> },
      { id: 'guardian', label: '보호자 설정', content: <div className="guardian-settings">
        <h3>보호자 설정</h3><p>계정 소유자·법정대리인이 동의와 데이터 관리를 확인하는 영역입니다.</p>
        <section className="privacy-panel">
      <div className="panel-heading"><span aria-hidden="true"><UiIcon name="shield" /></span><div><h2>개인정보와 열람 권한</h2><p className="muted">누가 기록을 볼 수 있는지 확인하고 내 데이터를 관리합니다.</p></div></div>
      {privacy.deletion_status === 'completed' && <p className="privacy-receipt" role="status">이용 데이터 삭제 완료 · {privacy.deleted_at ? new Date(privacy.deleted_at).toLocaleString('ko-KR') : ''}</p>}
      <div className="privacy-grid">
        <article><h3>동의와 보존 기간</h3><p>보호자 설정입니다. 저장된 동의는 다음 로그인에도 유지되며, 저장하기 전 체크만 바꾼 상태는 기록 수집에 적용하지 않습니다. 동의 없이도 기본 말하기와 기록 없는 연습을 사용할 수 있습니다.</p><label className="privacy-check"><input type="checkbox" checked={privacyDraft.guardian_consent} disabled={privacyBusy === 'settings' || offline || !loaded} onChange={event => setPrivacyDraft(current => ({ ...current, guardian_consent: event.target.checked }))} />법정대리인이 개인정보 수집·이용에 동의했음을 확인합니다.</label><label>기록 보존 기간<select value={privacyDraft.retention_days} disabled={privacyBusy === 'settings' || offline || !loaded} onChange={event => setPrivacyDraft(current => ({ ...current, retention_days: Number(event.target.value) }))}><option value="30">30일</option><option value="90">90일</option><option value="365">1년</option><option value="1095">3년</option></select></label><p className="muted">기간이 지난 문장·음성 이력은 설정 저장 시 삭제됩니다.</p><button className="primary" disabled={privacyBusy === 'settings' || offline || !loaded} onClick={savePrivacySettings}>{privacyBusy === 'settings' ? '저장 중…' : '동의 및 기간 저장'}</button></article>
        <article className="support-access-manager"><h3>보호자·담당자 연결</h3>{privacyCaregivers.length ? <ul className="privacy-caregivers">{privacyCaregivers.map(item => <li key={item.supporter_id}><div className="support-link-heading"><span><strong>{item.name}</strong><small>{item.username} · {item.role === 'caregiver' ? '보호자' : '지원 담당자'}</small></span><button disabled={privacyBusy === item.supporter_id} onClick={() => removePrivacyCaregiver(item)}>연결 해제</button></div><div className="permission-options">{Object.entries(SUPPORT_PERMISSION_LABELS).map(([permission, label]) => <label key={permission}><input type="checkbox" checked={(supportPermissionDrafts[item.supporter_id] || item.permissions).includes(permission)} onChange={() => setSupportPermissionDrafts(current => ({ ...current, [item.supporter_id]: toggleSupportPermission(current[item.supporter_id] || item.permissions, permission) }))} />{label}</label>)}</div><button className="primary" disabled={privacyBusy === item.supporter_id || JSON.stringify(supportPermissionDrafts[item.supporter_id] || item.permissions) === JSON.stringify(item.permissions)} onClick={() => saveSupportPermissions(item)}>권한 저장</button></li>)}</ul> : <p className="muted">연결된 보호자나 담당자가 없습니다.</p>}<form className="privacy-connect" onSubmit={addPrivacyCaregiver}><label>보호자·담당자 아이디<input required maxLength="64" value={caregiverUsername} onChange={event => setCaregiverUsername(event.target.value)} /></label><fieldset><legend>부여할 권한</legend><div className="permission-options">{Object.entries(SUPPORT_PERMISSION_LABELS).map(([permission, label]) => <label key={permission}><input type="checkbox" checked={newSupportPermissions.includes(permission)} onChange={() => setNewSupportPermissions(current => toggleSupportPermission(current, permission))} />{label}</label>)}</div></fieldset><button className="primary" disabled={privacyBusy === 'caregiver' || !newSupportPermissions.length}>연결</button></form></article>
        <article><h3>연결 변경 이력</h3>{privacyAudit.length ? <ul className="privacy-audit">{privacyAudit.slice(0, 10).map(item => <li key={item.id}><span>{({ caregiver_connected: '보호자 연결', caregiver_disconnected: '보호자 연결 해제', support_granted: '지원 연결 및 권한 부여', support_permissions_changed: '지원 권한 변경', support_revoked: '지원 연결 해제', personal_data_deleted: '이용 데이터 삭제' })[item.action] || item.action}<small>처리자 {item.actor_id}</small></span><time>{new Date(item.created_at).toLocaleString('ko-KR')}</time></li>)}</ul> : <p className="muted">변경 이력이 없습니다.</p>}</article>
        <article className="privacy-data"><h3>다운로드와 삭제</h3><p>다운로드에는 계정 정보, 문장·음성 이력, 개인 카드와 현재 열람자가 포함됩니다. 이미지 원본과 비밀번호는 포함되지 않습니다.</p><div><button disabled={privacyBusy === 'export'} onClick={downloadPrivacyData}>{privacyBusy === 'export' ? '준비 중…' : '내 데이터 다운로드'}</button><button className="danger" disabled={privacyBusy === 'delete'} onClick={deletePrivacyData}>{privacyBusy === 'delete' ? '삭제 중…' : '이용 데이터 삭제'}</button></div><small>삭제하면 개인 카드, 의사소통·음성 기록, 보호자 연결, 프로필 이미지와 사용자 설정이 제거됩니다. 로그인 계정과 삭제 확인 기록은 유지됩니다.</small></article>
      </div>
      <DeletionReceipt receipt={privacy.deletion_receipt} />
      {localDeletionStatus && <p role="status">{localDeletionStatus === 'completed' ? '이 기기의 임시 기록 삭제 완료' : '기기 임시 기록 삭제 미완료 · 삭제 요청을 다시 실행해 주세요.'}</p>}
    </section></div> },
    ] : []),
    ...(isSupporter && !isCaregiver ? [{ id: 'support', label: '사용자·운영 설정', content: <section className="my-page-settings">
      <h3>연결 사용자 설정</h3><p>{selectedUser ? `${selectedUser.name}님의 설정으로 이동합니다.` : '지원 홈에서 연결 사용자를 먼저 선택해 주세요.'}</p>
      {canManageCards && <button onClick={() => navigateFromMyPage(() => openSupportSection('card_settings'))}>개인 카드 관리</button>}
      {(canManageQuick || canManageBoard) && <button onClick={() => navigateFromMyPage(() => openSupportSection('board_settings'))}>빠른 표현·카드판</button>}
      {canManageVoice && <button onClick={() => navigateFromMyPage(() => openSupportSection('support_settings'))}>음성·접근 설정</button>}
      {canManageLearning && <button onClick={() => navigateFromMyPage(() => openLearning(selectedUser))}>학습 설정</button>}
      {canManageBoard && <button onClick={() => navigateFromMyPage(() => setTab('rfid'))}><span aria-hidden="true"><UiIcon name="reader" /></span>RFID 카드판</button>}
      {!selectedUser && <button onClick={() => navigateFromMyPage(() => setTab('support_home'))}>지원 홈</button>}
      {(canManageContent || canManageAccounts) && <h3>운영 설정</h3>}
      {canManageContent && <><button onClick={() => navigateFromMyPage(() => setTab('admin'))}>공용 콘텐츠 운영</button>
        <button onClick={() => navigateFromMyPage(() => setTab('rfid_registration'))}><span aria-hidden="true"><UiIcon name="tag" /></span>RFID 칩 등록</button></>}
      {canManageAccounts && <button onClick={() => navigateFromMyPage(() => setTab('account_permissions'))}>운영 권한 관리</button>}
    </section> }] : []),
  ] : [];
  function openCatalog(value = '전체') {
    setCategory(value); setSearch(''); setTab('catalog');
  }
  function navigateFromMyPage(action) { setMyPageOpen(false); action(); }
  return <main ref={entryPageRef} className={`app${isCaregiver ? ' caregiver-ui' : ''}${sidebarCollapsed ? ' sidebar-collapsed' : ''} display-${accessibility.display_mode} card-size-${accessibility.card_size} text-size-${accessibility.text_size}${accessibility.reduced_motion ? ' reduced-motion' : ''}${accessibility.high_contrast ? ' high-contrast' : ''}`}>
    <a className="skip-link" href="#main-content">본문 바로가기</a>
    {compactSidebar && !sidebarCollapsed && <div className="sidebar-backdrop" aria-hidden="true" onClick={() => toggleSidebar(true)} />}
    <aside className="sidebar" id="app-sidebar" hidden={sidebarCollapsed} role={compactSidebar ? 'dialog' : undefined} aria-modal={compactSidebar && !sidebarCollapsed ? true : undefined} aria-label="주 메뉴">
      <div className="sidebar-heading"><div className="sidebar-brand"><Mascot className="mascot-brand" /><strong>{isCaregiver ? 'PECS MATE' : <>PECS <br />MATE</>}</strong></div><button ref={sidebarCloseRef} type="button" className="sidebar-toggle" aria-label="주 메뉴 접기" title="주 메뉴 접기" aria-controls="app-sidebar" aria-expanded="true" onClick={() => toggleSidebar(true)}><UiIcon name="menu" /></button></div>
      <nav aria-label="주 메뉴" onClickCapture={event => { const button = event.target.closest('button'); if (button && button.getAttribute('aria-current') !== 'page' && !confirmCaregiverLeave()) { event.preventDefault(); event.stopPropagation(); } }} onClick={event => { const button = event.target.closest('button:not(:disabled)'); if (button) { setMyPageOpen(false); if (compactSidebar && button.getAttribute('aria-controls') !== 'caregiver-management-menu') toggleSidebar(true); } }}>{isSupporter ? <>
        <button aria-current={!myPageOpen && tab === 'support_home' ? 'page' : undefined} className={!myPageOpen && tab === 'support_home' ? 'active' : ''} onClick={() => setTab('support_home')}><span aria-hidden="true"><UiIcon name="home" /></span>{isCaregiver ? '보호자 홈' : '지원 홈'}</button>
        {isCaregiver && <button aria-current={!myPageOpen && tab === 'caregiver_manage' ? 'page' : undefined}
          aria-expanded={caregiverManagementOpen} aria-controls="caregiver-management-menu"
          className={!myPageOpen && caregiverManagementOpen ? 'active' : ''}
          onClick={() => setTab('caregiver_manage')}><span aria-hidden="true"><UiIcon name="users" /></span>아이 관리<UiIcon name={caregiverManagementOpen ? 'chevron-down' : 'chevron-right'} /></button>}
        {(!isCaregiver || caregiverManagementOpen) && <div id={isCaregiver ? 'caregiver-management-menu' : undefined} className={isCaregiver ? 'caregiver-management-menu' : 'support-management-menu'} role="group" aria-label={isCaregiver ? '아이 관리 상세 메뉴' : '사용자 관리 메뉴'}>
        {canReadRecords && <button aria-current={!myPageOpen && tab === 'dashboard' ? 'page' : undefined} className={!myPageOpen && tab === 'dashboard' ? 'active' : ''} onClick={() => openSupportSection('dashboard')}><span aria-hidden="true"><UiIcon name="chart" /></span>의사소통 기록</button>}
        {canManageCards && <button aria-current={!myPageOpen && tab === 'card_settings' ? 'page' : undefined} className={!myPageOpen && tab === 'card_settings' ? 'active' : ''} onClick={() => openSupportSection('card_settings')}><span aria-hidden="true"><UiIcon name="cards" /></span>개인 카드 관리</button>}
        {(canManageQuick || canManageBoard) && <button aria-current={!myPageOpen && tab === 'board_settings' ? 'page' : undefined} className={!myPageOpen && tab === 'board_settings' ? 'active' : ''} onClick={() => openSupportSection('board_settings')}><span aria-hidden="true"><UiIcon name="grid" /></span>빠른 표현·카드판</button>}
        {canManageVoice && <button aria-current={!myPageOpen && tab === 'support_settings' ? 'page' : undefined} className={!myPageOpen && tab === 'support_settings' ? 'active' : ''} onClick={() => openSupportSection('support_settings')}><span aria-hidden="true"><UiIcon name="accessibility" /></span>음성·접근 설정</button>}
        {canManageLearning && <button aria-current={!myPageOpen && tab === 'learning_progress' ? 'page' : undefined} className={!myPageOpen && tab === 'learning_progress' ? 'active' : ''} onClick={() => openLearning(selectedUser)}><span aria-hidden="true"><UiIcon name="book" /></span>{isCaregiver ? '연습 관리' : '학습 기록'}</button>}
        {canManageBoard && <button aria-current={!myPageOpen && tab === 'rfid' ? 'page' : undefined} className={!myPageOpen && tab === 'rfid' ? 'active' : ''} onClick={() => setTab('rfid')}><span aria-hidden="true"><UiIcon name="reader" /></span>{isCaregiver ? '기기 연결' : 'RFID 카드판'}</button>}
        </div>}
        {canManageContent && <button aria-current={!myPageOpen && tab === 'admin' ? 'page' : undefined} className={!myPageOpen && tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}><span aria-hidden="true"><UiIcon name="check-square" /></span>공용 콘텐츠 운영<i aria-label={`승인 대기 ${adminSubmissions.filter(item => item.status === 'pending').length}개`}>{adminSubmissions.filter(item => item.status === 'pending').length}</i></button>}
        {canManageContent && <button aria-current={!myPageOpen && tab === 'rfid_registration' ? 'page' : undefined} className={!myPageOpen && tab === 'rfid_registration' ? 'active' : ''} onClick={() => setTab('rfid_registration')}><span aria-hidden="true"><UiIcon name="tag" /></span>RFID 칩 등록</button>}
        {canManageAccounts && <button aria-current={!myPageOpen && tab === 'account_permissions' ? 'page' : undefined} className={!myPageOpen && tab === 'account_permissions' ? 'active' : ''} onClick={() => setTab('account_permissions')}><span aria-hidden="true"><UiIcon name="key" /></span>운영 권한 관리</button>}
        </> : <>
        <button aria-current={!myPageOpen && tab === 'home' ? 'page' : undefined} className={!myPageOpen && tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}><span aria-hidden="true"><UiIcon name="home" /></span>홈</button>
        <button aria-current={!myPageOpen && tab === 'cards' ? 'page' : undefined} className={!myPageOpen && tab === 'cards' ? 'active' : ''} onClick={() => setTab('cards')}><span aria-hidden="true"><UiIcon name="message" /></span>그림으로 말하기</button>
        <button aria-current={!myPageOpen && tab === 'catalog' ? 'page' : undefined} className={!myPageOpen && tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}><span aria-hidden="true"><UiIcon name="cards" /></span>카드</button>
        <button aria-current={!myPageOpen && tab === 'practice' ? 'page' : undefined} className={!myPageOpen && tab === 'practice' ? 'active' : ''} onClick={() => openLearning(null)}><span aria-hidden="true"><UiIcon name="book" /></span>연습하기</button>
        </>}</nav>
      <AccountMenu key={user.id} user={user} buttonRef={accountButtonRef} disabled={busy} onLogout={handleLogout}
        onProfile={() => { stopSpeech(); setMyPageOpen(true); setProfileNotice(''); if (compactSidebar) toggleSidebar(true); }} />
    </aside>
    <div className={`app-content screen-${tab}`} id="main-content" tabIndex="-1" inert={compactSidebar && !sidebarCollapsed && !myPageOpen ? true : undefined}>
      {sidebarCollapsed && <div className="sidebar-toggle-bar"><button ref={sidebarOpenRef} type="button" className="sidebar-toggle"
        aria-label="주 메뉴 펼치기" title="주 메뉴 펼치기"
        aria-controls="app-sidebar" aria-expanded="false"
        onClick={() => toggleSidebar(false)}><UiIcon name="menu" /></button></div>}
      <div>
      {!myPageOpen && profileNotice && <p role="status">{profileNotice}</p>}
      <header className="topbar"><div><p className="eyebrow">오늘은 {todayLabel}</p><h1>{pageTitle}</h1></div><div className="topbar-statuses">{user.role === 'user' && loaded ? <details ref={connectionMenuRef} className="connection-menu" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
          <summary className="status" aria-label={`${usbConnectionLabel} · 연결 메뉴 열기`}><b className={usbConnected ? 'online' : ''} aria-hidden="true"></b><span className="connection-menu-label">{usbConnectionLabel}</span><UiIcon name="chevron-down" className="connection-menu-chevron" /></summary>
          <div className="connection-menu-panel"><div ref={setUsbTopbarTarget} className="topbar-usb-slot" />
          </div></details> : <span className={`status${offline ? ' offline' : ''}`}><b className={!offline && loaded ? 'online' : ''}></b>{offline ? '오프라인 사용 중' : '연결 대기'}</span>}<span className="visually-hidden" role="status">{speechActive ? speechStatusLabel : ''}</span>{speechActive && <div className="speech-player" role="group" aria-label="음성 재생 제어">{speechState.status === 'playing' && <button type="button" onClick={pauseSpeech}>일시 정지</button>}{speechState.status === 'paused' && <button type="button" onClick={resumeSpeech}>재개</button>}<button type="button" onClick={stopSpeech}>중지</button></div>}</div></header>
      {user.role === 'user' && tab === 'cards' && <>
      <section className="board" ref={boardRef}><div className="section-title"><h2 tabIndex="-1">나의 문장 <small>{board.length}/12</small></h2><div className="sentence-toolbar" role="group" aria-label="문장 도구">
        <button type="button" aria-label="고른 카드 모두 비우기" title="고른 카드 모두 비우기" disabled={!board.length || busy} onClick={() => { if (window.confirm('선택한 카드를 모두 지울까요?')) { rememberBoardFocus(0, 'remove'); updateBoard([]); } }}><UiIcon name="trash" size={24} /></button>
        <button type="button" className="primary" aria-label="고른 카드 말하기" title="고른 카드 말하기" disabled={!board.length} onClick={speakSelection}><UiIcon name="volume" size={24} /></button>
        <button type="button" aria-label={generating ? '문장 만드는 중' : generatedSessionId ? '문장 다시 만들어 말하기' : '문장 만들어 말하기'} title={!privacy.guardian_consent ? '문장 생성은 보호자 동의 후 사용할 수 있어요.' : offline ? '문장 생성은 온라인 연결이 필요해요.' : generating ? '문장 만드는 중' : generatedSessionId ? '문장 다시 만들어 말하기' : '문장 만들어 말하기'} aria-busy={generating} disabled={!board.length || busy || generating || speechActive || offline || !privacy.guardian_consent} onClick={() => generatedSessionId ? regenerate(true) : generate(true)}><UiIcon name="sparkles" size={24} /></button>
      </div></div>
        <SentenceStrip cards={board} renderPicture={cardPicture} onMove={move} onRemove={removeBoardCard} />
        {generating && <span className="visually-hidden" role="status">문장 만드는 중</span>}
      </section>
      </>}
      {canManageContent && <OperationalAlerts key={user.id} refreshKey={adminSubmissions} onReview={() => setTab('admin')} />}
      {offline && <p className="offline-notice" role="status">인터넷 연결 없이 저장된 카드를 사용 중입니다. 즉시 발화와 선택 카드 그대로 발화는 계속 사용할 수 있습니다.{localKoreanVoices.length ? ` 기기에 저장된 한국어 음성 ${localKoreanVoices.length}개를 확인했습니다.` : ' 한국어 음성이 재생되지 않으면 기기 설정에서 음성 데이터를 설치해 주세요.'}{pendingSyncCount ? ` 재연결 후 동기화할 이력 ${pendingSyncCount}건이 있습니다.` : ''}</p>}
      {user.role === 'user' && privacy.guardian_consent && !offline && (pendingSyncCount > 0 || syncState === 'failed') && <div className="offline-notice" data-testid="sync-status"><span role="status">{syncState === 'syncing' ? `기기에 저장한 기록 ${pendingSyncCount}건을 동기화하고 있어요.` : syncState === 'failed' ? `저장한 기록을 모두 전송하지 못했어요. 남은 ${pendingSyncCount}건은 기기에 보관됩니다.` : `동기화할 기록 ${pendingSyncCount}건이 기기에 있습니다.`}</span> <button type="button" disabled={syncState === 'syncing'} onClick={() => syncPendingEvents(user)}>기록 동기화 다시 시도</button></div>}
      {loaded && user.role === 'user' && <UsbRfidReader key={`rfid-${user.id}`} targetId={user.id} cards={cards} autoAppend
        connectionTarget={usbTopbarTarget} onStatus={setUsbStatus} onReadError={setError}
        appendScope={`${requestId}:${tab}:${myPageOpen}:${compactSidebar && !sidebarCollapsed}:${offline}`}
        disabled={busy || speechActive || offline || myPageOpen || (compactSidebar && !sidebarCollapsed) || !['home', 'cards'].includes(tab)}
        onAppend={selection => {
          if (busy || speechActive || offline || myPageOpen || (compactSidebar && !sidebarCollapsed) || !['home', 'cards'].includes(tab) || document.visibilityState === 'hidden') return false;
          const currentBoard = boardCardsRef.current;
          if (currentBoard.length + selection.length > 12) { setError('문장은 최대 12장입니다. 현재 문장을 정리한 뒤 카드를 다시 대주세요.'); return false; }
          setError('');
          updateBoard([...currentBoard, ...selection.map(card => ({ ...card, selected_at: new Date().toISOString() }))]);
          setTab('cards');
          return true;
        }} />}
      {user.role === 'user' && tab !== 'cards' && <section className="quick-speech" aria-labelledby="quick-speech-title" data-scan-group="quick-speech"><div><strong id="quick-speech-title">빠른 표현</strong></div>{quickExpressionCards.map(item => <button key={item.id} disabled={speechState.status === 'starting'} aria-label={`${item.label} 바로 말하기`} onClick={() => speakText(item.label, 'card', [item.id])}>{expressionVisual(item)}{item.label}</button>)}</section>}
      {tab === 'home' && user.role === 'user' && <HomeDashboard selectedCount={board.length}
        cards={cards} renderPicture={cardPicture}
        onSpeak={() => setTab('cards')} onPractice={() => openLearning(null)} />}
      {!myPageOpen && error && <div role="alert" className="error">{error} <button disabled={busy || generating || offline} onClick={() => generationFailed ? generate() : load(user)}>{generationFailed ? '문장 다시 만들기' : '다시 불러오기'}</button></div>}
      {speechFailure && <div role="alert" className="speech-error"><span aria-hidden="true"><UiIcon name="volume-off" /></span><div><strong>음성을 재생하지 못했어요.</strong><p>전달할 표현: <strong>{speechFailure.content}</strong></p><p>{speechFailureMessage(speechFailure.errorCode)} 선택한 카드와 문장은 그대로 유지됩니다.</p></div><div className="speech-error-actions">{speechFailure.retryable && <button className="primary" onClick={() => speakText(speechFailure.content, speechFailure.contentType, speechFailure.cardIds || [], '', speechFailure.playback)}>다시 재생</button>}<button onClick={() => setSpeechFailure(null)}>닫기</button></div></div>}
      {!loaded && !error && <p role="status">카드를 불러오는 중입니다…</p>}
      {isSupporter && selectedUser && ['dashboard', 'learning_progress'].includes(tab) && <SupportRecordTabs
        active={tab} permissions={selectedPermissions} variant={isCaregiver ? 'caregiver' : 'default'}
        onSelect={nextTab => { if (confirmCaregiverLeave()) { if (nextTab === 'dashboard') openSupportSection(nextTab); else openLearning(selectedUser); } }} />}
      {tab === 'rfid_registration' && canManageContent ? <RfidChipRegistration key={user.id} accountId={user.id} artStyle={artStyle} /> : tab === 'rfid' && isSupporter && canManageBoard && selectedUser ? <div>
        <label>{isCaregiver ? '아이 선택' : 'RFID 관리 사용자'}<select value={selectedUser.id} onChange={event => changeLinkedUser(event.target.value)}>
          {linkedUsers.filter(person => person.permissions.includes('board_manage')).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select></label>
        <RfidBoard key={`rfid-${user.id}-${selectedUser.id}-${canManageCards}`} targetId={selectedUser.id} targetName={selectedUser.name} variant={isCaregiver ? 'caregiver' : 'default'} manager canMap={canManageCards} />
      </div> : tab === 'support_home' && isCaregiver ? <A4SharingGallery key={`sharing-${user.id}`} accountId={user.id} disabled={offline} />
      : tab === 'caregiver_manage' && isCaregiver ? <CaregiverHome accountId={user.username || user.id} users={linkedUsers}
        target={selectedUser} offline={offline} onSelect={changeLinkedUser}
        onOpen={next => next === 'rfid' ? setTab('rfid') : openSupportSection(next)} onPractice={() => openLearning(selectedUser)}>
        {selectedUser && canManageLearning && canReadRecords && <PracticeSuggestionsPanel key={`${user.id}:${selectedUser.id}`} variant="caregiver" accountId={user.id} target={selectedUser} onDirectSelect={() => openLearning(selectedUser)} />}
      </CaregiverHome> : tab === 'support_home' && isSupporter ? <section className="support-home">
        <div className="support-home-panel">
        <div className="panel-heading"><span aria-hidden="true"><UiIcon name="users" /></span><div><h2>{user.role === 'caregiver' ? '보호자 지원 홈' : '담당자 지원 홈'}</h2><p className="muted">연결 사용자를 선택하면 부여된 권한 범위의 메뉴만 표시됩니다.</p></div></div>
        {linkedUsers.length ? <><label className="user-picker">지원할 사용자<select value={selectedUser?.id || ''} onChange={event => changeLinkedUser(event.target.value)}>{linkedUsers.map(person => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}</select></label>
          <div className="support-action-grid">
            {canReadRecords && <button onClick={() => openSupportSection('dashboard')}><span aria-hidden="true"><UiIcon name="chart" /></span><strong>의사소통 기록</strong><small>문장 저장·카드 사용 · 의사소통 기록 조회 권한</small></button>}
            {canManageCards && <button onClick={() => openSupportSection('card_settings')}><span aria-hidden="true"><UiIcon name="cards" /></span><strong>개인 카드 관리</strong><small>연결 사용자 전용 카드 등록과 수정</small></button>}
            {(canManageQuick || canManageBoard) && <button onClick={() => openSupportSection('board_settings')}><span aria-hidden="true"><UiIcon name="grid" /></span><strong>빠른 표현·카드판</strong><small>표현과 카드 위치를 사용자별로 고정</small></button>}
            {canManageVoice && <button onClick={() => openSupportSection('support_settings')}><span aria-hidden="true"><UiIcon name="accessibility" /></span><strong>음성·접근 설정</strong><small>목소리와 화면 표시 방식 조정</small></button>}
            {canManageLearning && <button onClick={() => openLearning(selectedUser)}><span aria-hidden="true"><UiIcon name="book" /></span><strong>학습 기록</strong><small>최근 30일 연습 참여·단어별 기록 · 학습 관리 권한</small></button>}
            {selectedPermissions.includes('notes_write') && <article><span aria-hidden="true"><UiIcon name="check" /></span><strong>{SUPPORT_PERMISSION_LABELS.notes_write}</strong><small>의사소통 기록 화면에서 사용할 수 있습니다.</small></article>}
          </div>
        </> : <EmptyState>연결된 사용자가 없습니다.</EmptyState>}
        </div>
        {selectedUser && canManageLearning && canReadRecords && <PracticeSuggestionsPanel key={`${user.id}:${selectedUser.id}`} accountId={user.id} target={selectedUser} onDirectSelect={() => openLearning(selectedUser)} />}
      </section> : tab === 'home' && user.role === 'user' ? null : tab === 'cards' && user.role === 'user' ? <div className="communication-layout">
      {!privacy.guardian_consent && <p className="recordless-notice" role="status">기록 없이 말하기 · 지금 고른 카드와 발화는 저장하지 않아요.</p>}
      <div className="workspace">
      <SpeakingCardLibrary key={`${user.id}:${privacy.guardian_consent}`} accountId={user.id} persistFavorites={privacy.guardian_consent}
        onRefresh={offline ? undefined : cardCatalog.refresh} refreshing={cardCatalog.refreshing} refreshNotice={cardCatalog.notice}
        cards={cards} categories={cardCategories} layout={boardLayout} recoveryCards={recoveryExpressions}
        renderPicture={cardPicture} hasPicture={card => Boolean(cardImage(card))} pageSize={accessibility.cards_per_page} busy={busy}
        renderCard={card => recoveryExpressions.some(item => item.id === card.id)
          ? <SpeakingCardTile card={card} renderArt={cardArt} compose={false} disabled={speechState.status === 'starting'} onSpeak={item => speakText(item.label, 'recovery')} />
          : tile(card)} />
      </div>
    </div> : tab === 'practice' && user.role === 'user' ? <section className="learning-hub">
      <div className="panel-heading"><span aria-hidden="true"><UiIcon name="book" /></span><div><h2>연습하기</h2>{user.role !== 'user' && <p className="muted">연습 결과는 실제 의사소통 기록과 섞이지 않고 따로 저장됩니다.</p>}</div></div>
      {learningBusy ? <p role="status">학습 정보를 불러오는 중입니다…</p> : learningGame?.phase === 'playing' || learningGame?.phase === 'saving' ? <article className="learning-game" aria-labelledby="learning-question-title">
        {learningGame.resumed && <p className="learning-resumed" role="status">저장된 문제부터 이어서 연습해요.</p>}
        <div className="learning-game-progress"><strong>{learningGame.questionIndex + 1} / {learningGame.questions.length}</strong><progress value={learningGame.questionIndex + (learningGame.feedback ? 1 : 0)} max={learningGame.questions.length} /><span>천천히 골라도 괜찮아요.</span></div>
        {currentLearningQuestion && (learningGame.activity_type === 'sentence_card_order' ? <SentenceOrderQuestion
          game={learningGame} question={currentLearningQuestion} artStyle={artStyle}
          onChange={changeLearningOrder} onAnswer={answerLearningQuestion} /> : <LearningQuestion key={`${learningGame.requestId}:${learningGame.questionIndex}`}
          game={learningGame} question={currentLearningQuestion} artStyle={artStyle}
          onAnswer={answerLearningQuestion} onListen={playLearningPrompt} />)}
        <div className={`learning-feedback ${learningGame.feedback || 'waiting'}`} role="status" aria-live="polite">{learningGame.feedback === 'correct' ? '잘 찾았어요! 다음 문제로 가 볼까요?' : learningGame.feedback === 'retry' ? (learningGame.activity_type === 'sentence_card_order' ? '괜찮아요. 카드를 빼고 예문의 순서로 다시 놓아 보세요.' : '괜찮아요. 다른 단어를 다시 골라 보세요.') : learningGame.feedback === 'incorrect' ? (learningGame.activity_type === 'sentence_card_order' ? `예문 순서는 ${currentLearningQuestion.sequence.map(card => card.label).join(' → ')}이에요. 천천히 다시 살펴봐요.` : `괜찮아요. 정답은 ${currentLearningQuestion?.target.label}이에요.`) : learningGame.activity_type === 'sentence_card_order' ? '카드를 놓은 뒤 순서 확인을 눌러 주세요.' : '정답을 골라 주세요.'}</div>
        {['correct', 'incorrect'].includes(learningGame.feedback) && <button className="primary learning-next" disabled={learningGame.phase === 'saving'} onClick={nextLearningQuestion}>{learningGame.phase === 'saving' ? '결과 저장 중…' : learningGame.questionIndex === learningGame.questions.length - 1 ? '연습 마치기' : '다음 문제'}</button>}
      </article> : learningGame?.phase === 'complete' ? <article className="learning-result"><span aria-hidden="true"><UiIcon name="star" size={40} /></span><h3>연습을 마쳤어요!</h3><p>{learningGame.activity_type === 'sentence_card_order' ? '처음 놓은 순서로 ' : '처음 선택으로 '}<strong>{learningGame.attempt?.correct_answers ?? learningGame.correctAnswers}</strong>{learningGame.activity_type === 'sentence_card_order' ? '개 문장을 완성했어요. ' : '개를 찾았어요. '}틀린 문제도 다시 살펴본 것이 중요한 연습이에요.</p>{learningGame.recordingDisabled ? <small>결과를 저장하지 않았습니다.</small> : learningGame.attempt?.pending_sync ? <small>결과를 기기에 저장했습니다. 온라인 연결 후 자동으로 동기화합니다.</small> : learningGame.attempt ? <small>학습 기록에만 안전하게 저장했습니다.</small> : <small>결과가 저장되지 않았습니다. 다시 연결한 뒤 한 번 더 연습해 주세요.</small>}<div><button onClick={() => setLearningGame(null)}>연습 목록</button><button className="primary" onClick={() => startLearningGame(learningGame.plan)}>같은 범위 다시 연습</button></div></article> : <PracticeOverview
        activity={practiceActivity} category={practiceCategory} categories={practiceCategories}
        situation={practiceSituation} onSituation={setPracticeSituation}
        settings={learningSettings} progress={learningProgress} plan={activePracticePlan}
        availableCount={availablePracticeCards().length}
        sentenceExampleCount={practiceActivity === 'sentence_card_order'
          ? availableSentenceExamples(availablePracticeCards()).length : 0}
        onActivity={id => { if (id !== practiceActivity) { setPracticeActivity(id); setPracticeCategory('all'); } }}
        onCategory={setPracticeCategory} onStart={() => startLearningGame()}
        onStartPlan={startPracticePlan} busy={learningBusy} offline={offline} />}
      <IconButton icon="message" label="말하기로 이동" className="primary communication-return" onClick={() => setTab('cards')} />
      {!learningGame && <LearningProgram key={`course-${user.id}`} accountId={user.id} targetId={user.id}
        disabled={offline || !privacy.guardian_consent} onStart={startLearningGame} />}
    </section> : tab === 'catalog' && user.role === 'user' ? <section className="card-catalog">
      <div className="catalog-toolbar">
        <div><h2>카드 보기</h2></div>
        <div className="catalog-actions"><input aria-label="카드 검색" placeholder="카드 이름 검색" value={search} onChange={event => setSearch(event.target.value)} /><button className="primary" onClick={() => { setEditingSubmission(null); setCardFormError(''); setShowCardForm(true); }}><UiIcon name="plus" />카드 등록</button></div>
      </div>
      <div className="categories" aria-label="카테고리">{['전체', ...cardCategories.map(item => item.name)].map(item => <button key={item} aria-pressed={category === item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
      <div className="catalog-layout">
        <div ref={catalogListRef} className="catalog-grid card-scroll-region" role="region" tabIndex="0" aria-label="카드 목록" onScroll={scrollCatalog}>{visibleCards.map(card => <div className="catalog-tile" key={card.id}><button type="button" className="catalog-card" disabled={busy} aria-pressed={selectedCard?.id === card.id} aria-label={`${card.label} 선택하고 말하기`} onClick={() => { setSelectedCard(card); speakText(card.label, 'card', [card.id]); }}>
          {cardArt(card)}
          <span><strong>{card.label}</strong></span>
        </button></div>)}</div>
        <aside className="card-detail" aria-live="polite">
          {selectedCard ? <>{cardArt(selectedCard, 'detail-art')}<span className="detail-category">{selectedCard.category}</span><h3>{selectedCard.label}</h3><div className="detail-actions"><button className="primary" onClick={() => { if (add(selectedCard)) setTab('cards'); }}>문장에 사용하기</button></div></> : <div className="detail-empty"><Mascot /><strong>카드를 선택해 주세요</strong></div>}
        </aside>
      </div>
      {cardSubmissions.length > 0 && <div className="submission-list"><ul>{cardSubmissions.map(item => <li key={item.id}><span><strong>{item.label}</strong><small>{item.category} · {item.sharing_notice || (item.visibility === 'private' ? '나만 사용' : '공개 요청')}</small></span><div className="submission-actions"><b className={`submission-status ${item.status}`}>{item.visibility === 'private' && item.status === 'approved' ? '나만 사용 중' : ({ draft: '작성 중', pending: '승인 대기', approved: '공개 승인', rejected: '반려', inactive: '비활성' })[item.status] || item.status}</b>{['draft', 'rejected'].includes(item.status) && <button disabled={reviewBusy === item.id} onClick={() => { setEditingSubmission(item); setCardFormError(''); setShowCardForm(true); }}>수정</button>}{item.status === 'draft' && <button className="primary" disabled={reviewBusy === item.id} onClick={() => submitDraft(item)}>{item.visibility === 'private' ? '나만 사용 시작' : '공개 승인 요청'}</button>}</div></li>)}</ul></div>}
      {loaded && !filteredCards.length && <EmptyState>조건에 맞는 카드가 없어요. 다른 검색어나 카테고리를 선택해 보세요.</EmptyState>}
      {showCardForm && <CardEditorDialog key={editingSubmission?.id || 'new-card'} editing={editingSubmission}
        categories={cardCategories} busy={cardFormBusy} error={cardFormError} onSubmit={submitCard}
        onClose={() => { setShowCardForm(false); setEditingSubmission(null); setCardFormError(''); }} />}
    </section> : tab === 'card_settings' && isSupporter && canManageCards ? <section className="card-catalog">
      <div className="caregiver-card-toolbar"><div className="catalog-toolbar"><div><h2>{selectedUser?.name}님의 개인 카드</h2></div><button className="primary" onClick={() => { setEditingSubmission(null); setCardFormError(''); setShowCardForm(true); }}><UiIcon name="plus" />개인 카드 등록</button></div>
      <label className="user-picker">{isCaregiver ? '아이 선택' : '관리 사용자'}<select value={selectedUser?.id || ''} onChange={event => changeLinkedUser(event.target.value)} disabled={cardFormBusy}>{linkedUsers.filter(person => person.permissions.includes('cards_manage')).map(person => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}</select></label></div>
      {selectedUser && <PhysicalCardImporter key={`physical-${user.id}:${selectedUser.id}`} targetId={selectedUser.id}
        categories={cardCategories} existingCards={[...cards, ...cardSubmissions]} disabled={offline || statsBusy || cardFormBusy}
        onSaved={() => loadSupportCards(selectedUser)} />}
      {user.role === 'caregiver' && selectedUser && <CardPrintEditor key={`print-${user.id}:${selectedUser.id}`}
        targetId={selectedUser.id} targetName={selectedUser.name} categories={cardCategories} existingCards={cardSubmissions}
        disabled={offline || statsBusy || cardFormBusy} onSaved={() => loadSupportCards(selectedUser)} />}
      {isCaregiver && <div className="caregiver-card-search"><label>카드 검색<input value={managedCardSearch} onChange={event => setManagedCardSearch(event.target.value)} placeholder="등록한 카드 이름" /></label>
        <label>분류<select value={managedCardCategory} onChange={event => setManagedCardCategory(event.target.value)}><option value="">모든 분류</option>{[...new Set(cardSubmissions.map(item => item.category))].map(name => <option key={name} value={name}>{name}</option>)}</select></label></div>}
      {isCaregiver && managedCardNotice?.targetId === selectedUser?.id && <div className="caregiver-save-result">
        <p role="status">{selectedUser.name}님의 ‘{managedCardNotice.label}’ 카드를 {managedCardNotice.draft ? '임시 저장했어요. 사용 시작 전에는 아이에게 표시되지 않아요.' : '저장했어요.'}</p>
        <button type="button" onClick={() => { setManagedCardSearch(''); setManagedCardCategory(''); requestAnimationFrame(() => {
          const target = document.getElementById(`managed-card-${managedCardNotice.id}`); target?.scrollIntoView({ block: 'center' }); target?.focus({ preventScroll: true });
        }); }}>등록한 카드 보기</button>
        {canManageBoard && <button type="button" onClick={() => openSupportSection('board_settings')}>카드판 관리로 이동</button>}
      </div>}
      {cardSubmissions.some(item => item.visibility === 'private') && <section className="private-card-photos" aria-label="개인 카드 사진 교체 목록">
        <h3>사진 교체</h3>
        <ul>{cardSubmissions.filter(item => item.visibility === 'private').map(item => <li key={`${user.id}:${selectedUser.id}:${item.id}`}>
          <span>{item.label}</span><CardPhotoReplacement card={item} targetId={selectedUser.id} disabled={offline || statsBusy || cardFormBusy}
            onReplaced={() => loadSupportCards(selectedUser)}
            onRefresh={() => loadSupportCards(selectedUser).catch(failure => setError(failure.message))} />
        </li>)}</ul>
      </section>}
      <div className="submission-list" id="managed-card-list"><h3>등록 카드</h3>{statsBusy ? <p role="status">카드를 불러오고 있어요.</p> : visibleManagedCards.length ? <ul>{visibleManagedCards.map(item => <li key={item.id} id={`managed-card-${item.id}`} tabIndex="-1"><span><strong>{item.label}</strong><small>{item.category}{!isCaregiver && <> · {item.sharing_notice || (item.visibility === 'private' ? '연결 사용자만 사용' : '공개 요청')}</>}</small></span><div className="submission-actions"><b className={`submission-status ${item.status}`}>{item.visibility === 'private' && item.status === 'approved' ? '사용 중' : ({ draft: '작성 중', pending: '승인 대기', approved: '공개 승인', rejected: '반려', inactive: '비활성' })[item.status] || item.status}</b>{['draft', 'rejected'].includes(item.status) && <button disabled={reviewBusy === item.id} onClick={() => { setEditingSubmission(item); setCardFormError(''); setShowCardForm(true); }}>수정</button>}{item.status === 'draft' && <button className="primary" disabled={reviewBusy === item.id} onClick={() => submitDraft(item)}>{item.visibility === 'private' ? '사용 시작' : '공개 승인 요청'}</button>}</div></li>)}</ul> : <div className="caregiver-card-empty"><UiIcon name="cards" size={44} /><strong>{cardSubmissions.length ? '검색 조건에 맞는 카드가 없어요.' : '등록된 개인 카드가 없습니다.'}</strong></div>}</div>
      {showCardForm && <CardEditorDialog key={`${selectedUser?.id}:${editingSubmission?.id || 'new-card'}`}
        editing={editingSubmission} categories={cardCategories} privateOnly targetName={selectedUser?.name}
        targetId={selectedUser?.id} ocrDisabled={offline || statsBusy}
        busy={cardFormBusy} error={cardFormError} onSubmit={submitCard}
        onClose={() => { setShowCardForm(false); setEditingSubmission(null); setCardFormError(''); }} />}
    </section> : tab === 'learning_progress' && isSupporter && canManageLearning ? <section className="learning-hub"
      role="tabpanel" id="support-record-panel-learning_progress" aria-labelledby="support-record-tab-learning_progress" tabIndex="0">
      <div className="panel-heading"><span aria-hidden="true"><UiIcon name="book" /></span><div><h2>{isCaregiver ? `${selectedUser?.name}님의 연습 관리` : '연결 사용자 학습 기록'}</h2><p className="muted">{selectedUser?.name} · 최근 30일 · 완료한 연습 기준 · 학습 기록 조회·설정 관리 권한</p></div></div>
      {isCaregiver ? <div className="caregiver-record-scope"><p>연습 설정과 최근 30일 연습 기록을 별도로 확인해요.</p><details><summary>기록 해석 안내</summary><p>연습 참여와 단어별 결과이며 문장 저장·카드 사용과 합산하지 않아요. 실제 상황의 의사소통 능력 평가나 진단이 아니에요.</p></details></div> : <p className="record-scope-note">연습 참여 횟수와 단어별 연습 결과만 표시합니다. 문장 저장·카드 사용 횟수에는 합산하지 않으며, 의사소통 능력의 평가나 진단이 아닙니다.</p>}
      {learningProgress && selectedUser && <RecordExport key={`learning-${user.id}-${selectedUser.id}`}
        domain="learning" variant={isCaregiver ? 'caregiver' : 'default'} targetId={selectedUser.id} days={30} disabled={offline || learningBusy} />}
      <label className="user-picker">{isCaregiver ? '아이 선택' : '조회 사용자'}<select value={selectedUser?.id || ''} onChange={event => changeLinkedUser(event.target.value)} disabled={learningBusy}>{linkedUsers.filter(person => person.permissions.includes('learning_manage')).map(person => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}</select></label>
      {selectedUser && canManageCards && <LearningProgram key={`course-${user.id}:${selectedUser.id}`} manager
        accountId={user.id} targetId={selectedUser.id} disabled={offline || learningBusy} />}
      {learningBusy ? <p role="status">학습 기록을 불러오는 중입니다…</p> : learningProgress && <div className="learning-overview-grid">
        <article><h3>{selectedUser?.name}님의 {isCaregiver ? '연습 설정' : '학습 설정'}</h3>{isCaregiver && supportSettingsNotice?.targetId === selectedUser?.id && <p role="status">{supportSettingsNotice.message}</p>}{learningSettings ? <form className="learning-settings-form" onSubmit={saveLearningConfiguration}><fieldset><legend>학습 카테고리</legend><div className="learning-category-options">{cardCategories.map(item => <label key={item.id}><input type="checkbox" checked={learningSettings.category_ids.includes(item.id)} onChange={event => updateLearningSetting({ category_ids: event.target.checked ? [...learningSettings.category_ids, item.id] : learningSettings.category_ids.filter(id => id !== item.id) })} />{item.name}</label>)}</div></fieldset><div className="learning-setting-fields"><label>문제 수<select value={learningSettings.question_count} onChange={event => updateLearningSetting({ question_count: Number(event.target.value) })}>{[5, 10, 15, 20, 30].map(value => <option key={value} value={value}>{value}개</option>)}</select></label><label>단어 보기 수<select value={learningSettings.option_count} onChange={event => updateLearningSetting({ option_count: Number(event.target.value) })}>{[2, 3, 4].map(value => <option key={value} value={value}>{value}개</option>)}</select></label><label>카드 반복<select value={learningSettings.repeat_frequency} onChange={event => updateLearningSetting({ repeat_frequency: Number(event.target.value) })}>{[1, 2, 3].map(value => <option key={value} value={value}>{value}회</option>)}</select></label><label>권장 시간<select value={learningSettings.time_limit_seconds} onChange={event => updateLearningSetting({ time_limit_seconds: Number(event.target.value) })}>{[30, 60, 120, 300, 600].map(value => <option key={value} value={value}>{value}초</option>)}</select></label></div><label className="privacy-check"><input type="checkbox" checked={learningSettings.retry_enabled} onChange={event => updateLearningSetting({ retry_enabled: event.target.checked })} />다른 보기를 다시 선택할 수 있게 해요</label><button className="primary" disabled={!learningSettings.category_ids.length}>{isCaregiver ? `${selectedUser?.name}님의 연습 설정 저장` : '학습 설정 저장'}</button></form> : <p className="muted">기본 학습 설정을 사용합니다.</p>}</article>
        <article className="learning-word-progress"><h3>{isCaregiver ? '최근 30일 연습 기록' : '최근 30일 학습 흐름'}</h3><div className="learning-metrics"><div><strong>{learningProgress?.attempts || 0}</strong><span>참여 횟수</span></div><div><strong>{learningProgress?.familiar_words?.length || 0}</strong><span>반복해서 만나본 단어</span></div><div><strong>{learningProgress?.repeat_words?.length || 0}</strong><span>다시 연습할 단어</span></div></div>{learningProgress?.last_completed_at ? <p className="muted">최근 참여 {new Date(learningProgress.last_completed_at).toLocaleString('ko-KR')}</p> : <p className="muted">아직 완료한 연습이 없습니다.</p>}<div className="learning-word-groups"><section><h4>반복해서 만나본 단어</h4>{learningProgress?.familiar_words?.length ? <ul>{learningProgress.familiar_words.map(item => <li key={item.card_id}><strong>{item.label}</strong><span>{item.practice_count}번 연습</span></li>)}</ul> : <p className="muted">두 번 이상 연습에서 첫 선택으로 찾은 기록입니다. 실제 상황에서의 이해나 의사소통 능력을 판단하지 않습니다.</p>}</section><section><h4>다시 만나볼 단어</h4>{learningProgress?.repeat_words?.length ? <ul>{learningProgress.repeat_words.map(item => <li key={item.card_id}><strong>{item.label}</strong><span>{item.needs_repeat_count}번 다시 살펴봐요</span></li>)}</ul> : <p className="muted">조금 더 연습할 단어가 없습니다.</p>}</section></div></article>
      </div>}
    </section> : tab === 'board_settings' && isSupporter && (canManageQuick || canManageBoard) ? <section className="board-settings-panel">
      <div className="panel-heading"><span aria-hidden="true"><UiIcon name="grid" /></span><div><h2>빠른 표현·카드판</h2></div></div>
      <label className="user-picker">{isCaregiver ? '아이 선택' : '설정 사용자'}<select value={selectedUser?.id || ''} onChange={event => changeLinkedUser(event.target.value)} disabled={statsBusy}>{linkedUsers.filter(person => person.permissions.some(permission => ['quick_speech_manage', 'board_manage'].includes(permission))).map(person => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}</select></label>
      <IconButton icon="refresh" label="저장된 카드판 다시 불러오기" disabled={offline || Boolean(boardConfigBusy) || statsBusy} onClick={() => { if (window.confirm('편집 내용을 버리고 저장된 카드판을 불러올까요?')) reloadBoardConfiguration(); }} />
      {boardConflict && <div className="error" role="alert" data-testid="board-conflict"><span>다른 기기에서 카드판을 변경했습니다. 현재 편집 내용은 화면에 남아 있으며 저장하지 않았습니다. 최신 구성을 불러오면 현재 편집 내용이 바뀝니다.</span><button type="button" disabled={Boolean(boardConfigBusy)} onClick={reloadBoardConfiguration}>최신 카드판 불러오기</button></div>}
      {boardLayout && boardLayout.user_id === selectedUser?.id && <fieldset className="board-config-workspace" aria-label="카드판 구성 편집" disabled={offline || Boolean(boardConfigBusy) || statsBusy || boardConflict}>
        <BoardConfiguration key={`board-editor-${user.id}-${selectedUser.id}`} layout={boardLayout} canManageQuick={canManageQuick} canManageBoard={canManageBoard}
          quick={quickDraft} recovery={recoveryDraft} slots={slotDraft} onQuick={setQuickDraft} onRecovery={setRecoveryDraft} onSlots={setSlotDraft}
          onSave={saveBoardConfiguration} busy={Boolean(boardConfigBusy) || statsBusy || offline || boardConflict} recoveryCards={RECOVERY_EXPRESSIONS} renderPicture={cardPicture}>
        {canManageBoard && selectedUser && <CoreCardLocks key={`${user.id}-${selectedUser.id}`} layout={boardLayout}
          targetId={selectedUser.id} disabled={offline || Boolean(boardConfigBusy) || statsBusy || boardConflict}
          onSaved={setBoardLayout} onRefresh={reloadBoardConfiguration} />}
        {canManageBoard && selectedUser && <SituationBoards key={`situations-${user.id}-${selectedUser.id}`} layout={boardLayout}
          targetId={selectedUser.id} disabled={offline || Boolean(boardConfigBusy) || statsBusy || boardConflict}
          onSaved={setBoardLayout} onRefresh={reloadBoardConfiguration} renderPicture={cardPicture} />}
        {user.role === 'caregiver' && canManageBoard && canReadRecords && selectedUser && boardLayout.user_id === selectedUser.id &&
          <BoardOrganizationSuggestions key={`organization-${user.id}-${selectedUser.id}`}
            layout={boardLayout} targetId={selectedUser.id}
            disabled={offline || Boolean(boardConfigBusy) || statsBusy || boardConflict}
            onSaved={setBoardLayout} onRefresh={reloadBoardConfiguration} renderPicture={cardPicture} />}
        </BoardConfiguration>
      </fieldset>}
      {canManageBoard && selectedUser && <SettingsDisclosure key={`board-recommendation-${user.id}-${selectedUser.id}`} label="추천 설정"><RecommendationSettings key={`${user.id}-${selectedUser.id}`}
        targetId={selectedUser.id} canReadRecords={canReadRecords} /></SettingsDisclosure>}
      <details className="board-extra-settings board-audit"><summary>최근 구성 변경</summary>{boardLayoutAudit.length ? <ul>{boardLayoutAudit.slice(0, 10).map(item => <li key={item.id}><span>{({ recovery_expressions_changed: '복구 표현 변경', quick_expressions_changed: '빠른 표현 변경', board_slots_changed: '카드 슬롯 변경', core_card_locks_changed: '핵심 카드 잠금 변경', recommendation_settings_changed: '추천 설정 변경' })[item.action] || item.action} · 변경자 {item.actor_id}</span><time>{new Date(item.created_at).toLocaleString('ko-KR')}</time></li>)}</ul> : <p className="muted">아직 변경 기록이 없습니다.</p>}</details>
    </section> : tab === 'support_settings' && isSupporter && canManageVoice ? <section className="support-settings-panel">
      <div className="panel-heading"><span aria-hidden="true"><UiIcon name="accessibility" /></span><div><h2>{isCaregiver ? `${selectedUser?.name}님의 아이 설정` : '음성·접근 설정'}</h2><p className="muted">{selectedUser?.name} 사용자에게 적용할 설정입니다.</p></div></div>
      <label className="user-picker">{isCaregiver ? '아이 선택' : '설정 사용자'}<select value={selectedUser?.id || ''} onChange={event => changeLinkedUser(event.target.value)} disabled={statsBusy}>{linkedUsers.filter(person => person.permissions.includes('voice_access_manage')).map(person => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}</select></label>
      {isCaregiver && supportSettingsNotice?.targetId === selectedUser?.id && <p role="status">{supportSettingsNotice.message}</p>}
      {isCaregiver && caregiverSettingsDirty && <p className="caregiver-unsaved" role="status">{selectedUser?.name}님의 변경 사항이 아직 저장되지 않았어요.</p>}
      <fieldset className="support-settings-fieldset" disabled={isCaregiver && (statsBusy || ttsSettingsBusy || accessibilityBusy)}><legend className="visually-hidden">아이 음성 및 화면 설정</legend>
      <div className="support-settings-grid">
        <article><h3>목소리 설정</h3>{isCaregiver && <p>이 영역의 저장 버튼은 {selectedUser?.name}님의 목소리에만 적용돼요.</p>}<div className="tts-settings-grid">
          <label>음성 느낌<select value={ttsSettings.preset} onChange={event => changeTtsPreset(event.target.value)}>{Object.entries(TTS_PRESETS).map(([value, preset]) => <option key={value} value={value}>{preset.label}</option>)}</select></label>
          <label>기기 한국어 음성<select value={ttsSettings.voiceName} onChange={event => updateTtsSettings({ voiceName: event.target.value })}><option value="">한국어 음성 자동 선택</option>{ttsVoices.map(voice => <option key={voice.voiceURI} value={voice.name}>{voice.name}{voice.localService === true ? ' · 기기 저장' : voice.localService === false ? ' · 온라인 음성' : ' · 오프라인 확인 필요'}</option>)}</select></label>
          <label>속도 <output>{ttsSettings.rate.toFixed(2)}배</output><input type="range" min="0.5" max="1.5" step="0.05" value={ttsSettings.rate} onChange={event => updateTtsSettings({ rate: Number(event.target.value) })} /></label>
          <label>음높이 <output>{ttsSettings.pitch.toFixed(2)}</output><input type="range" min="0.5" max="1.5" step="0.05" value={ttsSettings.pitch} onChange={event => updateTtsSettings({ pitch: Number(event.target.value) })} /></label>
          <label>기본 볼륨 <output>{Math.round(ttsSettings.volume * 100)}%</output><input type="range" min="0" max="1" step="0.05" value={ttsSettings.volume} onChange={event => updateTtsSettings({ volume: Number(event.target.value) })} /></label>
        </div><button className="primary" disabled={ttsSettingsBusy || ttsSettingsSaved} onClick={saveTtsSettings}>{ttsSettingsBusy ? '저장 중…' : ttsSettingsSaved ? '저장됨' : '목소리 저장'}</button></article>
        <article><h3>화면 접근 설정</h3>{isCaregiver && <p>화면 표시와 발화 방식은 여기에서 따로 저장해 주세요.</p>}<div className="support-access-fields">
          <label>시작 화면<select value={accessibility.start_screen} onChange={event => updateAccessibility({ start_screen: event.target.value })}><option value="home">홈</option><option value="cards">그림으로 말하기</option></select></label>
          <label>기본 발화 방식<select value={accessibility.output_mode} onChange={event => updateAccessibility({ output_mode: event.target.value })}><option value="selection">고른 카드 말하기</option><option value="word">단어 즉시 발화</option><option value="natural">자연스러운 문장 생성 사용</option></select></label>
          <label>카드 표시<select value={accessibility.display_mode} onChange={event => updateAccessibility({ display_mode: event.target.value })}><option value="image">그림 중심</option><option value="image_text">그림 + 글자</option><option value="text">글자 중심</option></select></label>
          <label>한 번에 불러올 카드 수<select value={accessibility.cards_per_page} onChange={event => updateAccessibility({ cards_per_page: Number(event.target.value) })}>{[6, 12, 18, 24, 30].map(value => <option key={value} value={value}>{value}개</option>)}</select></label>
          <label>카드 크기<select value={accessibility.card_size} onChange={event => updateAccessibility({ card_size: event.target.value })}><option value="small">작게</option><option value="medium">보통</option><option value="large">크게</option></select></label>
          <label>글자 크기<select value={accessibility.text_size} onChange={event => updateAccessibility({ text_size: event.target.value })}><option value="small">작게</option><option value="medium">보통</option><option value="large">크게</option></select></label>
          <label className="privacy-check"><input type="checkbox" checked={accessibility.reduced_motion} onChange={event => updateAccessibility({ reduced_motion: event.target.checked })} />애니메이션·장식 줄이기</label>
          <label className="privacy-check"><input type="checkbox" checked={accessibility.high_contrast} onChange={event => updateAccessibility({ high_contrast: event.target.checked })} />고대비 표시</label>
          <div className="support-access-preview" aria-label="설정 미리보기"><strong>미리보기 · {accessibility.start_screen === 'home' ? '홈' : '그림으로 말하기'}</strong>
            <div className={`preview-cards size-${accessibility.card_size} display-${accessibility.display_mode}`}>{Array.from({ length: Math.min(3, accessibility.cards_per_page) }, (_, index) => <span key={index}>{['물', '사과', '집'][index]}</span>)}</div>
            <small>한 페이지 {accessibility.cards_per_page}개 · {accessibility.output_mode === 'word' ? '단어 즉시 발화' : accessibility.output_mode === 'natural' ? '자연스러운 문장 생성 사용' : '고른 카드 말하기'}</small>
          </div>
        </div><button className="primary" disabled={accessibilityBusy || accessibilitySaved} onClick={saveAccessibility}>{accessibilityBusy ? '저장 중…' : accessibilitySaved ? '저장됨' : '접근 설정 저장'}</button></article>
      </div></fieldset>
    </section> : tab === 'account_permissions' && canManageAccounts ? <AccountPermissions key={user.id} accountId={user.id} onSessionExpired={handleLogout} /> : tab === 'admin' && canManageContent ? <AdminContentPage
      user={user} offline={offline} adminCategories={adminCategories} adminSubmissions={adminSubmissions}
      categoryError={categoryError} categoryBusy={categoryBusy} categoryEdits={categoryEdits}
      setCategoryEdits={setCategoryEdits} addCategory={addCategory} saveCategory={saveCategory}
      reviewDrafts={reviewDrafts} setReviewDrafts={setReviewDrafts} reviewBusy={reviewBusy}
      reviewCard={reviewCard} setAdminSubmissions={setAdminSubmissions} refreshAdminCards={refreshAdminCards}
    /> : tab === 'dashboard' && isSupporter && canReadRecords ? <section className="dashboard"
      role={isSupporter ? 'tabpanel' : undefined} id={isSupporter ? 'support-record-panel-dashboard' : undefined}
      aria-labelledby={isSupporter ? 'support-record-tab-dashboard' : undefined} tabIndex={isSupporter ? 0 : undefined}>
      <div className="panel-heading"><span aria-hidden="true"><UiIcon name="chart" /></span><div><h2>{isCaregiver ? `${selectedUser?.name}님의 의사소통 기록` : isSupporter ? '연결 사용자 의사소통 기록' : '나의 의사소통 기록'}</h2>{isSupporter && <p className="muted">{(selectedUser || user).name} · {period === 'all' ? '전체 기간' : `최근 ${period}일`} · 문장 저장 기준 · 의사소통 기록 조회 권한</p>}</div></div>
      {isCaregiver ? <div className="caregiver-record-scope"><p>저장한 문장과 그 안에 포함된 카드만 집계해요.</p><details><summary>집계 기준과 해석 안내</summary><p>연습 결과와 실제 음성 재생 성공 횟수는 이 지표에 포함하지 않아요. 기간 내 저장 기록이며 의도·이해도·능력 평가가 아니에요.</p></details></div> : isSupporter && <p className="record-scope-note">저장한 문장과 그 문장에 포함된 카드만 집계합니다. 연습 결과와 실제 음성 재생 성공 횟수는 이 지표에 포함하지 않습니다.</p>}
      <div className="caregiver-report-toolbar">{isSupporter && selectedUser && <div className="profile"><Avatar user={selectedUser} /><strong>{selectedUser.name}</strong></div>}
      {isSupporter && <label className="user-picker">{isCaregiver ? '아이 선택' : '조회 사용자'}<select value={selectedUser?.id || ''} onChange={event => changeLinkedUser(event.target.value)} disabled={statsBusy}>{linkedUsers.filter(person => person.permissions.includes('records_read')).map(person => <option key={person.id} value={person.id}>{person.name} ({person.username})</option>)}</select></label>}
      <div className="period-filter" aria-label="조회 기간">{[['7', '최근 7일'], ['30', '최근 30일'], ['all', '전체']].map(([value, label]) => <button key={value} className={period === value ? 'active' : ''} aria-pressed={period === value} disabled={statsBusy} onClick={() => changePeriod(value)}>{label}</button>)}</div></div>
      {isSupporter && stats && selectedUser && <RecordExport key={`communication-${user.id}-${selectedUser.id}-${period}`}
        domain="communication" variant={isCaregiver ? 'caregiver' : 'default'} targetId={selectedUser.id} days={period === 'all' ? null : Number(period)} disabled={offline || statsBusy} />}
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
        <div className="report-breakdown">
          <article><h3>카테고리별 사용</h3>{Object.entries(stats.categories).length ? Object.entries(stats.categories).map(([name, count]) => <div className="bar" key={name}><span>{name}</span><meter min="0" max={Math.max(stats.selections, 1)} value={count} /><strong>{count}회</strong></div>) : <p className="muted">저장된 카드 사용 기록이 없습니다.</p>}</article>
          <article><h3>자주 사용한 카드</h3>{stats.top_cards.length ? <ol className="report-card-ranking">{stats.top_cards.slice(0, 8).map((c, index) => <li key={c.id}><span className="report-rank">{index + 1}</span><strong>{c.symbol} {c.label}</strong><span>{c.count}회</span></li>)}</ol> : <p className="muted">자주 사용한 카드가 아직 없습니다.</p>}</article>
        </div>
        {isSupporter && <CardCombinations items={stats.top_combinations} />}
        {isSupporter && selectedUser && <CommunicationActivity key={`activity-${user.id}-${selectedUser.id}-${period}`}
          targetId={selectedUser.id} variant={isCaregiver ? 'caregiver' : 'default'} days={period === 'all' ? null : Number(period)}
          cards={{ ...CARD_META, ...Object.fromEntries(stats.top_cards.map(card => [card.id, card])) }} />}
        <h3>{isSupporter ? '최근 의사소통 타임라인' : '최근 문장'}</h3>{!stats.recent.length ? <EmptyState>선택한 기간에 기록이 없어요.</EmptyState> : <ul className="history">{stats.recent.map(r => <li key={r.id}>
          {isSupporter && <SessionDetails record={r} cardPicture={cardPicture} fallbackCards={CARD_META} />}<span>{r.sentence}</span>
          {!isSupporter && <time>{new Date(r.created_at).toLocaleString('ko-KR')}</time>}
          {isSupporter && canWriteNotes && <div className="caregiver-note">
            <textarea aria-label={`${r.sentence} 지원 메모`} maxLength="500" placeholder="관찰한 상황과 필요한 지원을 메모해 주세요" value={noteDrafts[r.id] ?? r.caregiver_note ?? ''}
              onChange={event => setNoteDrafts(current => ({ ...current, [r.id]: event.target.value }))} />
            <div><small>{(noteDrafts[r.id] ?? r.caregiver_note ?? '').length}/500</small><button disabled={noteBusy === r.id} onClick={() => saveCaregiverNote(r.id)}>메모 저장</button>
              {r.caregiver_note && <button disabled={noteBusy === r.id} onClick={() => removeCaregiverNote(r.id)}>삭제</button>}</div>
            <NoteHistory key={`${user.id}-${selectedUser.id}-${r.id}-${r.caregiver_note_details?.revision || 0}`}
              targetId={selectedUser.id} sessionId={r.id} details={r.caregiver_note_details} authorName={user.name} />
          </div>}
        </li>)}</ul>}</div>}
      </section> : <EmptyState>이 화면을 볼 수 있는 연결 권한이 없습니다. 지원 홈에서 사용자를 다시 선택해 주세요.</EmptyState>}
      {user.role !== 'user' && <footer>실행용 프로토타입 · 실제 개인정보를 입력하지 마세요.</footer>}
      </div>
      {myPageOpen && <AccountSettingsDialog key={user.id} name={user.name} sections={settingsSections}
        variant={isCaregiver ? 'caregiver' : 'default'}
        returnFocus={() => compactSidebar ? sidebarOpenRef.current : accountButtonRef.current}
        notice={profileNotice} error={error} onClose={() => setMyPageOpen(false)} />}
      {confirmation}
    </div>
  </main>;
}

export default App;
