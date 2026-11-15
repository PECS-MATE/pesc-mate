import { expect, it, vi } from 'vitest';
import { createPublishedCardSpeechCache } from './publishedCardSpeech';
import { cacheCoreSpeech } from './offlineStore';

const catalog = { version: 'v2', provider: 'qwen3-tts', rate: 1, voice_version: 'synthetic',
  voices: ['girl', 'boy'], entries: [{ text: '도와주세요', file: 'help.wav' }] };
function fallback() { return { prepare: vi.fn(async () => ({ status: 'ready' })), urlFor: vi.fn(() => 'legacy.wav'), dispose: vi.fn() }; }

it('keeps working speech before publication, then adopts the complete child pack', async () => {
  let published = false;
  const legacy = fallback();
  const child = { prepare: vi.fn(async () => ({ status: 'ready' })), urlFor: vi.fn(() => 'child.wav'), dispose: vi.fn() };
  const cache = createPublishedCardSpeechCache({ fallback: legacy, createCache: () => child,
    fetchAsset: async () => ({ ok: published, json: async () => catalog }) });
  await cache.prepare({ voice: 'boy', online: true });
  expect(cache.urlFor('도와주세요')).toBe('legacy.wav');
  published = true;
  await cache.prepare({ voice: 'boy', online: true });
  expect(cache.urlFor('도와주세요')).toBe('child.wav');
  expect(child.prepare).toHaveBeenCalledWith({ voice: 'boy', online: true });
  expect(legacy.dispose).toHaveBeenCalledOnce();
});

it('restores a published child catalog offline without fetching or using adult audio', async () => {
  await cacheCoreSpeech({ manifest: catalog, voice: 'boy', clips: [] }, 'boy');
  const legacy = fallback();
  const fetchAsset = vi.fn();
  const child = { prepare: vi.fn(async () => ({ status: 'ready' })), urlFor: vi.fn(() => 'child-offline.wav'), dispose: vi.fn() };
  const cache = createPublishedCardSpeechCache({ fallback: legacy, fetchAsset, createCache: () => child });
  await cache.prepare({ voice: 'boy', online: false });
  expect(fetchAsset).not.toHaveBeenCalled();
  expect(legacy.prepare).not.toHaveBeenCalled();
  expect(cache.urlFor('도와주세요')).toBe('child-offline.wav');
});

it('does not adopt a late publication after disposal', async () => {
  let resolve;
  const createCache = vi.fn();
  const cache = createPublishedCardSpeechCache({ fallback: fallback(), createCache,
    fetchAsset: () => new Promise(done => { resolve = done; }) });
  const preparing = cache.prepare({ online: true });
  cache.dispose(); resolve({ ok: true, json: async () => catalog }); await preparing;
  expect(createCache).not.toHaveBeenCalled();
});
