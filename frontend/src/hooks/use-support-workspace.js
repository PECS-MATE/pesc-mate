import { useEffect, useRef, useState } from "react";
import { request } from "../services/api";
import { clearBoard } from "../services/boardStorage";

import { DEFAULT_TTS_SETTINGS, normalizeTtsSettings, DEFAULT_ACCESSIBILITY, DEFAULT_PRIVACY } from "../config/appDefaults";
import { hydrateImages } from "../services/cardMedia";

import { clearOfflineUserData } from "../services/offlineStore";

// State is allocated once at the App mount; role/page changes do not remount it.
export function useSupportWorkspaceState() {
  const [showCardForm, setShowCardForm] = useState(false);
  const [cardSubmissions, setCardSubmissions] = useState([]);
  const [cardFormBusy, setCardFormBusy] = useState(false);
  const [cardFormError, setCardFormError] = useState('');
  const [managedCardSearch, setManagedCardSearch] = useState('');
  const [managedCardCategory, setManagedCardCategory] = useState('');
  const [managedCardNotice, setManagedCardNotice] = useState(null);
  const [supportSettingsNotice, setSupportSettingsNotice] = useState(null);
  const supportSettingsRequestRef = useRef(0);
  const [editingSubmission, setEditingSubmission] = useState(null);
  const [adminSubmissions, setAdminSubmissions] = useState([]);
  const [adminCategories, setAdminCategories] = useState([]);
  const [categoryEdits, setCategoryEdits] = useState({});
  const [categoryBusy, setCategoryBusy] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [reviewDrafts, setReviewDrafts] = useState({});
  const [reviewBusy, setReviewBusy] = useState('');
  const [stats, setStats] = useState(null);
  const [period, setPeriod] = useState('all');
  const [statsBusy, setStatsBusy] = useState(false);
  const [linkedUsers, setLinkedUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const selectedUserRef = useRef(null);
  selectedUserRef.current = selectedUser;
  const supportRecordRequestRef = useRef(0);
  const supportCardRequestRef = useRef(0);
  const [noteDrafts, setNoteDrafts] = useState({});
  const [noteBusy, setNoteBusy] = useState('');
  const [privacy, setPrivacy] = useState(DEFAULT_PRIVACY);
  const [privacyDraft, setPrivacyDraft] = useState(DEFAULT_PRIVACY);
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
  return { showCardForm, setShowCardForm, cardSubmissions, setCardSubmissions, cardFormBusy, setCardFormBusy, cardFormError, setCardFormError, managedCardSearch, setManagedCardSearch, managedCardCategory, setManagedCardCategory, managedCardNotice, setManagedCardNotice, supportSettingsNotice, setSupportSettingsNotice, supportSettingsRequestRef, editingSubmission, setEditingSubmission, adminSubmissions, setAdminSubmissions, adminCategories, setAdminCategories, categoryEdits, setCategoryEdits, categoryBusy, setCategoryBusy, categoryError, setCategoryError, reviewDrafts, setReviewDrafts, reviewBusy, setReviewBusy, stats, setStats, period, setPeriod, statsBusy, setStatsBusy, linkedUsers, setLinkedUsers, selectedUser, setSelectedUser, selectedUserRef, supportRecordRequestRef, supportCardRequestRef, noteDrafts, setNoteDrafts, noteBusy, setNoteBusy, privacy, setPrivacy, privacyDraft, setPrivacyDraft, privacyCaregivers, setPrivacyCaregivers, privacyAudit, setPrivacyAudit, privacyBusy, setPrivacyBusy, localDeletionStatus, setLocalDeletionStatus, caregiverUsername, setCaregiverUsername, newSupportPermissions, setNewSupportPermissions, supportPermissionDrafts, setSupportPermissionDrafts, boardLayout, setBoardLayout, boardLayoutAudit, setBoardLayoutAudit, quickDraft, setQuickDraft, recoveryDraft, setRecoveryDraft, slotDraft, setSlotDraft, boardConfigBusy, setBoardConfigBusy, boardConflict, setBoardConflict };
}

export default function useSupportWorkspace({
  caregiverSettingsDirty, supportRecordRequestRef, supportCardRequestRef, selectedUserRef, cardSubmissions, setLinkedUsers, setSelectedUser, setCardSubmissions, setStats, setNoteDrafts, setBoardLayout, setBoardLayoutAudit, setQuickDraft, setRecoveryDraft, setSlotDraft, setBoardConflict, setBoardConfigBusy, setLearningSettings, setLearningProgress, setLearningGame, setStatsBusy, setLearningBusy, setTtsSettings, setTtsSettingsSaved, setAccessibility, setAccessibilitySaved, period, selectedUser, user, setPeriod, setError, linkedUsers, activeUserRef, tab, setTab, setLearningDirty, setNoteBusy, supportSettingsRequestRef, setSupportSettingsNotice, boardConfigBusy, boardLayout, boardConflict, quickDraft, recoveryDraft, slotDraft, noteDrafts, stats, setPrivacyBusy, setPrivacy, privacyDraft, load, caregiverUsername, newSupportPermissions, setPrivacyCaregivers, setSupportPermissionDrafts, setCaregiverUsername, setPrivacyAudit, supportPermissionDrafts, stopSpeech, activityConsentRef, setBoard, setLocalDeletionStatus, isSupporter, setCardFormBusy, setCardFormError, editingSubmission, setShowCardForm, setEditingSubmission, setManagedCardSearch, setManagedCardCategory, setManagedCardNotice, setCategory, setSearch, setReviewBusy, setAdminSubmissions, askPassword, reviewDrafts, setCategoryBusy, setCategoryError, setAdminCategories, setCategoryEdits, categoryEdits
}) {
  function confirmCaregiverLeave() {
    return !caregiverSettingsDirty || window.confirm('저장하지 않은 아이 설정이 있어요. 저장하지 않고 이동할까요?');
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
  return { confirmCaregiverLeave, clearSupportTargetData, dashboardPath, changePeriod, changeLinkedUser, openSupportSection, loadSupportRecords, loadSupportSettings, loadSupportCards, loadBoardConfiguration, reloadBoardConfiguration, saveBoardConfiguration, saveCaregiverNote, removeCaregiverNote, savePrivacySettings, addPrivacyCaregiver, removePrivacyCaregiver, toggleSupportPermission, saveSupportPermissions, downloadPrivacyData, deletePrivacyData, submitCard, submitDraft, refreshAdminCards, performContentOperation, reviewCard, addCategory, saveCategory };
}

export function useSupportTargetReset({ setManagedCardSearch, setManagedCardCategory, setManagedCardNotice, setSupportSettingsNotice, setLearningDirty, selectedUser }) {
  useEffect(() => { setManagedCardSearch(''); setManagedCardCategory(''); setManagedCardNotice(null); setSupportSettingsNotice(null); setLearningDirty(false); }, [selectedUser?.id]);
}

export function usePrivacyDraft({ setPrivacyDraft, privacy, user }) {
  useEffect(() => { setPrivacyDraft({ guardian_consent: privacy.guardian_consent, retention_days: privacy.retention_days }); },
    [user?.id, privacy.guardian_consent, privacy.retention_days]);
}

export function useUnsavedSettingsWarning({ caregiverSettingsDirty }) {
  useEffect(() => {
    if (!caregiverSettingsDirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [caregiverSettingsDirty]);
}

export function useSupportAccessRevocation({ user, clearSupportTargetData, setTab, setError }) {
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
}
