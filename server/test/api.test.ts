import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureOwner } from '../src/auth.js';
import { createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PASSWORD = 'correct horse battery';

let db: Db;
/** App for the functional tests: same as production but without the CSRF header check (tested separately). */
const mkApp = (opts: Parameters<typeof createApp>[1] = {}) => createApp(db, { csrfHeader: false, ...opts });
let agent: ReturnType<typeof request.agent>;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, path.join(here, '..', 'migrations'));
  await ensureOwner(db, PASSWORD, true); // tests use the workbook example data as a fixture
  agent = request.agent(mkApp());
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('fresh install', () => {
  it('a brand-new account starts completely empty (no template data)', async () => {
    const fresh = await createPgliteDb();
    try {
      await migrate(fresh, path.join(here, '..', 'migrations'));
      await ensureOwner(fresh, PASSWORD);
      const a = request.agent(createApp(fresh, { csrfHeader: false }));
      await a.post('/api/auth/login').send({ password: PASSWORD }).expect(200);
      const s = (await a.get('/api/state?month=2026-11')).body;
      expect(s.categories).toEqual([]);
      expect(s.goals).toEqual([]);
      expect(s.loans).toEqual([]);
      expect(s.expenses).toEqual([]);
      expect(s.recent).toEqual([]);
      expect(s.budget).toMatchObject({ income: 0, savePlan: 0, loanPlan: 0 });
    } finally {
      await fresh.close();
    }
  }, 60_000);
});

describe('sign up', () => {
  it('creates an account, signs it in, and it starts empty', async () => {
    const a = request.agent(mkApp());
    const r = await a.post('/api/auth/signup').send({ username: 'Mona.K', password: 'secret-pass-1' });
    expect(r.status).toBe(201);
    expect(r.body.user.username).toBe('mona.k'); // usernames are lower-cased
    const s = (await a.get('/api/state?month=2026-11')).body;
    expect(s.categories).toEqual([]);
    expect(s.goals).toEqual([]);
  });

  it('keeps every account\'s data separate', async () => {
    const a = request.agent(mkApp());
    await a.post('/api/auth/login').send({ username: 'mona.k', password: 'secret-pass-1' }).expect(200);
    const mine = await a.post('/api/categories').send({ name: 'Mona only', month: '2026-11' }).expect(201);
    const owner = request.agent(mkApp());
    await owner.post('/api/auth/login').send({ username: 'owner', password: PASSWORD }).expect(200);
    // the owner does not see it...
    const owners = (await owner.get('/api/state?month=2026-11')).body.categories;
    expect(owners.map((c: any) => c.name)).not.toContain('Mona only');
    // ...cannot delete it...
    expect((await owner.delete(`/api/categories/${mine.body.id}`)).status).toBe(404);
    // ...and Mona cannot delete the owner's data
    expect((await a.delete(`/api/categories/${owners[0].id}`)).status).toBe(404);
  });

  it('rejects a taken username, a short password and odd characters', async () => {
    const a = request(mkApp());
    expect((await a.post('/api/auth/signup').send({ username: 'MONA.K', password: 'another-pass' })).status).toBe(409);
    expect((await a.post('/api/auth/signup').send({ username: 'newuser', password: 'short' })).status).toBe(400);
    expect((await a.post('/api/auth/signup').send({ username: 'no spaces!', password: 'long-enough' })).status).toBe(400);
  });

  it('can be turned off', async () => {
    const closed = request(mkApp({ allowSignup: false }));
    expect((await closed.get('/api/auth/config')).body).toEqual({ signupEnabled: false, inviteRequired: false });
    expect((await closed.post('/api/auth/signup').send({ username: 'blocked', password: 'long-enough' })).status).toBe(403);
  });

  it('wrong username or password gives the same message', async () => {
    const a = request(mkApp());
    const r1 = await a.post('/api/auth/login').send({ username: 'nobody', password: 'whatever-123' });
    const r2 = await a.post('/api/auth/login').send({ username: 'mona.k', password: 'wrong-password' });
    expect(r1.status).toBe(401);
    expect(r1.body.error).toBe(r2.body.error);
  });
});

