import { useEffect, useRef, useState } from "react";
import { request, requestSpeechAudio } from "../services/api";

import { koreanVoices, selectTtsVoice } from "../services/ttsVoice";
import { createRequestId } from "../services/requestId";
import { TTS_PRESETS, DEFAULT_TTS_SETTINGS, normalizeTtsSettings, RECOVERY_EXPRESSIONS, DEFAULT_ACCESSIBILITY } from "../config/appDefaults";

import { createCoreSpeechCache } from "../services/coreSpeech";
import { createSpeechPlayback } from "../services/speechPlayback";

import { pendingOfflineEvents, queueOfflineEvent } from "../services/offlineStore";

// State is allocated once at the App mount; role/page changes do not remount it.
export function useSpeechControllerState() {
  const [speechState, setSpeechState] = useState({ status: 'idle', content: '' });
  const [speechFailure, setSpeechFailure] = useState(null);
  const speechRunRef = useRef(0);
  const speechEventRef = useRef(null);
  const lastSpeechTapRef = useRef({ content: '', at: 0 });
  const [speechPlayback] = useState(() => createSpeechPlayback());
  const [coreSpeechCache] = useState(() => createCoreSpeechCache());
  const [ttsVoices, setTtsVoices] = useState([]);
  const [ttsSettings, setTtsSettings] = useState(DEFAULT_TTS_SETTINGS);
  const [ttsSettingsBusy, setTtsSettingsBusy] = useState(false);
  const [ttsSettingsSaved, setTtsSettingsSaved] = useState(false);
  const [accessibility, setAccessibility] = useState(DEFAULT_ACCESSIBILITY);
  const [accessibilityBusy, setAccessibilityBusy] = useState(false);
  const [accessibilitySaved, setAccessibilitySaved] = useState(true);
  return { speechState, setSpeechState, speechFailure, setSpeechFailure, speechRunRef, speechEventRef, lastSpeechTapRef, speechPlayback, coreSpeechCache, ttsVoices, setTtsVoices, ttsSettings, setTtsSettings, ttsSettingsBusy, setTtsSettingsBusy, ttsSettingsSaved, setTtsSettingsSaved, accessibility, setAccessibility, accessibilityBusy, setAccessibilityBusy, accessibilitySaved, setAccessibilitySaved };
}

export default function useSpeechController({
  persistActivity, activityConsentRef, activeUserRef, setError, ttsSettings, setSpeechFailure, lastSpeechTapRef, speechEventRef, user, privacy, makeActivity, selectionEventRef, text, generatedSessionId, setPendingSyncCount, setOffline, speechRunRef, ttsVoices, offline, coreSpeechCache, setSpeechState, speechPlayback, board, speechState, setTtsSettings, setTtsSettingsSaved, isSupporter, selectedUser, selectedUserRef, setTtsSettingsBusy, setSupportSettingsNotice, load, setAccessibility, setAccessibilitySaved, setAccessibilityBusy, accessibility
}) {
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
  return { finishSpeechEvent, speechFailureMessage, speakText, speakBoardSentence, playLearningPrompt, speakSelection, pauseSpeech, resumeSpeech, stopSpeech, updateTtsSettings, changeTtsPreset, saveTtsSettings, updateAccessibility, saveAccessibility };
}

export function useCoreSpeechPreparation({ user, coreSpeechCache, offline }) {
  useEffect(() => {
    if (user?.role !== 'user') return;
    // Prepare fallback audio in the background; playback failures still have their own alert.
    coreSpeechCache.prepare({ online: !offline }).catch(() => {});
  }, [user?.id, user?.role, offline]);
}

export function useSpeechDeviceEvents({ setTtsVoices, finishSpeechEvent, speechEventRef, speechRunRef, speechPlayback, setSpeechState }) {
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
}
