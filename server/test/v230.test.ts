/** 2.3.0: one admin by email, a gated admin area with usage counts, and the security audit fixes. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { base32Decode, hotp, stepAt } from '../src/totp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let db: Db;
const ADMIN = 'boss@example.com';
const base = { requireEmail: false, strongPasswords: false, csrfHeader: false, starterCategories: false } as const;
const plainApp = () => createApp(db, { ...base, adminUsernames: ['listed'] });
const strictApp = () => createApp(db, { ...base, adminUsernames: ['listed'], adminEmail: ADMIN });
const PW = 'long-enough-pass';

/** A code for `step` steps from now (each use needs a newer one: codes can't be replayed). */
const codeFor = (secret: string, step = 0) => hotp(base32Decode(secret), stepAt(Date.now()) + step);

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, path.join(here, '..', 'migrations'));
  // The admin account is made before ADMIN_EMAIL is turned on (as on the live server).
  await request(plainApp()).post('/api/auth/signup').send({ username: 'boss', email: ADMIN, password: PW }).expect(201);
  // (a listed admin name can't be taken by sign-up, so this account is made before it is listed)
  await request(createApp(db, base)).post('/api/auth/signup').send({ username: 'listed', password: PW }).expect(201);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

async function signIn(username: string, app = strictApp()) {
  const a = request.agent(app);
  await a.post('/api/auth/login').send({ username, password: PW }).expect(200);
  return a;
}

async function turnOn2fa(a: ReturnType<typeof request.agent>) {
  const { secret } = (await a.post('/api/auth/2fa/setup').send({ password: PW }).expect(200)).body;
  await a.post('/api/auth/2fa/enable').send({ code: codeFor(secret) }).expect(200);
  return secret as string;
}

describe('one admin, by email', () => {
  it('only the account with ADMIN_EMAIL is admin; listed names and everyone else see no admin area at all', async () => {
    const boss = await signIn('boss');
    expect((await boss.get('/api/auth/me')).body.user.isAdmin).toBe(true);
    const listed = await signIn('listed');
    expect((await listed.get('/api/auth/me')).body.user.isAdmin).toBe(false);
    for (const url of ['/api/admin/status', '/api/admin/stats', '/api/admin/users', '/api/admin/audit']) {
      const r = await listed.get(url);
      expect(r.status).toBe(404); // not "forbidden": it doesn't exist for them
    }
    expect((await listed.post('/api/admin/unlock').send({ password: PW, code: '123456' })).status).toBe(404);
  });

  it('nobody can sign up with the admin email or move it onto their account', async () => {
    const r = await request(strictApp()).post('/api/auth/signup').send({ username: 'faker', email: 'BOSS@example.com', password: PW });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('reserved');
    const listed = await signIn('listed');
    const e = await listed.put('/api/auth/email').send({ email: ADMIN, password: PW });
    expect(e.status).toBe(403);
    expect(e.body.code).toBe('reserved');
  });
});

