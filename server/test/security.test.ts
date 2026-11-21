/**
 * Security and isolation tests (0.6.2): one account can never read, change or delete another
 * account's data; routes that had no test; offline retries; receipt quota; headers and cookies.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { housekeeping } from '../src/undo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let db: Db;
const mkApp = () => createApp(db, { csrfHeader: false, signupLimit: 1000, loginLimit: 1000 });
type Agent = ReturnType<typeof request.agent>;
const PASS = 'security-pass-123';
let n = 0;
async function newUser(): Promise<{ a: Agent; name: string; id: number }> {
  const a = request.agent(mkApp());
  const name = `sec.user${n++}`;
  const r = await a.post('/api/auth/signup').send({ username: name, password: PASS }).expect(201);
  return { a, name, id: r.body.user.id };
}

/** An account with one of everything. */
async function fullAccount() {
  const u = await newUser();
  const a = u.a;
  const cat = (await a.post('/api/categories').send({ name: 'Food', month: '2026-11' }).expect(201)).body.id as number;
  const exp = (await a.post('/api/expenses').send({ date: '2026-11-05', categoryId: cat, amount: 500, description: 'Secret dinner', tags: ['private'] }).expect(201)).body.id as number;
  const goal = (await a.post('/api/goals').send({ name: 'Laptop', target: 100000 }).expect(201)).body.id as number;
  const entry = (await a.post(`/api/goals/${goal}/entries`).send({ date: '2026-11-06', deposit: true, amount: 1000, note: 'first' }).expect(201)).body.id as number;
  const loan = (await a.post('/api/loans').send({ date: '2026-11-07', person: 'Omar', borrowed: false, repayment: false, amount: 300, note: 'lunch' }).expect(201)).body.id as number;
  const rule = (await a.post('/api/recurring').send({ categoryId: cat, amount: 200, description: 'Gym', day: 3 }).expect(201)).body.id as number;
  return { ...u, cat, exp, goal, entry, loan, rule };
}

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, path.join(here, '..', 'migrations'));
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe("another account's data is out of reach", () => {
  it('reads: none of it shows up anywhere', async () => {
    await fullAccount();
    const { a: other } = await newUser();
    const state = (await other.get('/api/state?month=2026-11').expect(200)).body;
    expect(state.categories).toEqual([]);
    expect(state.goals).toEqual([]);
    expect(state.loans).toEqual([]);
    const all = JSON.stringify([
      state,
      (await other.get('/api/expenses?from=2000-01-01&to=2100-12-31')).body,
      (await other.get('/api/tags')).body,
      (await other.get('/api/recurring')).body,
      (await other.get('/api/backup')).body,
      (await other.get('/api/reports/year?y=2026')).body,
      (await other.get('/api/reports/tags?from=2026-01-01&to=2026-12-31')).body,
      (await other.get('/api/expenses/suggestions')).body,
    ]);
    for (const secret of ['Secret dinner', 'private', 'Laptop', 'Omar', 'Gym']) expect(all).not.toContain(secret);
    const csv = await other.get('/api/export?kind=expenses&from=2026-01-01&to=2026-12-31&format=csv').expect(200);
    expect(csv.text).not.toContain('Secret dinner');
  });

  it("writes and deletes on someone else's ids fail and change nothing", async () => {
    const v = await fullAccount();
    const { a: x } = await newUser();
    const myCat = (await x.post('/api/categories').send({ name: 'Mine', month: '2026-11' }).expect(201)).body.id;
    const tries: [string, string, object?][] = [
      ['put', `/api/categories/${v.cat}`, { name: 'Hacked', month: '2026-11', perDay: false, planned: 1 }],
      ['delete', `/api/categories/${v.cat}`],
      ['put', `/api/expenses/${v.exp}?force=1`, { date: '2026-11-05', categoryId: myCat, amount: 1 }],
      ['delete', `/api/expenses/${v.exp}`],
      ['get', `/api/expenses/${v.exp}/receipt`],
      ['delete', `/api/expenses/${v.exp}/receipt`],
      ['put', `/api/goals/${v.goal}`, { name: 'Hacked', target: 1 }],
      ['delete', `/api/goals/${v.goal}`],
      ['post', `/api/goals/${v.goal}/entries`, { date: '2026-11-06', deposit: false, amount: 1000 }],
      ['put', `/api/goal-entries/${v.entry}`, { date: '2026-11-06', deposit: false, amount: 1 }],
      ['delete', `/api/goal-entries/${v.entry}`],
      ['put', `/api/loans/${v.loan}?force=1`, { date: '2026-11-07', person: 'X', borrowed: true, repayment: false, amount: 1 }],
      ['delete', `/api/loans/${v.loan}`],
      ['put', `/api/recurring/${v.rule}`, { categoryId: myCat, amount: 1, day: 1 }],
      ['delete', `/api/recurring/${v.rule}`],
    ];
    for (const [m, url, body] of tries) {
      const r = await (x as any)[m](url).send(body ?? {});
      expect([400, 403, 404], `${m} ${url} -> ${r.status}`).toContain(r.status);
    }
    // Using someone else's category for my own expense is refused too.
    expect((await x.post('/api/expenses?force=1').send({ date: '2026-11-05', categoryId: v.cat, amount: 1 })).status).toBe(400);
    // Removing "their" person in my account touches nothing of theirs.
    await x.delete('/api/loan-people?borrowed=false&name=Omar').expect(404);

    const after = (await v.a.get('/api/state?month=2026-11').expect(200)).body;
    expect(after.categories.map((c: { name: string }) => c.name)).toEqual(['Food']);
    expect(after.goals[0]).toMatchObject({ name: 'Laptop', balance: 1000 });
    expect(after.loans[0]).toMatchObject({ person: 'Omar', amount: 300 });
    const exps = (await v.a.get('/api/expenses?from=2026-11-01&to=2026-11-30').expect(200)).body;
    expect(JSON.stringify(exps)).toContain('Secret dinner');
  });

  it("an Undo id from another account can't restore into it", async () => {
    const v = await fullAccount();
    const undo = (await v.a.delete(`/api/expenses/${v.exp}`).expect(200)).body.undo;
    const { a: x } = await newUser();
    expect([403, 404, 410]).toContain((await x.post(`/api/undo/${undo}`)).status);
    await v.a.post(`/api/undo/${undo}`).expect(200);
  });
});

