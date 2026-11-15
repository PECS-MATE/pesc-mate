import { cacheCoreSpeech, cachedCoreSpeech } from './offlineStore.js';

export const CARD_SPEECH_VERSION = 'v2';

export function validCardSpeechManifest(manifest) {
  return manifest?.version === CARD_SPEECH_VERSION && manifest.provider === 'qwen3-tts'
    && manifest.rate === 1 && typeof manifest.voice_version === 'string'
    && Array.isArray(manifest.voices) && manifest.voices.includes('girl') && manifest.voices.includes('boy')
    && Array.isArray(manifest.entries) && manifest.entries.length > 0 && manifest.entries.length <= 256
    && manifest.entries.every(entry => entry && typeof entry.text === 'string' && entry.text.length > 0
      && entry.text.length <= 100 && /^[a-z0-9_-]+\.wav$/.test(entry.file))
    && new Set(manifest.entries.map(entry => entry.text)).size === manifest.entries.length
    && new Set(manifest.entries.map(entry => entry.file)).size === manifest.entries.length;
}

async function isWave(blob) {
  if (!(blob instanceof Blob) || blob.size < 44 || blob.size > 1024 * 1024) return false;
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  return String.fromCharCode(...header.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...header.slice(8, 12)) === 'WAVE';
}

// Public vocabulary only. Voice buckets persist independently and never contain user text.
export function createCardSpeechCache({ catalog, read = cachedCoreSpeech, write = cacheCoreSpeech,
  fetchAsset = globalThis.fetch, createUrl = blob => URL.createObjectURL(blob),
  revokeUrl = url => URL.revokeObjectURL(url),
} = {}) {
  const buckets = new Map();
  const entries = validCardSpeechManifest(catalog) ? catalog.entries : [];
  let generation = 0;
  const voiceName = voice => ['boy', 'man'].includes(voice) ? 'boy' : 'girl';
  const assetUrl = (voice, entry) => `/audio/core/${CARD_SPEECH_VERSION}/${voice}/${entry.file}?voice=${encodeURIComponent(catalog.voice_version)}`;

  function bucketFor(voice) {
    if (!buckets.has(voice)) buckets.set(voice, { clips: new Map(), urls: new Map(), saved: new Set(), pending: null, online: false });
    return buckets.get(voice);
  }

  function status(bucket) {
    return { ready: bucket.clips.size, saved: bucket.saved.size, total: entries.length,
      status: entries.length && bucket.saved.size === entries.length ? 'ready' : bucket.clips.size ? 'partial' : 'unavailable' };
  }

  async function prepareVoice(voice, bucket, online, run) {
    const current = () => generation === run;
    const stored = await read(voice).catch(() => null);
    if (!current()) return status(bucket);
    if (stored?.manifest?.version === CARD_SPEECH_VERSION
      && stored.manifest.voice_version === catalog?.voice_version && stored.voice === voice) {
      for (const entry of entries) {
        const clip = Array.isArray(stored.clips) && stored.clips.find(item => item?.text === entry.text && item.file === entry.file);
        if (await isWave(clip?.blob)) {
          if (!current()) return status(bucket);
          bucket.clips.set(entry.text, clip); bucket.saved.add(entry.text);
        }
      }
    }
    const missing = entries.filter(entry => !bucket.clips.has(entry.text));
    let next = 0;
    async function worker() {
      while (current() && bucket.online && next < missing.length) {
        const entry = missing[next++];
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetchAsset(assetUrl(voice, entry), { signal: controller.signal, credentials: 'omit' });
          if (!response.ok) continue;
          const blob = await response.blob();
          if (await isWave(blob) && current()) bucket.clips.set(entry.text, { ...entry, blob: blob.slice(0, blob.size, 'audio/wav') });
        } catch { /* Retry missing clips on the next preparation; login never waits. */ }
        finally { clearTimeout(timer); }
      }
    }
    if (online || bucket.online) await Promise.all(Array.from({ length: Math.min(4, missing.length) }, worker));
    if (!current()) return status(bucket);
    if (bucket.clips.size > bucket.saved.size) {
      const clips = [...bucket.clips.values()];
      try {
        await write({ manifest: catalog, voice, clips }, voice);
        if (!current()) return status(bucket);
        clips.forEach(clip => bucket.saved.add(clip.text));
      } catch { /* Retain memory playback without claiming persistence. */ }
    }
    if (!current()) return status(bucket);
    for (const [text, clip] of bucket.clips) {
      if (!bucket.urls.has(text)) bucket.urls.set(text, createUrl(clip.blob));
    }
    return status(bucket);
  }

  return {
    prepare({ online = true, voice = 'girl' } = {}) {
      voice = voiceName(voice);
      const bucket = bucketFor(voice);
      bucket.online ||= online;
      if (bucket.pending) return bucket.pending;
      const run = generation;
      bucket.pending = prepareVoice(voice, bucket, online, run).finally(() => {
        if (generation === run) { bucket.pending = null; bucket.online = false; }
      });
      return bucket.pending;
    },
    urlFor(text, { online = true, voice = 'girl' } = {}) {
      voice = voiceName(voice);
      const cached = bucketFor(voice).urls.get(text);
      if (cached || !online) return cached;
      const entry = entries.find(item => item.text === text);
      return entry ? assetUrl(voice, entry) : undefined;
    },
    dispose() {
      generation += 1;
      for (const bucket of buckets.values()) bucket.urls.forEach(revokeUrl);
      buckets.clear();
    },
  };
}
