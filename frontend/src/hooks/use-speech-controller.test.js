import { afterEach, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import useSpeechController, { useCoreSpeechPreparation } from './use-speech-controller';
import * as api from '../services/api';

afterEach(() => vi.unstubAllEnvs());
function harness(offline = false) {
  const props = {
    ttsSettings: { preset: 'boy', rate: .9, pitch: 1.15, volume: 1 },
    user: { id: 'synthetic', role: 'user' }, privacy: { guardian_consent: false },
    lastSpeechTapRef: { current: { content: '', at: 0 } }, speechEventRef: { current: null },
    speechRunRef: { current: 0 }, selectionEventRef: { current: null },
    ttsVoices: [], offline, coreSpeechCache: { urlFor: vi.fn(() => 'blob:boy-water') },
    speechPlayback: { speak: vi.fn(), stop: vi.fn() }, setSpeechFailure: vi.fn(),
    setSpeechState: vi.fn(), makeActivity: vi.fn(() => null),
  };
  return { props, controller: useSpeechController(props) };
}

it('plays a saved card directly even when Qwen is the configured online provider', () => {
  vi.stubEnv('VITE_TTS_PROVIDER', 'qwen3-tts');
  const { props, controller } = harness();
  controller.speakText('물', 'card', ['water']);
  expect(props.coreSpeechCache.urlFor).toHaveBeenCalledWith('물', { online: true, voice: 'boy' });
  expect(props.speechPlayback.speak).toHaveBeenCalledWith(expect.objectContaining({ audioUrl: 'blob:boy-water', preferAudio: true, resolveAudio: null, rate: .9 }));
});

it('uses the selected child voice for urgent and recovery phrases', () => {
  const { props, controller } = harness();
  controller.speakText('도와주세요', 'quick');
  expect(props.coreSpeechCache.urlFor).toHaveBeenCalledWith('도와주세요', { online: true, voice: 'boy' });
});

it.each(['girl', 'boy'])('synthesizes a generated sentence using the selected local %s reference', async preset => {
  vi.stubEnv('VITE_TTS_PROVIDER', 'qwen3-tts');
  const fetchAudio = vi.spyOn(api, 'requestSpeechAudio').mockResolvedValue(new Blob(['synthetic']));
  const { props, controller } = harness();
  props.ttsSettings.preset = preset;
  controller.speakText('물을 마시고 싶어요.', 'sentence', ['water', 'drink']);
  const options = props.speechPlayback.speak.mock.calls[0][0];
  expect(props.coreSpeechCache.urlFor).not.toHaveBeenCalled();
  expect(options).toMatchObject({ preferAudio: true, audioUrl: null, allowSpeechFallback: false });
  const signal = new AbortController().signal;
  await options.resolveAudio(signal);
  expect(fetchAudio).toHaveBeenCalledWith('물을 마시고 싶어요.', .9, signal, preset);
});
it('uses cloud speech online rather than a clip from a different provider', () => {
  vi.stubEnv('VITE_TTS_PROVIDER', 'qwen-api');
  const { props, controller } = harness();
  controller.speakText('물', 'card', ['water']);
  expect(props.coreSpeechCache.urlFor).not.toHaveBeenCalled();
  expect(props.speechPlayback.speak).toHaveBeenCalledWith(expect.objectContaining({
    audioUrl: null, resolveAudio: expect.any(Function),
  }));
});

it('plays a stored learning card offline without requiring an installed device voice', () => {
  const { props, controller } = harness(true);
  const onError = vi.fn();
  controller.playLearningPrompt({ label: '물' }, { onError, onStart: vi.fn() });
  expect(onError).not.toHaveBeenCalled();
  expect(props.speechPlayback.speak).toHaveBeenCalledWith(expect.objectContaining({ audioUrl: 'blob:boy-water', preferAudio: true, resolveAudio: null }));
});

it('prepares the chosen voice again when the voice setting changes', () => {
  const prepare = vi.fn(async () => ({}));
  const base = { user: { id: 'synthetic', role: 'user' }, coreSpeechCache: { prepare }, offline: false };
  const hook = renderHook(({ preset }) => useCoreSpeechPreparation({ ...base, ttsSettings: { preset } }), { initialProps: { preset: 'girl' } });
  expect(prepare).toHaveBeenLastCalledWith({ online: true, voice: 'girl' });
  hook.rerender({ preset: 'boy' });
  expect(prepare).toHaveBeenLastCalledWith({ online: true, voice: 'boy' });
});
