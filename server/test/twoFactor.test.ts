/** Phase 8: two-step sign-in (TOTP authenticator codes + backup codes). */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ensureOwner } from '../src/auth.js';
import { createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { base32Decode, base32Encode, hotp, stepAt, verifyTotp } from '../src/totp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let db: Db;
const mkApp = () => createApp(db, { requireEmail: false, strongPasswords: false, csrfHeader: false, signupLimit: 1000, loginLimit: 1000 });
const PASS = 'two-factor-pass-1';
const codeNow = (secret: string, offset = 0) => hotp(base32Decode(secret), stepAt(Date.now()) + offset);
let n = 0;
async function newUser() {
  const a = request.agent(mkApp());
  const name = `tfa.user${n++}`;
  await a.post('/api/auth/signup').send({ username: name, password: PASS }).expect(201);
  return { a, name };
}
/** Turns it on and returns the secret and the backup codes. */
async function turnOn(a: ReturnType<typeof request.agent>) {
  const s = (await a.post('/api/auth/2fa/setup').send({ password: PASS }).expect(200)).body;
  const r = (await a.post('/api/auth/2fa/enable').send({ code: codeNow(s.secret) }).expect(200)).body;
  return { secret: s.secret as string, backupCodes: r.backupCodes as string[] };
}

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, path.join(here, '..', 'migrations'));
  await ensureOwner(db, 'owner-pass-12345');
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe('TOTP codes', () => {
  it('match the RFC 6238 test vectors', () => {
    const secret = Buffer.from('12345678901234567890');
    // RFC 6238 Appendix B (SHA-1, 8 digits): T=59 → 94287082, T=1111111109 → 07081804
    expect(hotp(secret, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(hotp(secret, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(base32Decode(base32Encode(secret)).toString()).toBe('12345678901234567890');
  });
  it('allow one step of clock drift, refuse a code twice', () => {
    const b32 = base32Encode(Buffer.from('12345678901234567890'));
    const now = 1_800_000_000_000;
    const code = hotp(base32Decode(b32), stepAt(now) - 1);
    const step = verifyTotp(b32, code, now);
    expect(step).toBe(stepAt(now) - 1);
    expect(verifyTotp(b32, code, now, step)).toBeNull(); // replay
    expect(verifyTotp(b32, hotp(base32Decode(b32), stepAt(now) - 3), now)).toBeNull(); // too old
    expect(verifyTotp(b32, 'abcdef', now)).toBeNull();
  });
});

describe('two-step sign-in', () => {
  it('setup needs the password; it is only on after a right code', async () => {
    const { a } = await newUser();
    expect((await a.post('/api/auth/2fa/setup').send({ password: 'wrong-pass-12' })).status).toBe(403);
    const s = (await a.post('/api/auth/2fa/setup').send({ password: PASS }).expect(200)).body;
    expect(s.uri).toMatch(/^otpauth:\/\/totp\/Masrofy:tfa\.user\d+\?secret=[A-Z2-7]+&issuer=Masrofy/);
    expect((await a.get('/api/auth/me')).body.user.twoFactor).toBe(false);
    expect((await a.post('/api/auth/2fa/enable').send({ code: '000000' })).status).toBe(400);
    const r = await a.post('/api/auth/2fa/enable').send({ code: codeNow(s.secret) }).expect(200);
    expect(r.body.backupCodes).toHaveLength(8);
    expect(r.body.backupCodes[0]).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect((await a.get('/api/auth/me')).body.user.twoFactor).toBe(true);
  });

  it('signing in then needs the code: password alone gives no session', async () => {
    const { a, name } = await newUser();
    const { secret } = await turnOn(a);
    const b = request.agent(mkApp());
    const first = await b.post('/api/auth/login').send({ username: name, password: PASS }).expect(200);
    expect(first.body).toMatchObject({ twoFactor: true });
    expect(first.body.user).toBeUndefined();
    expect(first.headers['set-cookie']).toBeUndefined();
    expect((await b.get('/api/auth/me')).status).toBe(401);

    expect((await b.post('/api/auth/login/2fa').send({ ticket: first.body.ticket, code: '123456' })).status).toBe(400);
    // the code used to turn it on can't be used again; the next step's code works
    const ok = await b.post('/api/auth/login/2fa').send({ ticket: first.body.ticket, code: codeNow(secret, 1) }).expect(200);
    expect(ok.body.user.username).toBe(name);
    expect((await b.get('/api/auth/me')).status).toBe(200);
    // the ticket is single use
    expect((await b.post('/api/auth/login/2fa').send({ ticket: first.body.ticket, code: codeNow(secret, 1) })).status).toBe(401);
  });

  it('a backup code works once; 5 wrong codes end the ticket', async () => {
    const { a, name } = await newUser();
    const { backupCodes } = await turnOn(a);
    const t1 = (await request(mkApp()).post('/api/auth/login').send({ username: name, password: PASS })).body.ticket;
    await request(mkApp()).post('/api/auth/login/2fa').send({ ticket: t1, code: backupCodes[0].toLowerCase() }).expect(200);
    const t2 = (await request(mkApp()).post('/api/auth/login').send({ username: name, password: PASS })).body.ticket;
    expect((await request(mkApp()).post('/api/auth/login/2fa').send({ ticket: t2, code: backupCodes[0] })).status).toBe(400); // used
    for (let i = 0; i < 4; i++) await request(mkApp()).post('/api/auth/login/2fa').send({ ticket: t2, code: '000000' });
    expect((await request(mkApp()).post('/api/auth/login/2fa').send({ ticket: t2, code: backupCodes[1] })).status).toBe(429);
  });

  it('turning it off needs the password and a code; an admin can reset it for a lost phone', async () => {
    const { a, name } = await newUser();
    const { secret } = await turnOn(a);
    expect((await a.post('/api/auth/2fa/disable').send({ password: PASS, code: '000000' })).status).toBe(400);
    await a.post('/api/auth/2fa/disable').send({ password: PASS, code: codeNow(secret, 1) }).expect(200);
    expect((await a.get('/api/auth/me')).body.user.twoFactor).toBe(false);

    await turnOn(a);
    const owner = request.agent(mkApp());
    await owner.post('/api/auth/login').send({ username: 'owner', password: 'owner-pass-12345' }).expect(200);
    const id = (await db.query('SELECT id FROM users WHERE username = $1', [name])).rows[0].id;
    const list = (await owner.get('/api/admin/users').expect(200)).body;
    expect(list.find((u: { username: string }) => u.username === name).twoFactor).toBe(true);
    expect((await owner.post(`/api/admin/users/${id}/disable-2fa`).send({ password: 'nope-nope-1' })).status).toBe(403);
    await owner.post(`/api/admin/users/${id}/disable-2fa`).send({ password: 'owner-pass-12345' }).expect(204);
    const login = await request(mkApp()).post('/api/auth/login').send({ username: name, password: PASS }).expect(200);
    expect(login.body.user.username).toBe(name); // straight in again
  });
});
