import { expect, it, vi } from 'vitest';
import { createSpeechAudioQueue } from './speechAudioQueue';

it('deduplicates synthesis and separates voice/rate cache entries with expiry', async () => {
  let now = 0;
  const fetchAudio = vi.fn(async () => new Blob(['wav']));
  const queue = createSpeechAudioQueue({ fetchAudio, getSession: () => 'one', now: () => now, ttlMs: 100 });
  const [a, b] = await Promise.all([queue.request('물', 1), queue.request('물', 1)]);
  expect(a).toBe(b); expect(fetchAudio).toHaveBeenCalledTimes(1);
  expect(await queue.request('물', 1)).toBe(a);
  await queue.request('물', 1, undefined, 'boy'); await queue.request('물', .9);
  expect(fetchAudio).toHaveBeenCalledTimes(3);
  now = 100; await queue.request('물', 1); expect(fetchAudio).toHaveBeenCalledTimes(4);
});
it('rejects an old account response without caching it into the replacement session', async () => {
  let session = 'one', finish;
  const fetchAudio = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const queue = createSpeechAudioQueue({ fetchAudio, getSession: () => session });
  const old = expect(queue.request('물', 1)).rejects.toMatchObject({ name: 'AbortError' });
  await Promise.resolve(); session = 'two'; finish(new Blob(['old'])); await old;
  await vi.waitFor(() => expect(fetchAudio).toHaveBeenCalledTimes(1));
  queue.reset();
});
it('runs only the latest pending phrase while an active synthesis finishes', async () => {
  const finish = [], fetchAudio = vi.fn(() => new Promise(resolve => finish.push(resolve)));
  const queue = createSpeechAudioQueue({ fetchAudio, getSession: () => 'one' });
  const first = queue.request('물', 1); await Promise.resolve();
  const dropped = expect(queue.request('밥', 1)).rejects.toMatchObject({ name: 'AbortError' });
  const last = queue.request('사과', 1); await dropped;
  expect(fetchAudio).toHaveBeenCalledTimes(1); finish[0](new Blob(['one'])); await first;
  await vi.waitFor(() => expect(fetchAudio).toHaveBeenCalledTimes(2));
  expect(fetchAudio.mock.calls[1][0]).toBe('사과'); finish[1](new Blob(['two'])); await last;
});