describe('auth', () => {
  it('rejects anonymous requests', async () => {
    const r = await request(mkApp()).get('/api/state?month=2026-11');
    expect(r.status).toBe(401);
  });

  it('rejects a wrong password', async () => {
    const r = await request(mkApp()).post('/api/auth/login').send({ password: 'nope' });
    expect(r.status).toBe(401);
  });

  it('signs in with the right password and sets an httpOnly cookie', async () => {
    const r = await agent.post('/api/auth/login').send({ password: PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.user.username).toBe('owner');
    expect(String(r.headers['set-cookie'])).toMatch(/sb_session=.*HttpOnly/i);
  });

  it('health is public', async () => {
    const r = await request(mkApp()).get('/api/health');
    expect(r.body).toEqual({ ok: true });
  });
});

describe('starting data (workbook, Nov 2026)', () => {
  it('returns the seeded budget, categories, goal and loans', async () => {
    const r = await agent.get('/api/state?month=2026-11');
    expect(r.status).toBe(200);
    const s = r.body;
    expect(s.budget).toMatchObject({ income: 250000, uniDays: 3, uniWeeks: 4, uniCost: 10000, savePlan: 50000, loanPlan: 50000 });
    expect(s.categories.map((c: any) => c.name)).toEqual(['Uni Transport & Food', 'Transportation', 'ETC', 'Hangouts']);
    expect(s.categories[0].isUni).toBe(true);
    expect(s.goals[0]).toMatchObject({ name: 'Guitar', target: 1000000, start: 152600, balance: 152600 });
    expect(s.loans).toHaveLength(3);
    expect(s.expenses).toHaveLength(0); // sample expenses are in June
    expect(s.recent[0]).toMatchObject({ kind: 'repay', title: 'Paid back Yaso', amount: -5000 });
  });

  it('a new month copies the nearest earlier budget', async () => {
    const r = await agent.get('/api/state?month=2026-12');
    expect(r.body.budget.income).toBe(250000);
    expect(r.body.hasEarlierMonth).toBe(true);
  });
});

describe('expenses', () => {
  let catId: number;
  let expenseId: number;

  it('adds an expense and warns about duplicates', async () => {
    catId = (await agent.get('/api/state?month=2026-11')).body.categories[3].id;
    const body = { date: '2026-11-02', categoryId: catId, description: 'Cinema', amount: 15000 };
    const a = await agent.post('/api/expenses').send(body);
    expect(a.status).toBe(201);
    expenseId = a.body.id;
    const dup = await agent.post('/api/expenses').send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('confirm');
    const forced = await agent.post('/api/expenses?force=1').send(body);
    expect(forced.status).toBe(201);
    await agent.delete(`/api/expenses/${forced.body.id}`).expect(200);
  });

  it('validates input', async () => {
    const r = await agent.post('/api/expenses').send({ date: '2026-02-30', categoryId: catId, amount: 5 });
    expect(r.status).toBe(400);
    const neg = await agent.post('/api/expenses').send({ date: '2026-11-02', categoryId: catId, amount: -5 });
    expect(neg.status).toBe(400);
  });

  it('searches and totals', async () => {
    const r = await agent.get('/api/expenses?q=cine');
    expect(r.body.count).toBe(1);
    expect(r.body.total).toBe(15000);
    expect(r.body.items[0].categoryName).toBe('Hangouts');
    const june = await agent.get('/api/expenses?from=2026-06-01&to=2026-06-30');
    expect(june.body.total).toBe(37000);
  });

  it('cannot delete a category that still has expenses', async () => {
    expect((await agent.delete(`/api/categories/${catId}`)).status).toBe(400);
  });

  it('updates and deletes', async () => {
    const u = await agent
      .put(`/api/expenses/${expenseId}`)
      .send({ date: '2026-11-03', categoryId: catId, description: 'Cinema + popcorn', amount: 20000 });
    expect(u.status).toBe(200);
    expect(u.body.amount).toBe(20000);
    await agent.delete(`/api/expenses/${expenseId}`).expect(200);
  });
});

describe('categories and budget', () => {
  it('creates a category with a plan, rejects duplicates by name', async () => {
    const c = await agent.post('/api/categories').send({ name: 'Books', planned: 30000, month: '2026-11' });
    expect(c.status).toBe(201);
    const dup = await agent.post('/api/categories').send({ name: 'books', month: '2026-11' });
    expect(dup.status).toBe(409);
    const s = (await agent.get('/api/state?month=2026-11')).body;
    expect(s.budget.plans[c.body.id]).toBe(30000);
    await agent.delete(`/api/categories/${c.body.id}`).expect(204);
  });

  it('moves the per-day formula to another category (only one at a time)', async () => {
    const c = await agent.post('/api/categories').send({ name: 'Gym', month: '2026-11', perDay: true });
    expect(c.status).toBe(201);
    let cats = (await agent.get('/api/state?month=2026-11')).body.categories;
    expect(cats.filter((x: any) => x.isUni).map((x: any) => x.name)).toEqual(['Gym']);
    const uni = cats.find((x: any) => x.name === 'Uni Transport & Food');
    await agent.put(`/api/categories/${uni.id}`).send({ name: uni.name, month: '2026-11', perDay: true }).expect(200);
    cats = (await agent.get('/api/state?month=2026-11')).body.categories;
    expect(cats.filter((x: any) => x.isUni).map((x: any) => x.name)).toEqual(['Uni Transport & Food']);
    await agent.delete(`/api/categories/${c.body.id}`).expect(204);
  });

  it('saves monthly settings with limits', async () => {
    const bad = await agent
      .put('/api/budget/2026-11')
      .send({ income: 1, uniDays: 8, uniWeeks: 4, uniCost: 0, savePlan: 0, loanPlan: 0 });
    expect(bad.status).toBe(400);
    const ok = await agent
      .put('/api/budget/2026-11')
      .send({ income: 250000, uniDays: 3, uniWeeks: 4, uniCost: 10000, savePlan: 50000, loanPlan: 50000 });
    expect(ok.status).toBe(200);
  });
});

describe('savings goals', () => {
  let goalId: number;

  it('blocks withdrawing more than the balance', async () => {
    goalId = (await agent.get('/api/state?month=2026-11')).body.goals[0].id;
    const w = await agent.post(`/api/goals/${goalId}/entries`).send({ date: '2026-11-04', deposit: false, amount: 999999 });
    expect(w.status).toBe(400);
    expect(w.body.error).toMatch(/cannot withdraw/);
  });

  it('deposit then withdraw updates the balance', async () => {
    await agent.post(`/api/goals/${goalId}/entries`).send({ date: '2026-11-03', deposit: true, amount: 60000 }).expect(201);
    await agent.post(`/api/goals/${goalId}/entries`).send({ date: '2026-11-04', deposit: false, amount: 10000 }).expect(201);
    const g = (await agent.get('/api/state?month=2026-11')).body.goals[0];
    expect(g.balance).toBe(152600 + 50000);
  });

  it('will not delete a deposit if that makes the balance negative', async () => {
    const g = await agent.post('/api/goals').send({ name: 'Laptop', target: 100000 });
    const d = await agent.post(`/api/goals/${g.body.id}/entries`).send({ date: '2026-11-05', deposit: true, amount: 1000 });
    await agent.post(`/api/goals/${g.body.id}/entries`).send({ date: '2026-11-06', deposit: false, amount: 800 }).expect(201);
    expect((await agent.delete(`/api/goal-entries/${d.body.id}`)).status).toBe(400);
    await agent.delete(`/api/goals/${g.body.id}`).expect(204);
  });
});

describe('loans', () => {
  it('warns when repaying more than owed', async () => {
    const r = await agent
      .post('/api/loans')
      .send({ date: '2026-11-07', person: 'dad', borrowed: true, repayment: true, amount: 25000 });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/200/);
  });

  it('renames a person across all their entries, then deletes them', async () => {
    await agent.put('/api/loan-people').send({ borrowed: true, from: 'yaso', to: 'Yasmine' }).expect(200);
    const names = (await agent.get('/api/state?month=2026-11')).body.loans.map((l: any) => l.person);
    expect(names.filter((n: string) => n === 'Yasmine')).toHaveLength(2);
    // put it back for later tests
    await agent.put('/api/loan-people').send({ borrowed: true, from: 'Yasmine', to: 'Yaso' }).expect(200);
    await agent.post('/api/loans').send({ date: '2026-11-08', person: 'Temp', borrowed: false, repayment: false, amount: 100 });
    await agent.delete('/api/loan-people?borrowed=false&name=temp').expect(204);
    const lent = (await agent.get('/api/state?month=2026-11')).body.loans.filter((l: any) => !l.borrowed);
    expect(lent).toHaveLength(0);
  });
});

