const CANCELLED_ERRORS = new Set(['canceled', 'cancelled', 'interrupted']);

function playbackError(error, fallback) {
  if (typeof error === 'string') return error;
  if (typeof error?.error === 'string') return error.error;
  if (error?.name === 'NotAllowedError') return 'not-allowed';
  if (error?.name === 'AbortError') return 'interrupted';
  return fallback;
}

export function createSpeechPlayback({
  synthesis = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  Audio = globalThis.Audio,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  startupTimeoutMs = 2500,
} = {}) {
  let current = null;

  const active = (run, media) => current === run && run.media === media;

  function clearStartup(media) {
    if (media?.timer != null) clearTimer(media.timer);
    if (media) media.timer = null;
  }

  function releaseAudio(audio) {
    audio.onplaying = null;
    audio.onpause = null;
    audio.onended = null;
    audio.onerror = null;
    try { audio.pause(); } catch { /* A failed element must not block replacement. */ }
    try {
      if (audio.removeAttribute) audio.removeAttribute('src');
      else audio.src = '';
    } catch { /* Stale playback is already detached from the active run. */ }
  }

  function release(media) {
    if (!media) return;
    clearStartup(media);
    if (media.kind === 'audio' && media.audio) releaseAudio(media.audio);
    if (media.kind === 'speech') {
      if (media.utterance) {
        for (const event of ['onstart', 'onpause', 'onresume', 'onend', 'onerror']) {
          media.utterance[event] = null;
        }
      }
      try { synthesis?.cancel(); } catch { /* Cancellation is best effort. */ }
    }
  }

  function stop() {
    const previous = current;
    current = null;
    release(previous?.media);
  }

  function finish(run, media, error) {
    if (!active(run, media)) return;
    current = null;
    release(media);
    if (error) run.options.onError?.(error);
    else run.options.onEnd?.();
  }

  function playing(run, media) {
    if (!active(run, media)) return;
    clearStartup(media);
    const resumed = run.status === 'paused' || run.status === 'resuming';
    run.status = 'playing';
    if (!run.started) {
      run.started = true;
      run.options.onStart?.();
    } else if (resumed) run.options.onResume?.();
  }

  function paused(run, media) {
    if (!active(run, media) || run.status === 'paused') return;
    clearStartup(media);
    run.status = 'paused';
    run.options.onPause?.();
  }

  function watchStartup(run, media, fail) {
    clearStartup(media);
    media.timer = setTimer(() => {
      if (active(run, media)) fail('start-timeout');
    }, startupTimeoutMs);
  }

  function startAudio(run) {
    const previous = run.media;
    const media = { kind: 'audio', audio: null, timer: null };
    run.media = media;
    run.status = ['paused', 'resuming'].includes(run.status) ? 'resuming' : 'starting';
    release(previous);
    if (!run.options.audioUrl || !Audio) {
      finish(run, media, 'audio-unavailable');
      return;
    }
    try {
      const audio = new Audio(run.options.audioUrl);
      media.audio = audio;
      audio.preload = 'auto';
      audio.volume = run.options.volume ?? 1;
      audio.playbackRate = run.options.rate ?? 1;
      audio.onplaying = () => playing(run, media);
      audio.onpause = () => paused(run, media);
      audio.onended = () => finish(run, media);
      audio.onerror = () => finish(run, media, 'audio-unavailable');
      playAudio(run, media);
    } catch (error) {
      finish(run, media, playbackError(error, 'audio-unavailable'));
    }
  }

  function playAudio(run, media) {
    const audio = media.audio;
    watchStartup(run, media, error => finish(run, media, error));
    try {
      Promise.resolve(audio.play()).then(() => {
        // play() can resolve after cancellation. Retire only that old element.
        if (!active(run, media)) releaseAudio(audio);
      }, error => finish(run, media, playbackError(error, 'audio-unavailable')));
    } catch (error) {
      finish(run, media, playbackError(error, 'audio-unavailable'));
    }
  }

  function speechFailed(run, media, error) {
    if (!active(run, media)) return;
    if (run.options.audioUrl && !CANCELLED_ERRORS.has(error)) startAudio(run);
    else finish(run, media, error);
  }

  function speak(options) {
    stop();
    const run = { options, media: null, status: 'starting', started: false };
    current = run;
    if (options.preferAudio || !synthesis || !Utterance) {
      if (options.audioUrl) startAudio(run);
      else if (!synthesis || !Utterance) {
        const media = { kind: 'none', timer: null };
        run.media = media;
        finish(run, media, 'unsupported');
      } else startSpeech(run);
    } else startSpeech(run);
  }

  function startSpeech(run) {
    const media = { kind: 'speech', utterance: null, timer: null };
    run.media = media;
    try {
      const utterance = new Utterance(run.options.text);
      media.utterance = utterance;
      utterance.lang = 'ko-KR';
      utterance.rate = run.options.rate ?? 1;
      utterance.pitch = run.options.pitch ?? 1;
      utterance.volume = run.options.volume ?? 1;
      if (run.options.voice) utterance.voice = run.options.voice;
      utterance.onstart = () => playing(run, media);
      utterance.onpause = () => paused(run, media);
      utterance.onresume = () => playing(run, media);
      utterance.onend = () => finish(run, media);
      utterance.onerror = error => speechFailed(run, media, playbackError(error, 'speech-unavailable'));
      if (synthesis.paused) synthesis.resume();
      watchStartup(run, media, error => speechFailed(run, media, error));
      synthesis.speak(utterance);
    } catch (error) {
      speechFailed(run, media, playbackError(error, 'speech-unavailable'));
    }
  }

  function pause() {
    const run = current;
    if (!run || run.status !== 'playing') return;
    const media = run.media;
    try {
      if (media.kind === 'audio') media.audio.pause();
      else synthesis.pause();
      paused(run, media);
    } catch (error) {
      finish(run, media, playbackError(error, 'playback-unavailable'));
    }
  }

  function resume() {
    const run = current;
    if (!run || run.status !== 'paused') return;
    const media = run.media;
    run.status = 'resuming';
    if (media.kind === 'audio') playAudio(run, media);
    else {
      try {
        watchStartup(run, media, error => speechFailed(run, media, error));
        synthesis.resume();
      } catch (error) {
        speechFailed(run, media, playbackError(error, 'speech-unavailable'));
      }
    }
  }

  return { speak, pause, resume, stop };
}
