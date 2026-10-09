import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/services/offlineStore.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');

test('offline storage separates account snapshots and pending events', () => {
  assert.match(store, /createObjectStore\('account'/);
  assert.match(store, /createObjectStore\('snapshots'/);
  assert.match(store, /createObjectStore\('events'/);
  assert.match(store, /offline_expires_at/);
});

test('service worker caches the app shell but never caches API responses', () => {
  assert.match(worker, /APP_SHELL/);
  assert.match(worker, /CACHE_ASSETS/);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
});

test('speech failures queue card ids without storing spoken text', () => {
  assert.match(app, /queueOfflineEvent\(\{/);
  assert.match(app, /card_ids: cardIds/);
  assert.doesNotMatch(app, /queueOfflineEvent\(\{[^}]*\bcontent\s*:/s);
});

test('natural generation is unavailable offline while selection speech remains enabled', () => {
  assert.match(app, /disabled=\{!board\.length \|\| busy \|\| offline\}/);
  assert.match(app, /function speakSelection\(\)/);
});
