const DATABASE_NAME = 'pesc-mate-offline';
const DATABASE_VERSION = 1;

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

export async function clearOfflineUserData(userId) {
  await operation('snapshots', 'readwrite', store => store.delete(userId));
  const events = await pendingOfflineEvents(userId);
  await removeOfflineEvents(events.map(event => event.id));
}