describe('receipts', () => {
  // Smallest valid-looking files: real magic bytes + some payload.
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 2)]);
  let expenseId: number;

  it('attaches a photo to an expense and serves it back', async () => {
    const cat = (await agent.get('/api/state?month=2026-11')).body.categories[1].id;
    expenseId = (await agent.post('/api/expenses?force=1').send({ date: '2026-11-09', categoryId: cat, amount: 7700 })).body.id;
    const up = await agent.put(`/api/expenses/${expenseId}/receipt`).set('Content-Type', 'image/png').send(PNG);
    expect(up.status).toBe(200);
    expect(up.body.mime).toBe('image/png');
    const list = (await agent.get('/api/state?month=2026-11')).body.expenses;
    expect(list.find((e: any) => e.id === expenseId).hasReceipt).toBe(true);
    const got = await agent.get(`/api/expenses/${expenseId}/receipt`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(got.body as Buffer, PNG)).toBe(0);
  });

  it('replaces it with a PDF, ignoring the Content-Type the client claims', async () => {
    const up = await agent.put(`/api/expenses/${expenseId}/receipt`).set('Content-Type', 'image/jpeg').send(PDF);
    expect(up.body.mime).toBe('application/pdf');
  });

  it('rejects files that are not photos or PDFs', async () => {
    const r = await agent
      .put(`/api/expenses/${expenseId}/receipt`)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('<html><script>alert(1)</script></html>'));
    expect(r.status).toBe(415);
  });

  it('other accounts cannot see or change it', async () => {
    const other = request.agent(mkApp());
    await other.post('/api/auth/signup').send({ username: 'receipt.peeker', password: 'long-enough-1' }).expect(201);
    expect((await other.get(`/api/expenses/${expenseId}/receipt`)).status).toBe(404);
    expect((await other.put(`/api/expenses/${expenseId}/receipt`).set('Content-Type', 'image/png').send(PNG)).status).toBe(404);
    expect((await other.delete(`/api/expenses/${expenseId}/receipt`)).status).toBe(404);
  });

  it('can be removed, and goes away with its expense', async () => {
    await agent.delete(`/api/expenses/${expenseId}/receipt`).expect(204);
    expect((await agent.get(`/api/expenses/${expenseId}/receipt`)).status).toBe(404);
    await agent.put(`/api/expenses/${expenseId}/receipt`).set('Content-Type', 'image/png').send(PNG).expect(200);
    await agent.delete(`/api/expenses/${expenseId}`).expect(200);
    const left = await db.query('SELECT COUNT(*)::int AS n FROM receipts WHERE expense_id = $1', [expenseId]);
    expect(left.rows[0].n).toBe(0);
  });
});

