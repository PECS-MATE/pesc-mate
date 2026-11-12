import { afterEach, expect, it, vi } from 'vitest';
import { createSpeechPlayback } from './speechPlayback';

const controllers = [];
afterEach(() => controllers.splice(0).forEach(controller => controller.stop()));
function harness() {
  const audios = [], utterances = [];
  class Audio {
    constructor() { audios.push(this); this.src = ''; this.play = vi.fn(async () => {}); this.pause = vi.fn(); }
    removeAttribute() { this.src = ''; }
  }
  class Utterance { constructor(text) { this.text = text; utterances.push(this); } }
  const synthesis = { cancel: vi.fn(), speak: vi.fn(), pause: vi.fn(), resume: vi.fn() };
  const createUrl = vi.fn(() => 'blob:synthetic'), revokeUrl = vi.fn();
  const controller = createSpeechPlayback({ Audio, Utterance, synthesis, createUrl, revokeUrl });
  controllers.push(controller);
  return { controller, audios, utterances, synthesis, createUrl, revokeUrl };
}
it('unlocks one audio element synchronously before requesting server speech', async () => {
  const { controller, audios } = harness();
  const resolveAudio = vi.fn(async () => {
    expect(audios).toHaveLength(1); expect(audios[0].play).toHaveBeenCalledTimes(1);
    return new Blob(['synthetic-wav']);
  });
  controller.speak({ text: '물', resolveAudio });
  expect(resolveAudio).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(audios[0].src).toBe('blob:synthetic'));
  expect(audios).toHaveLength(1); expect(audios[0].play).toHaveBeenCalledTimes(2);
});
it('aborts a replaced request and ignores its late audio response', async () => {
  const { controller, createUrl, audios } = harness();
  let resolve, signal;
  controller.speak({ text: 'old', resolveAudio: s => { signal = s; return new Promise(r => { resolve = r; }); } });
  controller.speak({ text: 'new', preferAudio: true, audioUrl: 'new.wav' });
  expect(signal.aborted).toBe(true);
  resolve(new Blob(['old'])); await Promise.resolve();
  expect(createUrl).not.toHaveBeenCalled(); expect(audios[0].src).toBe('new.wav');
});
it('reports actual playing, pauses/resumes and revokes the resolved URL on stop', async () => {
  const { controller, audios, revokeUrl } = harness();
  const onStart = vi.fn(), onPause = vi.fn(), onResume = vi.fn(), onEnd = vi.fn();
  controller.speak({ text: '물', resolveAudio: async () => new Blob(['wav']), onStart, onPause, onResume, onEnd });
  await vi.waitFor(() => expect(audios[0].src).toBe('blob:synthetic'));
  expect(onStart).not.toHaveBeenCalled(); audios[0].onplaying(); expect(onStart).toHaveBeenCalledTimes(1);
  controller.pause(); expect(onPause).toHaveBeenCalledTimes(1);
  controller.resume(); audios[0].onplaying(); expect(onResume).toHaveBeenCalledTimes(1);
  const staleEnd = audios[0].onended; controller.stop(); staleEnd();
  expect(onEnd).not.toHaveBeenCalled(); expect(revokeUrl).toHaveBeenCalledWith('blob:synthetic');
});
it.each([403, 429, 503])('keeps the existing server failure fallback policy for %s', async status => {
  const { controller, audios } = harness(), onError = vi.fn();
  controller.speak({ text: '물', audioUrl: 'bundled.wav', resolveAudio: async () => { throw Object.assign(new Error('failed'), { status }); }, onError });
  await Promise.resolve();
  if (status >= 429) expect(audios[0].src).toBe('bundled.wav');
  else expect(onError).toHaveBeenCalledWith('server-unavailable');
});
it('falls back from browser speech failure to bundled audio and reports startup timeout', () => {
  vi.useFakeTimers();
  const { controller, utterances, audios } = harness(), onError = vi.fn();
  controller.speak({ text: '물', audioUrl: 'bundled.wav', onError });
  utterances[0].onerror({ error: 'synthesis-failed' }); expect(audios[0].src).toBe('bundled.wav');
  vi.advanceTimersByTime(6000); expect(onError).toHaveBeenCalledWith('start-timeout');
});
