import { cacheCoreSpeech, cachedCoreSpeech } from './offlineStore.js';

export const CORE_SPEECH_VERSION = 'v1';
const ASSET_BASE = `/audio/core/${CORE_SPEECH_VERSION}/`;

function validManifest(manifest) {
  return manifest?.version === CORE_SPEECH_VERSION && Array.isArray(manifest.entries)
    && manifest.entries.length > 0 && manifest.entries.length <= 64
    && manifest.entries.every(entry => entry && typeof entry.text === 'string' && entry.text.length > 0
      && entry.text.length <= 100 && typeof entry.file === 'string'
      && /^[^/\\]+\.wav$/.test(entry.file) && !entry.file.includes('..'))
    && new Set(manifest.entries.map(entry => entry.text)).size === manifest.entries.length;
}

async function isWave(blob) {
  if (!(blob instanceof Blob) || blob.size < 44 || blob.size > 1024 * 1024) return false;
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WAVE';
}

export function createCoreSpeechCache({
  read = cachedCoreSpeech, write = cacheCoreSpeech, fetchAsset = globalThis.fetch,
  createUrl = blob => URL.createObjectURL(blob), revokeUrl = url => URL.revokeObjectURL(url),
} = {}) {
  let manifest = null;
  const clips = new Map();
  const urls = new Map();
  const saved = new Set();
  let pending = null;
  let generation = 0;

  function status() {
    const total = manifest?.entries.length || 0;
    return { ready: clips.size, saved: saved.size, total,
      status: total && saved.size === total ? 'ready' : clips.size ? 'partial' : 'unavailable' };
  }

  async function download(path, parse) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetchAsset(path, { signal: controller.signal, credentials: 'omit' });
      if (!response.ok) throw new Error('Core speech asset unavailable');
      return await parse(response);
    } finally { clearTimeout(timeout); }
  }

  async function prepareBundle(online, run) {
    const stored = await read().catch(() => null);
    if (run !== generation) return status();
    if (validManifest(stored?.manifest)) {
      manifest = stored.manifest;
      for (const entry of manifest.entries) {
        const clip = Array.isArray(stored.clips)
          ? stored.clips.find(item => item?.text === entry.text && item.file === entry.file) : null;
        if (await isWave(clip?.blob)) {
          if (run !== generation) return status();
          clips.set(entry.text, clip); saved.add(entry.text);
        }
      }
    }
    if (!manifest && online) {
      try {
        const fetched = await download(`${ASSET_BASE}manifest.json`, response => response.json());
        if (run !== generation) return status();
        if (validManifest(fetched)) manifest = fetched;
      } catch { /* A failed warm-up must not block login or device speech. */ }
    }
    if (!manifest || run !== generation) return status();
    if (online) {
      await Promise.all(manifest.entries.filter(entry => !clips.has(entry.text)).map(async entry => {
        try {
          const blob = await download(`${ASSET_BASE}${encodeURIComponent(entry.file)}`, response => response.blob());
          if (await isWave(blob) && run === generation) {
            clips.set(entry.text, { ...entry, blob: blob.slice(0, blob.size, 'audio/wav') });
          }
        } catch { /* Keep usable clips and retry missing files next time. */ }
      }));
    }
    if (run !== generation) return status();
    if (clips.size > saved.size) {
      try {
        const snapshot = [...clips.values()];
        await write({ manifest, clips: snapshot });
        if (run !== generation) return status();
        snapshot.forEach(clip => saved.add(clip.text));
      } catch { /* Memory playback still works; do not claim persistence. */ }
    }
    for (const [text, clip] of clips) {
      if (!urls.has(text)) urls.set(text, createUrl(clip.blob));
    }
    return status();
  }

  return {
    prepare({ online = true } = {}) {
      if (pending) return pending;
      const run = generation;
      pending = prepareBundle(online, run).finally(() => { if (run === generation) pending = null; });
      return pending;
    },
    urlFor(text) { return urls.get(text); },
    dispose() {
      generation += 1;
      pending = null;
      urls.forEach(revokeUrl);
      urls.clear(); clips.clear(); saved.clear(); manifest = null;
    },
  };
}