describe('month start day', () => {
  it('a month runs from the start day to the day before it next month', async () => {
    const me = await agent.put('/api/settings').send({ monthStartDay: 10 });
    expect(me.body.user.monthStartDay).toBe(10);
    const cat = (await agent.get('/api/state?month=2026-11')).body.categories[1].id;
    // 5 Nov is before the 10th, so it belongs to the "October" month (10 Oct - 9 Nov)
    const e = await agent.post('/api/expenses?force=1').send({ date: '2026-11-05', categoryId: cat, amount: 4200 });
    const oct = (await agent.get('/api/state?month=2026-10')).body.expenses.map((x: any) => x.id);
    const nov = (await agent.get('/api/state?month=2026-11')).body.expenses.map((x: any) => x.id);
    expect(oct).toContain(e.body.id);
    expect(nov).not.toContain(e.body.id);
    const rep = (await agent.get('/api/reports/year?y=2026')).body.months;
    expect(rep[9].spent).toBe(4200); // October
    expect((await agent.get('/api/auth/me')).body.user.monthStartDay).toBe(10);
    await agent.delete(`/api/expenses/${e.body.id}`).expect(200);
    await agent.put('/api/settings').send({ monthStartDay: 1 }).expect(200);
  });

  it('rejects days outside 1..28', async () => {
    expect((await agent.put('/api/settings').send({ monthStartDay: 31 })).status).toBe(400);
  });
});

