import assert from 'node:assert/strict';
import test from 'node:test';
import { createOfflineSync } from '../src/services/offlineSync.js';

const event = (id, occurred_at = '2026-10-16T00:00:00Z') => ({
  id, occurred_at, user_id: 'child', event_type: 'immediate_speech', card_ids: ['help'],
});
function setup({ events = [], attempts = [], ...overrides } = {}) {
  let queue = [...events];
  let learning = [...attempts];
  const sent = [];
  const options = {
    readEvents: async () => queue,
    readAttempts: async () => learning,
    removeEvents: async ids => { queue = queue.filter(item => !ids.includes(item.id)); },
    removeAttempts: async ids => { learning = learning.filter(item => !ids.includes(item.request_id)); },
    markEvents: async (_userId, ids) => {
      const retried = queue.filter(item => ids.includes(item.id) && item.sync_attempted).length;
      queue = queue.map(item => ids.includes(item.id) ? { ...item, sync_attempted: true } : item);
      return retried;
    },
    markAttempts: async (_userId, ids) => {
      const retried = learning.filter(item => ids.includes(item.request_id) && item.sync_attempted).length;
      learning = learning.map(item => ids.includes(item.request_id) ? { ...item, sync_attempted: true } : item);
      return retried;
    },
    sendEvents: async batch => { sent.push(batch); return { accepted_ids: batch.map(item => item.id) }; },
    sendAttempt: async () => {},
    ...overrides,
  };
  return { sync: createOfflineSync(options).sync, restart: () => createOfflineSync(options).sync,
    sent, events: () => queue, attempts: () => learning };
}

test('more than 100 offline events sync in bounded batches with original timestamps and IDs', async () => {
  const original = Array.from({ length: 205 }, (_, index) => event(`event-${index}`));
  const harness = setup({ events: original });
  const result = await harness.sync('child');
  assert.deepEqual(harness.sent.map(batch => batch.length), [100, 100, 5]);
  assert.equal(result.remaining, 0);
  assert.equal(result.syncedEventIds.length, 205);
  assert.ok(harness.sent.flat().every(item => !('user_id' in item) && !('content' in item)));
  assert.equal(harness.events().length, 0);
});

test('events are sent in occurrence order even when IndexedDB returns reversed UUID order', async () => {
  const harness = setup({ events: [event('a', '2026-10-16T02:00:00Z'), event('z', '2026-10-16T01:00:00Z')] });
  await harness.sync('child');
  assert.deepEqual(harness.sent[0].map(item => item.id), ['z', 'a']);
});

test('partial server acceptance only removes acknowledged IDs from the submitted batch', async () => {
  const harness = setup({ events: [event('one'), event('two')], sendEvents: async () => ({ accepted_ids: ['one', 'unrelated'] }) });
  const result = await harness.sync('child');
  assert.deepEqual(harness.events().map(item => item.id), ['two']);
  assert.deepEqual(result.syncedEventIds, ['one']);
  assert.equal(result.failed, 1);
});

test('failed batches keep their IDs and do not prevent later batches or learning results', async () => {
  let fail = true;
  const sent = [];
  const harness = setup({
    events: Array.from({ length: 101 }, (_, index) => event(String(index).padStart(3, '0'))),
    attempts: [{ user_id: 'child', request_id: 'learning-1', items: [] }],
    sendEvents: async batch => {
      sent.push(batch);
      if (fail && batch.length === 100) throw new Error('503');
      return { accepted_ids: batch.map(item => item.id) };
    },
    sendAttempt: async attempt => { assert.equal(attempt.user_id, undefined); },
  });
  const first = await harness.sync('child');
  assert.equal(first.remaining, 100);
  assert.equal(first.failed, 100);
  assert.deepEqual(first.syncedAttemptIds, ['learning-1']);
  fail = false;
  const second = await harness.sync('child');
  assert.equal(second.remaining, 0);
  assert.deepEqual(sent[2], sent[0]);
});

test('concurrent reconnects share a single sync within the same login session', async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const harness = setup({ events: [event('one')], sendEvents: async () => {
    calls += 1; await wait; return { accepted_ids: ['one'] };
  } });
  const first = harness.sync('child', { scope: 'session' });
  assert.equal(harness.sync('child', { scope: 'session' }), first);
  release();
  await first;
  assert.equal(calls, 1);
});

