/** Admin page, runtime sign-up settings, audit log, owner-issued password reset codes. */
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
// "chief" becomes an admin through ADMIN_USERNAMES; "boss" is listed but has no account.
const mkApp = () => createApp(db, { requireEmail: false, strongPasswords: false, csrfHeader: false, signupLimit: 1000, loginLimit: 1000, adminUsernames: ['chief', 'boss'] });
type Agent = ReturnType<typeof request.agent>;
let n = 0;
async function newUser(prefix = 'p5.user'): Promise<{ a: Agent; name: string; id: number }> {
  const a = request.agent(mkApp());
  const name = `${prefix}${n++}`;
  const r = await a.post('/api/auth/signup').send({ username: name, password: 'phase-five-pass' }).expect(201);
  return { a, name, id: r.body.user.id };
}
async function owner(): Promise<Agent> {
  const a = request.agent(mkApp());
  await a.post('/api/auth/login').send({ username: 'owner', password: OWNER_PASS }).expect(200);
  return a;
}
const auditActions = async () => (await db.query('SELECT action, target, details FROM audit_log ORDER BY id')).rows;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, path.join(here, '..', 'migrations'));
  await ensureOwner(db, OWNER_PASS);
  // "chief" signs up before being listed (the right order); the app below lists it.
  await request(createApp(db, { requireEmail: false, strongPasswords: false, csrfHeader: false })).post('/api/auth/signup').send({ username: 'chief', password: 'chief-pass-123' }).expect(201);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe('who is an admin', () => {
  it('owner and listed accounts can open the admin pages; everyone else gets 403', async () => {
    const o = await owner();
    expect((await o.get('/api/auth/me')).body.user.isAdmin).toBe(true);
    await o.get('/api/admin/users').expect(200);

    const chief = request.agent(mkApp());
    const login = await chief.post('/api/auth/login').send({ username: 'chief', password: 'chief-pass-123' }).expect(200);
    expect(login.body.user.isAdmin).toBe(true);
    await chief.get('/api/admin/audit').expect(200);

    const { a } = await newUser();
    expect((await a.get('/api/auth/me')).body.user.isAdmin).toBe(false);
    for (const [m, url] of [
      ['get', '/api/admin/users'],
      ['get', '/api/admin/settings'],
      ['put', '/api/admin/settings'],
      ['get', '/api/admin/audit'],
      ['post', '/api/admin/users/1/reset-code'],
      ['post', '/api/admin/users/1/delete'],
    ] as const) {
      expect((await (a as any)[m](url).send({})).status).toBe(403);
    }
    expect((await request(mkApp()).get('/api/admin/users')).status).toBe(401);
  });

  it('a listed admin name without an account cannot be taken by sign-up', async () => {
    const r = await request(mkApp()).post('/api/auth/signup').send({ username: 'boss', password: 'sneaky-pass-123' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('reserved');
  });

  it('the user list shows joined / last active / storage', async () => {
    const { a, name } = await newUser();
    const cat = (await a.post('/api/categories').send({ name: 'Food', month: '2026-11' }).expect(201)).body.id;
    const e = (await a.post('/api/expenses').send({ date: '2026-11-01', categoryId: cat, amount: 100 }).expect(201)).body;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2_000, 1)]);
    await a.put(`/api/expenses/${e.id}/receipt`).set('Content-Type', 'image/png').send(png).expect(200);
    const users = (await (await owner()).get('/api/admin/users').expect(200)).body;
    const me = users.find((u: any) => u.username === name);
    expect(me).toMatchObject({ items: 1, receiptBytes: png.length, isAdmin: false });
    expect(me.lastActiveAt).toBeTruthy();
    expect(users.find((u: any) => u.username === 'owner').isAdmin).toBe(true);
  });
});

describe('sign-up settings while the app runs', () => {
  it('close sign-ups, then require an invite code; the code itself never goes to the log', async () => {
    const o = await owner();
    await o.put('/api/admin/settings').send({ allowSignup: false, inviteCode: null }).expect(200);
    expect((await request(mkApp()).get('/api/auth/config')).body).toMatchObject({ signupEnabled: false });
    expect((await request(mkApp()).post('/api/auth/signup').send({ username: 'late.one', password: 'late-pass-123' })).status).toBe(403);

    await o.put('/api/admin/settings').send({ allowSignup: true, inviteCode: 'SECRET-42' }).expect(200);
    expect((await request(mkApp()).get('/api/auth/config')).body).toMatchObject({ signupEnabled: true, inviteRequired: true });
    expect((await request(mkApp()).post('/api/auth/signup').send({ username: 'late.two', password: 'late-pass-123' })).status).toBe(403);
    await request(mkApp()).post('/api/auth/signup').send({ username: 'late.three', password: 'late-pass-123', inviteCode: 'SECRET-42' }).expect(201);
    expect((await o.get('/api/admin/settings')).body).toEqual({ allowSignup: true, inviteCode: 'SECRET-42' });

    await o.put('/api/admin/settings').send({ allowSignup: true, inviteCode: '' }).expect(200);
    expect((await request(mkApp()).get('/api/auth/config')).body).toMatchObject({ signupEnabled: true, inviteRequired: false });

    const log = (await auditActions()).filter((x) => x.action === 'signup_settings_changed');
    expect(log.map((x) => x.details)).toEqual([
      { allowSignup: false, inviteCode: 'unchanged' },
      { allowSignup: true, inviteCode: 'set' },
      { allowSignup: true, inviteCode: 'cleared' },
    ]);
    expect(JSON.stringify(await auditActions())).not.toContain('SECRET-42');
  });
});