describe('reports', () => {
  it('summarises a year', async () => {
    const r = await agent.get('/api/reports/year?y=2026');
    expect(r.body.months).toHaveLength(12);
    const jun = r.body.months[5];
    expect(jun).toMatchObject({ month: '2026-06', spent: 37000, hasBudget: false });
    const nov = r.body.months[10];
    expect(nov).toMatchObject({ hasBudget: true, income: 250000, saved: 50000, repaid: 5000 });
  });
});

describe('backup', () => {
  it('round-trips export -> restore', async () => {
    const before = (await agent.get('/api/state?month=2026-11')).body;
    const backup = (await agent.get('/api/backup')).body;
    expect(backup.app).toBe('student_budget');
    await agent.post('/api/reset').expect(200);
    const empty = (await agent.get('/api/state?month=2026-11')).body;
    expect(empty.goals).toHaveLength(0);
    await agent.post('/api/backup/restore').send(backup).expect(200);
    const after = (await agent.get('/api/state?month=2026-11')).body;
    expect(after.goals[0].balance).toBe(before.goals[0].balance);
    expect(after.loans).toHaveLength(before.loans.length);
    expect(after.budget.income).toBe(before.budget.income);
  });

  it('the per-day (uni) category can be deleted when it has no expenses', async () => {
    const uni = (await agent.get('/api/state?month=2026-11')).body.categories.find((c: any) => c.isUni);
    await agent.delete(`/api/categories/${uni.id}`).expect(204);
    const cats = (await agent.get('/api/state?month=2026-11')).body.categories;
    expect(cats.some((c: any) => c.isUni)).toBe(false);
  });

  it('erase all starts blank (no template categories)', async () => {
    const backup = (await agent.get('/api/backup')).body;
    await agent.post('/api/reset').expect(200);
    expect((await agent.get('/api/state?month=2026-11')).body.categories).toHaveLength(0);
    await agent.post('/api/backup/restore').send(backup).expect(200);
  });

  it('rejects an invalid file and changes nothing', async () => {
    const r = await agent.post('/api/backup/restore').send({ app: 'other', tables: {} });
    expect(r.status).toBe(400);
    const s = (await agent.get('/api/state?month=2026-11')).body;
    expect(s.goals).toHaveLength(1);
  });
});

