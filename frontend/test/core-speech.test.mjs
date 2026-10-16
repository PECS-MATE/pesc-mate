import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCoreSpeechCache, CORE_SPEECH_VERSION } from '../src/services/coreSpeech.js';

const manifest = { version: CORE_SPEECH_VERSION, entries: [
  { text: '도와주세요', file: '도와주세요.wav' },
  { text: '잘못 눌렀어요', file: '잘못_눌렀어요.wav' },
] };
function wave() {
  const bytes = new Uint8Array(46);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WAVE'), 8);
  return new Blob([bytes], { type: 'audio/wav' });
}
function setup(overrides = {}) {
  const calls = { fetched: [], writes: [], revoked: [] };
  let stored = null;
  let nextUrl = 0;
  const options = {
    read: async () => stored,
    write: async bundle => { calls.writes.push(bundle); stored = bundle; },
    fetchAsset: async (url, config) => {
      calls.fetched.push(url);
      assert.equal(config.credentials, 'omit');
      return { ok: true, json: async () => manifest, blob: async () => wave() };
    },
    createUrl: () => `blob:test-${++nextUrl}`,
    revokeUrl: url => calls.revoked.push(url),
    ...overrides,
  };
  return { cache: createCoreSpeechCache(options), calls, options, stored: () => stored };
}

test('public audio persists once and restores in another instance without networking', async () => {
  const { cache, calls, options } = setup();
  assert.deepEqual(await cache.prepare(), { status: 'ready', ready: 2, saved: 2, total: 2 });
  assert.equal(calls.writes.length, 1);
  assert.ok(calls.fetched.some(url => url.includes(encodeURIComponent('잘못_눌렀어요.wav'))));
  const restored = createCoreSpeechCache({ ...options, fetchAsset: async () => assert.fail('offline fetch') });
  assert.deepEqual(await restored.prepare({ online: false }), { status: 'ready', ready: 2, saved: 2, total: 2 });
  assert.match(restored.urlFor('도와주세요'), /^blob:/);
  assert.equal(restored.urlFor('개인이 입력한 문장'), undefined);
});

test('a failed clip keeps partial playback and the next preparation only retries the missing clip', async () => {
  let fail = true;
  const { cache, calls } = setup({ fetchAsset: async url => {
    calls.fetched.push(url);
    if (fail && url.endsWith(encodeURIComponent('잘못_눌렀어요.wav'))) throw new Error('offline');
    return { ok: true, json: async () => manifest, blob: async () => wave() };
  } });
  assert.deepEqual(await cache.prepare(), { status: 'partial', ready: 1, saved: 1, total: 2 });
  const firstUrl = cache.urlFor('도와주세요');
  calls.fetched.length = 0;
  fail = false;
  assert.equal((await cache.prepare()).status, 'ready');
  assert.equal(calls.fetched.length, 1);
  assert.equal(cache.urlFor('도와주세요'), firstUrl);
});

test('storage quota failure permits memory playback but does not claim offline persistence', async () => {
  const { cache } = setup({ write: async () => { throw new Error('quota'); } });
  assert.deepEqual(await cache.prepare(), { status: 'partial', ready: 2, saved: 0, total: 2 });
  assert.match(cache.urlFor('잘못 눌렀어요'), /^blob:/);
});

test('invalid versions, unsafe paths, duplicate phrases and malformed manifests are rejected', async () => {
  for (const invalid of [
    { ...manifest, version: 'old' },
    { ...manifest, entries: [null] },
    { ...manifest, entries: [{ text: '표현', file: '../private.wav' }] },
    { ...manifest, entries: [manifest.entries[0], manifest.entries[0]] },
  ]) {
    const { cache, calls } = setup({ fetchAsset: async () => ({ ok: true, json: async () => invalid }) });
    assert.equal((await cache.prepare()).status, 'unavailable');
    assert.equal(calls.writes.length, 0);
  }
});

test('bad cached data and non-audio server responses never become ready', async () => {
  const { cache, calls } = setup({
    read: async () => ({ manifest, clips: {} }),
    fetchAsset: async () => ({ ok: true, blob: async () => new Blob(['<html>not audio</html>']) }),
  });
  assert.equal((await cache.prepare()).status, 'unavailable');
  assert.equal(cache.urlFor('도와주세요'), undefined);
  assert.equal(calls.writes.length, 0);
});

test('reconnect during offline restoration fetches missing clips with single-flight preparation', async () => {
  let finishRead;
  const stored = new Promise(resolve => { finishRead = resolve; });
  const { cache, calls } = setup({ read: () => stored });
  const offline = cache.prepare({ online: false });
  const online = cache.prepare({ online: true });
  assert.equal(offline, online);
  finishRead({ manifest, clips: [{ ...manifest.entries[0], blob: wave() }] });
  assert.equal((await online).status, 'ready');
  assert.equal(calls.fetched.length, 1);
});

test('dispose revokes URLs and late preparation cannot restore disposed state', async () => {
  const { cache, calls } = setup();
  await cache.prepare();
  cache.dispose();
  assert.equal(calls.revoked.length, 2);
  assert.equal(cache.urlFor('도와주세요'), undefined);
  let finishRead;
  const delayed = setup({ read: () => new Promise(resolve => { finishRead = resolve; }) });
  const pending = delayed.cache.prepare();
  delayed.cache.dispose();
  finishRead({ manifest, clips: [{ ...manifest.entries[0], blob: wave() }] });
  assert.equal((await pending).ready, 0);
  assert.equal(delayed.calls.fetched.length, 0);
  assert.equal(delayed.cache.urlFor('도와주세요'), undefined);
});

test('every shipped manifest entry has a nonempty mono PCM WAV with matching RIFF length', () => {
  const base = new URL('../public/audio/core/v1/', import.meta.url);
  const shipped = JSON.parse(readFileSync(new URL('manifest.json', base), 'utf8'));
  assert.equal(shipped.version, CORE_SPEECH_VERSION);
  assert.equal(shipped.entries.length, 13);
  for (const entry of shipped.entries) {
    const bytes = readFileSync(new URL(entry.file, base));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    assert.equal(bytes.readUInt16LE(20), 1);
    assert.equal(bytes.readUInt16LE(22), 1);
    assert.equal(bytes.readUInt32LE(24), 16000);
    assert.equal(bytes.readUInt16LE(34), 16);
    assert.ok(bytes.length > 6400);
    assert.ok(bytes.subarray(44).some(byte => byte !== 0));
  }
});
