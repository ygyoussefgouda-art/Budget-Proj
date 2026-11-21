/**
 * Offline expense entry.
 * New expenses typed in without a connection wait in IndexedDB on this phone, each with an id made
 * here (clientId). When the connection is back they are sent; the server creates at most one expense
 * per clientId, so a send that is retried (flaky connection, two tabs) never duplicates anything.
 * Receipts are not queued (photos are too big and need the server to check them).
 */
import { api, ApiError } from './api';

export interface QueuedBody {
  date: string;
  categoryId: number;
  description: string;
  amount: number;
  tags?: string[];
  split?: { person: string; share: number } | null;
  foreign?: { amount: number | null; currency: string; rate: number } | null;
}
export interface Queued {
  clientId: string;
  userId: number;
  body: QueuedBody;
  createdAt: number;
  /** Set when the server refused it (e.g. its category was deleted): it waits for the user. */
  error?: string;
}

const DB = 'budget-me-offline';
const STORE = 'expenses';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'clientId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Random id made on the phone (randomUUID needs https or localhost; fall back to random bytes). */
export function newClientId(): string {
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  return Array.from(c.getRandomValues(new Uint8Array(16)), (b: number) => b.toString(16).padStart(2, '0')).join('');
}

export async function queueExpense(userId: number, body: QueuedBody): Promise<Queued> {
  const item: Queued = { clientId: newClientId(), userId, body, createdAt: Date.now() };
  await withStore('readwrite', (s) => s.put(item));
  return item;
}

export async function listQueued(userId: number): Promise<Queued[]> {
  try {
    const all = await withStore<Queued[]>('readonly', (s) => s.getAll() as IDBRequest<Queued[]>);
    return all.filter((q) => q.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return []; // private mode without IndexedDB: nothing queued
  }
}

export const removeQueued = (clientId: string) => withStore('readwrite', (s) => s.delete(clientId));

/** A request that never reached the server (no connection), as opposed to the server saying no. */
export const isNetworkError = (e: unknown) => e instanceof ApiError && e.status === 0;

/**
 * Sends everything waiting for this account, oldest first. Stops at the first network error
 * (still offline). An item the server refuses is kept with its error so the user can see it.
 */
export async function syncQueued(userId: number): Promise<{ synced: number; offline: boolean }> {
  let synced = 0;
  for (const item of await listQueued(userId)) {
    if (item.error) continue;
    try {
      // force=1: skip the "identical expense?" question; the clientId already prevents duplicates.
      await api('/expenses?force=1', 'POST', { ...item.body, clientId: item.clientId });
      await removeQueued(item.clientId);
      synced += 1;
    } catch (e) {
      if (isNetworkError(e) || (e instanceof ApiError && (e.status >= 500 || e.status === 429))) return { synced, offline: isNetworkError(e) };
      if (e instanceof ApiError && e.status === 401) return { synced, offline: false }; // signed out: try after sign-in
      await withStore('readwrite', (s) => s.put({ ...item, error: (e as Error).message }));
    }
  }
  return { synced, offline: false };
}

// ---------- offline kit: just enough to log an expense when the app is opened with no connection ----------
export interface OfflineKit {
  user: { id: number; username: string; currency: string; monthStartDay: number };
  categories: { id: number; name: string }[];
}
const KIT = 'bm-offline-kit';
export function saveKit(kit: OfflineKit) {
  try {
    localStorage.setItem(KIT, JSON.stringify(kit));
  } catch {
    /* storage full or blocked: offline start just won't be available */
  }
}
export function readKit(): OfflineKit | null {
  try {
    const v = JSON.parse(localStorage.getItem(KIT) ?? 'null');
    return v && v.user && Array.isArray(v.categories) ? (v as OfflineKit) : null;
  } catch {
    return null;
  }
}
export function clearKit() {
  try {
    localStorage.removeItem(KIT);
  } catch {
    /* ignore */
  }
}
