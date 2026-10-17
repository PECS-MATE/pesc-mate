const DATABASE_NAME = 'pesc-mate-offline';
const DATABASE_VERSION = 3;

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('account')) database.createObjectStore('account');
      if (!database.objectStoreNames.contains('snapshots')) database.createObjectStore('snapshots');
      if (!database.objectStoreNames.contains('events')) database.createObjectStore('events', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('learning')) database.createObjectStore('learning');
      if (!database.objectStoreNames.contains('learningAttempts')) database.createObjectStore('learningAttempts', { keyPath: 'request_id' });
      if (!database.objectStoreNames.contains('coreSpeech')) database.createObjectStore('coreSpeech');
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function operation(storeName, mode, run) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;
    try { result = run(store); } catch (error) { reject(error); return; }
    transaction.oncomplete = () => { database.close(); resolve(result?.result); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.onabort = () => { database.close(); reject(transaction.error); };
  });
}

export async function cacheAccount(account, expiresAt) {
  const existing = await operation('account', 'readonly', store => store.get('current')).catch(() => null);
  const offlineExpiresAt = expiresAt || existing?.offline_expires_at;
  if (!offlineExpiresAt) return;
  return operation('account', 'readwrite', store => store.put({
    ...account, offline_expires_at: offlineExpiresAt,
  }, 'current'));
}

export async function cachedAccount() {
  const stored = await operation('account', 'readonly', store => store.get('current'));
  if (!stored || new Date(stored.offline_expires_at).getTime() <= Date.now()) {
    await clearCachedAccount().catch(() => {});
    return null;
  }
  const { offline_expires_at: _expiry, ...account } = stored;
  return account;
}

export function clearCachedAccount() {
  return operation('account', 'readwrite', store => store.delete('current'));
}

export function cacheSnapshot(userId, snapshot) {
  return operation('snapshots', 'readwrite', store => store.put({ ...snapshot, cached_at: new Date().toISOString() }, userId));
}

export function cachedSnapshot(userId) {
  return operation('snapshots', 'readonly', store => store.get(userId));
}

// Public, bundled phrases only; no user text or recordings belong in this store.
export function cachedCoreSpeech() {
  return operation('coreSpeech', 'readonly', store => store.get('bundle'));
}

export function cacheCoreSpeech(bundle) {
  return operation('coreSpeech', 'readwrite', store => store.put(bundle, 'bundle'));
}

export function queueOfflineEvent(event) {
  return operation('events', 'readwrite', store => store.put(event));
}

export async function pendingOfflineEvents(userId) {
  const all = await operation('events', 'readonly', store => store.getAll());
  return (all || []).filter(event => event.user_id === userId);
}

export async function removeOfflineEvents(ids) {
  if (!ids.length) return;
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('events', 'readwrite');
    const store = transaction.objectStore('events');
    ids.forEach(id => store.delete(id));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export function cacheLearningState(userId, state) {
  return operation('learning', 'readwrite', store => store.put(state, `${userId}:state`));
}

export function cachedLearningState(userId) {
  return operation('learning', 'readonly', store => store.get(`${userId}:state`));
}

export function cacheLearningGame(userId, state) {
  return operation('learning', 'readwrite', store => store.put(state, `${userId}:game`));
}

export function cachedLearningGame(userId) {
  return operation('learning', 'readonly', store => store.get(`${userId}:game`));
}

export function clearLearningGame(userId) {
  return operation('learning', 'readwrite', store => store.delete(`${userId}:game`));
}

export function queueLearningAttempt(attempt) {
  return operation('learningAttempts', 'readwrite', store => store.put(attempt));
}

export async function pendingLearningAttempts(userId) {
  const all = await operation('learningAttempts', 'readonly', store => store.getAll());
  return (all || []).filter(attempt => attempt.user_id === userId);
}

// Mark before transport so a lost response or page reload does not turn a retry
// into an apparent first attempt. Existing queue stores need no schema upgrade.
async function markSyncAttempt(storeName, userId, ids) {
  if (!ids.length) return 0;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    let retried = 0;
    for (const id of ids) {
      const request = store.get(id);
      request.onsuccess = () => {
        const record = request.result;
        if (!record || record.user_id !== userId) { transaction.abort(); return; }
        retried += Number(record.sync_attempted === true);
        store.put({ ...record, sync_attempted: true });
      };
    }
    transaction.oncomplete = () => { database.close(); resolve(retried); };
    const fail = () => { database.close(); reject(new Error('동기화 시도 표시를 저장하지 못했습니다.')); };
    transaction.onerror = fail;
    transaction.onabort = fail;
  });
}

export function markOfflineSyncAttempt(userId, ids) {
  return markSyncAttempt('events', userId, ids);
}

export function markLearningSyncAttempt(userId, ids) {
  return markSyncAttempt('learningAttempts', userId, ids);
}

export async function removeLearningAttempts(ids) {
  if (!ids.length) return;
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('learningAttempts', 'readwrite');
    const store = transaction.objectStore('learningAttempts');
    ids.forEach(id => store.delete(id));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function clearOfflineUserData(userId) {
  await operation('snapshots', 'readwrite', store => store.delete(userId));
  const events = await pendingOfflineEvents(userId);
  await removeOfflineEvents(events.map(event => event.id));
  await operation('learning', 'readwrite', store => {
    store.delete(`${userId}:state`);
    store.delete(`${userId}:game`);
  });
  const attempts = await pendingLearningAttempts(userId);
  await removeLearningAttempts(attempts.map(attempt => attempt.request_id));
}
