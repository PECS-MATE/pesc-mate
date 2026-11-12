import { expect, it, vi } from 'vitest';
import { createOfflineSync } from './offlineSync';

function harness(events = []) {
  const dependencies = {
    readEvents: vi.fn(async () => events), readAttempts: vi.fn(async () => []),
    markEvents: vi.fn(async () => 0), markAttempts: vi.fn(async () => 0),
    removeEvents: vi.fn(async () => {}), removeAttempts: vi.fn(async () => {}),
    sendEvents: vi.fn(async rows => ({ accepted_ids: rows.map(row => row.id) })), sendAttempt: vi.fn(async () => ({})),
  };
  return dependencies;
}
const event = (id, occurred_at) => ({ id, occurred_at, user_id: 'synthetic', sync_attempted: true });

it('orders occurrence times, strips local fields and removes only accepted events', async () => {
  const deps = harness([event('b', '2026-01-02'), event('c', '2026-01-01'), event('a', '2026-01-01')]);
  deps.sendEvents.mockResolvedValue({ accepted_ids: ['c', 'foreign'] });
  const result = await createOfflineSync(deps).sync('synthetic');
  const sent = deps.sendEvents.mock.calls[0][0];
  expect(sent.map(row => row.id)).toEqual(['a', 'c', 'b']);
  expect(sent[0]).not.toHaveProperty('user_id'); expect(sent[0]).not.toHaveProperty('sync_attempted');
  expect(deps.removeEvents).toHaveBeenCalledWith(['c']);
  expect(result).toMatchObject({ failed: 2, syncedEventIds: ['c'], cancelled: false });
});
it('coalesces concurrent sync for one scope and permits a later retry', async () => {
  const deps = harness([event('a', '2026-01-01')]), sync = createOfflineSync(deps);
  const first = sync.sync('synthetic');
  expect(sync.sync('synthetic')).toBe(first);
  await first;
  await sync.sync('synthetic');
  expect(deps.sendEvents).toHaveBeenCalledTimes(2);
});
it('does not delete or apply a delayed response after logout/account switch', async () => {
  let current = true;
  const deps = harness([event('a', '2026-01-01')]);
  deps.sendEvents.mockImplementation(async () => { current = false; return { accepted_ids: ['a'] }; });
  expect(await createOfflineSync(deps).sync('synthetic', { isCurrent: () => current })).toEqual({ cancelled: true });
  expect(deps.removeEvents).not.toHaveBeenCalled();
});
it('marks retries before transport and preserves failed attempts for resending', async () => {
  const deps = harness();
  deps.readAttempts.mockResolvedValue([{ request_id: 'attempt', user_id: 'synthetic', sync_attempted: true }]);
  deps.markAttempts.mockResolvedValue(1); deps.sendAttempt.mockRejectedValue(new Error('offline'));
  expect(await createOfflineSync(deps).sync('synthetic')).toMatchObject({ failed: 1 });
  expect(deps.markAttempts.mock.invocationCallOrder[0]).toBeLessThan(deps.sendAttempt.mock.invocationCallOrder[0]);
  expect(deps.sendAttempt).toHaveBeenCalledWith({ request_id: 'attempt' }, { retried: 1 });
  expect(deps.removeAttempts).not.toHaveBeenCalled();
});
it('batches at 100 events and isolates session scopes', async () => {
  const deps = harness(Array.from({ length: 101 }, (_, i) => event(String(i), '2026-01-01')));
  const sync = createOfflineSync(deps);
  const one = sync.sync('synthetic', { scope: 'one' }), two = sync.sync('synthetic', { scope: 'two' });
  expect(one).not.toBe(two); await Promise.all([one, two]);
  expect(deps.sendEvents.mock.calls.map(([rows]) => rows.length)).toEqual([100, 100, 1, 1]);
});