describe('password reset codes', () => {
  it('one code, used once, within the hour; it signs the user out everywhere', async () => {
    const o = await owner();
    const { a: phone, name, id } = await newUser();
    const r = await o.post(`/api/admin/users/${id}/reset-code`).send({ password: OWNER_PASS }).expect(201);
    expect(r.body.code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(r.body.username).toBe(name);
    const stored = (await db.query('SELECT code_hash FROM password_resets WHERE user_id = $1', [id])).rows[0].code_hash;
    expect(stored).not.toContain(r.body.code.replace('-', '')); // only a hash is kept

    const reset = request(mkApp());
    expect((await reset.post('/api/auth/reset').send({ username: name, code: 'WRONG-CODE9', password: 'brand-new-pass-1' })).status).toBe(400);
    // typed in lower case without the dash still works
    await reset.post('/api/auth/reset').send({ username: name, code: r.body.code.toLowerCase().replace('-', ''), password: 'brand-new-pass-1' }).expect(200);
    expect((await phone.get('/api/auth/me')).status).toBe(401); // signed out everywhere
    expect((await request(mkApp()).post('/api/auth/login').send({ username: name, password: 'phase-five-pass' })).status).toBe(401);
    await request(mkApp()).post('/api/auth/login').send({ username: name, password: 'brand-new-pass-1' }).expect(200);
    // used once
    expect((await reset.post('/api/auth/reset').send({ username: name, code: r.body.code, password: 'another-pass-22' })).status).toBe(400);
  });

  it('expired or replaced codes fail; admins cannot make one for themselves; the user name must match', async () => {
    const o = await owner();
    const { name, id } = await newUser();
    const other = await newUser();
    const first = (await o.post(`/api/admin/users/${id}/reset-code`).send({ password: OWNER_PASS }).expect(201)).body.code;
    const second = (await o.post(`/api/admin/users/${id}/reset-code`).send({ password: OWNER_PASS }).expect(201)).body.code;
    const reset = request(mkApp());
    expect((await reset.post('/api/auth/reset').send({ username: name, code: first, password: 'brand-new-pass-1' })).status).toBe(400); // replaced
    expect((await reset.post('/api/auth/reset').send({ username: other.name, code: second, password: 'brand-new-pass-1' })).status).toBe(400); // someone else's code
    await db.query("UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [id]);
    expect((await reset.post('/api/auth/reset').send({ username: name, code: second, password: 'brand-new-pass-1' })).status).toBe(400); // expired
    const ownerId = (await db.query("SELECT id FROM users WHERE username = 'owner'")).rows[0].id;
    expect((await o.post(`/api/admin/users/${ownerId}/reset-code`).send({ password: OWNER_PASS })).status).toBe(400);
    expect((await reset.post('/api/auth/reset').send({ username: name, code: second, password: name })).status).toBe(400); // password = username
  });
});

describe('removing an account', () => {
  it('needs the exact username and the admin password; everything of that account goes; it is logged', async () => {
    const o = await owner();
    const { a, name, id } = await newUser();
    await a.post('/api/categories').send({ name: 'Food', month: '2026-11' }).expect(201);
    expect((await o.post(`/api/admin/users/${id}/delete`).send({ confirmUsername: 'someone', password: OWNER_PASS })).status).toBe(400);
    expect((await o.post(`/api/admin/users/${id}/delete`).send({ confirmUsername: name, password: 'wrong-pass-123' })).status).toBe(403);
    await o.post(`/api/admin/users/${id}/delete`).send({ confirmUsername: name.toUpperCase(), password: OWNER_PASS }).expect(204);
    expect((await db.query('SELECT COUNT(*)::int AS n FROM users WHERE id = $1', [id])).rows[0].n).toBe(0);
    expect((await db.query('SELECT COUNT(*)::int AS n FROM categories WHERE user_id = $1', [id])).rows[0].n).toBe(0);
    expect((await a.get('/api/auth/me')).status).toBe(401);

    const ownerId = (await db.query("SELECT id FROM users WHERE username = 'owner'")).rows[0].id;
    expect((await o.post(`/api/admin/users/${ownerId}/delete`).send({ confirmUsername: 'owner', password: OWNER_PASS })).status).toBe(400); // yourself
    const chief = request.agent(mkApp());
    await chief.post('/api/auth/login').send({ username: 'chief', password: 'chief-pass-123' }).expect(200);
    expect((await chief.post(`/api/admin/users/${ownerId}/delete`).send({ confirmUsername: 'owner', password: 'chief-pass-123' })).status).toBe(400); // built-in owner

    const log = (await (await owner()).get('/api/admin/audit?limit=200').expect(200)).body;
    expect(log[0]).toMatchObject({ actor: 'owner', action: 'user_deleted', target: name });
    expect(log.some((x: any) => x.action === 'reset_code_created')).toBe(true);
    expect(log.some((x: any) => x.action === 'password_reset')).toBe(true);
  });
});
