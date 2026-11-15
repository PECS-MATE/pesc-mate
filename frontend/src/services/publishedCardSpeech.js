import { createCoreSpeechCache } from './coreSpeech.js';
import { createCardSpeechCache, validCardSpeechManifest } from './cardSpeech.js';

// A clone without a generated pack keeps its working legacy speech until publication.
export function createPublishedCardSpeechCache({ fetchAsset = globalThis.fetch,
  fallback = createCoreSpeechCache(), createCache = catalog => createCardSpeechCache({ catalog, fetchAsset }),
} = {}) {
  let published = null, pending = null, generation = 0;
  async function loadCatalog() {
    if (published) return published;
    if (pending) return pending;
    const run = generation;
    pending = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetchAsset('/audio/core/v2/manifest.json', { cache: 'no-store', signal: controller.signal });
        if (response.ok) {
          const catalog = await response.json();
          if (run === generation && validCardSpeechManifest(catalog)) {
            published = createCache(catalog);
            fallback.dispose();
          }
        }
      } catch { /* A not-yet-generated pack must not disable existing speech. */ }
      finally { clearTimeout(timer); }
      return published;
    })().finally(() => { if (run === generation) pending = null; });
    return pending;
  }
  return {
    async prepare(options = {}) {
      const run = generation;
      // A published catalog is saved with the voice clips, so offline startup can
      // restore child speech without fetching the manifest.
      if (!published && options.online === false) {
        const { cachedCoreSpeech } = await import('./offlineStore.js');
        const voice = ['boy', 'man'].includes(options.voice) ? 'boy' : 'girl';
        const stored = await cachedCoreSpeech(voice).catch(() => null);
        if (run !== generation) return { status: 'unavailable', ready: 0, saved: 0, total: 0 };
        if (validCardSpeechManifest(stored?.manifest)) published = createCache(stored.manifest);
      }
      const cache = published || (options.online === false ? null : await loadCatalog());
      if (run !== generation) return { status: 'unavailable', ready: 0, saved: 0, total: 0 };
      return (cache || fallback).prepare(options);
    },
    urlFor(text, options) { return (published || fallback).urlFor(text, options); },
    dispose() { generation++; published?.dispose(); fallback.dispose(); published = null; pending = null; },
  };
}
