const cancelled = () => new DOMException('Cancelled', 'AbortError');

// One synthesis continues to completion; only the latest different phrase waits.
// Cancelling playback must not create overlapping work on the CPU TTS server.
export function createSpeechAudioQueue({ fetchAudio, getSession, now = Date.now,
  ttlMs = 300000, maxEntries = 32, maxBytes = 16 * 1024 * 1024 }) {
  let active = null, pending = null, session;
  const cache = new Map();
  function settle(job, error, value) {
    job.completed = true;
    for (const waiter of job.waiters) {
      waiter.signal?.removeEventListener('abort', waiter.abort);
      if (error) waiter.reject(error); else waiter.resolve(value);
    }
    job.waiters.clear();
  }
  function dropPending() {
    if (pending) settle(pending, cancelled());
    pending = null;
  }
  function reset() {
    cache.clear(); session = undefined; dropPending();
    if (active) { settle(active, cancelled()); active.controller.abort(); }
  }
  function pump() {
    if (active || !pending) return;
    const job = pending; pending = null;
    if (job.session !== getSession() || !job.waiters.size) { settle(job, cancelled()); return; }
    active = job;
    Promise.resolve().then(() => fetchAudio(job.text, job.rate, job.controller.signal, job.session)).then(blob => {
      if (job.session !== getSession() || job.controller.signal.aborted) { settle(job, cancelled()); return; }
      cache.delete(job.key); cache.set(job.key, { blob, at: now() });
      while (cache.size > maxEntries || [...cache.values()].reduce((n, row) => n + row.blob.size, 0) > maxBytes)
        cache.delete(cache.keys().next().value);
      settle(job, null, blob);
    }, error => settle(job, error)).finally(() => {
      if (active === job) active = null;
      pump();
    });
  }
  function request(text, rate, signal) {
    if (signal?.aborted) return Promise.reject(cancelled());
    const currentSession = getSession();
    if (session !== currentSession) { reset(); session = currentSession; }
    const key = JSON.stringify([text, rate]);
    if (pending && pending.key !== key) dropPending();
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.blob);
    cache.delete(key);
    let job = active?.key === key && !active.completed && active.session === currentSession && !active.controller.signal.aborted
      ? active : pending?.key === key ? pending : null;
    if (!job) {
      job = { key, text, rate, session: currentSession, waiters: new Set(), controller: new AbortController() };
      pending = job;
    }
    const promise = new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal };
      waiter.abort = () => {
        job.waiters.delete(waiter); signal.removeEventListener('abort', waiter.abort); reject(cancelled());
        if (pending === job && !job.waiters.size) pending = null;
      };
      job.waiters.add(waiter); signal?.addEventListener('abort', waiter.abort, { once: true });
    });
    pump();
    return promise;
  }
  return { request, reset };
}
