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
  startupTimeoutMs = 6000,
  createUrl = blob => URL.createObjectURL(blob),
  revokeUrl = url => URL.revokeObjectURL(url),
} = {}) {
  let current = null;
  let sharedAudio = null;
  let unlocking = false;

  function audioElement() {
    if (!sharedAudio && Audio) {
      sharedAudio = new Audio();
      sharedAudio.preload = 'auto';
      sharedAudio.playsInline = true;
    }
    return sharedAudio;
  }

  // Call directly in a click/touch handler, before a model/network await.
  // Reuse this same element for fallback clips; unlocking a different element is insufficient on iOS.
  function unlock() {
    if (current || unlocking || !Audio) return;
    let audio;
    try {
      audio = audioElement();
      const wave = new Uint8Array(444), view = new DataView(wave.buffer);
      for (const [offset, value] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) {
        [...value].forEach((char, index) => { wave[offset + index] = char.charCodeAt(0); });
      }
      view.setUint32(4, 436, true); view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 8000, true); view.setUint32(28, 8000, true);
      view.setUint16(32, 1, true); view.setUint16(34, 8, true); view.setUint32(40, 400, true);
      wave.fill(128, 44);
      audio.src = `data:audio/wav;base64,${btoa(String.fromCharCode(...wave))}`;
      audio.volume = 1;
      unlocking = true;
      Promise.resolve(audio.play()).catch(() => {}).finally(() => {
        unlocking = false;
        if (audio.src.startsWith('data:audio/wav;') && current?.media?.audio !== audio) audio.pause();
      });
    } catch { unlocking = false; /* Real playback still reports permission/device errors. */ }
  }

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
    media.controller?.abort();
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
    if (previous?.objectUrl) revokeUrl(previous.objectUrl);
  }

  function finish(run, media, error) {
    if (!active(run, media)) return;
    current = null;
    release(media);
    if (run.objectUrl) revokeUrl(run.objectUrl);
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
      const audio = audioElement();
      media.audio = audio;
      run.attemptedAudio = true;
      audio.src = run.options.audioUrl;
      audio.preload = 'auto';
      audio.volume = run.options.volume ?? 1;
      audio.playbackRate = run.objectUrl ? 1 : run.options.rate ?? 1;
      audio.onplaying = () => playing(run, media);
      audio.onpause = () => paused(run, media);
      audio.onended = () => finish(run, media);
      audio.onerror = () => audioFailed(run, media, 'audio-unavailable');
      playAudio(run, media);
    } catch (error) {
      audioFailed(run, media, playbackError(error, 'audio-unavailable'));
    }
  }

  function playAudio(run, media) {
    const audio = media.audio;
    watchStartup(run, media, error => audioFailed(run, media, error));
    try {
      Promise.resolve(audio.play()).then(() => {
        // play() can resolve after cancellation. Retire only that old element.
        if (!active(run, media) && current?.media?.audio !== audio) releaseAudio(audio);
      }, error => audioFailed(run, media, playbackError(error, 'audio-unavailable')));
    } catch (error) {
      audioFailed(run, media, playbackError(error, 'audio-unavailable'));
    }
  }

  function speechFailed(run, media, error) {
    if (!active(run, media)) return;
    if (run.options.audioUrl && !run.attemptedAudio && !CANCELLED_ERRORS.has(error)) startAudio(run);
    else finish(run, media, error);
  }

  function audioFailed(run, media, error) {
    if (!active(run, media)) return;
    if (run.options.allowSpeechFallback !== false && !run.attemptedSpeech && synthesis && Utterance && !CANCELLED_ERRORS.has(error)) {
      release(media); startSpeech(run);
    } else finish(run, media, error);
  }

  function speak(options) {
    stop();
    if (options.resolveAudio) unlock();
    const run = { options, media: null, status: 'starting', started: false };
    current = run;
    if (options.resolveAudio) {
      startResolvedAudio(run);
      return;
    }
    if (options.preferAudio || !synthesis || !Utterance) {
      if (options.audioUrl) startAudio(run);
      else if (!synthesis || !Utterance || options.allowSpeechFallback === false) {
        const media = { kind: 'none', timer: null };
        run.media = media;
        finish(run, media, 'unsupported');
      } else startSpeech(run);
    } else startSpeech(run);
  }

  async function startResolvedAudio(run) {
    const media = { kind: 'loading', controller: new AbortController() };
    run.media = media;
    try {
      const blob = await run.options.resolveAudio(media.controller.signal);
      if (!active(run, media)) return;
      run.objectUrl = createUrl(blob);
      run.options = { ...run.options, audioUrl: run.objectUrl };
      startAudio(run);
    } catch (error) {
      if (!active(run, media)) return;
      // Never mistake a failed server request for successful silent device speech.
      if (run.options.audioUrl && !error.status) startAudio(run);
      else if (run.options.audioUrl && error.status >= 429) startAudio(run);
      else finish(run, media, error.status === 429 ? 'server-busy' : 'server-unavailable');
    }
  }

  function startSpeech(run) {
    run.attemptedSpeech = true;
    const media = { kind: 'speech', utterance: null, timer: null };
    run.media = media;
    try {
      // A silent unlock clip may still own the audio session after async work.
      // Never run HTMLAudio and native speech together (notably on WebKit).
      if (sharedAudio) releaseAudio(sharedAudio);
      synthesis.cancel();
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

  return { speak, pause, resume, stop, unlock };
}
