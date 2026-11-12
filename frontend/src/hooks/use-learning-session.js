import { situationQuestions } from "../services/situationLearning";

import { useEffect, useState } from "react";
import { request } from "../services/api";

import { LEARNING_ACTIVITIES, learningQuestions } from "../services/learningGame";

import { sentenceLearningQuestions, sentenceOrderMatches, validSentenceDraft, validSentenceQuestion } from "../services/sentenceLearning";

import { createRequestId } from "../services/requestId";

import { cardImage, cacheableLearningGame, restoreLearningCards } from "../services/cardMedia";

import { cacheLearningGame, cachedLearningGame, cacheLearningState, cachedLearningState, clearLearningGame, queueLearningAttempt } from "../services/offlineStore";

// State is allocated once at the App mount; role/page changes do not remount it.
export function useLearningSessionState() {
  const [learningDirty, setLearningDirty] = useState(false);
  const [learningSettings, setLearningSettings] = useState(null);
  const [learningProgress, setLearningProgress] = useState(null);
  const [learningBusy, setLearningBusy] = useState(false);
  const [practiceCategory, setPracticeCategory] = useState('all');
  const [practiceActivity, setPracticeActivity] = useState('word_picture_match');
  const [practiceSituation, setPracticeSituation] = useState('meal');
  const [learningGame, setLearningGame] = useState(null);
  const [activePracticePlan, setActivePracticePlan] = useState(null);
  return { learningDirty, setLearningDirty, learningSettings, setLearningSettings, learningProgress, setLearningProgress, learningBusy, setLearningBusy, practiceCategory, setPracticeCategory, practiceActivity, setPracticeActivity, practiceSituation, setPracticeSituation, learningGame, setLearningGame, activePracticePlan, setActivePracticePlan };
}

export default function useLearningSession({
  setError, setLearningSettings, setPracticeCategory, setPracticeActivity, setLearningGame, setTab, user, setLearningProgress, setLearningDirty, selectedUser, learningSettings, setLearningBusy, activeUserRef, selectedUserRef, setSupportSettingsNotice, loadSupportRecords, privacy, practiceCategory, cardCategories, cards, practiceActivity, practiceSituation, activePracticePlan, offline, updatePendingSyncCount, learningGame
}) {
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
  return { restoreLearningSession, loadLearning, updateLearningSetting, saveLearningConfiguration, openLearning, availablePracticeCards, startLearningGame, startPracticePlan, answerLearningQuestion, changeLearningOrder, finishLearningGame, nextLearningQuestion };
}

export function useActivePracticePlan({ user, tab, loaded, offline, privacy, setActivePracticePlan, activeUserRef }) {
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
}

export function useLearningCache({ user, privacy, learningGame, learningSettings, practiceCategory }) {
  useEffect(() => {
    if (user?.role !== 'user' || !privacy.guardian_consent || learningGame?.phase !== 'playing' || !learningSettings) return;
    cacheLearningGame(user.id, {
      game: cacheableLearningGame(learningGame),
      practice_category: practiceCategory,
      learning_settings: learningSettings,
      saved_at: new Date().toISOString(),
    }).catch(() => {});
  }, [user?.id, user?.role, privacy.guardian_consent, learningGame, practiceCategory, learningSettings]);
}
