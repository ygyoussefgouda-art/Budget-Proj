/** 2.2.0: time of day on expenses, extra income entries. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, path.join(here, '..', 'migrations'));
  app = createApp(db, { requireEmail: false, strongPasswords: false, csrfHeader: false, starterCategories: false });
}, 60_000);
afterAll(async () => {
  await db?.close();
});

async function account(username: string) {
  const a = request.agent(app);
  await a.post('/api/auth/signup').send({ username, password: 'long-enough-pass' }).expect(201);
  const cat = (await a.post('/api/categories').send({ name: 'Food', month: '2026-11' }).expect(201)).body.id as number;
  return { a, cat };
}

describe('time of day on expenses', () => {
  it('is saved, listed newest time first, kept by an edit that does not send it, cleared with null', async () => {
    const { a, cat } = await account('time.user');
    const base = { date: '2026-11-20', categoryId: cat, amount: 1000 };
    const early = (await a.post('/api/expenses').send({ ...base, description: 'Breakfast', time: '08:15' }).expect(201)).body;
    expect(early.time).toBe('08:15');
    await a.post('/api/expenses').send({ ...base, description: 'Dinner', time: '20:40' }).expect(201);
    await a.post('/api/expenses').send({ ...base, description: 'No time' }).expect(201);

    const list = (await a.get('/api/expenses?from=2026-11-20&to=2026-11-20').expect(200)).body.items;
    expect(list.map((e: { description: string }) => e.description)).toEqual(['Dinner', 'Breakfast', 'No time']);

    await a.put(`/api/expenses/${early.id}`).send({ ...base, description: 'Breakfast!' }).expect(200);
    expect((await a.get('/api/expenses?q=Breakfast').expect(200)).body.items[0].time).toBe('08:15');
    await a.put(`/api/expenses/${early.id}`).send({ ...base, description: 'Breakfast!', time: null }).expect(200);
    expect((await a.get('/api/expenses?q=Breakfast').expect(200)).body.items[0].time).toBeNull();
  });

  it('refuses a time that is not HH:MM', async () => {
    const { a, cat } = await account('time.bad');
    for (const time of ['24:00', '9:30', '12:60', 'noon']) {
      await a.post('/api/expenses').send({ date: '2026-11-20', categoryId: cat, amount: 100, time }).expect(400);
    }
  });
});

describe('extra income', () => {
  it('counts in its budget month, shows in recent activity and the year report', async () => {
    const { a } = await account('income.user');
    await a.put('/api/budget/2026-11').send({ income: 500000, uniDays: 0, uniWeeks: 4, uniCost: 0, savePlan: 0, loanPlan: 0 }).expect(200);
    const inc = (await a.post('/api/incomes').send({ date: '2026-11-10', amount: 120000, description: 'Freelance' }).expect(201)).body;
    await a.post('/api/incomes').send({ date: '2026-12-02', amount: 5000, description: 'Gift' }).expect(201);

    const state = (await a.get('/api/state?month=2026-11').expect(200)).body;
    expect(state.incomes).toEqual([{ id: inc.id, date: '2026-11-10', amount: 120000, description: 'Freelance' }]);
    expect(state.recent.filter((r: { kind: string }) => r.kind === 'income')).toMatchObject([
      { title: 'Gift', amount: 5000 }, // newest first (recent activity is not limited to the month)
      { title: 'Freelance', amount: 120000 },
    ]);

    const year = (await a.get('/api/reports/year?y=2026').expect(200)).body.months;
    expect(year.find((m: { month: string }) => m.month === '2026-11').income).toBe(620000);
    expect(year.find((m: { month: string }) => m.month === '2026-12').income).toBe(5000); // December not opened yet: only the gift
  });

  it('asks before saving an identical one, can be edited, deleted and brought back with Undo', async () => {
    const { a } = await account('income.edit');
    const body = { date: '2026-11-10', amount: 3000, description: 'Bonus' };
    const inc = (await a.post('/api/incomes').send(body).expect(201)).body;
    expect((await a.post('/api/incomes').send(body).expect(409)).body.code).toBe('confirm');
    await a.post('/api/incomes?force=1').send(body).expect(201);

    await a.put(`/api/incomes/${inc.id}`).send({ ...body, amount: 4000 }).expect(200);
    const undo = (await a.delete(`/api/incomes/${inc.id}`).expect(200)).body.undo;
    expect((await a.get('/api/state?month=2026-11').expect(200)).body.incomes).toHaveLength(1);
    await a.post(`/api/undo/${undo}`).expect(200);
    const back = (await a.get('/api/state?month=2026-11').expect(200)).body.incomes;
    expect(back.find((i: { id: number }) => i.id === inc.id)).toMatchObject({ amount: 4000 });
  });

  it('belongs to one account only', async () => {
    const { a } = await account('income.owner');
    const other = (await account('income.other')).a;
    const inc = (await a.post('/api/incomes').send({ date: '2026-11-10', amount: 100 }).expect(201)).body;
    await other.put(`/api/incomes/${inc.id}`).send({ date: '2026-11-10', amount: 999 }).expect(404);
    await other.delete(`/api/incomes/${inc.id}`).expect(404);
    expect((await other.get('/api/state?month=2026-11').expect(200)).body.incomes).toEqual([]);
  });

  it('goes into the backup with expense times, and comes back on restore', async () => {
    const { a, cat } = await account('income.backup');
    await a.post('/api/incomes').send({ date: '2026-11-10', amount: 7000, description: 'Tutoring' }).expect(201);
    await a.post('/api/expenses').send({ date: '2026-11-11', categoryId: cat, amount: 500, time: '13:45' }).expect(201);
    const backup = (await a.get('/api/backup').expect(200)).body;
    expect(backup.tables.incomes).toEqual([{ date: '2026-11-10', amount: 7000, description: 'Tutoring' }]);
    expect(backup.tables.expenses[0].time_of_day).toBe('13:45');

    await a.post('/api/backup/restore').send({ password: 'long-enough-pass', backup }).expect(200);
    const state = (await a.get('/api/state?month=2026-11').expect(200)).body;
    expect(state.incomes).toMatchObject([{ amount: 7000, description: 'Tutoring' }]);
    expect(state.expenses[0].time).toBe('13:45');
  });
});
