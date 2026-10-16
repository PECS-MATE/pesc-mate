import { request } from './api.js';
import { pendingLearningAttempts, pendingOfflineEvents, removeLearningAttempts, removeOfflineEvents } from './offlineStore.js';

export function createOfflineSync({
  readEvents = pendingOfflineEvents, readAttempts = pendingLearningAttempts,
  removeEvents = removeOfflineEvents, removeAttempts = removeLearningAttempts,
  sendEvents = events => request('/offline/events/sync', { method: 'POST', body: JSON.stringify({ events }) }),
  sendAttempt = attempt => request('/learning/attempts', { method: 'POST', body: JSON.stringify(attempt) }),
} = {}) {
  const pending = new Map();

  async function run(userId, isCurrent) {
    if (!isCurrent()) return { cancelled: true };
    const [events, attempts] = await Promise.all([readEvents(userId), readAttempts(userId)]);
    const syncedEventIds = [];
    const syncedAttemptIds = [];
    let failed = 0;
    // IndexedDB keys are UUIDs, not time order. Keep the original occurrence time.
    const ordered = [...events].sort((left, right) => left.occurred_at.localeCompare(right.occurred_at) || left.id.localeCompare(right.id));
    for (let offset = 0; offset < ordered.length; offset += 100) {
      if (!isCurrent()) return { cancelled: true };
      const batch = ordered.slice(offset, offset + 100).map(({ user_id: _userId, ...event }) => event);
      try {
        const result = await sendEvents(batch);
        if (!isCurrent()) return { cancelled: true };
        const accepted = new Set(result.accepted_ids || []);
        const ids = batch.filter(event => accepted.has(event.id)).map(event => event.id);
        await removeEvents(ids);
        syncedEventIds.push(...ids);
        failed += batch.length - ids.length;
      } catch { failed += batch.length; }
    }
    for (const { user_id: _userId, ...attempt } of attempts) {
      if (!isCurrent()) return { cancelled: true };
      try {
        await sendAttempt(attempt);
        if (!isCurrent()) return { cancelled: true };
        await removeAttempts([attempt.request_id]);
        syncedAttemptIds.push(attempt.request_id);
      } catch { failed += 1; }
    }
    if (!isCurrent()) return { cancelled: true };
    const [remainingEvents, remainingAttempts] = await Promise.all([readEvents(userId), readAttempts(userId)]);
    if (!isCurrent()) return { cancelled: true };
    return { cancelled: false, syncedEventIds, syncedAttemptIds, failed,
      remaining: remainingEvents.length + remainingAttempts.length };
  }

  return {
    sync(userId, { scope = userId, isCurrent = () => true } = {}) {
      const key = `${userId}:${scope}`;
      if (pending.has(key)) return pending.get(key);
      const work = run(userId, isCurrent).finally(() => pending.delete(key));
      pending.set(key, work);
      return work;
    },
  };
}