test('logout during disk read prevents requests under a replacement account', async () => {
  let release;
  let current = true;
  const harness = setup({ readEvents: () => new Promise(resolve => { release = resolve; }) });
  const work = harness.sync('child', { isCurrent: () => current });
  current = false;
  release([event('one')]);
  assert.deepEqual(await work, { cancelled: true });
  assert.equal(harness.sent.length, 0);
});

test('logout during transport keeps pending data and stops subsequent batches', async () => {
  let current = true;
  const harness = setup({ events: Array.from({ length: 101 }, (_, index) => event(`event-${index}`)),
    sendEvents: async () => { current = false; return { accepted_ids: ['event-0'] }; },
  });
  assert.deepEqual(await harness.sync('child', { isCurrent: () => current }), { cancelled: true });
  assert.equal(harness.events().length, 101);
});

test('failed learning results and storage read errors remain retryable', async () => {
  const harness = setup({ attempts: [{ user_id: 'child', request_id: 'attempt' }],
    sendAttempt: async () => { throw new Error('unavailable'); },
  });
  const result = await harness.sync('child');
  assert.equal(result.remaining, 1);
  assert.equal(result.failed, 1);
  const unavailable = setup({ readEvents: async () => { throw new Error('storage'); } });
  await assert.rejects(unavailable.sync('child'), /storage/);
  await assert.rejects(unavailable.sync('child'), /storage/);
});

test('server success followed by local deletion failure keeps the original event for retry', async () => {
  const harness = setup({ events: [event('one')], removeEvents: async () => { throw new Error('disk'); } });
  const first = await harness.sync('child');
  assert.equal(first.failed, 1);
  assert.equal(first.remaining, 1);
  await harness.sync('child');
  assert.deepEqual(harness.sent[1], harness.sent[0]);
});

test('retry metadata survives a new sync instance and never enters communication or learning bodies', async () => {
  const observed = [];
  let failed = true;
  const harness = setup({ events: [event('one')], attempts: [{ user_id: 'child', request_id: 'practice' }],
    sendEvents: async (batch, metadata) => {
      observed.push(['communication', metadata.retried]);
      assert.ok(batch.every(item => !('sync_attempted' in item) && !('user_id' in item)));
      if (failed) throw new Error('response lost');
      return { accepted_ids: batch.map(item => item.id) };
    },
    sendAttempt: async (attempt, metadata) => {
      observed.push(['learning', metadata.retried]);
      assert.equal(attempt.sync_attempted, undefined);
      if (failed) throw new Error('response lost');
    },
  });
  assert.equal((await harness.sync('child')).remaining, 2);
  assert.equal(harness.events()[0].sync_attempted, true);
  assert.equal(harness.attempts()[0].sync_attempted, true);
  failed = false;
  assert.equal((await harness.restart()('child')).remaining, 0);
  assert.deepEqual(observed, [['communication', 0], ['learning', 0], ['communication', 1], ['learning', 1]]);
});

test('mixed first and repeat attempts report only the retried items in each batch', async () => {
  const harness = setup({ events: [event('first'), { ...event('repeat'), sync_attempted: true }],
    sendEvents: async (batch, { retried }) => {
      assert.equal(retried, 1);
      return { accepted_ids: batch.map(item => item.id) };
    },
  });
  assert.equal((await harness.sync('child')).remaining, 0);
});

test('marker write failure keeps data and does not send unmarked records', async () => {
  let calls = 0;
  const harness = setup({ events: [event('one')], attempts: [{ user_id: 'child', request_id: 'practice' }],
    markEvents: async () => { throw new Error('storage'); },
    markAttempts: async () => { throw new Error('storage'); },
    sendEvents: async () => { calls += 1; }, sendAttempt: async () => { calls += 1; },
  });
  const result = await harness.sync('child');
  assert.equal(result.failed, 2);
  assert.equal(result.remaining, 2);
  assert.equal(calls, 0);
});

test('account replacement during marker write prevents transport under the next account', async () => {
  let current = true;
  const harness = setup({ events: [event('one')], markEvents: async () => { current = false; return 0; } });
  assert.deepEqual(await harness.sync('child', { isCurrent: () => current }), { cancelled: true });
  assert.equal(harness.sent.length, 0);
  assert.equal(harness.events().length, 1);
});
