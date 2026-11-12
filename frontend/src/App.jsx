import './assets/caregiverUx.css';
import CommunicatorPage from "./pages/CommunicatorPage";
import SupportWorkspacePage from "./pages/SupportWorkspacePage";

import Mascot from "./Mascot";
import { ProfileEditor } from "./Profile";
import AccountMenu from "./AccountMenu";
import AccountSettingsPanel from "./components/account-settings-panel";

import UiIcon from "./UiIcon";

import useSidebar from "./hooks/useSidebar";
import useCardScroll from "./hooks/useCardScroll";
import useLiveCardCatalog from "./hooks/useLiveCardCatalog";
import { CardArt, CardPicture, ExpressionVisual } from "./components/CardVisuals";

import HomeDashboard from "./HomeDashboard";
import LandingPage from "./LandingPage";
import OperationalAlerts from "./OperationalAlerts";

import SupportRecordTabs from "./SupportRecordTabs";


import UsbRfidReader from "./UsbRfidReader";

import useReauthentication from "./useReauthentication";
import { useRef, useState } from "react";

import SentenceStrip from "./SentenceStrip";
import { availableSentenceExamples } from "./services/sentenceLearning";
import { localKoreanVoices as installedKoreanVoices } from "./services/ttsVoice";

import { DEFAULT_QUICK_EXPRESSIONS, RECOVERY_EXPRESSIONS } from "./config/appDefaults";
import { hydrateImages } from "./services/cardMedia";

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

import { cacheAccountForOffline } from "./services/offlineAccount";

