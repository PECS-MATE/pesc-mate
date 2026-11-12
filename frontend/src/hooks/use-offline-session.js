import { useEffect, useState } from "react";
import { request, setToken } from "../services/api";
import { loadBoard } from "../services/boardStorage";

import { normalizeTtsSettings, normalizeAccessibility } from "../config/appDefaults";
import { CARD_IMAGE_URLS, hydrateImages, cacheableCards, restoreCachedCards } from "../services/cardMedia";

import { createOfflineSync } from "../services/offlineSync";
import { cacheLearningState, cacheSnapshot, cachedSnapshot, clearOfflineUserData, pendingLearningAttempts, pendingOfflineEvents } from "../services/offlineStore";

// State is allocated once at the App mount; role/page changes do not remount it.
export function useOfflineSessionState() {
  const [loaded, setLoaded] = useState(false);
  const [offlineSync] = useState(() => createOfflineSync());
  const [syncState, setSyncState] = useState('idle');
  const [offline, setOffline] = useState(!navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  return { loaded, setLoaded, offlineSync, syncState, setSyncState, offline, setOffline, pendingSyncCount, setPendingSyncCount };
}

export default function useOfflineSession({
  setPendingSyncCount, setCards, setCardCategories, setStats, setCardSubmissions, setBoard, setTtsSettings, setAccessibility, setAccessibilitySaved, setOutputMode, loaded, setTab, setPrivacy, setPrivacyCaregivers, setPrivacyAudit, setTtsSettingsSaved, setBoardLayout, setLoaded, setOffline, restoreLearningSession, user, activityConsentRef, activeUserRef, setSyncState, offlineSync, setLearningGame, setLearningProgress, learningSettings, setError, clearSupportTargetData, setLinkedUsers, setSelectedUser, setAdminSubmissions, setAdminCategories, setCategoryEdits, dashboardPath, setSupportPermissionDrafts, setUser
}) {
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
  return { updatePendingSyncCount, applyOfflineSnapshot, syncPendingEvents, primeOfflineAssets, load };
}

export function useNetworkSessionEvents({ setOffline, syncPendingEvents, user, load, clearSupportTargetData, setTab, setError }) {
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
}
