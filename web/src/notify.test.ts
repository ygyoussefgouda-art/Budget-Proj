import { describe, expect, it } from 'vitest';
import type { BudgetAlert, DueItem } from './domain/calc';
import { fortnightNote, monthEndNote, remindersToSend, type MonthEndInput, type ReminderPrefs } from './notify';
import { widgetText } from './widget';

const prefs: ReminderPrefs = { budget: true, recurring: true, daily: false, dailyTime: '20:00', monthEnd: true, fortnight: true };
const alerts = [
  { catId: 1, name: 'Food', level: 'warn', pct: 85, over: 0 },
  { catId: 2, name: 'Transport', level: 'over', pct: 120, over: 500 },
] as BudgetAlert[];
const due: DueItem[] = [{ ruleId: 7, date: '2026-11-22', amount: 30000, categoryId: 3, description: 'Rent' }];
const cat = (id: number) => (id === 3 ? 'Home' : '?');

describe('reminders (local notifications)', () => {
  it('one per budget alert level per month, and one per due recurring expense', () => {
    const out = remindersToSend(alerts, due, '2026-11', prefs, new Set(), cat);
    expect(out.map((o) => o.key)).toEqual(['b:2026-11:1:warn', 'b:2026-11:2:full', 'r:7:2026-11-22']);
    expect(out[0].title).toBe('Food is at 85% of its budget');
    expect(out[1].title).toBe('Transport reached its budget');
    expect(out[2].title).toBe('Recurring expense due: Rent');
  });
  it('never twice', () => {
    const sent = new Set(['b:2026-11:1:warn', 'r:7:2026-11-22']);
    expect(remindersToSend(alerts, due, '2026-11', prefs, sent, cat).map((o) => o.key)).toEqual(['b:2026-11:2:full']);
    // a new month starts again
    expect(remindersToSend(alerts, [], '2026-12', prefs, sent, cat)).toHaveLength(2);
  });
  it('money notes: every 2 weeks (day 14 and 28) and on the last evening, never in the past', () => {
    const fmt = (m: number) => `${m / 100} EGP`;
    // Budget month 1–30 Nov.
    const x: MonthEndInput = { month: '2026-11', from: '2026-11-01', last: '2026-11-30', spent: 120000, saved: 30000, left: 45000, fmt, locked: false };
    const early = new Date(2026, 10, 5, 12, 0);
    const f1 = fortnightNote(x, early)!;
    expect(f1.at).toEqual(new Date(2026, 10, 15, 19, 0)); // day 14 after the 1st
    expect(f1.body).toBe('You have 450 EGP left this month: about 28.12 EGP a day for 16 days.');
    expect(fortnightNote(x, new Date(2026, 10, 16, 9, 0))!.at).toEqual(new Date(2026, 10, 29, 19, 0)); // day 28
    expect(fortnightNote(x, new Date(2026, 10, 29, 20, 0))).toBeNull(); // none left this month
    expect(fortnightNote({ ...x, left: -500 }, early)!.body).toBe('You are 5 EGP over your income this month.');

    const end = monthEndNote(x, early)!;
    expect(end.at).toEqual(new Date(2026, 10, 30, 20, 0));
    expect(end.body).toBe('You spent 1200 EGP and saved 300 EGP. 450 EGP is left over.');
    expect(monthEndNote(x, new Date(2026, 10, 30, 21, 0))).toBeNull();
    expect(monthEndNote({ ...x, left: -1000 }, early)!.body).toBe('You spent 1200 EGP and saved 300 EGP. You went 10 EGP over your income.');
  });

  it('App lock on: no amounts in notifications or on the widget (they show without unlocking)', () => {
    const fmt = (m: number) => `${m / 100} EGP`;
    const x: MonthEndInput = { month: '2026-11', from: '2026-11-01', last: '2026-11-30', spent: 1, saved: 1, left: 45000, fmt, locked: true };
    const early = new Date(2026, 10, 5, 12, 0);
    expect(fortnightNote(x, early)!.body).not.toMatch(/EGP/);
    expect(monthEndNote(x, early)!.body).not.toMatch(/EGP/);
    const w = widgetText({ perDay: 2000, days: 10, left: 20000, fmt }, true);
    expect(w.value).toBe('');
    expect(JSON.stringify(w)).not.toMatch(/EGP/);
  });

  it('the widget: left today, or over budget, or nothing when signed out', () => {
    const fmt = (m: number) => `${m / 100} EGP`;
    expect(widgetText({ perDay: 2000, days: 10, left: 20000, fmt }, false)).toEqual({ title: 'Left today', value: '20 EGP', sub: '200 EGP left · 10 days to go', add: 'Add expense' });
    expect(widgetText({ perDay: 2000, days: 1, left: 2000, fmt }, false).sub).toBe('20 EGP left · last day');
    expect(widgetText({ perDay: -100, days: 3, left: -300, fmt }, false)).toMatchObject({ title: 'Over budget', value: '3 EGP' });
    expect(widgetText(null, false)).toMatchObject({ title: 'Budget me', value: '' });
  });

  it('respects the settings', () => {
    expect(remindersToSend(alerts, due, '2026-11', { ...prefs, budget: false }, new Set(), cat).map((o) => o.key)).toEqual(['r:7:2026-11-22']);
    expect(remindersToSend(alerts, due, '2026-11', { ...prefs, recurring: false }, new Set(), cat)).toHaveLength(2);
  });
});
