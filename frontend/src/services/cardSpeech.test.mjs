import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardSpeechCache, validCardSpeechManifest } from './cardSpeech.js';
import { IDBFactory } from 'fake-indexeddb';
import { cacheCoreSpeech, cachedCoreSpeech } from './offlineStore.js';

const catalog = { version: 'v2', provider: 'qwen3-tts', rate: 1, voice_version: 'synthetic',
  voices: ['girl', 'boy'], entries: [{ text: '물', file: 'water.wav' }, { text: '도와주세요', file: 'help.wav' }] };
function wave() {
  const data = new Uint8Array(48);
  data.set(new TextEncoder().encode('RIFF'), 0); data.set(new TextEncoder().encode('WAVE'), 8);
  return new Blob([data]);
}

test('uses selected child voice for cards and urgent expressions before downloading', () => {
  const cache = createCardSpeechCache({ catalog });
  assert.equal(cache.urlFor('물'), '/audio/core/v2/girl/water.wav?voice=synthetic');
  assert.equal(cache.urlFor('도와주세요', { voice: 'boy' }), '/audio/core/v2/boy/help.wav?voice=synthetic');
  assert.equal(cache.urlFor('물', { online: false }), undefined);
  assert.equal(cache.urlFor('나만의 문장'), undefined);
});

test('persists voices separately and restores them offline without a network request', async () => {
  const disk = new Map(); let count = 0;
  const read = async voice => disk.get(voice);
  const write = async (bundle, voice) => disk.set(voice, bundle);
  const fetchAsset = async () => { count++; return { ok: true, blob: async () => wave() }; };
  const cache = createCardSpeechCache({ catalog, read, write, fetchAsset, createUrl: () => `blob:${count}` });
  assert.equal((await cache.prepare({ voice: 'girl' })).saved, 2);
  assert.equal((await cache.prepare({ voice: 'boy' })).saved, 2);
  assert.equal(disk.size, 2);
  const restored = createCardSpeechCache({ catalog, read, write, fetchAsset: () => { throw new Error('offline'); }, createUrl: () => 'blob:restored' });
  assert.equal((await restored.prepare({ voice: 'boy', online: false })).ready, 2);
  assert.equal(restored.urlFor('도와주세요', { voice: 'boy', online: false }), 'blob:restored');
  assert.equal(restored.urlFor('도와주세요', { voice: 'girl', online: false }), undefined);
});

test('retries missing files and does not report persistence when writing fails', async () => {
  let fail = true;
  const cache = createCardSpeechCache({ catalog, read: async () => null,
    write: async () => { throw new Error('quota'); }, createUrl: () => 'blob:memory',
    fetchAsset: async path => ({ ok: !(fail && path.includes('help')), blob: async () => wave() }) });
  assert.deepEqual(await cache.prepare(), { ready: 1, saved: 0, total: 2, status: 'partial' });
  fail = false;
  assert.equal((await cache.prepare()).ready, 2);
  assert.equal(cache.urlFor('물', { online: false }), 'blob:memory');
});

test('rejects adult/old voice bundles and invalid public paths', async () => {
  assert.equal(validCardSpeechManifest({ ...catalog, version: 'v1' }), false);
  assert.equal(validCardSpeechManifest({ ...catalog, entries: [{ text: '물', file: '../water.wav' }] }), false);
  const cache = createCardSpeechCache({ catalog, read: async () => ({ manifest: { ...catalog, voice_version: 'old' }, voice: 'girl', clips: [{ text: '물', file: 'water.wav', blob: wave() }] }) });
  assert.equal((await cache.prepare({ online: false })).ready, 0);
});

test('disposing during download does not recreate object URLs', async () => {
  let release; let created = 0;
  // One entry makes the pending fetch controllable without leaving another worker open.
  const single = { ...catalog, entries: catalog.entries.slice(0, 1) };
  const target = createCardSpeechCache({ catalog: single, read: async () => null, write: async () => {},
    fetchAsset: async () => new Promise(resolve => { release = resolve; }), createUrl: () => { created++; return 'blob:new'; } });
  const pending = target.prepare(); await new Promise(resolve => setImmediate(resolve));
  target.dispose(); release({ ok: true, blob: async () => wave() }); await pending;
  assert.equal(created, 0);
});

test('IndexedDB storage keeps child voices across cache instances and retires the adult bundle', async () => {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  try {
    await cacheCoreSpeech({ manifest: { version: 'v1' }, clips: [] });
    await cacheCoreSpeech({ manifest: catalog, voice: 'girl', clips: [] }, 'girl');
    await cacheCoreSpeech({ manifest: catalog, voice: 'boy', clips: [] }, 'boy');
    assert.equal(await cachedCoreSpeech(), undefined);
    assert.equal((await cachedCoreSpeech('girl')).voice, 'girl');
    assert.equal((await cachedCoreSpeech('boy')).voice, 'boy');
  } finally { globalThis.indexedDB = previous; }
});

test('preparation downloads at most four files concurrently', async () => {
  let active = 0, maximum = 0;
  const expanded = { ...catalog, entries: Array.from({ length: 12 }, (_, i) => ({ text: `카드${i}`, file: `card-${i}.wav` })) };
  const cache = createCardSpeechCache({ catalog: expanded, read: async () => null, write: async () => {}, createUrl: () => 'blob:ready',
    fetchAsset: async () => {
      active++; maximum = Math.max(active, maximum);
      await new Promise(resolve => setImmediate(resolve)); active--;
      return { ok: true, blob: async () => wave() };
    } });
  assert.equal((await cache.prepare()).ready, 12);
  assert.equal(maximum, 4);
});
