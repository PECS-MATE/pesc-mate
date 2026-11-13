import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { request } from "../services/api";
import { clearBoard, saveBoard } from "../services/boardStorage";

import { createRequestId } from "../services/requestId";

import { clearLearningGame, queueOfflineEvent } from "../services/offlineStore";

// State is allocated once at the App mount; role/page changes do not remount it.
export function useCommunicationState() {
  const [cards, setCards] = useState([]);
  const [cardCategories, setCardCategories] = useState([]);
  const [board, setBoard] = useState([]);
  const boardCardsRef = useRef(board);
  const rfidBoardRevisionRef = useRef(0);
  boardCardsRef.current = board;
  const boardRef = useRef(null);
  const boardFocusRef = useRef(null);
  const [outputMode, setOutputMode] = useState('natural');
  const [category, setCategory] = useState('전체');
  const [search, setSearch] = useState('');
  const [selectedCard, setSelectedCard] = useState(null);
  const [text, setText] = useState('');
  const [generatedSessionId, setGeneratedSessionId] = useState('');
  const [generationFailed, setGenerationFailed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const generationInFlightRef = useRef(false);
  const sentenceContextRef = useRef('');
  const activityStreamRef = useRef({ id: createRequestId(), sequence: 0 });
  const selectionEventRef = useRef(null);
  const [situation, setSituation] = useState('unspecified');
  const [requestId, setRequestId] = useState(() => createRequestId());
  const activityConsentRef = useRef(false);
  return { cards, setCards, cardCategories, setCardCategories, board, setBoard, boardCardsRef, rfidBoardRevisionRef, boardRef, boardFocusRef, outputMode, setOutputMode, category, setCategory, search, setSearch, selectedCard, setSelectedCard, text, setText, generatedSessionId, setGeneratedSessionId, generationFailed, setGenerationFailed, generating, setGenerating, generationInFlightRef, sentenceContextRef, activityStreamRef, selectionEventRef, situation, setSituation, requestId, setRequestId, activityConsentRef };
}

export default function useCommunication({
  activeUserRef, activityConsentRef, situation, activityStreamRef, offline, updatePendingSyncCount, setError, boardCardsRef, sentenceContextRef, stopSpeech, selectionEventRef, setBoard, privacy, user, setText, setGeneratedSessionId, setGenerationFailed, setSpeechFailure, setRequestId, board, boardRef, boardFocusRef, generationInFlightRef, speechPlayback, speechRunRef, setGenerating, requestId, speakBoardSentence, dashboardPath, setStats, generatedSessionId, loaded, tab, myPageOpen, outputMode, rfidBoardRevisionRef, busy, speechState, compactSidebar, sidebarCollapsed, setTab, speakText
}) {
  activityConsentRef.current = user?.role === 'user' && privacy.guardian_consent;
  const sentenceContext = JSON.stringify([user?.id, user?.role, loaded, requestId, board.map(card => [card.id, card.selected_at]),
    tab, myPageOpen, outputMode, offline, privacy.guardian_consent]);
  sentenceContextRef.current = sentenceContext;
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
  function updateBoard(next, { source = 'manual' } = {}) {
    if (source !== 'rfid') rfidBoardRevisionRef.current += 1;
    boardCardsRef.current = next;
    // Invalidate pending generation before React commits the new selection.
    sentenceContextRef.current = '';
    stopSpeech();
    const activity = makeActivity('card_selection', next.map(card => card.id));
    selectionEventRef.current = activity?.event.id || null;
    persistActivity(activity);
    setBoard(next); if (privacy.guardian_consent) saveBoard(user?.id, next); setText(''); setGeneratedSessionId(''); setGenerationFailed(false); setSpeechFailure(null); setRequestId(createRequestId());
  }
  function appendRfidSelection(selection, { autoSpeak = false } = {}) {
    if (busy || speechState.status !== 'idle' || offline || myPageOpen || (compactSidebar && !sidebarCollapsed)
        || !['home', 'cards'].includes(tab) || document.visibilityState === 'hidden') return false;
    const currentBoard = boardCardsRef.current;
    if (currentBoard.length + selection.length > 12) {
      setError('문장은 최대 12장입니다. 현재 문장을 정리한 뒤 카드를 다시 대주세요.');
      return false;
    }
    const next = [...currentBoard, ...selection.map(card => ({ ...card, selected_at: card.selected_at || new Date().toISOString() }))];
    setError(''); updateBoard(next, { source: 'rfid' }); setTab('cards');
    if (autoSpeak) speakText(next.map(card => card.label).join(' '), 'sentence', next.map(card => card.id), '', { freshSelection: true });
    return true;
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
  return { makeActivity, persistActivity, updateBoard, appendRfidSelection, add, move, rememberBoardFocus, removeBoardCard, generate, regenerate };
}

export function useUsbStatusReset({ setUsbStatus, user }) {
  useEffect(() => { setUsbStatus({ state: 'disconnected', fresh: false, count: 0 }); }, [user?.id]);
}

export function useBoardFocus({ boardFocusRef, boardRef, board }) {
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
}

export function useConsentBoardCleanup({ loaded, user, privacy }) {
  useEffect(() => {
    if (loaded && user?.role === 'user' && !privacy.guardian_consent) {
      clearBoard(user.id); clearLearningGame(user.id).catch(() => {});
    }
  }, [loaded, user?.id, user?.role, privacy.guardian_consent]);
}

export function useActivityStream({ activityStreamRef, selectionEventRef, setSituation, user }) {
  useEffect(() => {
    activityStreamRef.current = { id: createRequestId(), sequence: 0 };
    selectionEventRef.current = null;
    setSituation('unspecified');
  }, [user?.id]);
}
