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
  monthEnd: boolean; // a summary on the last evening of the budget month
  fortnight: boolean; // every 2 weeks: how much money is left
}
const DEFAULTS: ReminderPrefs = { budget: true, recurring: true, daily: false, dailyTime: '20:00', monthEnd: true, fortnight: true };
const prefsKey = (uid: number) => `bm-reminders:${uid}`;
const sentKey = (uid: number) => `bm-notified:${uid}`;
const DAILY_ID = 1_000_000;
const MONTH_END_ID = 1_000_001;
const FORTNIGHT_ID = 1_000_002;

/** This budget month's numbers for the money notifications (minor units; `fmt` formats them). */
export interface MonthEndInput {
  month: string;
  /** First and last day of the budget month, 'YYYY-MM-DD'. */
  from: string;
  last: string;
  spent: number;
  saved: number;
  left: number;
  fmt: (minor: number) => string;
  /** App lock is on: notifications show no amounts (they appear on the lock screen). */
  locked: boolean;
}
export interface Note { at: Date; title: string; body: string }

const atTime = (iso: string, hour: number, addDays = 0) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d + addDays, hour, 0, 0);
};
const dayDiff = (a: Date, b: Date) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000);

/**
 * The month-end summary (pure, unit-tested): at 20:00 on the last day of the budget month.
 * Null when that moment has already passed.
 */
export function monthEndNote(x: MonthEndInput, now = new Date()): Note | null {
  const at = atTime(x.last, 20);
  if (at.getTime() <= now.getTime()) return null;
  const title = t('Your month in Budget me');
  if (x.locked) return { at, title, body: t('Your month ends today. Open Budget me to see how it went.') };
  const body =
    x.left >= 0
      ? t('You spent {spent} and saved {saved}. {left} is left over.', { spent: x.fmt(x.spent), saved: x.fmt(x.saved), left: x.fmt(x.left) })
      : t('You spent {spent} and saved {saved}. You went {over} over your income.', { spent: x.fmt(x.spent), saved: x.fmt(x.saved), over: x.fmt(-x.left) });
  return { at, title, body };
}

/**
 * Every 2 weeks (pure, unit-tested): at 19:00 on day 14 and day 28 of the budget month, how much
 * is left and what that is per day. The next one still ahead and before the last day (the
 * month-end summary covers that day); null when none is left this month.
 */
export function fortnightNote(x: MonthEndInput, now = new Date()): Note | null {
  const end = atTime(x.last, 0);
  for (const days of [14, 28]) {
    const at = atTime(x.from, 19, days);
    if (at.getTime() <= now.getTime() || at.getTime() >= end.getTime()) continue;
    const title = t('Money check');
    if (x.locked) return { at, title, body: t('Open Budget me to see how much you have left this month.') };
    if (x.left < 0) return { at, title, body: t('You are {amount} over your income this month.', { amount: x.fmt(-x.left) }) };
    const daysLeft = dayDiff(at, end) + 1; // that day included
    return {
      at,
      title,
      body: t('You have {left} left this month: about {perDay} a day for {n} days.', { left: x.fmt(x.left), perDay: x.fmt(Math.trunc(x.left / daysLeft)), n: daysLeft }),
    };
  }
  return null;
}

/** Keeps exactly one of `id` scheduled with today's numbers, or none. */
async function keepOne(id: number, note: Note | null) {
  await LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => undefined);
  if (!note) return;
  await LocalNotifications.schedule({ notifications: [{ id, title: note.title, body: note.body, schedule: { at: note.at, allowWhileIdle: true } }] }).catch(() => undefined);
}

/** The month-end summary and the every-2-weeks money check, with the latest numbers (or cancelled). */
export async function syncMoneyNotes(prefs: ReminderPrefs, input: MonthEndInput | null) {
  if (!isNative()) return;
  await keepOne(MONTH_END_ID, prefs.monthEnd && input ? monthEndNote(input) : null);
  await keepOne(FORTNIGHT_ID, prefs.fortnight && input ? fortnightNote(input) : null);
}

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
export function useReminders(
  uid: number,
  alerts: BudgetAlert[],
  due: DueItem[],
  month: string,
  catName: (id: number) => string,
  /** Numbers for this budget month; undefined (looking at another month) leaves the scheduled one alone. */
  monthEnd?: MonthEndInput,
) {
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
      if (monthEnd) await syncMoneyNotes(prefs, monthEnd);
    })();
    return () => {
      stop = true;
    };
  }, [uid, alerts, due, month, catName, monthEnd]);
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
    if (next.budget || next.recurring || next.daily || next.monthEnd || next.fortnight) {
      const perm = await LocalNotifications.checkPermissions().catch(() => ({ display: 'denied' as const }));
      if (perm.display !== 'granted') await LocalNotifications.requestPermissions().catch(() => undefined);
    }
    await syncDaily(next);
    // Turned off: cancel that one now. Turned on: scheduled the next time the app has this month's numbers.
    if (isNative() && !next.monthEnd) await keepOne(MONTH_END_ID, null);
    if (isNative() && !next.fortnight) await keepOne(FORTNIGHT_ID, null);
  };
  return [prefs, update] as const;
}
