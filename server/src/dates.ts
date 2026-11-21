import type { Request } from 'express';

/** Plain calendar dates ('YYYY-MM-DD'), computed in UTC so the server's timezone never shifts them. */

const pad = (n: number) => String(n).padStart(2, '0');
export const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const parts = (iso: string) => iso.split('-').map(Number) as [number, number, number];
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function addDays(iso: string, n: number) {
  const [y, m, d] = parts(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** First day of the month after `iso`'s month. */
export function firstOfNextMonth(iso: string) {
  const [y, m] = parts(iso);
  return m === 12 ? isoOf(y + 1, 1, 1) : isoOf(y, m + 1, 1);
}

export const serverToday = () => new Date().toISOString().slice(0, 10);

/**
 * "Today" on the user's phone (Cairo is ahead of UTC, so near midnight the server's date is a day
 * behind). The app sends it in X-Local-Date; anything further than a day from the server's own
 * date is ignored, so nobody can make the server act on far-future dates.
 */
export function localToday(req: Request): string {
  const server = serverToday();
  const v = req.get('x-local-date');
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= addDays(server, -1) && v <= addDays(server, 1)) {
    const [y, m, d] = parts(v);
    if (m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)) return v;
  }
  return server;
}

/**
 * Dates of a monthly rule ("every month on day `day`", 29–31 fall back to the month's last day)
 * between `from` and `to` (inclusive), not before `start` and not after `end`.
 * Looks back at most 13 months, so a very old rule can't produce an endless list.
 */
export function monthlyDates(day: number, start: string, end: string | null, from: string, to: string): string[] {
  const lo = start > from ? start : from;
  const hi = end && end < to ? end : to;
  if (lo > hi) return [];
  const [hy, hm] = parts(hi);
  let [y, m] = parts(lo);
  const earliest = hy * 12 + hm - 13;
  if (y * 12 + m < earliest) {
    y = Math.floor((earliest - 1) / 12);
    m = earliest - y * 12;
  }
  const out: string[] = [];
  while (y * 12 + m <= hy * 12 + hm) {
    const date = isoOf(y, m, Math.min(day, daysInMonth(y, m)));
    if (date >= lo && date <= hi) out.push(date);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