describe('security hardening', () => {
  const CSRF = { 'X-Requested-With': 'budget-me' };
  const prod = () => createApp(db); // real defaults: CSRF header required

  it('blocks writes without the app header or from another site', async () => {
    const a = request.agent(prod());
    await a.post('/api/auth/login').set(CSRF).send({ username: 'owner', password: PASSWORD }).expect(200);
    // a plain cross-site form post cannot add the header
    expect((await a.post('/api/reset')).status).toBe(403);
    // another site's page, even with the header (browsers would need CORS, which we never allow)
    expect((await a.post('/api/reset').set(CSRF).set('Origin', 'https://evil.example')).status).toBe(403);
    // our own page: same origin + header -> passes the check (409 here: nothing to do with CSRF)
    const ok = await a.post('/api/categories').set(CSRF).set('Origin', 'http://127.0.0.1').set('Host', '127.0.0.1')
      .send({ name: 'Transportation', month: '2026-11' });
    expect(ok.status).toBe(409);
    // reading is never blocked
    expect((await a.get('/api/state?month=2026-11')).status).toBe(200);
  });

  it('API responses are never cached', async () => {
    const r = await agent.get('/api/state?month=2026-11');
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('reserves built-in usernames and rejects password = username', async () => {
    const a = request(mkApp());
    expect((await a.post('/api/auth/signup').send({ username: 'owner', password: 'long-enough-1' })).status).toBe(400);
    expect((await a.post('/api/auth/signup').send({ username: 'Admin', password: 'long-enough-1' })).status).toBe(400);
    expect((await a.post('/api/auth/signup').send({ username: 'samesame.1', password: 'samesame.1' })).status).toBe(400);
    expect((await a.post('/api/auth/signup').send({ username: 'ninechars', password: '123456789' })).status).toBe(400);
  });

  it('invite code, when set, is required to sign up', async () => {
    const a = request(mkApp({ inviteCode: 'family-2026' }));
    expect((await a.get('/api/auth/config')).body).toEqual({ signupEnabled: true, inviteRequired: true });
    expect((await a.post('/api/auth/signup').send({ username: 'invited.no', password: 'long-enough-1' })).status).toBe(403);
    expect(
      (await a.post('/api/auth/signup').send({ username: 'invited.no', password: 'long-enough-1', inviteCode: 'wrong' })).status,
    ).toBe(403);
    expect(
      (await a.post('/api/auth/signup').send({ username: 'invited.yes', password: 'long-enough-1', inviteCode: 'family-2026' })).status,
    ).toBe(201);
  });

  it('locks one account after 10 failed sign-ins, even from different addresses', async () => {
    const a = request(mkApp({ loginLimit: 1000 }));
    await a.post('/api/auth/signup').send({ username: 'target.user', password: 'right-password-1' }).expect(201);
    for (let i = 0; i < 10; i++) {
      await a.post('/api/auth/login').set('X-Forwarded-For', `10.0.0.${i}`).send({ username: 'target.user', password: `nope-${i}` }).expect(401);
    }
    const r = await a.post('/api/auth/login').set('X-Forwarded-For', '10.0.9.9').send({ username: 'target.user', password: 'right-password-1' });
    expect(r.status).toBe(429);
  });

  it('upgrades old password hashes at sign-in', async () => {
    const { scryptSync, randomBytes } = await import('node:crypto');
    const salt = randomBytes(16);
    const legacy = `scrypt$${salt.toString('base64')}$${scryptSync('legacy-pass-1', salt, 64).toString('base64')}`;
    await db.query("INSERT INTO users(username, password_hash) VALUES ('legacy.user', $1)", [legacy]);
    await request(mkApp()).post('/api/auth/login').send({ username: 'legacy.user', password: 'legacy-pass-1' }).expect(200);
    const h = (await db.query("SELECT password_hash FROM users WHERE username = 'legacy.user'")).rows[0].password_hash as string;
    expect(h.startsWith('scrypt2$16384$8$5$')).toBe(true);
    await request(mkApp()).post('/api/auth/login').send({ username: 'legacy.user', password: 'legacy-pass-1' }).expect(200);
  });

  it('change password signs out other devices; sign out everywhere; delete account', async () => {
    const app = mkApp();
    const phone = request.agent(app);
    const laptop = request.agent(app);
    await phone.post('/api/auth/signup').send({ username: 'mover.1', password: 'first-pass-1' }).expect(201);
    await laptop.post('/api/auth/login').send({ username: 'mover.1', password: 'first-pass-1' }).expect(200);

    expect((await phone.post('/api/auth/password').send({ current: 'wrong-pass-1', next: 'second-pass-2' })).status).toBe(403);
    await phone.post('/api/auth/password').send({ current: 'first-pass-1', next: 'second-pass-2' }).expect(200);
    expect((await phone.get('/api/auth/me')).status).toBe(200); // this device stays signed in
    expect((await laptop.get('/api/auth/me')).status).toBe(401); // other devices are signed out

    await laptop.post('/api/auth/login').send({ username: 'mover.1', password: 'second-pass-2' }).expect(200);
    await phone.post('/api/auth/logout-all').expect(204);
    expect((await phone.get('/api/auth/me')).status).toBe(401);
    expect((await laptop.get('/api/auth/me')).status).toBe(401);

    await phone.post('/api/auth/login').send({ username: 'mover.1', password: 'second-pass-2' }).expect(200);
    await phone.post('/api/categories').send({ name: 'Temp', month: '2026-11' }).expect(201);
    expect((await phone.post('/api/auth/delete-account').send({ password: 'nope-nope-1' })).status).toBe(403);
    await phone.post('/api/auth/delete-account').send({ password: 'second-pass-2' }).expect(204);
    expect((await db.query("SELECT COUNT(*)::int AS n FROM users WHERE username = 'mover.1'")).rows[0].n).toBe(0);
    expect((await phone.post('/api/auth/login').send({ username: 'mover.1', password: 'second-pass-2' })).status).toBe(401);
  });

  it('rejects oversized bodies and out-of-range values cleanly', async () => {
    const big = { name: 'x'.repeat(150_000), month: '2026-11' };
    expect((await agent.post('/api/categories').send(big)).status).toBe(413);
    expect((await agent.get('/api/state?month=9999-12')).status).toBe(400);
    expect((await agent.get('/api/expenses?offset=1e300')).status).toBe(400);
    expect((await agent.delete('/api/expenses/99999999999999999999')).status).toBe(400);
  });

  it('a goal start amount cannot be lowered below what was withdrawn', async () => {
    const g = await agent.post('/api/goals').send({ name: 'Bike', target: 100000, start: 50000 }).expect(201);
    await agent.post(`/api/goals/${g.body.id}/entries`).send({ date: '2026-11-10', deposit: false, amount: 40000 }).expect(201);
    expect((await agent.put(`/api/goals/${g.body.id}`).send({ name: 'Bike', target: 100000, start: 10000 })).status).toBe(400);
    await agent.put(`/api/goals/${g.body.id}`).send({ name: 'Bike', target: 100000, start: 40000 }).expect(200);
    await agent.delete(`/api/goals/${g.body.id}`).expect(204);
  });

  it('receipts: stored privately, never cached, PDFs download, per-account quota', async () => {
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(600, 1)]);
    const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(600, 2)]);
    const cat = (await agent.get('/api/state?month=2026-11')).body.categories[1].id;
    const mk = async () => (await agent.post('/api/expenses?force=1').send({ date: '2026-11-12', categoryId: cat, amount: 100 })).body.id;
    const e1 = await mk();
    await agent.put(`/api/expenses/${e1}/receipt`).set('Content-Type', 'image/png').send(PNG).expect(200);
    const img = await agent.get(`/api/expenses/${e1}/receipt`);
    expect(img.headers['cache-control']).toBe('no-store');
    expect(img.headers['content-security-policy']).toContain('sandbox');
    expect(img.headers['content-disposition']).toMatch(/^inline/);
    await agent.put(`/api/expenses/${e1}/receipt`).set('Content-Type', 'application/pdf').send(PDF).expect(200);
    expect((await agent.get(`/api/expenses/${e1}/receipt`)).headers['content-disposition']).toMatch(/^attachment/);

    process.env.RECEIPT_QUOTA_MB = String(1000 / (1024 * 1024)); // ~1000 bytes
    try {
      const e2 = await mk();
      const r = await agent.put(`/api/expenses/${e2}/receipt`).set('Content-Type', 'image/png').send(PNG);
      expect(r.status).toBe(413);
      await agent.delete(`/api/expenses/${e2}`).expect(200);
    } finally {
      delete process.env.RECEIPT_QUOTA_MB;
    }
    await agent.delete(`/api/expenses/${e1}`).expect(200);
  });

  it('backup restore refuses values the app itself would refuse', async () => {
    const backup = (await agent.get('/api/backup')).body;
    const bad = structuredClone(backup);
    bad.tables.expenses.push({ date: '2026-11-01', category_id: bad.tables.categories[0].id, description: 'x'.repeat(500), amount: 5 });
    expect((await agent.post('/api/backup/restore').send(bad)).status).toBe(400);
    const bad2 = structuredClone(backup);
    bad2.settings = { currency: '<script>' };
    expect((await agent.post('/api/backup/restore').send(bad2)).status).toBe(400);
    await agent.post('/api/backup/restore').send(backup).expect(200);
  });
});