import useAuthSession, { useAuthSessionState, useAuthErrorFocus, useEntryFocus, useSessionSidebar, useSessionRestore, useSessionExpiry } from "./hooks/use-auth-session";
import useOfflineSession, { useOfflineSessionState, useNetworkSessionEvents } from "./hooks/use-offline-session";
import useSpeechController, { useSpeechControllerState, useCoreSpeechPreparation, useSpeechDeviceEvents } from "./hooks/use-speech-controller";
import useCommunication, { useCommunicationState, useUsbStatusReset, useBoardFocus, useConsentBoardCleanup, useActivityStream } from "./hooks/use-communication";
import useLearningSession, { useLearningSessionState, useActivePracticePlan, useLearningCache } from "./hooks/use-learning-session";
import useSupportWorkspace, { useSupportWorkspaceState, useSupportTargetReset, usePrivacyDraft, useUnsavedSettingsWarning, useSupportAccessRevocation } from "./hooks/use-support-workspace";
function App() {
  const { user, setUser, activeUserRef, authReady, setAuthReady, profileNotice, setProfileNotice, username, setUsername, password, setPassword, authMode, setAuthMode, authPanelRef, entryPageRef, name, setName, passwordConfirm, setPasswordConfirm, registrationConsent, setRegistrationConsent, error, setError, busy, setBusy } = useAuthSessionState();
  const { loaded, setLoaded, offlineSync, syncState, setSyncState, offline, setOffline, pendingSyncCount, setPendingSyncCount } = useOfflineSessionState();
  const { speechState, setSpeechState, speechFailure, setSpeechFailure, speechRunRef, speechEventRef, lastSpeechTapRef, speechPlayback, coreSpeechCache, ttsVoices, setTtsVoices, ttsSettings, setTtsSettings, ttsSettingsBusy, setTtsSettingsBusy, ttsSettingsSaved, setTtsSettingsSaved, accessibility, setAccessibility, accessibilityBusy, setAccessibilityBusy, accessibilitySaved, setAccessibilitySaved } = useSpeechControllerState();
  const { cards, setCards, cardCategories, setCardCategories, board, setBoard, boardCardsRef, boardRef, boardFocusRef, outputMode, setOutputMode, category, setCategory, search, setSearch, selectedCard, setSelectedCard, text, setText, generatedSessionId, setGeneratedSessionId, generationFailed, setGenerationFailed, generating, setGenerating, generationInFlightRef, sentenceContextRef, activityStreamRef, selectionEventRef, situation, setSituation, requestId, setRequestId, activityConsentRef } = useCommunicationState();
  const { learningDirty, setLearningDirty, learningSettings, setLearningSettings, learningProgress, setLearningProgress, learningBusy, setLearningBusy, practiceCategory, setPracticeCategory, practiceActivity, setPracticeActivity, practiceSituation, setPracticeSituation, learningGame, setLearningGame, activePracticePlan, setActivePracticePlan } = useLearningSessionState();
  const { showCardForm, setShowCardForm, cardSubmissions, setCardSubmissions, cardFormBusy, setCardFormBusy, cardFormError, setCardFormError, managedCardSearch, setManagedCardSearch, managedCardCategory, setManagedCardCategory, managedCardNotice, setManagedCardNotice, supportSettingsNotice, setSupportSettingsNotice, supportSettingsRequestRef, editingSubmission, setEditingSubmission, adminSubmissions, setAdminSubmissions, adminCategories, setAdminCategories, categoryEdits, setCategoryEdits, categoryBusy, setCategoryBusy, categoryError, setCategoryError, reviewDrafts, setReviewDrafts, reviewBusy, setReviewBusy, stats, setStats, period, setPeriod, statsBusy, setStatsBusy, linkedUsers, setLinkedUsers, selectedUser, setSelectedUser, selectedUserRef, supportRecordRequestRef, supportCardRequestRef, noteDrafts, setNoteDrafts, noteBusy, setNoteBusy, privacy, setPrivacy, privacyDraft, setPrivacyDraft, privacyCaregivers, setPrivacyCaregivers, privacyAudit, setPrivacyAudit, privacyBusy, setPrivacyBusy, localDeletionStatus, setLocalDeletionStatus, caregiverUsername, setCaregiverUsername, newSupportPermissions, setNewSupportPermissions, supportPermissionDrafts, setSupportPermissionDrafts, boardLayout, setBoardLayout, boardLayoutAudit, setBoardLayoutAudit, quickDraft, setQuickDraft, recoveryDraft, setRecoveryDraft, slotDraft, setSlotDraft, boardConfigBusy, setBoardConfigBusy, boardConflict, setBoardConflict } = useSupportWorkspaceState();
  const [myPageOpen, setMyPageOpen] = useState(false);
  const [usbSidebarTarget, setUsbSidebarTarget] = useState(null);
  const [usbStatus, setUsbStatus] = useState({ state: 'disconnected', fresh: false, count: 0 });
  const accountButtonRef = useRef(null);
  const {
    sidebarCollapsed, setSidebarCollapsed, compactSidebar,
    sidebarOpenRef, sidebarCloseRef, toggleSidebar,
  } = useSidebar({ authReady, accountId: user?.id, profileReady: Boolean(user?.profile) });
  const [tab, setTab] = useState('home');
  const cardCatalog = useLiveCardCatalog({ account: user, loaded, offline, tab, cards,
    categories: cardCategories, hydrateImages,
    onUpdate: (next, categories) => { setCards(next); setCardCategories(categories); } });
  const { askPassword, confirmation } = useReauthentication(`${user?.id || ''}:${tab}:${myPageOpen}`);
  const caregiverSettingsDirty = user?.role === 'caregiver' && ((tab === 'support_settings' && !statsBusy && (!ttsSettingsSaved || !accessibilitySaved))
    || (tab === 'learning_progress' && learningDirty)
    || (tab === 'board_settings' && boardLayout?.user_id === selectedUser?.id && !statsBusy
      && (JSON.stringify(quickDraft) !== JSON.stringify(boardLayout.quick_expression_ids)
        || JSON.stringify(recoveryDraft) !== JSON.stringify(boardLayout.recovery_expression_ids)
        || JSON.stringify(slotDraft) !== JSON.stringify(boardLayout.slots.map(slot => slot.card_id)))));
  const isSupporter = ['caregiver', 'support_staff'].includes(user?.role);
  const { openAuthentication, handleLogin, handleLogout } = useAuthSession({
    busy,
    authMode,
    setUsername,
    setPassword,
    setPasswordConfirm,
    setName,
    setRegistrationConsent,
    setAuthMode,
    setError,
    authPanelRef,
    password,
    passwordConfirm,
    setBusy,
    username,
    name,
    registrationConsent,
    setUser,
    setMyPageOpen,
    setProfileNotice,
    load: (...args) => load(...args),
    setAuthReady,
    confirmCaregiverLeave: (...args) => confirmCaregiverLeave(...args),
    setBoardConflict,
    setBoardConfigBusy,
    activeUserRef,
    stopSpeech: (...args) => stopSpeech(...args),
    user,
    setLoaded,
    setSyncState,
    setPendingSyncCount,
    cards,
    adminSubmissions,
    setCards,
    setCardCategories,
    setStats,
    setBoard,
    setCardSubmissions,
    setAdminSubmissions,
    setAdminCategories,
    setCategoryEdits,
    setCategoryError,
    setLinkedUsers,
    setSelectedUser,
    setBoardLayout,
    setBoardLayoutAudit,
    setQuickDraft,
    setRecoveryDraft,
    setSlotDraft,
    setLearningSettings,
    setLearningProgress,
    setLearningGame,
    setPracticeCategory,
    setText,
    setGeneratedSessionId,
    setGenerationFailed,
    setTab,
    setTtsSettings,
    setTtsSettingsSaved,
    setAccessibility,
    setAccessibilitySaved,
    setPrivacy,
    setPrivacyCaregivers,
    setPrivacyAudit,
    setSpeechFailure,
    setLocalDeletionStatus,
  });
  const { updatePendingSyncCount, applyOfflineSnapshot, syncPendingEvents, primeOfflineAssets, load } = useOfflineSession({
    setPendingSyncCount,
    setCards,
    setCardCategories,
    setStats,
    setCardSubmissions,
    setBoard,
    setTtsSettings,
    setAccessibility,
    setAccessibilitySaved,
    setOutputMode,
    loaded,
    setTab,
    setPrivacy,
    setPrivacyCaregivers,
    setPrivacyAudit,
    setTtsSettingsSaved,
    setBoardLayout,
    setLoaded,
    setOffline,
    restoreLearningSession: (...args) => restoreLearningSession(...args),
    user,
    activityConsentRef,
    activeUserRef,
    setSyncState,
    offlineSync,
    setLearningGame,
    setLearningProgress,
    learningSettings,
    setError,
    clearSupportTargetData: (...args) => clearSupportTargetData(...args),
    setLinkedUsers,
    setSelectedUser,
    setAdminSubmissions,
    setAdminCategories,
    setCategoryEdits,
    dashboardPath: (...args) => dashboardPath(...args),
    setSupportPermissionDrafts,
    setUser,
  });
  const { finishSpeechEvent, speechFailureMessage, speakText, speakBoardSentence, playLearningPrompt, speakSelection, pauseSpeech, resumeSpeech, stopSpeech, updateTtsSettings, changeTtsPreset, saveTtsSettings, updateAccessibility, saveAccessibility } = useSpeechController({
    persistActivity: (...args) => persistActivity(...args),
    activityConsentRef,
    activeUserRef,
    setError,
    ttsSettings,
    setSpeechFailure,
    lastSpeechTapRef,
    speechEventRef,
    user,
    privacy,
    makeActivity: (...args) => makeActivity(...args),
    selectionEventRef,
    text,
    generatedSessionId,
    setPendingSyncCount,
    setOffline,
    speechRunRef,
    ttsVoices,
    offline,
    coreSpeechCache,
    setSpeechState,
    speechPlayback,
    board,
    speechState,
    setTtsSettings,
    setTtsSettingsSaved,
    isSupporter,
    selectedUser,
    selectedUserRef,
    setTtsSettingsBusy,
    setSupportSettingsNotice,
    load: (...args) => load(...args),
    setAccessibility,
    setAccessibilitySaved,
    setAccessibilityBusy,
    accessibility,
  });
  const { makeActivity, persistActivity, updateBoard, add, move, rememberBoardFocus, removeBoardCard, generate, regenerate } = useCommunication({
    activeUserRef,
    activityConsentRef,
    situation,
    activityStreamRef,
    offline,
    updatePendingSyncCount: (...args) => updatePendingSyncCount(...args),
    setError,
    boardCardsRef,
    sentenceContextRef,
    stopSpeech: (...args) => stopSpeech(...args),
    selectionEventRef,
    setBoard,
    privacy,
    user,
    setText,
    setGeneratedSessionId,
    setGenerationFailed,
    setSpeechFailure,
    setRequestId,
    board,
    boardRef,
    boardFocusRef,
    generationInFlightRef,
    speechPlayback,
    speechRunRef,
    setGenerating,
    requestId,
    speakBoardSentence: (...args) => speakBoardSentence(...args),
    dashboardPath: (...args) => dashboardPath(...args),
    setStats,
    generatedSessionId,
    loaded,
    tab,
    myPageOpen,
    outputMode,
  });
  const { restoreLearningSession, loadLearning, updateLearningSetting, saveLearningConfiguration, openLearning, availablePracticeCards, startLearningGame, startPracticePlan, answerLearningQuestion, changeLearningOrder, finishLearningGame, nextLearningQuestion } = useLearningSession({
    setError,
    setLearningSettings,
    setPracticeCategory,
    setPracticeActivity,
    setLearningGame,
    setTab,
    user,
    setLearningProgress,
    setLearningDirty,
    selectedUser,
    learningSettings,
    setLearningBusy,
    activeUserRef,
    selectedUserRef,
    setSupportSettingsNotice,
    loadSupportRecords: (...args) => loadSupportRecords(...args),
    privacy,
    practiceCategory,
    cardCategories,
    cards,
    practiceActivity,
    practiceSituation,
    activePracticePlan,
    offline,
    updatePendingSyncCount: (...args) => updatePendingSyncCount(...args),
    learningGame,
  });
  const { confirmCaregiverLeave, clearSupportTargetData, dashboardPath, changePeriod, changeLinkedUser, openSupportSection, loadSupportRecords, loadSupportSettings, loadSupportCards, loadBoardConfiguration, reloadBoardConfiguration, saveBoardConfiguration, saveCaregiverNote, removeCaregiverNote, savePrivacySettings, addPrivacyCaregiver, removePrivacyCaregiver, toggleSupportPermission, saveSupportPermissions, downloadPrivacyData, deletePrivacyData, submitCard, submitDraft, refreshAdminCards, performContentOperation, reviewCard, addCategory, saveCategory } = useSupportWorkspace({
    caregiverSettingsDirty,
    supportRecordRequestRef,
    supportCardRequestRef,
    selectedUserRef,
    cardSubmissions,
    setLinkedUsers,
    setSelectedUser,
    setCardSubmissions,
    setStats,
    setNoteDrafts,
    setBoardLayout,
    setBoardLayoutAudit,
    setQuickDraft,
    setRecoveryDraft,
    setSlotDraft,
    setBoardConflict,
    setBoardConfigBusy,
    setLearningSettings,
    setLearningProgress,
    setLearningGame,
    setStatsBusy,
    setLearningBusy,
    setTtsSettings,
    setTtsSettingsSaved,
    setAccessibility,
    setAccessibilitySaved,
    period,
    selectedUser,
    user,
    setPeriod,
    setError,
    linkedUsers,
    activeUserRef,
    tab,
    setTab,
    setLearningDirty,
    setNoteBusy,
    supportSettingsRequestRef,
    setSupportSettingsNotice,
    boardConfigBusy,
    boardLayout,
    boardConflict,
    quickDraft,
    recoveryDraft,
    slotDraft,
    noteDrafts,
    stats,
    setPrivacyBusy,
    setPrivacy,
    privacyDraft,
    load: (...args) => load(...args),
    caregiverUsername,
    newSupportPermissions,
    setPrivacyCaregivers,
    setSupportPermissionDrafts,
    setCaregiverUsername,
    setPrivacyAudit,
    supportPermissionDrafts,
    stopSpeech: (...args) => stopSpeech(...args),
    activityConsentRef,
    setBoard,
    setLocalDeletionStatus,
    isSupporter,
    setCardFormBusy,
    setCardFormError,
    editingSubmission,
    setShowCardForm,
    setEditingSubmission,
    setManagedCardSearch,
    setManagedCardCategory,
    setManagedCardNotice,
    setCategory,
    setSearch,
    setReviewBusy,
    setAdminSubmissions,
    askPassword,
    reviewDrafts,
    setCategoryBusy,
    setCategoryError,
    setAdminCategories,
    setCategoryEdits,
    categoryEdits,
  });
  useUsbStatusReset({ setUsbStatus, user });
  useBoardFocus({ boardFocusRef, boardRef, board });
  useSupportTargetReset({ setManagedCardSearch, setManagedCardCategory, setManagedCardNotice, setSupportSettingsNotice, setLearningDirty, selectedUser });
  usePrivacyDraft({ setPrivacyDraft, privacy, user });
  useConsentBoardCleanup({ loaded, user, privacy });
  useUnsavedSettingsWarning({ caregiverSettingsDirty });
  useActivePracticePlan({ user, tab, loaded, offline, privacy, setActivePracticePlan, activeUserRef });
  useAuthErrorFocus({ authReady, user, error, authPanelRef });
  useEntryFocus({ authReady, entryPageRef, user });
  useSessionSidebar({ setSidebarCollapsed, user });
  useActivityStream({ activityStreamRef, selectionEventRef, setSituation, user });
  useSessionRestore({ setAuthReady, setUser, load, speechPlayback, coreSpeechCache });
  useCoreSpeechPreparation({ user, coreSpeechCache, offline });
  useSpeechDeviceEvents({ setTtsVoices, finishSpeechEvent, speechEventRef, speechRunRef, speechPlayback, setSpeechState });
  useNetworkSessionEvents({ setOffline, syncPendingEvents, user, load, clearSupportTargetData, setTab, setError });
  useSupportAccessRevocation({ user, clearSupportTargetData, setTab, setError });
  useSessionExpiry({ activeUserRef, handleLogout, user });
  useLearningCache({ user, privacy, learningGame, learningSettings, practiceCategory });
  
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
  const showPageHeading = user?.role !== 'user' || (tab === 'home' && !myPageOpen);
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
  
  function openCatalog(value = '전체') {
    setCategory(value); setSearch(''); setTab('catalog');
  }
  
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
      {user.role === 'user' && loaded && <details className="connection-menu sidebar-device-menu" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
        <summary className="status" aria-label={`${usbConnectionLabel} · 연결 메뉴 열기`}><UiIcon name="reader" /><span className="connection-menu-label">{usbConnectionLabel}</span><b className={usbConnected ? 'online' : ''} aria-hidden="true"></b><UiIcon name="chevron-down" className="connection-menu-chevron" /></summary>
        <div className="connection-menu-panel"><div ref={setUsbSidebarTarget} className="sidebar-usb-slot" /></div>
      </details>}
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
      <header className={`topbar${showPageHeading ? '' : ' topbar-controls-only'}`} >{showPageHeading && <div><p className="eyebrow">오늘은 {todayLabel}</p><h1>{pageTitle}</h1></div>}<div className="topbar-statuses">{user.role !== 'user' && <span className={`status${offline ? ' offline' : ''}`}><b className={!offline && loaded ? 'online' : ''}></b>{offline ? '오프라인 사용 중' : '연결 대기'}</span>}<span className="visually-hidden" role="status">{speechActive ? speechStatusLabel : ''}</span>{speechActive && <div className="speech-player" role="group" aria-label="음성 재생 제어">{speechState.status === 'playing' && <button type="button" onClick={pauseSpeech}>일시 정지</button>}{speechState.status === 'paused' && <button type="button" onClick={resumeSpeech}>재개</button>}<button type="button" onClick={stopSpeech}>중지</button></div>}</div></header>
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
        connectionTarget={usbSidebarTarget} onStatus={setUsbStatus} onReadError={setError}
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
      {isSupporter ? <SupportWorkspacePage tab={tab} canManageContent={canManageContent} user={user} isSupporter={isSupporter} canManageBoard={canManageBoard} selectedUser={selectedUser} isCaregiver={isCaregiver} changeLinkedUser={changeLinkedUser} linkedUsers={linkedUsers} canManageCards={canManageCards} cardCategories={cardCategories} offline={offline} setTab={setTab} openSupportSection={openSupportSection} openLearning={openLearning} canManageLearning={canManageLearning} canReadRecords={canReadRecords} canManageQuick={canManageQuick} canManageVoice={canManageVoice} selectedPermissions={selectedPermissions} setEditingSubmission={setEditingSubmission} setCardFormError={setCardFormError} setShowCardForm={setShowCardForm} cardFormBusy={cardFormBusy} cards={cards} cardSubmissions={cardSubmissions} statsBusy={statsBusy} loadSupportCards={loadSupportCards} managedCardSearch={managedCardSearch} setManagedCardSearch={setManagedCardSearch} managedCardCategory={managedCardCategory} setManagedCardCategory={setManagedCardCategory} managedCardNotice={managedCardNotice} setError={setError} visibleManagedCards={visibleManagedCards} reviewBusy={reviewBusy} submitDraft={submitDraft} showCardForm={showCardForm} editingSubmission={editingSubmission} cardFormError={cardFormError} submitCard={submitCard} learningProgress={learningProgress} learningBusy={learningBusy} supportSettingsNotice={supportSettingsNotice} learningSettings={learningSettings} saveLearningConfiguration={saveLearningConfiguration} updateLearningSetting={updateLearningSetting} boardConfigBusy={boardConfigBusy} reloadBoardConfiguration={reloadBoardConfiguration} boardConflict={boardConflict} boardLayout={boardLayout} quickDraft={quickDraft} recoveryDraft={recoveryDraft} slotDraft={slotDraft} setQuickDraft={setQuickDraft} setRecoveryDraft={setRecoveryDraft} setSlotDraft={setSlotDraft} saveBoardConfiguration={saveBoardConfiguration} cardPicture={cardPicture} setBoardLayout={setBoardLayout} boardLayoutAudit={boardLayoutAudit} caregiverSettingsDirty={caregiverSettingsDirty} ttsSettingsBusy={ttsSettingsBusy} accessibilityBusy={accessibilityBusy} ttsSettings={ttsSettings} changeTtsPreset={changeTtsPreset} updateTtsSettings={updateTtsSettings} ttsSettingsSaved={ttsSettingsSaved} saveTtsSettings={saveTtsSettings} accessibility={accessibility} updateAccessibility={updateAccessibility} accessibilitySaved={accessibilitySaved} saveAccessibility={saveAccessibility} canManageAccounts={canManageAccounts} handleLogout={handleLogout} adminCategories={adminCategories} adminSubmissions={adminSubmissions} categoryError={categoryError} categoryBusy={categoryBusy} categoryEdits={categoryEdits} setCategoryEdits={setCategoryEdits} addCategory={addCategory} saveCategory={saveCategory} reviewDrafts={reviewDrafts} setReviewDrafts={setReviewDrafts} reviewCard={reviewCard} setAdminSubmissions={setAdminSubmissions} refreshAdminCards={refreshAdminCards} period={period} changePeriod={changePeriod} stats={stats} loaded={loaded} canWriteNotes={canWriteNotes} noteDrafts={noteDrafts} setNoteDrafts={setNoteDrafts} noteBusy={noteBusy} saveCaregiverNote={saveCaregiverNote} removeCaregiverNote={removeCaregiverNote} /> : <CommunicatorPage tab={tab} user={user} privacy={privacy} offline={offline} cardCatalog={cardCatalog} cards={cards} cardCategories={cardCategories} boardLayout={boardLayout} recoveryExpressions={recoveryExpressions} cardPicture={cardPicture} accessibility={accessibility} busy={busy} cardArt={cardArt} speechState={speechState} speakText={speakText} setTab={setTab} learningBusy={learningBusy} learningGame={learningGame} currentLearningQuestion={currentLearningQuestion} changeLearningOrder={changeLearningOrder} answerLearningQuestion={answerLearningQuestion} playLearningPrompt={playLearningPrompt} nextLearningQuestion={nextLearningQuestion} setLearningGame={setLearningGame} startLearningGame={startLearningGame} practiceActivity={practiceActivity} practiceCategory={practiceCategory} practiceCategories={practiceCategories} practiceSituation={practiceSituation} setPracticeSituation={setPracticeSituation} learningSettings={learningSettings} learningProgress={learningProgress} activePracticePlan={activePracticePlan} availablePracticeCards={availablePracticeCards} setPracticeActivity={setPracticeActivity} setPracticeCategory={setPracticeCategory} startPracticePlan={startPracticePlan} search={search} setSearch={setSearch} setEditingSubmission={setEditingSubmission} setCardFormError={setCardFormError} setShowCardForm={setShowCardForm} category={category} setCategory={setCategory} catalogListRef={catalogListRef} scrollCatalog={scrollCatalog} visibleCards={visibleCards} selectedCard={selectedCard} setSelectedCard={setSelectedCard} add={add} cardSubmissions={cardSubmissions} reviewBusy={reviewBusy} submitDraft={submitDraft} loaded={loaded} filteredCards={filteredCards} showCardForm={showCardForm} editingSubmission={editingSubmission} cardFormBusy={cardFormBusy} cardFormError={cardFormError} submitCard={submitCard} outputMode={outputMode} />}
      {user.role !== 'user' && <footer>실행용 프로토타입 · 실제 개인정보를 입력하지 마세요.</footer>}
      </div>
      {myPageOpen && <AccountSettingsPanel key={user.id}
        user={user}
        profileSaved={profileSaved}
        setMyPageOpen={setMyPageOpen}
        accessibility={accessibility}
        updateAccessibility={updateAccessibility}
        accessibilityBusy={accessibilityBusy}
        accessibilitySaved={accessibilitySaved}
        saveAccessibility={saveAccessibility}
        ttsSettings={ttsSettings}
        changeTtsPreset={changeTtsPreset}
        updateTtsSettings={updateTtsSettings}
        busy={busy}
        ttsSettingsBusy={ttsSettingsBusy}
        offline={offline}
        speakText={speakText}
        ttsSettingsSaved={ttsSettingsSaved}
        saveTtsSettings={saveTtsSettings}
        privacy={privacy}
        privacyDraft={privacyDraft}
        privacyBusy={privacyBusy}
        loaded={loaded}
        setPrivacyDraft={setPrivacyDraft}
        savePrivacySettings={savePrivacySettings}
        privacyCaregivers={privacyCaregivers}
        removePrivacyCaregiver={removePrivacyCaregiver}
        supportPermissionDrafts={supportPermissionDrafts}
        setSupportPermissionDrafts={setSupportPermissionDrafts}
        toggleSupportPermission={toggleSupportPermission}
        saveSupportPermissions={saveSupportPermissions}
        addPrivacyCaregiver={addPrivacyCaregiver}
        caregiverUsername={caregiverUsername}
        setCaregiverUsername={setCaregiverUsername}
        newSupportPermissions={newSupportPermissions}
        setNewSupportPermissions={setNewSupportPermissions}
        privacyAudit={privacyAudit}
        downloadPrivacyData={downloadPrivacyData}
        deletePrivacyData={deletePrivacyData}
        localDeletionStatus={localDeletionStatus}
        isSupporter={isSupporter}
        isCaregiver={isCaregiver}
        selectedUser={selectedUser}
        canManageCards={canManageCards}
        openSupportSection={openSupportSection}
        canManageQuick={canManageQuick}
        canManageBoard={canManageBoard}
        canManageVoice={canManageVoice}
        canManageLearning={canManageLearning}
        openLearning={openLearning}
        setTab={setTab}
        canManageContent={canManageContent}
        canManageAccounts={canManageAccounts}
        compactSidebar={compactSidebar}
        sidebarOpenRef={sidebarOpenRef}
        accountButtonRef={accountButtonRef}
        profileNotice={profileNotice}
        error={error}
      />}
      {confirmation}
    </div>
  </main>;
}

export default App;
