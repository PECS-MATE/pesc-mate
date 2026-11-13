import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createUsbTagQueue } from './usbTagQueue';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z')); });
afterEach(() => vi.useRealTimers());
const row = (reader_id, uid = String(reader_id).repeat(8)) => ({ reader_id, uid, status: 'PRESENT' });
const presentation = rows => ({ mode: 'positions', rows, reset: false });
function harness(overrides = {}) {
  const options = { resolve: vi.fn(async rows => rows), onBatch: vi.fn(), onError: vi.fn(),
    isCurrent: () => true, isEnabled: () => true, ...overrides };
  return { ...options, input: createUsbTagQueue(options) };
}
it('uses tag order for separate placements, not physical position', async () => {
  const h = harness();
  h.input.accept(presentation([row(3)]), 'scope'); await vi.advanceTimersByTimeAsync(150);
  h.input.accept(presentation([row(1), row(3)]), 'scope'); await vi.advanceTimersByTimeAsync(150);
  expect(h.onBatch.mock.calls.map(([, batch]) => batch.rows.map(r => r.reader_id))).toEqual([[3], [1]]);
  expect(h.onBatch.mock.calls.every(([, batch]) => !batch.autoSpeak)).toBe(true);
});
it('groups readers within the fixed window and orders a simultaneous group by reader number', async () => {
  const h = harness(); h.input.accept(presentation([row(3)]), 'scope');
  await vi.advanceTimersByTimeAsync(50); h.input.accept(presentation([row(3), row(1)]), 'scope');
  await vi.advanceTimersByTimeAsync(50); h.input.accept(presentation([row(3), row(1), row(2)]), 'scope');
  await vi.advanceTimersByTimeAsync(50);
  expect(h.onBatch).toHaveBeenCalledTimes(1);
  expect(h.onBatch.mock.calls[0][1]).toMatchObject({ autoSpeak: true });
  expect(h.onBatch.mock.calls[0][1].rows.map(r => r.reader_id)).toEqual([1, 2, 3]);
});
it('does not repeat held cards but accepts removal and retag on a single reader', async () => {
  const h = harness(); h.input.accept(presentation([row(1)]), 'scope'); await vi.advanceTimersByTimeAsync(150);
  h.input.accept(presentation([row(1)]), 'scope'); await vi.advanceTimersByTimeAsync(150);
  expect(h.onBatch).toHaveBeenCalledTimes(1);
  h.input.accept(presentation([{ reader_id: 1, status: 'EMPTY', uid: null }]), 'scope');
  h.input.accept(presentation([row(1)]), 'scope'); await vi.advanceTimersByTimeAsync(150);
  expect(h.onBatch).toHaveBeenCalledTimes(2);
});
it('never treats two rapid presentations on the same reader as simultaneous', async () => {
  const h = harness(); h.input.accept({ mode: 'queue', rows: [row(1)] }, 'scope');
  h.input.accept({ mode: 'queue', rows: [row(1, 'AABBCCDD')] }, 'scope');
  await vi.advanceTimersByTimeAsync(150);
  expect(h.onBatch).toHaveBeenCalledTimes(2);
  expect(h.onBatch.mock.calls.every(([, batch]) => !batch.autoSpeak)).toBe(true);
});
it('serializes lookup and keeps later groups when a network response is delayed', async () => {
  let finish;
  const h = harness({ resolve: vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue([]) });
  h.input.accept(presentation([row(3)]), 'scope'); await vi.advanceTimersByTimeAsync(150);
  h.input.accept(presentation([row(1), row(3)]), 'scope'); await vi.advanceTimersByTimeAsync(150);
  expect(h.resolve).toHaveBeenCalledTimes(1);
  finish([]); await vi.advanceTimersByTimeAsync(0);
  expect(h.onBatch.mock.calls.map(([, batch]) => batch.rows[0].reader_id)).toEqual([3, 1]);
});
it('invalidates timers and in-flight results on disconnect/reset', async () => {
  let finish;
  const h = harness({ resolve: () => new Promise(resolve => { finish = resolve; }) });
  h.input.accept(presentation([row(1), row(2)]), 'scope'); await vi.advanceTimersByTimeAsync(150);
  h.input.reset({ forgetPositions: true }); finish([]); await vi.advanceTimersByTimeAsync(0);
  expect(h.onBatch).not.toHaveBeenCalled();
  h.input.accept(presentation([row(1)]), 'scope'); h.input.reset(); await vi.advanceTimersByTimeAsync(150);
  expect(h.onBatch).not.toHaveBeenCalled();
});
it('discards stale account/board context and observes cards while input is disabled', async () => {
  let scope = 'one', enabled = true;
  const h = harness({ isCurrent: value => value === scope, isEnabled: () => enabled });
  h.input.accept(presentation([row(1), row(2)]), scope); scope = 'two'; await vi.advanceTimersByTimeAsync(150);
  expect(h.onBatch).not.toHaveBeenCalled();
  enabled = false; h.input.accept(presentation([row(3)]), scope); enabled = true;
  h.input.accept(presentation([row(3)]), scope); await vi.advanceTimersByTimeAsync(150);
  expect(h.onBatch).not.toHaveBeenCalled();
});
it('keeps healthy readers when other positions report ERROR', async () => {
  const h = harness(); h.input.accept(presentation([row(2), { reader_id: 1, status: 'ERROR', uid: null }]), 'scope');
  await vi.advanceTimersByTimeAsync(150);
  expect(h.onBatch.mock.calls[0][1].rows.map(r => r.reader_id)).toEqual([2]);
  expect(h.onBatch.mock.calls[0][1].autoSpeak).toBe(false);
});

it('rejects an overflowing group atomically without speaking a partial sentence', async () => {
  const h = harness({ maxPending: 2 });
  h.input.accept(presentation([row(1), row(2), row(3)]), 'scope');
  await vi.advanceTimersByTimeAsync(150);
  expect(h.onError).toHaveBeenCalledOnce();
  expect(h.resolve).not.toHaveBeenCalled(); expect(h.onBatch).not.toHaveBeenCalled();
});
