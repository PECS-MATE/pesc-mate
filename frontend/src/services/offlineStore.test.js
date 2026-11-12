import { beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { cacheAccount, cachedAccount, cacheSnapshot, cachedSnapshot, queueOfflineEvent, pendingOfflineEvents,
  markOfflineSyncAttempt, queueLearningAttempt, pendingLearningAttempts, clearOfflineUserData } from './offlineStore';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
it('restores cached account only before its server supplied expiry', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-01T00:00:00Z'));
  await cacheAccount({ id: 'synthetic', role: 'user' }, '2026-01-01T01:00:00Z');
  expect(await cachedAccount()).toEqual({ id: 'synthetic', role: 'user' });
  Date.now.mockReturnValue(Date.parse('2026-01-01T01:00:00Z'));
  expect(await cachedAccount()).toBeNull();
});
it('restores snapshots and deletes only the logged out users data', async () => {
  for (const user_id of ['one', 'two']) {
    await cacheSnapshot(user_id, { cards: [{ id: 'water' }] });
    await queueOfflineEvent({ id: user_id, user_id });
    await queueLearningAttempt({ request_id: user_id, user_id });
  }
  expect((await cachedSnapshot('one')).cards).toEqual([{ id: 'water' }]);
  await clearOfflineUserData('one');
  expect(await cachedSnapshot('one')).toBeUndefined();
  expect(await pendingOfflineEvents('one')).toEqual([]);
  expect(await pendingLearningAttempts('one')).toEqual([]);
  expect(await pendingOfflineEvents('two')).toHaveLength(1);
});
it('persists retry metadata and aborts a cross-account marking transaction', async () => {
  await queueOfflineEvent({ id: 'a', user_id: 'one' });
  expect(await markOfflineSyncAttempt('one', ['a'])).toBe(0);
  expect(await markOfflineSyncAttempt('one', ['a'])).toBe(1);
  await expect(markOfflineSyncAttempt('two', ['a'])).rejects.toThrow();
  expect(await pendingOfflineEvents('two')).toEqual([]);
});
