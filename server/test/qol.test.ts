/** 1.2.0: category icons and colours, budget rollover, Undo for whole goals and loan people. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { addMonths, carryChain } from '../src/rollover.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let db: Db;
type Agent = ReturnType<typeof request.agent>;
const mkApp = () => createApp(db, { requireEmail: false, strongPasswords: false, csrfHeader: false, signupLimit: 1000, loginLimit: 1000 });
let n = 0;
async function newUser(): Promise<Agent> {
  const a = request.agent(mkApp());
  await a.post('/api/auth/signup').send({ username: `qol.user${n++}`, password: 'qol-pass-12345' }).expect(201);
  return a;
}
const state = async (a: Agent, month: string) => (await a.get(`/api/state?month=${month}`).expect(200)).body;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, path.join(here, '..', 'migrations'));
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe('category icons and colours', () => {
  it('are saved, shown in the state, changed, cleared, and only from the app lists', async () => {
    const a = await newUser();
    const c = (await a.post('/api/categories').send({ name: 'Food', planned: 100000, month: '2026-11', icon: 'food', color: 'gold' }).expect(201)).body;
    expect(c).toMatchObject({ name: 'Food', icon: 'food', color: 'gold' });

    await a.put(`/api/categories/${c.id}`).send({ name: 'Food', month: '2026-11', icon: 'coffee' }).expect(200);
    let cat = (await state(a, '2026-11')).categories[0];
    expect(cat).toMatchObject({ icon: 'coffee', color: 'gold' }); // colour left alone when not sent

    await a.put(`/api/categories/${c.id}`).send({ name: 'Food', month: '2026-11', icon: null, color: null }).expect(200);
    cat = (await state(a, '2026-11')).categories[0];
    expect(cat).toMatchObject({ icon: null, color: null });

    for (const bad of [{ icon: 'skull' }, { color: '#ff0000' }, { icon: '<script>' }]) {
      expect((await a.put(`/api/categories/${c.id}`).send({ name: 'Food', month: '2026-11', ...bad })).status).toBe(400);
    }
  });

  it('a backup keeps them; an older backup without them still restores', async () => {
    const a = await newUser();
    await a.post('/api/categories').send({ name: 'Bus', month: '2026-11', icon: 'transport', color: 'blue' }).expect(201);
    await a.put('/api/settings').send({ rollover: true }).expect(200);
    const backup = (await a.get('/api/backup').expect(200)).body;
    expect(backup.tables.categories[0]).toMatchObject({ icon: 'transport', color: 'blue' });
    expect(backup.settings.rollover).toBe(true);

    await a.post('/api/backup/restore').send({ password: 'qol-pass-12345', backup }).expect(200);
    expect((await state(a, '2026-11')).categories[0]).toMatchObject({ name: 'Bus', icon: 'transport', color: 'blue' });

    // Old format: no icon/colour/rollover fields at all, plus an unknown icon from a newer app.
    const old = structuredClone(backup);
    delete old.settings.rollover;
    old.tables.categories = [{ id: 1, name: 'Old', is_uni: false, sort: 0 }, { id: 2, name: 'Odd', is_uni: false, sort: 1, icon: 'rocket' }];
    old.tables.category_plans = [];
    old.tables.expenses = [];
    old.tables.recurring_rules = [];
    old.tables.recurring_done = [];
    await a.post('/api/backup/restore').send({ password: 'qol-pass-12345', backup: old }).expect(200);
    const cats = (await state(a, '2026-11')).categories;
    expect(cats.map((x: { name: string; icon: string | null }) => [x.name, x.icon])).toEqual([['Old', null], ['Odd', null]]);
  });
});

describe('budget rollover', () => {
  it('the maths: unspent budget carries on, overspending never carries a negative amount', () => {
    const months = [
      { planned: { '1': 1000, '2': 500 }, spent: { '1': 400, '2': 900 } }, // 1: +600 left; 2: over by 400 → 0
      { planned: { '1': 1000, '2': 500 }, spent: { '1': 1500, '2': 100 } }, // 1: 1000+600-1500 = 100; 2: 400
      { planned: { '1': 1000 }, spent: {} }, // 1: 1100; 2: no plan, keeps 400
    ];
    expect(carryChain(months, [1, 2, 3])).toEqual({ '1': 1100, '2': 400 });
    expect(carryChain([], [1])).toEqual({});
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-11', -12)).toBe('2025-11');
  });

  it('is off by default; when on, the state carries last month’s unspent budget (month start day respected)', async () => {
    const a = await newUser();
    expect((await a.get('/api/auth/me')).body.user.rollover).toBe(false);
    await a.put('/api/settings').send({ monthStartDay: 25 }).expect(200);
    const food = (await a.post('/api/categories').send({ name: 'Food', planned: 100000, month: '2026-10' }).expect(201)).body.id;
    // Budget month 2026-10 with start day 25 = 25 Oct .. 24 Nov.
    await a.post('/api/expenses').send({ date: '2026-10-26', categoryId: food, amount: 30000 }).expect(201);
    await a.post('/api/expenses').send({ date: '2026-11-24', categoryId: food, amount: 20000 }).expect(201); // still October's month
    await a.post('/api/expenses').send({ date: '2026-11-25', categoryId: food, amount: 5000 }).expect(201); // November's month
    await state(a, '2026-11'); // opens November (copies October's plan)

    expect((await state(a, '2026-11')).carry).toEqual({});
    const on = (await a.put('/api/settings').send({ rollover: true }).expect(200)).body.user;
    expect(on.rollover).toBe(true);
    expect((await state(a, '2026-11')).carry).toEqual({ [food]: 50000 }); // 100000 - 30000 - 20000
    // December: November had 100000 + 50000 carried, 5000 spent.
    expect((await state(a, '2026-12')).carry).toEqual({ [food]: 145000 });

    await a.put('/api/settings').send({ rollover: false }).expect(200);
    expect((await state(a, '2026-12')).carry).toEqual({});
  });

  it('only ever looks at your own spending', async () => {
    const a = await newUser();
    const b = await newUser();
    const ca = (await a.post('/api/categories').send({ name: 'Food', planned: 10000, month: '2026-10' }).expect(201)).body.id;
    await b.post('/api/categories').send({ name: 'Food', planned: 10000, month: '2026-10' }).expect(201);
    await b.post('/api/expenses').send({ date: '2026-10-05', categoryId: (await state(b, '2026-10')).categories[0].id, amount: 9000 }).expect(201);
    await a.put('/api/settings').send({ rollover: true }).expect(200);
    await state(a, '2026-11');
    expect((await state(a, '2026-11')).carry).toEqual({ [ca]: 10000 });
  });
});

describe('merge repeats', () => {
  it('off by default: two quick "Transport 10" stay two expenses', async () => {
    const a = await newUser();
    expect((await a.get('/api/auth/me')).body.user.mergeRepeats).toBe(false);
    const c = (await a.post('/api/categories').send({ name: 'Transport', month: '2026-11' }).expect(201)).body.id;
    await a.post('/api/expenses').send({ date: '2026-11-10', categoryId: c, description: 'Bus', amount: 1000 }).expect(201);
    // the second identical one only needs the usual "Save anyway?" confirmation
    expect((await a.post('/api/expenses').send({ date: '2026-11-10', categoryId: c, description: 'Bus', amount: 1000 })).status).toBe(409);
    expect((await state(a, '2026-11')).expenses).toHaveLength(1);
  });

  it('on: the same expense again within 5 minutes is added to the last one', async () => {
    const a = await newUser();
    await a.put('/api/settings').send({ mergeRepeats: true }).expect(200);
    const c = (await a.post('/api/categories').send({ name: 'Transport', month: '2026-11' }).expect(201)).body.id;
    const first = (await a.post('/api/expenses').send({ date: '2026-11-10', categoryId: c, description: 'Bus', amount: 1000, tags: ['uni'] }).expect(201)).body;
    const second = (await a.post('/api/expenses').send({ date: '2026-11-10', categoryId: c, description: ' bus ', amount: 1000, tags: ['work'] }).expect(200)).body;
    expect(second).toMatchObject({ id: first.id, amount: 2000, merged: true, tags: ['uni', 'work'] });
    const list = (await state(a, '2026-11')).expenses;
    expect(list).toHaveLength(1);
    expect(list[0].amount).toBe(2000);
  });

  it('on: never merges different things, old ones, ones with something in between, splits, currencies, offline syncs or receipts', async () => {
    const a = await newUser();
    await a.put('/api/settings').send({ mergeRepeats: true }).expect(200);
    const c = (await a.post('/api/categories').send({ name: 'Transport', month: '2026-11' }).expect(201)).body.id;
    const food = (await a.post('/api/categories').send({ name: 'Food', month: '2026-11' }).expect(201)).body.id;
    const add = (body: object) => a.post('/api/expenses').send({ date: '2026-11-12', categoryId: c, description: 'Taxi', amount: 1500, ...body });

    const base = (await add({}).expect(201)).body;
    await add({ description: 'Uber' }).expect(201); // different description
    await add({ description: 'Uber', date: '2026-11-13' }).expect(201); // different date
    await add({ description: 'Uber', date: '2026-11-13', categoryId: food }).expect(201); // different category
    await add({ description: 'Bus', split: { person: 'Ali', share: 500 } }).expect(201);
    // Splits never merge: the second one gets the normal "identical expense, save anyway?" question (a merge would be 200).
    expect((await add({ description: 'Bus', split: { person: 'Ali', share: 500 } })).status).toBe(409);
    await add({ description: 'Late', noMerge: true }).expect(201);
    expect((await add({ description: 'Late', noMerge: true })).status).toBe(409); // a receipt is coming: normal duplicate check
    await add({ description: 'Sync', clientId: 'offline-0001' }).expect(201);
    expect((await add({ description: 'Sync', clientId: 'offline-0002' })).status).toBe(409); // offline syncs never merge

    // Older than 5 minutes: a new one stays separate.
    await add({ description: 'Old' }).expect(201);
    await db.query(`UPDATE expenses SET created_at = now() - interval '6 minutes' WHERE description = 'Old'`);
    expect((await add({ description: 'Old' })).status).toBe(409);

    // Something in between: "Taxi" is no longer the last one.
    expect((await add({})).status).toBe(409);
    const taxi = (await state(a, '2026-11')).expenses.find((x: { id: number }) => x.id === base.id);
    expect(taxi.amount).toBe(1500);
  });
});

describe('Undo for a whole goal and a whole person', () => {
  it('a deleted goal comes back with all its entries, once', async () => {
    const a = await newUser();
    const g = (await a.post('/api/goals').send({ name: 'Laptop', target: 500000, start: 1000 }).expect(201)).body.id;
    await a.post(`/api/goals/${g}/entries`).send({ date: '2026-11-03', deposit: true, amount: 20000, note: 'first' }).expect(201);
    await a.post(`/api/goals/${g}/entries`).send({ date: '2026-11-04', deposit: false, amount: 5000 }).expect(201);
    const { undo } = (await a.delete(`/api/goals/${g}`).expect(200)).body;
    let s = await state(a, '2026-11');
    expect(s.goals).toHaveLength(0);
    expect(s.goalEntries).toHaveLength(0);

    await a.post(`/api/undo/${undo}`).expect(200);
    s = await state(a, '2026-11');
    expect(s.goals).toMatchObject([{ id: g, name: 'Laptop', balance: 1000 + 20000 - 5000 }]);
    expect(s.goalEntries).toHaveLength(2);
    expect((await a.post(`/api/undo/${undo}`)).status).toBe(410); // a second tap does nothing
  });

  it('a deleted person comes back with every entry; nobody else can undo it', async () => {
    const a = await newUser();
    const other = await newUser();
    await a.post('/api/loans').send({ date: '2026-11-01', person: 'Sara', borrowed: false, repayment: false, amount: 30000 }).expect(201);
    await a.post('/api/loans').send({ date: '2026-11-05', person: 'sara', borrowed: false, repayment: true, amount: 10000 }).expect(201);
    await a.post('/api/loans').send({ date: '2026-11-06', person: 'Sara', borrowed: true, repayment: false, amount: 700 }).expect(201); // other direction stays
    const { undo } = (await a.delete('/api/loan-people?borrowed=false&name=Sara').expect(200)).body;
    expect((await state(a, '2026-11')).loans).toHaveLength(1);

    expect((await other.post(`/api/undo/${undo}`)).status).toBe(410);
    await a.post(`/api/undo/${undo}`).expect(200);
    const loans = (await state(a, '2026-11')).loans;
    expect(loans).toHaveLength(3);
    expect(loans.filter((l: { borrowed: boolean }) => !l.borrowed).map((l: { amount: number }) => l.amount).sort()).toEqual([10000, 30000]);
  });
});
