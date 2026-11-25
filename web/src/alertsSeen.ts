import { useCallback, useSyncExternalStore } from 'react';
import type { BudgetAlert } from './domain/calc';

/**
 * 2.2.1: which budget alerts the user has already read, so a read alert stops looking new.
 * Read = tapped on Home, "Mark as read", or the Budget tab opened (where every category is listed).
 * An alert is one category at one level in one budget month: reaching the next level (80% → used up →
 * over) or a new month makes it new again. Kept per account on this device only.
 */
const key = (uid: number) => `bm-alerts-seen:${uid}`;
export const alertId = (month: string, a: Pick<BudgetAlert, 'catId' | 'level'>) => `${month}:${a.catId}:${a.level}`;

const listeners = new Set<() => void>();
const cache = new Map<number, Set<string>>();

function load(uid: number): Set<string> {
  let s = cache.get(uid);
  if (!s) {
    try {
      s = new Set(JSON.parse(localStorage.getItem(key(uid)) ?? '[]') as string[]);
    } catch {
      s = new Set();
    }
    cache.set(uid, s);
  }
  return s;
}

function markSeen(uid: number, ids: string[]) {
  const s = load(uid);
  if (ids.every((id) => s.has(id))) return;
  // A new Set each time, so React sees the change.
  const next = new Set([...s, ...ids]);
  cache.set(uid, next);
  try {
    localStorage.setItem(key(uid), JSON.stringify([...next].slice(-300))); // only recent months matter
  } catch {
    /* private mode: remembered until the app closes */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The read alerts of this account, and a way to mark more as read. Everything using it updates together. */
export function useSeenAlerts(uid: number, month: string) {
  const seen = useSyncExternalStore(subscribe, () => load(uid));
  const isSeen = useCallback((a: BudgetAlert) => seen.has(alertId(month, a)), [seen, month]);
  const markRead = useCallback((alerts: BudgetAlert[]) => markSeen(uid, alerts.map((a) => alertId(month, a))), [uid, month]);
  return { isSeen, markRead };
}
