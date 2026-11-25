import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

/**
 * Offline viewing: the last data the app loaded is kept in this phone's IndexedDB, so with no
 * connection the app still opens and shows it (read-only, with "Last updated ...").
 * Only for the signed-in account: cleared on sign-out, session expiry and account deletion.
 * The server still sends Cache-Control: no-store; this copy lives only inside the app.
 */
const DB = 'budget-me-cache';
const STORE = 'client';
const KEY = 'query-cache';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const idbPersister: Persister = {
  async persistClient(client: PersistedClient) {
    try {
      // A plain-data copy: the cache can hold things IndexedDB can't store (functions, promises, errors).
      const plain = JSON.parse(JSON.stringify(client)) as PersistedClient;
      await run('readwrite', (s) => s.put(plain, KEY));
    } catch (e) {
      console.warn('[offline] could not save the offline copy', e);
    }
  },
  async restoreClient() {
    return (await run<PersistedClient>('readonly', (s) => s.get(KEY)).catch(() => undefined)) ?? undefined;
  },
  async removeClient() {
    await run('readwrite', (s) => s.delete(KEY)).catch(() => undefined);
  },
};

/** Which cached answers are worth keeping for offline viewing (not admin pages, not suggestions). */
export const KEEP_OFFLINE = new Set(['me', 'state', 'expenses', 'tags', 'recurring', 'reports', 'reports-compare', 'reports-weekdays', 'reports-tags', 'auth-config']);

/** Forget the offline copy (sign-out, expired session, deleted account). */
export const clearOfflineCache = async (): Promise<void> => {
  await idbPersister.removeClient();
};

/** 2.3.0: whose data the offline copy holds (account id), or null when nobody is signed in. */
const OWNER_KEY = 'bm-cache-owner';
export function readCacheOwner(): number | null {
  try {
    const v = localStorage.getItem(OWNER_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}
export function writeCacheOwner(id: number | null) {
  try {
    if (id === null) localStorage.removeItem(OWNER_KEY);
    else localStorage.setItem(OWNER_KEY, String(id));
  } catch {
    /* private mode: the copy is cleared on every start anyway */
  }
}

/**
 * Keep the offline copy for up to 7 days. (Also used as React Query's gcTime, which is a timer:
 * browsers cap timers at about 24.8 days, and a longer one fires at once and drops the data.)
 */
export const OFFLINE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
