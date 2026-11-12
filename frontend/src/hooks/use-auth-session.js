import { cacheAccountForOffline } from '../services/offlineAccount';
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { hasToken, request, setToken } from "../services/api";
import { clearBoard } from "../services/boardStorage";

import { DEFAULT_TTS_SETTINGS, DEFAULT_ACCESSIBILITY, DEFAULT_PRIVACY } from "../config/appDefaults";

import { cachedAccount, clearCachedAccount, clearOfflineUserData } from "../services/offlineStore";

// State is allocated once at the App mount; role/page changes do not remount it.
export function useAuthSessionState() {
  const [user, setUser] = useState(null);
  const activeUserRef = useRef(null);
  activeUserRef.current = user;
  const [authReady, setAuthReady] = useState(false);
  const [profileNotice, setProfileNotice] = useState('');
  const [username, setUsername] = useState('demo');
  const [password, setPassword] = useState('demo1234');
  const [authMode, setAuthMode] = useState('login');
  const authPanelRef = useRef(null);
  const entryPageRef = useRef(null);
  const [name, setName] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [registrationConsent, setRegistrationConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return { user, setUser, activeUserRef, authReady, setAuthReady, profileNotice, setProfileNotice, username, setUsername, password, setPassword, authMode, setAuthMode, authPanelRef, entryPageRef, name, setName, passwordConfirm, setPasswordConfirm, registrationConsent, setRegistrationConsent, error, setError, busy, setBusy };
}

export default function useAuthSession({
  busy, authMode, setUsername, setPassword, setPasswordConfirm, setName, setRegistrationConsent, setAuthMode, setError, authPanelRef, password, passwordConfirm, setBusy, username, name, registrationConsent, setUser, setMyPageOpen, setProfileNotice, load, setAuthReady, confirmCaregiverLeave, setBoardConflict, setBoardConfigBusy, activeUserRef, stopSpeech, user, setLoaded, setSyncState, setPendingSyncCount, cards, adminSubmissions, setCards, setCardCategories, setStats, setBoard, setCardSubmissions, setAdminSubmissions, setAdminCategories, setCategoryEdits, setCategoryError, setLinkedUsers, setSelectedUser, setBoardLayout, setBoardLayoutAudit, setQuickDraft, setRecoveryDraft, setSlotDraft, setLearningSettings, setLearningProgress, setLearningGame, setPracticeCategory, setText, setGeneratedSessionId, setGenerationFailed, setTab, setTtsSettings, setTtsSettingsSaved, setAccessibility, setAccessibilitySaved, setPrivacy, setPrivacyCaregivers, setPrivacyAudit, setSpeechFailure, setLocalDeletionStatus
}) {
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
  return { openAuthentication, handleLogin, handleLogout };
}

export function useAuthErrorFocus({ authReady, user, error, authPanelRef }) {
  useEffect(() => {
    if (authReady && !user && error) authPanelRef.current?.scrollIntoView?.({ block: 'start' });
  }, [authReady, user, error]);
}

export function useEntryFocus({ authReady, entryPageRef, user }) {
  useLayoutEffect(() => {
    if (authReady) entryPageRef.current?.scrollIntoView?.({ block: 'start' });
  }, [authReady, user?.id, Boolean(user?.profile)]);
}

export function useSessionSidebar({ setSidebarCollapsed, user }) {
  useEffect(() => { setSidebarCollapsed(false); }, [user?.id]);
}

export function useSessionRestore({ setAuthReady, setUser, load, speechPlayback, coreSpeechCache }) {
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
}

export function useSessionExpiry({ activeUserRef, handleLogout, user }) {
  useEffect(() => {
    const expireSupportSession = () => {
      if (['caregiver', 'support_staff'].includes(activeUserRef.current?.role)) handleLogout({ sessionExpired: true });
    };
    window.addEventListener('pesc-mate:session-expired', expireSupportSession);
    return () => window.removeEventListener('pesc-mate:session-expired', expireSupportSession);
  }, [user]);
}