describe('routes that had no test', () => {
  it('edit a loan entry and a savings entry; clear plans; sign out', async () => {
    const v = await fullAccount();
    const l = await v.a.put(`/api/loans/${v.loan}`).send({ date: '2026-11-08', person: 'Omar', borrowed: false, repayment: false, amount: 450, note: 'dinner' }).expect(200);
    expect(l.body).toMatchObject({ amount: 450, date: '2026-11-08', note: 'dinner' });
    const g = await v.a.put(`/api/goal-entries/${v.entry}`).send({ date: '2026-11-06', deposit: true, amount: 2500, note: 'more' }).expect(200);
    expect(g.body).toMatchObject({ amount: 2500 });
    expect((await v.a.get('/api/state?month=2026-11')).body.goals[0].balance).toBe(2500);
    // A withdrawal bigger than the balance is refused.
    expect((await v.a.put(`/api/goal-entries/${v.entry}`).send({ date: '2026-11-06', deposit: false, amount: 1 })).status).toBe(400);

    await v.a.put(`/api/categories/${v.cat}`).send({ name: 'Food', month: '2026-11', perDay: false, planned: 9000 }).expect(200);
    const planned = async () => (await db.query('SELECT COALESCE(SUM(planned), 0)::int AS p FROM category_plans WHERE user_id = $1', [v.id])).rows[0].p;
    expect(await planned()).toBe(9000);
    await v.a.post('/api/budget/2026-11/clear-plans').expect(200);
    expect(await planned()).toBe(0);

    await v.a.post('/api/auth/logout').expect(204);
    expect((await v.a.get('/api/state?month=2026-11')).status).toBe(401);
  });
});

