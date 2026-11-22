import { useEffect, useState } from 'react';
import type { BudgetAlert, DueItem } from './domain/calc';
import { t } from './i18n';
import { isNative, LocalNotifications, type LocalNotification } from './native';

/**
 * Reminders in the Android app: local notifications scheduled on the phone (no Firebase, no push
 * server). Worked out from data the app already has, each one only once.
 */
export interface ReminderPrefs {
  budget: boolean; // a category reaches 80% / 100% of its budget
  recurring: boolean; // a recurring expense is due
  daily: boolean; // "Log today's expenses" every evening
  dailyTime: string; // "HH:MM"
}
const DEFAULTS: ReminderPrefs = { budget: true, recurring: true, daily: false, dailyTime: '20:00' };
const prefsKey = (uid: number) => `bm-reminders:${uid}`;
const sentKey = (uid: number) => `bm-notified:${uid}`;
const DAILY_ID = 1_000_000;

const read = <T extends object>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};

export const readReminderPrefs = (uid: number): ReminderPrefs => read(prefsKey(uid), DEFAULTS);
function readSent(uid: number): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(sentKey(uid)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Which notifications to send now. Pure (unit-tested): `sent` holds keys already shown. */
export function remindersToSend(
  alerts: BudgetAlert[],
  due: DueItem[],
  month: string,
  prefs: ReminderPrefs,
  sent: Set<string>,
  catName: (id: number) => string,
): { key: string; title: string; body: string }[] {
  const out: { key: string; title: string; body: string }[] = [];
  if (prefs.budget) {
    for (const a of alerts) {
      const level = a.level === 'warn' ? 'warn' : 'full'; // 100% and over are one step
      const key = `b:${month}:${a.catId}:${level}`;
      if (sent.has(key)) continue;
      out.push({
        key,
        title: level === 'warn' ? t('{name} is at {pct}% of its budget', { name: a.name, pct: a.pct ?? 80 }) : t('{name} reached its budget', { name: a.name }),
        body: t('Open Budget me to see this month.'),
      });
    }
  }
  if (prefs.recurring) {
    for (const d of due) {
      const key = `r:${d.ruleId}:${d.date}`;
      if (sent.has(key)) continue;
      out.push({ key, title: t('Recurring expense due: {name}', { name: d.description || catName(d.categoryId) }), body: t('Tap Add or Skip in Budget me.') });
    }
  }
  return out;
}

let nextId = 1;
/** Sends what's new and keeps the daily reminder in line with the settings. Native only. */
export function useReminders(uid: number, alerts: BudgetAlert[], due: DueItem[], month: string, catName: (id: number) => string) {
  useEffect(() => {
    if (!isNative()) return;
    let stop = false;
    (async () => {
      const perm = await LocalNotifications.checkPermissions().catch(() => ({ display: 'denied' as const }));
      if (stop || perm.display !== 'granted') return;
      const prefs = readReminderPrefs(uid);
      const sent = new Set<string>(readSent(uid));
      const list = remindersToSend(alerts, due, month, prefs, sent, catName);
      if (list.length) {
        const at = new Date(Date.now() + 1500);
        const notifications: LocalNotification[] = list.map((n) => ({ id: nextId++ % 900_000, title: n.title, body: n.body, schedule: { at, allowWhileIdle: true } }));
        await LocalNotifications.schedule({ notifications }).catch(() => undefined);
        list.forEach((n) => sent.add(n.key));
        write(sentKey(uid), [...sent].slice(-300)); // remember only recent ones
      }
      await syncDaily(prefs);
    })();
    return () => {
      stop = true;
    };
  }, [uid, alerts, due, month, catName]);
}

/** The repeating "Log today's expenses" reminder: on at the chosen time, or cancelled. */
export async function syncDaily(prefs: ReminderPrefs) {
  if (!isNative()) return;
  await LocalNotifications.cancel({ notifications: [{ id: DAILY_ID }] }).catch(() => undefined);
  if (!prefs.daily) return;
  const [h, m] = prefs.dailyTime.split(':').map(Number);
  await (LocalNotifications as unknown as {
    schedule(o: { notifications: { id: number; title: string; body: string; schedule: { on: { hour: number; minute: number }; allowWhileIdle: boolean } }[] }): Promise<unknown>;
  })
    .schedule({
      notifications: [{ id: DAILY_ID, title: t("Log today's expenses"), body: t('A minute now keeps your budget right.'), schedule: { on: { hour: h, minute: m }, allowWhileIdle: true } }],
    })
    .catch(() => undefined);
}

/** Settings → Reminders state (saved per account on this phone). */
export function useReminderPrefs(uid: number) {
  const [prefs, setPrefs] = useState(() => readReminderPrefs(uid));
  const update = async (p: Partial<ReminderPrefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    write(prefsKey(uid), next);
    if (next.budget || next.recurring || next.daily) {
      const perm = await LocalNotifications.checkPermissions().catch(() => ({ display: 'denied' as const }));
      if (perm.display !== 'granted') await LocalNotifications.requestPermissions().catch(() => undefined);
    }
    await syncDaily(next);
  };
  return [prefs, update] as const;
}
