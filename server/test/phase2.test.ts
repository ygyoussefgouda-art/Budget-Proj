/** Reports: month-over-month comparison and spending by weekday. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgliteDb, type Db } from '../src/db.js';
import { addDays, serverToday } from '../src/dates.js';
import { migrate } from '../src/migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let db: Db;
const mkApp = () => createApp(db, { csrfHeader: false, signupLimit: 1000, loginLimit: 1000 });
type Agent = ReturnType<typeof request.agent>;
let n = 0;
async function newUser(): Promise<Agent> {
  const a = request.agent(mkApp());
  await a.post('/api/auth/signup').send({ username: `p2.user${n++}`, password: 'phase-two-pass' }).expect(201);
  return a;
}
const cat = async (a: Agent, name: string) => (await a.post('/api/categories').send({ name, month: '2026-01' }).expect(201)).body.id as number;
const spend = (a: Agent, categoryId: number, date: string, amount: number) =>
  a.post('/api/expenses?force=1').send({ date, categoryId, amount, description: '' }).expect(201);

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, path.join(here, '..', 'migrations'));
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe('month-over-month comparison', () => {
  it('spending per category in a month and the month before; other accounts never count', async () => {
    const a = await newUser();
    const food = await cat(a, 'Food');
    const fun = await cat(a, 'Fun');
    const idle = await cat(a, 'Idle');
    await spend(a, food, '2026-02-03', 1000);
    await spend(a, food, '2026-02-20', 200);
    await spend(a, food, '2026-03-05', 1500);
    await spend(a, fun, '2026-03-06', 400);
    const b = await newUser();
    const bFood = await cat(b, 'Food');
    await spend(b, bFood, '2026-03-05', 99_999);

    const r = (await a.get('/api/reports/compare?month=2026-03').expect(200)).body;
    expect(r.month).toBe('2026-03');
    expect(r.previous).toBe('2026-02');
    const by = Object.fromEntries(r.categories.map((c: any) => [c.categoryId, [c.current, c.previous]]));
    expect(by[food]).toEqual([1500, 1200]);
    expect(by[fun]).toEqual([400, 0]);
    expect(by[idle]).toEqual([0, 0]);
    expect(r.total).toEqual({ current: 1900, previous: 1200 });
  });

  it('January compares with December of the year before, and follows the month start day', async () => {
    const a = await newUser();
    const food = await cat(a, 'Food');
    await a.put('/api/settings').send({ monthStartDay: 25 }).expect(200);
    // With months starting on the 25th: 26 Dec 2025 is in "December 2025", 26 Jan 2026 in "January 2026"
    await spend(a, food, '2025-12-26', 300);
    await spend(a, food, '2026-01-10', 100); // still the December period
    await spend(a, food, '2026-01-26', 700);
    const r = (await a.get('/api/reports/compare?month=2026-01').expect(200)).body;
    expect(r.previous).toBe('2025-12');
    expect(r.total).toEqual({ current: 700, previous: 400 });
  });

  it('rejects a bad month', async () => {
    const a = await newUser();
    expect((await a.get('/api/reports/compare?month=2026-13')).status).toBe(400);
    expect((await a.get('/api/reports/compare')).status).toBe(400);
  });
});

describe('spending by weekday', () => {
  const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

  it('average per weekday = total on that weekday ÷ how many of them the range has', async () => {
    const a = await newUser();
    const food = await cat(a, 'Food');
    // 14 days: exactly two of every weekday
    await spend(a, food, '2025-06-07', 600);
    await spend(a, food, '2025-06-14', 300); // same weekday, a week later
    await spend(a, food, '2025-06-02', 100);
    await spend(a, food, '2025-06-20', 5_000); // outside the range
    const r = (await a.get('/api/reports/weekdays?from=2025-06-01&to=2025-06-14').expect(200)).body;
    expect(r.days).toHaveLength(7);
    expect(r.days.every((d: any) => d.days === 2)).toBe(true);
    const byDow = Object.fromEntries(r.days.map((d: any) => [d.dow, d]));
    expect(byDow[dow('2025-06-07')]).toMatchObject({ total: 900, average: 450 });
    expect(byDow[dow('2025-06-02')]).toMatchObject({ total: 100, average: 50 });
    expect(r.days.reduce((s: number, d: any) => s + d.total, 0)).toBe(1000);
  });

  it('days after today are not counted; bad or huge ranges are refused', async () => {
    const a = await newUser();
    const today = serverToday();
    const r = (await a.get(`/api/reports/weekdays?from=${addDays(today, -6)}&to=${addDays(today, 30)}`).expect(200)).body;
    expect(r.to).toBe(today);
    expect(r.days.reduce((s: number, d: any) => s + d.days, 0)).toBe(7);
    expect((await a.get('/api/reports/weekdays?from=2026-02-10&to=2026-02-01')).status).toBe(400);
    expect((await a.get('/api/reports/weekdays?from=2020-01-01&to=2026-01-01')).status).toBe(400);
    expect((await a.get('/api/reports/weekdays?from=nope&to=2026-01-01')).status).toBe(400);
  });
});