describe('offline retries', () => {
  it('a retry without ?force=1 still returns the saved expense, never a copy', async () => {
    const v = await fullAccount();
    const body = { date: '2026-11-09', categoryId: v.cat, amount: 75, description: 'Bus', clientId: 'c-sec-retry-0001' };
    const first = await v.a.post('/api/expenses').send(body).expect(201);
    const again = await v.a.post('/api/expenses').send(body).expect(200);
    expect(again.body.id).toBe(first.body.id);
  });

  it('a retry of something deleted since is answered "deleted" and not brought back', async () => {
    const v = await fullAccount();
    const body = { date: '2026-11-09', categoryId: v.cat, amount: 80, description: 'Taxi', clientId: 'c-sec-retry-0002' };
    const first = (await v.a.post('/api/expenses?force=1').send(body).expect(201)).body;
    await v.a.delete(`/api/expenses/${first.id}`).expect(200);
    const r = await v.a.post('/api/expenses?force=1').send(body);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('deleted');
    const exps = (await v.a.get('/api/expenses?from=2026-11-01&to=2026-11-30')).body;
    expect(JSON.stringify(exps)).not.toContain('Taxi');
  });
});

describe('receipt storage quota', () => {
  it('receipts waiting in the Undo trash still count', async () => {
    process.env.RECEIPT_QUOTA_MB = '1';
    try {
      const v = await fullAccount();
      const png = (kb: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(kb * 1024, 1)]);
      await v.a.put(`/api/expenses/${v.exp}/receipt`).set('Content-Type', 'image/png').send(png(700)).expect(200);
      await v.a.delete(`/api/expenses/${v.exp}`).expect(200); // receipt goes to the trash with it
      const e2 = (await v.a.post('/api/expenses?force=1').send({ date: '2026-11-10', categoryId: v.cat, amount: 5 }).expect(201)).body.id;
      const r = await v.a.put(`/api/expenses/${e2}/receipt`).set('Content-Type', 'image/png').send(png(700));
      expect(r.status).toBe(413);
    } finally {
      delete process.env.RECEIPT_QUOTA_MB;
    }
  });
});

describe('housekeeping', () => {
  it('clears expired sessions and old reset codes', async () => {
    const v = await newUser();
    await db.query("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [v.id]);
    await db.query(
      "INSERT INTO password_resets(user_id, code_hash, created_by, expires_at) VALUES ($1, 'old-hash-sec', $1, now() - interval '3 days')",
      [v.id],
    );
    await housekeeping(db);
    expect((await db.query('SELECT COUNT(*)::int AS n FROM sessions WHERE user_id = $1', [v.id])).rows[0].n).toBe(0);
    expect((await db.query("SELECT COUNT(*)::int AS n FROM password_resets WHERE code_hash = 'old-hash-sec'")).rows[0].n).toBe(0);
  });
});

describe('headers and cookies', () => {
  it('strict security headers, no caching of API data, safe session cookie', async () => {
    const app = createApp(db, { csrfHeader: false, signupLimit: 1000 });
    const r = await request(app).post('/api/auth/signup').send({ username: 'sec.cookie', password: PASS }).expect(201);
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(r.headers['cache-control']).toBe('no-store');
    const h = (await request(app).get('/api/health')).headers;
    expect(h['content-security-policy']).toContain("script-src 'self'");
    expect(h['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-powered-by']).toBeUndefined();
    expect(h['referrer-policy']).toBe('same-origin');
  });

  it('writes from another site are refused even with a valid session', async () => {
    const app = createApp(db, { signupLimit: 1000 });
    const a = request.agent(app);
    await a.post('/api/auth/signup').set('X-Requested-With', 'budget-me').send({ username: 'sec.csrf', password: PASS }).expect(201);
    const evil = await a.post('/api/categories').set('X-Requested-With', 'budget-me').set('Origin', 'https://evil.example').send({ name: 'X', month: '2026-11' });
    expect(evil.status).toBe(403);
    const noHeader = await a.post('/api/categories').send({ name: 'X', month: '2026-11' });
    expect(noHeader.status).toBe(403);
  });
});
