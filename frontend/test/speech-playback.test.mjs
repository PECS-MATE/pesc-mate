import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpeechPlayback } from '../src/services/speechPlayback.js';

function setup(overrides = {}) {
  const utterances = [];
  const audioElements = [];
  const timers = new Map();
  let nextTimer = 0;
  const calls = [];
  class Utterance {
    constructor(text) { this.text = text; }
  }
  class Audio {
    constructor(src) {
      this.src = src;
      this.pauseCount = 0;
      this.playCount = 0;
      audioElements.push(this);
    }
    play() { this.playCount += 1; return this.playResult || Promise.resolve(); }
    pause() { this.pauseCount += 1; this.onpause?.(); }
  }
  const synthesis = {
    paused: false,
    speak: utterance => utterances.push(utterance),
    cancel: () => calls.push('cancel'),
    pause: () => { synthesis.paused = true; },
    resume: () => { synthesis.paused = false; },
  };
  const player = createSpeechPlayback({
    synthesis, Utterance, Audio,
    setTimer: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimer: id => timers.delete(id),
    ...overrides,
  });
  const events = [];
  const options = {
    text: '도와주세요', audioUrl: 'blob:help', volume: 0.6, rate: 0.9, pitch: 1.1,
    onStart: () => events.push('start'), onPause: () => events.push('pause'),
    onResume: () => events.push('resume'), onEnd: () => events.push('end'),
    onError: error => events.push(error),
  };
  const expire = () => {
    const pending = [...timers.values()];
    timers.clear();
    pending.forEach(callback => callback());
  };
  return { player, synthesis, options, events, calls, utterances, audioElements, timers, expire };
}

test('device speech uses settings and completes once without fallback', () => {
  const h = setup();
  const voice = { name: '한국어' };
  h.player.speak({ ...h.options, voice });
  const u = h.utterances[0];
  assert.equal(u.text, '도와주세요');
  assert.equal(u.lang, 'ko-KR');
  assert.equal(u.voice, voice);
  assert.deepEqual([u.rate, u.pitch, u.volume], [0.9, 1.1, 0.6]);
  const end = u.onend;
  u.onstart();
  end();
  end();
  assert.deepEqual(h.events, ['start', 'end']);
  assert.equal(h.audioElements.length, 0);
  assert.equal(h.timers.size, 0);
});

test('device error switches once to audio and ignores late device callbacks', () => {
  const h = setup();
  h.player.speak(h.options);
  const u = h.utterances[0];
  const oldStart = u.onstart;
  const oldEnd = u.onend;
  const oldError = u.onerror;
  oldError({ error: 'voice-unavailable' });
  oldStart(); oldEnd(); oldError({ error: 'voice-unavailable' });
  assert.equal(h.audioElements.length, 1);
  const audio = h.audioElements[0];
  assert.deepEqual([audio.volume, audio.playbackRate], [0.6, 0.9]);
  assert.deepEqual(h.events, []);
  audio.onplaying();
  audio.onended();
  assert.deepEqual(h.events, ['start', 'end']);
});

test('a throwing speech engine uses bundled audio', () => {
  const h = setup();
  h.synthesis.speak = () => { throw new Error('engine unavailable'); };
  h.player.speak(h.options);
  assert.equal(h.audioElements.length, 1);
  h.audioElements[0].onplaying();
  assert.deepEqual(h.events, ['start']);
});

test('hung speech and audio each time out without an endless fallback loop', () => {
  const h = setup();
  h.player.speak(h.options);
  h.expire();
  assert.equal(h.audioElements.length, 1);
  assert.deepEqual(h.events, []);
  h.expire();
  assert.deepEqual(h.events, ['start-timeout']);
  assert.equal(h.timers.size, 0);
  h.expire();
  assert.equal(h.audioElements.length, 1);
});

test('cancellation does not trigger fallback and uncached errors are reported', () => {
  const h = setup();
  h.player.speak(h.options);
  h.utterances[0].onerror({ error: 'interrupted' });
  assert.deepEqual(h.events, ['interrupted']);
  assert.equal(h.audioElements.length, 0);
  h.player.speak({ ...h.options, audioUrl: undefined });
  h.utterances[1].onerror({ error: 'voice-unavailable' });
  assert.deepEqual(h.events, ['interrupted', 'voice-unavailable']);
});

test('audio primary works without device TTS and only signals actual playback', async () => {
  const h = setup({ synthesis: null, Utterance: null });
  h.player.speak(h.options);
  await Promise.resolve();
  assert.deepEqual(h.events, []);
  const audio = h.audioElements[0];
  audio.onplaying();
  audio.onplaying();
  h.player.pause();
  h.player.resume();
  audio.onplaying();
  const end = audio.onended;
  end(); end();
  assert.deepEqual(h.events, ['start', 'pause', 'resume', 'end']);
  assert.equal(audio.playCount, 2);
  assert.equal(h.timers.size, 0);
});

