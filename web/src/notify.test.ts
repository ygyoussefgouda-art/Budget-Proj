import { describe, expect, it } from 'vitest';
import type { BudgetAlert, DueItem } from './domain/calc';
import { remindersToSend, type ReminderPrefs } from './notify';

const prefs: ReminderPrefs = { budget: true, recurring: true, daily: false, dailyTime: '20:00' };
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
  it('respects the settings', () => {
    expect(remindersToSend(alerts, due, '2026-11', { ...prefs, budget: false }, new Set(), cat).map((o) => o.key)).toEqual(['r:7:2026-11-22']);
    expect(remindersToSend(alerts, due, '2026-11', { ...prefs, recurring: false }, new Set(), cat)).toHaveLength(2);
  });
});