describe('the admin area gate', () => {
  it('needs two-step sign-in, then the password and a code; it opens for 15 minutes and can be locked again', async () => {
    const boss = await signIn('boss');
    expect((await boss.get('/api/admin/status').expect(200)).body).toMatchObject({ gated: true, twoFactor: false, unlockedUntil: null });
    expect((await boss.get('/api/admin/stats')).body.code).toBe('admin_2fa');

    const secret = await turnOn2fa(boss);
    expect((await boss.get('/api/admin/stats')).body.code).toBe('admin_locked');
    expect((await boss.post('/api/admin/unlock').send({ password: 'wrong-password', code: codeFor(secret, 1) })).body.code).toBe('bad_password');
    expect((await boss.post('/api/admin/unlock').send({ password: PW, code: '000000' })).body.code).toBe('bad_code');

    const until = (await boss.post('/api/admin/unlock').send({ password: PW, code: codeFor(secret, 1) }).expect(200)).body.unlockedUntil;
    const mins = (Date.parse(until) - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(14);
    expect(mins).toBeLessThanOrEqual(15);
    await boss.get('/api/admin/users').expect(200);

    // Another device of the same admin is still locked (the unlock belongs to one session)
    const other = request.agent(strictApp());
    const t = (await other.post('/api/auth/login').send({ username: 'boss', password: PW }).expect(200)).body.ticket;
    await db.query('UPDATE users SET totp_last_step = NULL WHERE email = $1', [ADMIN]);
    await other.post('/api/auth/login/2fa').send({ ticket: t, code: codeFor(secret) }).expect(200);
    expect((await other.get('/api/admin/stats')).body.code).toBe('admin_locked');

    await boss.post('/api/admin/lock').expect(204);
    expect((await boss.get('/api/admin/users')).body.code).toBe('admin_locked');

    const log = await db.query(`SELECT action FROM audit_log WHERE actor_username = 'boss' ORDER BY id`);
    expect(log.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['admin_unlock_failed', 'admin_unlocked']));
  });

  it('shows how many people use the app (counts only), including Android vs browser', async () => {
    const listed = await signIn('listed');
    await listed.get('/api/auth/me').set('User-Agent', 'Mozilla/5.0 (Linux; Android 14) BudgetMeApp').expect(200);
    await db.query('UPDATE users SET totp_last_step = NULL WHERE email = $1', [ADMIN]);
    const boss = await signIn('boss');
    const secret = (await db.query('SELECT totp_secret FROM users WHERE email = $1', [ADMIN])).rows[0].totp_secret as string;
    // Signing in needs the second step now
    const t = (await request.agent(strictApp()).post('/api/auth/login').send({ username: 'boss', password: PW })).body.ticket;
    expect(t).toBeTruthy();
    const a = request.agent(strictApp());
    const tk = (await a.post('/api/auth/login').send({ username: 'boss', password: PW }).expect(200)).body.ticket;
    await a.post('/api/auth/login/2fa').send({ ticket: tk, code: codeFor(secret) }).expect(200);
    await db.query('UPDATE users SET totp_last_step = NULL WHERE email = $1', [ADMIN]);
    await a.post('/api/admin/unlock').send({ password: PW, code: codeFor(secret) }).expect(200);
    void boss;

    const s = (await a.get('/api/admin/stats').expect(200)).body;
    expect(s.accounts.total).toBeGreaterThanOrEqual(2);
    expect(s.accounts.twoFactor).toBeGreaterThanOrEqual(1);
    expect(s.active.today).toBeGreaterThanOrEqual(2);
    expect(s.signupsByMonth).toHaveLength(12);
    expect(s.dailyActive).toHaveLength(30);
    const today = s.dailyActive[29];
    expect(today.users).toBeGreaterThanOrEqual(2);
    expect(today.android).toBeGreaterThanOrEqual(1);
    expect(s.clients30d.androidOnly + s.clients30d.both).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(s)).not.toContain('listed'); // no names, only numbers
  });
});

describe('security audit fixes', () => {
  it('two-step codes: many requests at once on one ticket still count every try', async () => {
    await request(plainApp()).post('/api/auth/signup').send({ username: 'racer', password: PW }).expect(201);
    const a = await signIn('racer', plainApp());
    await turnOn2fa(a);
    const ticket = (await request(plainApp()).post('/api/auth/login').send({ username: 'racer', password: PW }).expect(200)).body.ticket;
    const tries = await Promise.all(
      Array.from({ length: 8 }, () => request(plainApp()).post('/api/auth/login/2fa').send({ ticket, code: '000000' })),
    );
    expect(tries.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(3); // only 5 of 8 may be checked
  });

  it('two-step codes: 10 wrong codes lock the account for a while, whatever the network', async () => {
    await request(plainApp()).post('/api/auth/signup').send({ username: 'target', password: PW }).expect(201);
    const a = await signIn('target', plainApp());
    const secret = await turnOn2fa(a);
    for (let i = 0; i < 2; i++) {
      const ticket = (await request(plainApp()).post('/api/auth/login').send({ username: 'target', password: PW })).body.ticket;
      for (let j = 0; j < 5; j++) await request(plainApp()).post('/api/auth/login/2fa').send({ ticket, code: '000000' });
    }
    const ticket = (await request(plainApp()).post('/api/auth/login').send({ username: 'target', password: PW })).body.ticket;
    const r = await request(plainApp()).post('/api/auth/login/2fa').send({ ticket, code: codeFor(secret, 1) });
    expect(r.status).toBe(429); // even the right code waits
  });

  it('turning on two-step sign-in signs out every other device', async () => {
    await request(plainApp()).post('/api/auth/signup').send({ username: 'careful', password: PW }).expect(201);
    const stolen = await signIn('careful', plainApp());
    const mine = await signIn('careful', plainApp());
    await turnOn2fa(mine);
    await mine.get('/api/auth/me').expect(200);
    await stolen.get('/api/auth/me').expect(401);
  });

  it('reset codes: many tries at once still count every one', async () => {
    await request(plainApp()).post('/api/auth/signup').send({ username: 'resetme', password: PW }).expect(201);
    await db.query(
      `INSERT INTO password_resets(user_id, code_hash, created_by, expires_at)
       SELECT id, 'x', NULL, now() + interval '1 hour' FROM users WHERE username = 'resetme'`,
    );
    await Promise.all(
      Array.from({ length: 8 }, () =>
        request(plainApp()).post('/api/auth/reset').send({ username: 'resetme', code: 'AAAAA-BBBBB', password: 'new-long-pass-1' }),
      ),
    );
    const n = (await db.query(`SELECT attempts FROM password_resets r JOIN users u ON u.id = r.user_id WHERE u.username = 'resetme'`)).rows[0].attempts;
    expect(n).toBe(8);
  });
});
