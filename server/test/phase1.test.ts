/**
 * Recurring expenses, undo for deletes, "same as last month", quick-add suggestions.
 * Own in-memory database, separate from api.test.ts.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgliteDb, type Db } from '../src/db.js';
import { addDays, daysInMonth, isoOf, localToday, monthlyDates, parts, serverToday } from '../src/dates.js';
import { migrate } from '../src/migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let db: Db;
const mkApp = () => createApp(db, { csrfHeader: false, signupLimit: 1000, loginLimit: 1000 });
type Agent = ReturnType<typeof request.agent>;

let n = 0;
async function newUser(): Promise<Agent> {
  const a = request.agent(mkApp());
  await a.post('/api/auth/signup').send({ username: `p1.user${n++}`, password: 'phase-one-pass' }).expect(201);
  return a;
}
async function newCategory(a: Agent, name = 'Bills') {
  const month = serverToday().slice(0, 7);
  return (await a.post('/api/categories').send({ name, month }).expect(201)).body.id as number;
}
const today = () => serverToday();
const thisMonth = () => today().slice(0, 7);
/** Same day of the month, `k` months earlier (clamped to that month's length). */
const monthsAgo = (k: number, day: number) => {
  let [y, m] = parts(today());
  m -= k;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return isoOf(y, m, Math.min(day, daysInMonth(y, m)));
};
const state = async (a: Agent, month = thisMonth()) => (await a.get(`/api/state?month=${month}`).expect(200)).body;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, path.join(here, '..', 'migrations'));
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe('dates', () => {
  it('monthly dates fall back to the last day in short months (incl. leap years)', () => {
    expect(monthlyDates(31, '2026-01-01', null, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(monthlyDates(30, '2028-01-01', null, '2028-02-01', '2028-02-29')).toEqual(['2028-02-29']);
  });
  it('respects start, end and the window, and never lists more than ~13 months back', () => {
    expect(monthlyDates(15, '2026-02-16', '2026-05-14', '2026-01-01', '2026-12-31')).toEqual(['2026-03-15', '2026-04-15']);
    expect(monthlyDates(1, '2000-01-01', null, '2000-01-01', '2026-12-31').length).toBeLessThanOrEqual(14);
  });
  it("uses the phone's date only when it is within a day of the server's", () => {
    const fake = (v?: string) => ({ get: (h: string) => (h.toLowerCase() === 'x-local-date' ? v : undefined) }) as any;
    expect(localToday(fake(addDays(serverToday(), 1)))).toBe(addDays(serverToday(), 1));
    expect(localToday(fake('2099-01-01'))).toBe(serverToday());
    expect(localToday(fake('2026-02-31'))).toBe(serverToday());
    expect(localToday(fake())).toBe(serverToday());
  });
});

describe('recurring expenses', () => {
  const day = () => Math.min(28, parts(today())[2]); // a day that exists in every month

  it('a rule due today shows as Due; tapping Add twice at once adds it only once', async () => {
    const a = await newUser();
    const cat = await newCategory(a);
    // Created with today's day of the month (but avoid 29–31 so the test works every day)
    const r = await a.post('/api/recurring').send({ categoryId: cat, amount: 300_000, description: 'Rent', day: day() }).expect(201);
    expect(r.body).toMatchObject({ amount: 300_000, description: 'Rent', autoAdd: false, paused: false, startDate: today() });
    if (day() !== parts(today())[2]) return; // 29th–31st: today is not on the schedule; covered by the next test
    let s = await state(a);
    expect(s.recurringDue).toEqual([{ ruleId: r.body.id, date: today(), amount: 300_000, categoryId: cat, description: 'Rent' }]);

    const [x, y] = await Promise.all([
      a.post(`/api/recurring/${r.body.id}/add`).send({ date: today() }),
      a.post(`/api/recurring/${r.body.id}/add`).send({ date: today() }),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    s = await state(a);
    expect(s.expenses.filter((e: any) => e.description === 'Rent')).toHaveLength(1);
    expect(s.recurringDue).toEqual([]);
    // the next one is next month
    const list = (await a.get('/api/recurring').expect(200)).body.rules;
    expect(list[0].nextDate > today()).toBe(true);
  });

  it('older occurrences come due; Skip and Add each handle one; off-schedule dates are refused', async () => {
    const a = await newUser();
    const cat = await newCategory(a);
    const r = (await a.post('/api/recurring').send({ categoryId: cat, amount: 5_000, description: 'Gym', day: 1 }).expect(201)).body;
    await db.query('UPDATE recurring_rules SET start_date = $1 WHERE id = $2', [monthsAgo(3, 1), r.id]);
    const due = (await state(a)).recurringDue.map((d: any) => d.date);
    expect(due).toEqual([monthsAgo(3, 1), monthsAgo(2, 1), monthsAgo(1, 1), monthsAgo(0, 1)]);

    await a.post(`/api/recurring/${r.id}/skip`).send({ date: due[0] }).expect(200);
    const added = await a.post(`/api/recurring/${r.id}/add`).send({ date: due[1] }).expect(201);
    expect(added.body).toMatchObject({ date: due[1], amount: 5_000, description: 'Gym', categoryId: cat });
    expect((await state(a)).recurringDue.map((d: any) => d.date)).toEqual(due.slice(2));
    // already handled, not on the schedule, or in the future: refused
    expect((await a.post(`/api/recurring/${r.id}/add`).send({ date: due[0] })).status).toBe(409);
    expect((await a.post(`/api/recurring/${r.id}/add`).send({ date: monthsAgo(1, 2) })).status).toBe(409);
    expect((await a.post(`/api/recurring/${r.id}/add`).send({ date: addDays(today(), 40) })).status).toBe(409);
  });

  it('"add automatically" adds every due occurrence exactly once, even with parallel requests', async () => {
    const a = await newUser();
    const cat = await newCategory(a);
    const r = (await a.post('/api/recurring').send({ categoryId: cat, amount: 9_900, description: 'Netflix', day: 1, autoAdd: true }).expect(201)).body;
    await db.query('UPDATE recurring_rules SET start_date = $1 WHERE id = $2', [monthsAgo(2, 1), r.id]);
    await Promise.all([state(a), state(a), state(a)]);
    const rows = (await db.query("SELECT date FROM expenses WHERE description = 'Netflix' AND category_id = $1 ORDER BY date", [cat])).rows;
    expect(rows.map((x) => x.date)).toEqual([monthsAgo(2, 1), monthsAgo(1, 1), monthsAgo(0, 1)]);
    expect((await state(a)).recurringDue).toEqual([]); // automatic rules never show as Due
  });

  it('pause stops it; resuming continues from today; changing the day does not repeat this month', async () => {
    const a = await newUser();
    const cat = await newCategory(a);
    const body = { categoryId: cat, amount: 1_000, description: 'Phone', day: 1 };
    const r = (await a.post('/api/recurring').send(body).expect(201)).body;
    await db.query('UPDATE recurring_rules SET start_date = $1 WHERE id = $2', [monthsAgo(2, 1), r.id]);
    expect((await state(a)).recurringDue).toHaveLength(3);

    const paused = (await a.put(`/api/recurring/${r.id}`).send({ ...body, paused: true }).expect(200)).body;
    expect(paused.nextDate).toBeNull();
    expect((await state(a)).recurringDue).toEqual([]);
    const resumed = (await a.put(`/api/recurring/${r.id}`).send({ ...body, paused: false }).expect(200)).body;
    expect(resumed.startDate).toBe(today()); // what fell in the pause is not due
    expect((await state(a)).recurringDue.every((d: any) => d.date >= today())).toBe(true);

    // handle this month, then move the day: the new schedule starts next month
    await db.query('UPDATE recurring_rules SET start_date = $1 WHERE id = $2', [monthsAgo(0, 1), r.id]);
    await a.post(`/api/recurring/${r.id}/add`).send({ date: monthsAgo(0, 1) }).expect(201);
    const moved = (await a.put(`/api/recurring/${r.id}`).send({ ...body, day: 28 }).expect(200)).body;
    expect(moved.startDate > today()).toBe(true);
    expect((await state(a)).recurringDue).toEqual([]);
  });

  it('end date, validation, and the category can only be removed once its rules are gone', async () => {
    const a = await newUser();
    const cat = await newCategory(a);
    const ok = { categoryId: cat, amount: 1_000, day: 5 };
    expect((await a.post('/api/recurring').send({ ...ok, day: 32 })).status).toBe(400);
    expect((await a.post('/api/recurring').send({ ...ok, amount: 0 })).status).toBe(400);
    expect((await a.post('/api/recurring').send({ ...ok, endDate: addDays(today(), -1) })).status).toBe(400);
    const r = (await a.post('/api/recurring').send({ ...ok, endDate: addDays(today(), 400) }).expect(201)).body;
    const del = await a.delete(`/api/categories/${cat}`);
    expect(del.status).toBe(400);
    expect(del.body.error).toMatch(/used by 1 recurring expense/);
    await a.delete(`/api/recurring/${r.id}`).expect(204);
    await a.delete(`/api/categories/${cat}`).expect(204);
  });

  it("nobody can see or touch another account's rules", async () => {
    const a = await newUser();
    const cat = await newCategory(a);
    const r = (await a.post('/api/recurring').send({ categoryId: cat, amount: 1_000, day: 1 }).expect(201)).body;
    const b = await newUser();
    const bCat = await newCategory(b);
    expect((await b.get('/api/recurring')).body.rules).toEqual([]);
    expect((await b.put(`/api/recurring/${r.id}`).send({ categoryId: bCat, amount: 1, day: 1 })).status).toBe(404);
    expect((await b.post(`/api/recurring/${r.id}/add`).send({ date: today() })).status).toBe(404);
    expect((await b.delete(`/api/recurring/${r.id}`)).status).toBe(404);
    // and can't point their own rule at someone else's category
    expect((await b.post('/api/recurring').send({ categoryId: cat, amount: 1, day: 1 })).status).toBe(400);
  });

  it('rules and what was already handled survive a backup + restore', async () => {
    const a = await newUser();
    const cat = await newCategory(a);
    const r = (await a.post('/api/recurring').send({ categoryId: cat, amount: 2_000, description: 'Water', day: 1 }).expect(201)).body;
    await db.query('UPDATE recurring_rules SET start_date = $1 WHERE id = $2', [monthsAgo(1, 1), r.id]);
    await a.post(`/api/recurring/${r.id}/add`).send({ date: monthsAgo(1, 1) }).expect(201);
    const before = (await state(a)).recurringDue.map((d: any) => d.date);
    const backup = (await a.get('/api/backup').expect(200)).body;
    expect(backup.tables.recurring_rules).toHaveLength(1);
    await a.post('/api/backup/restore').send(backup).expect(200);
    const after = await state(a);
    expect(after.recurringDue.map((d: any) => d.date)).toEqual(before);
    expect((await a.get('/api/recurring')).body.rules[0]).toMatchObject({ description: 'Water', amount: 2_000, day: 1 });
  });
});

describe('undo for deletes', () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
  const getBytes = (a: Agent, url: string) =>
    a
      .get(url)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

  it('an expense and its receipt come back with the same id; Undo works only once', async () => {
    const a = await newUser();
    const cat = await newCategory(a);
    const e = (await a.post('/api/expenses').send({ date: today(), categoryId: cat, amount: 4_500, description: 'Lunch' }).expect(201)).body;
    await a.put(`/api/expenses/${e.id}/receipt`).set('Content-Type', 'image/png').send(PNG).expect(200);

    const { undo } = (await a.delete(`/api/expenses/${e.id}`).expect(200)).body;
    expect(typeof undo).toBe('number');
    expect((await state(a)).expenses).toEqual([]); // totals update at once
    expect((await a.get(`/api/expenses/${e.id}/receipt`)).status).toBe(404);

    await a.post(`/api/undo/${undo}`).expect(200);
    const back = (await state(a)).expenses;
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: e.id, amount: 4_500, description: 'Lunch', hasReceipt: true });
    const img = await getBytes(a, `/api/expenses/${e.id}/receipt`);
    expect(Buffer.compare(img.body as Buffer, PNG)).toBe(0);
    expect((await a.post(`/api/undo/${undo}`)).status).toBe(410);
  });

  it('other accounts cannot undo; after the undo window it is gone for good', async () => {
    const a = await newUser();
    const cat = await newCategory(a);
    const e = (await a.post('/api/expenses').send({ date: today(), categoryId: cat, amount: 100 }).expect(201)).body;
    const { undo } = (await a.delete(`/api/expenses/${e.id}`).expect(200)).body;
    const b = await newUser();
    expect((await b.post(`/api/undo/${undo}`)).status).toBe(410);

    await db.query("UPDATE trash SET deleted_at = now() - interval '10 minutes' WHERE id = $1", [undo]);
    expect((await a.post(`/api/undo/${undo}`)).status).toBe(410);
    // the next request from a fresh app instance purges it
    const fresh = request.agent(mkApp());
    await fresh.post('/api/auth/login').send({ username: `p1.user${n - 2}`, password: 'phase-one-pass' }).expect(200);
    await fresh.get('/api/auth/me').expect(200);
    expect((await db.query('SELECT COUNT(*)::int AS n FROM trash WHERE id = $1', [undo])).rows[0].n).toBe(0);
  });

  it('savings entries: undo keeps the balance from going below zero', async () => {
    const a = await newUser();
    const goal = (await a.post('/api/goals').send({ name: 'Trip', target: 100_000 }).expect(201)).body.id;
    const dep = (await a.post(`/api/goals/${goal}/entries`).send({ date: today(), deposit: true, amount: 10_000 }).expect(201)).body;
    const wd = (await a.post(`/api/goals/${goal}/entries`).send({ date: today(), deposit: false, amount: 6_000 }).expect(201)).body;
    const u1 = (await a.delete(`/api/goal-entries/${wd.id}`).expect(200)).body.undo;
    await a.post(`/api/undo/${u1}`).expect(200);
    // delete the withdrawal, then the deposit; bringing the withdrawal back would go negative
    const u2 = (await a.delete(`/api/goal-entries/${wd.id}`).expect(200)).body.undo;
    await a.delete(`/api/goal-entries/${dep.id}`).expect(200);
    const r = await a.post(`/api/undo/${u2}`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/balance negative/);
  });

  it('loan entries come back; an expense whose category is gone cannot', async () => {
    const a = await newUser();
    const l = (await a.post('/api/loans').send({ date: today(), person: 'Omar', borrowed: true, repayment: false, amount: 20_000 }).expect(201)).body;
    const u = (await a.delete(`/api/loans/${l.id}`).expect(200)).body.undo;
    expect((await state(a)).loans).toEqual([]);
    await a.post(`/api/undo/${u}`).expect(200);
    expect((await state(a)).loans[0]).toMatchObject({ id: l.id, person: 'Omar', amount: 20_000 });

    const cat = await newCategory(a, 'Temp');
    const e = (await a.post('/api/expenses').send({ date: today(), categoryId: cat, amount: 100 }).expect(201)).body;
    const ue = (await a.delete(`/api/expenses/${e.id}`).expect(200)).body.undo;
    await a.delete(`/api/categories/${cat}`).expect(204);
    expect((await a.post(`/api/undo/${ue}`)).status).toBe(409);
  });
});

describe('same as last month', () => {
  it('an empty month offers to copy the latest month that has a budget, skipping empty ones', async () => {
    const a = await newUser();
    const cat = await newCategory(a, 'Food');
    // Open Feb and Mar first (both blank), then fill in January.
    await state(a, '2026-02');
    await state(a, '2026-03');
    await state(a, '2026-01');
    await a.put('/api/budget/2026-01').send({ income: 500_000, uniDays: 0, uniWeeks: 4, uniCost: 0, savePlan: 50_000, loanPlan: 0 }).expect(200);
    await a.put(`/api/categories/${cat}`).send({ name: 'Food', planned: 150_000, month: '2026-01' }).expect(200);

    let mar = await state(a, '2026-03');
    expect(mar).toMatchObject({ canCopyPrevious: true, copyFrom: '2026-01' });
    expect((await state(a, '2026-01')).canCopyPrevious).toBe(false); // has data already

    const r = await a.post('/api/budget/2026-03/copy-previous').expect(200);
    expect(r.body.from).toBe('2026-01');
    mar = await state(a, '2026-03');
    expect(mar.budget).toMatchObject({ income: 500_000, savePlan: 50_000 });
    expect(mar.budget.plans[String(cat)]).toBe(150_000);
    expect(mar.canCopyPrevious).toBe(false);
  });

  it('nothing to copy: no offer, and the endpoint says so', async () => {
    const a = await newUser();
    expect((await state(a, '2026-05')).canCopyPrevious).toBe(false);
    expect((await a.post('/api/budget/2026-05/copy-previous')).status).toBe(400);
  });
});

describe('quick add suggestions', () => {
  it('lists the most used descriptions with their usual category, only for this account', async () => {
    const a = await newUser();
    const food = await newCategory(a, 'Food');
    const transport = await newCategory(a, 'Transport');
    const add = (description: string, categoryId: number, amount: number) =>
      a.post('/api/expenses?force=1').send({ date: today(), categoryId, description, amount }).expect(201);
    await add('Coffee', food, 3_000);
    await add('coffee ', food, 3_500);
    await add('Coffee', food, 3_000);
    await add('Bus', transport, 1_000);
    await add('', food, 500); // no description: not suggested
    const s = (await a.get('/api/expenses/suggestions').expect(200)).body;
    expect(s.map((x: any) => x.description.trim().toLowerCase())).toEqual(['coffee', 'bus']);
    expect(s[0]).toMatchObject({ categoryId: food, count: 3 });
    const b = await newUser();
    expect((await b.get('/api/expenses/suggestions')).body).toEqual([]);
  });
});
