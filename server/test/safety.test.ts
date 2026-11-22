/** 0.6.1 safety fixes: admin takeover, reset codes after a password change, split-linked loan entries. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureOwner } from '../src/auth.js';
import { createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OWNER_PASS = 'owner-pass-12345';
let db: Db;
const mkApp = () => createApp(db, { requireEmail: false, strongPasswords: false, csrfHeader: false, signupLimit: 1000, loginLimit: 1000, adminUsernames: ['chief', 'deputy'] });
type Agent = ReturnType<typeof request.agent>;
const idOf = async (name: string) => (await db.query('SELECT id FROM users WHERE username = $1', [name])).rows[0].id as number;
async function signIn(username: string, password: string): Promise<Agent> {
  const a = request.agent(mkApp());
  await a.post('/api/auth/login').send({ username, password }).expect(200);
  return a;
}
let n = 0;
async function newUser(): Promise<{ a: Agent; name: string; id: number }> {
  const a = request.agent(mkApp());
  const name = `safe.user${n++}`;
  const r = await a.post('/api/auth/signup').send({ username: name, password: 'safety-pass-123' }).expect(201);
  return { a, name, id: r.body.user.id };
}

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, path.join(here, '..', 'migrations'));
  await ensureOwner(db, OWNER_PASS);
  const plain = createApp(db, { requireEmail: false, strongPasswords: false, csrfHeader: false });
  await request(plain).post('/api/auth/signup').send({ username: 'chief', password: 'chief-pass-123' }).expect(201);
  await request(plain).post('/api/auth/signup').send({ username: 'deputy', password: 'deputy-pass-123' }).expect(201);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe('admins cannot take over accounts too easily', () => {
  it('a reset code needs the admin password', async () => {
    const chief = await signIn('chief', 'chief-pass-123');
    const { id } = await newUser();
    expect((await chief.post(`/api/admin/users/${id}/reset-code`).send({})).status).toBe(400);
    expect((await chief.post(`/api/admin/users/${id}/reset-code`).send({ password: 'wrong-pass-123' })).status).toBe(403);
    await chief.post(`/api/admin/users/${id}/reset-code`).send({ password: 'chief-pass-123' }).expect(201);
  });

  it('a listed admin cannot reset or remove another admin, nor the owner', async () => {
    const chief = await signIn('chief', 'chief-pass-123');
    const deputy = await idOf('deputy');
    const owner = await idOf('owner');
    const r1 = await chief.post(`/api/admin/users/${deputy}/reset-code`).send({ password: 'chief-pass-123' });
    expect(r1.status).toBe(403);
    expect(r1.body.error).toBe('Only the owner account can do this to another admin.');
    expect((await chief.post(`/api/admin/users/${deputy}/delete`).send({ confirmUsername: 'deputy', password: 'chief-pass-123' })).status).toBe(403);
    expect((await chief.post(`/api/admin/users/${owner}/reset-code`).send({ password: 'chief-pass-123' })).status).toBe(400);
    expect(await idOf('deputy')).toBe(deputy); // still there
  });

  it('the owner can still help another admin', async () => {
    const o = await signIn('owner', OWNER_PASS);
    const r = await o.post(`/api/admin/users/${await idOf('deputy')}/reset-code`).send({ password: OWNER_PASS }).expect(201);
    expect(r.body.username).toBe('deputy');
  });
});

describe('reset codes', () => {
  it('stop working once the user changes their password', async () => {
    const o = await signIn('owner', OWNER_PASS);
    const { a, name, id } = await newUser();
    const code = (await o.post(`/api/admin/users/${id}/reset-code`).send({ password: OWNER_PASS }).expect(201)).body.code;
    await a.post('/api/auth/password').send({ current: 'safety-pass-123', next: 'my-own-new-pass-1' }).expect(200);
    const r = await request(mkApp()).post('/api/auth/reset').send({ username: name, code, password: 'attacker-pass-12' });
    expect(r.status).toBe(400);
    await signIn(name, 'my-own-new-pass-1');
  });
});

describe('"Owed to me" entries made by a split', () => {
  it('can only be changed through their expense', async () => {
    const { a } = await newUser();
    const cat = (await a.post('/api/categories').send({ name: 'Food', month: '2026-11' }).expect(201)).body.id;
    const e = (
      await a.post('/api/expenses').send({ date: '2026-11-10', categoryId: cat, amount: 150, description: 'Dinner', split: { person: 'Omar', share: 150 } }).expect(201)
    ).body;
    const loan = (await a.get('/api/state?month=2026-11').expect(200)).body.loans.find((l: { expenseId: number | null }) => l.expenseId === e.id);
    expect(loan).toBeTruthy();

    const edit = await a.put(`/api/loans/${loan.id}?force=1`).send({ date: '2026-11-10', person: 'Omar', amount: 1, borrowed: true, repayment: false, note: '' });
    expect(edit.status).toBe(400);
    expect(edit.body.error).toBe('This entry comes from a split expense. Edit or delete the expense instead.');
    expect((await a.delete(`/api/loans/${loan.id}`)).status).toBe(400);
    expect((await a.delete('/api/loan-people?borrowed=false&name=Omar')).status).toBe(400);

    // A normal entry for the same person still edits fine, and the split is unchanged.
    const own = (await a.post('/api/loans').send({ date: '2026-11-12', person: 'Omar', amount: 50, borrowed: false, repayment: false, note: 'Taxi' }).expect(201)).body;
    await a.put(`/api/loans/${own.id}`).send({ date: '2026-11-12', person: 'Omar', amount: 60, borrowed: false, repayment: false, note: 'Taxi' }).expect(200);
    const still = (await a.get('/api/state?month=2026-11').expect(200)).body.loans.find((l: { id: number }) => l.id === loan.id);
    expect(still).toMatchObject({ amount: 150, borrowed: false, expenseId: e.id });

    // Deleting the expense takes its entry along; then the person can be removed.
    await a.delete(`/api/expenses/${e.id}`).expect(200);
    await a.delete('/api/loan-people?borrowed=false&name=Omar').expect(200);
  });
});