test('preferAudio bypasses device TTS; missing bundled asset can use device voice', () => {
  const h = setup();
  h.player.speak({ ...h.options, preferAudio: true });
  assert.equal(h.utterances.length, 0);
  assert.equal(h.audioElements.length, 1);
  h.player.speak({ ...h.options, audioUrl: undefined, preferAudio: true });
  assert.equal(h.utterances.length, 1);
});

test('device pause and resume preserve a single start notification', () => {
  const h = setup();
  h.player.speak(h.options);
  const u = h.utterances[0];
  u.onstart();
  h.player.pause(); u.onpause();
  h.player.resume(); u.onresume();
  u.onend();
  assert.deepEqual(h.events, ['start', 'pause', 'resume', 'end']);
  assert.equal(h.timers.size, 0);
});

test('a hung device resume falls back to audio and reports resumed playback', () => {
  const h = setup();
  h.player.speak(h.options);
  h.utterances[0].onstart();
  h.player.pause();
  h.player.resume();
  h.expire();
  h.audioElements[0].onplaying();
  assert.deepEqual(h.events, ['start', 'pause', 'resume']);
  h.player.stop();
});

test('rejected initial audio playback reports permission error once', async () => {
  class RejectedAudio {
    play() { return Promise.reject({ name: 'NotAllowedError' }); }
    pause() {}
  }
  const h = setup({ Audio: RejectedAudio });
  h.player.speak({ ...h.options, preferAudio: true });
  await Promise.resolve();
  assert.deepEqual(h.events, ['not-allowed']);
  assert.equal(h.timers.size, 0);
});

test('rejected resume ends the audio run instead of leaving paused controls', async () => {
  const h = setup();
  h.player.speak({ ...h.options, preferAudio: true });
  const audio = h.audioElements[0];
  audio.onplaying();
  h.player.pause();
  audio.playResult = Promise.reject({ name: 'NotAllowedError' });
  h.player.resume();
  await Promise.resolve();
  assert.deepEqual(h.events, ['start', 'pause', 'not-allowed']);
  assert.equal(h.timers.size, 0);
});

test('stop invalidates delayed audio resolution and callbacks without completing a run', async () => {
  let resolvePlay;
  class DelayedAudio {
    constructor() { this.pauseCount = 0; }
    play() { return new Promise(resolve => { resolvePlay = resolve; }); }
    pause() { this.pauseCount += 1; }
  }
  const h = setup({ Audio: DelayedAudio });
  let audio;
  class CapturedAudio extends DelayedAudio {
    constructor() { super(); audio = this; }
  }
  const player = createSpeechPlayback({ Audio: CapturedAudio, synthesis: null, Utterance: null });
  player.speak(h.options);
  const playing = audio.onplaying;
  const ended = audio.onended;
  const error = audio.onerror;
  player.stop();
  playing(); ended(); error();
  resolvePlay();
  await Promise.resolve();
  assert.deepEqual(h.events, []);
  assert.ok(audio.pauseCount >= 2);
});

test('replacement ignores old callbacks and cancels old timers', () => {
  const h = setup();
  h.player.speak(h.options);
  const old = h.utterances[0];
  const callbacks = [old.onstart, old.onend, () => oldError({ error: 'network' })];
  const oldError = old.onerror;
  h.player.speak({ ...h.options, text: '그만' });
  callbacks.forEach(callback => callback());
  assert.deepEqual(h.events, []);
  assert.equal(h.audioElements.length, 0);
  assert.equal(h.timers.size, 1);
  h.utterances[1].onstart();
  h.player.stop();
  assert.deepEqual(h.events, ['start']);
  assert.equal(h.timers.size, 0);
});

test('old audio play resolution cannot pause or complete its replacement', async () => {
  const elements = [];
  class PendingAudio {
    constructor() { this.pauseCount = 0; elements.push(this); }
    play() { return new Promise(resolve => { this.resolvePlay = resolve; }); }
    pause() { this.pauseCount += 1; }
  }
  const h = setup({ Audio: PendingAudio });
  h.player.speak({ ...h.options, preferAudio: true });
  const old = elements[0];
  const oldPlaying = old.onplaying;
  h.player.speak({ ...h.options, text: '그만', audioUrl: 'blob:stop', preferAudio: true });
  const replacement = elements[1];
  old.resolvePlay();
  oldPlaying();
  await Promise.resolve();
  assert.equal(replacement.pauseCount, 0);
  assert.deepEqual(h.events, []);
  replacement.onplaying();
  replacement.onended();
  assert.deepEqual(h.events, ['start', 'end']);
});

test('unavailable engines fail explicitly and stop remains safe', () => {
  const h = setup({ synthesis: null, Utterance: null, Audio: null });
  h.player.speak(h.options);
  assert.deepEqual(h.events, ['audio-unavailable']);
  h.player.speak({ ...h.options, audioUrl: undefined });
  assert.deepEqual(h.events, ['audio-unavailable', 'unsupported']);
  h.player.pause(); h.player.resume(); h.player.stop();
});
