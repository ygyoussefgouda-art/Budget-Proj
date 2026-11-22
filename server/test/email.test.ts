/** 0.6.3: sign-up with email + strong passwords, "Forgot password?" by email, change email. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgliteDb, type Db } from '../src/db.js';
import type { MailMessage, Mailer } from '../src/mail.js';
import { migrate } from '../src/migrate.js';
import { passwordProblems } from '../src/validation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let db: Db;
const outbox: MailMessage[] = [];
const mailer: Mailer = { enabled: true, send: async (m) => void outbox.push(m) };
// The real production rules (email required, strong passwords) with a test mailer.
const mkApp = (opts: Parameters<typeof createApp>[1] = {}) =>
  createApp(db, { csrfHeader: false, signupLimit: 1000, loginLimit: 1000, forgotLimit: 1000, mailer, ...opts });
const GOOD = 'Budget-me-2026';
let n = 0;
const fresh = () => `mail.user${n++}`;
/** Waits for the background email and returns the code in it. */
async function codeFor(to: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const m = outbox.find((x) => x.to === to);
    if (m) return /([A-Z2-9]{5}-[A-Z2-9]{5})/.exec(m.text)![1];
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`no email to ${to}`);
}

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, path.join(here, '..', 'migrations'));
}, 60_000);
afterAll(async () => {
  await db?.close();
});
beforeEach(() => {
  outbox.length = 0;
});

describe('password rules', () => {
  it('lists exactly what is missing', () => {
    expect(passwordProblems('abc')).toEqual(['uppercase', 'number', 'special', 'length']);
    expect(passwordProblems('ABCDEFGH')).toEqual(['lowercase', 'number', 'special']);
    expect(passwordProblems(GOOD)).toEqual([]);
    expect(passwordProblems('Aa1!aaaa')).toEqual([]);
  });
});

describe('sign-up', () => {
  it('needs an email and a strong password; the config tells the app so', async () => {
    const cfg = (await request(mkApp()).get('/api/auth/config')).body;
    expect(cfg).toMatchObject({ emailRequired: true, strongPasswords: true, emailReset: true });
    const name = fresh();
    const noEmail = await request(mkApp()).post('/api/auth/signup').send({ username: name, password: GOOD });
    expect(noEmail.status).toBe(400);
    expect(noEmail.body.error).toBe('Enter your email address.');
    const weak = await request(mkApp()).post('/api/auth/signup').send({ username: name, email: `${name}@example.com`, password: 'alllowercase1!' });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('weak_password');
    expect((await request(mkApp()).post('/api/auth/signup').send({ username: name, email: 'not-an-email', password: GOOD })).status).toBe(400);
    const ok = await request(mkApp()).post('/api/auth/signup').send({ username: name, email: ` ${name.toUpperCase()}@Example.com `, password: GOOD }).expect(201);
    expect(ok.body.user.email).toBe(`${name}@example.com`); // trimmed, lower-case
  });

  it('one account per email', async () => {
    const a = fresh();
    await request(mkApp()).post('/api/auth/signup').send({ username: a, email: 'shared@example.com', password: GOOD }).expect(201);
    const r = await request(mkApp()).post('/api/auth/signup').send({ username: fresh(), email: 'SHARED@example.com', password: GOOD });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('email_taken');
  });

  it('sign in with the username or the email', async () => {
    const name = fresh();
    await request(mkApp()).post('/api/auth/signup').send({ username: name, email: `${name}@example.com`, password: GOOD }).expect(201);
    await request(mkApp()).post('/api/auth/login').send({ username: `${name}@EXAMPLE.com`, password: GOOD }).expect(200);
    await request(mkApp()).post('/api/auth/login').send({ username: name, password: GOOD }).expect(200);
  });
});

describe('"Forgot password?" by email', () => {
  it('emails a code; the code and a strong new password reset it and sign out everywhere', async () => {
    const name = fresh();
    const email = `${name}@example.com`;
    const phone = request.agent(mkApp());
    await phone.post('/api/auth/signup').send({ username: name, email, password: GOOD }).expect(201);

    await request(mkApp()).post('/api/auth/forgot').send({ email: email.toUpperCase() }).expect(200);
    const code = await codeFor(email);
    const mail = outbox.find((m) => m.to === email)!;
    expect(mail.subject).toContain(code);
    expect(mail.text).toContain('30 minutes');
    expect(mail.text).toContain('كود');

    // Weak new password: refused, and the code still works afterwards.
    expect((await request(mkApp()).post('/api/auth/reset').send({ username: email, code, password: 'weakpassword' })).status).toBe(400);
    await request(mkApp()).post('/api/auth/reset').send({ username: email, code: code.toLowerCase(), password: 'New-Pass-2026' }).expect(200);
    expect((await phone.get('/api/auth/me')).status).toBe(401);
    await request(mkApp()).post('/api/auth/login').send({ username: name, password: 'New-Pass-2026' }).expect(200);
    // Only a hash of the code is stored.
    const stored = (await db.query("SELECT code_hash, via FROM password_resets WHERE via = 'email'")).rows;
    expect(JSON.stringify(stored)).not.toContain(code.replace('-', ''));
  });

  it('answers the same for an unknown address and sends nothing', async () => {
    const r = await request(mkApp()).post('/api/auth/forgot').send({ email: 'nobody-here@example.com' }).expect(200);
    expect(r.body).toEqual({ ok: true });
    await new Promise((res) => setTimeout(res, 100));
    expect(outbox).toHaveLength(0);
  });

  it('after 5 wrong codes the code stops working', async () => {
    const name = fresh();
    const email = `${name}@example.com`;
    await request(mkApp()).post('/api/auth/signup').send({ username: name, email, password: GOOD }).expect(201);
    await request(mkApp()).post('/api/auth/forgot').send({ email }).expect(200);
    const code = await codeFor(email);
    for (let i = 0; i < 5; i++) {
      expect((await request(mkApp()).post('/api/auth/reset').send({ username: name, code: 'WRONG-CODE2', password: 'New-Pass-2026' })).status).toBe(400);
    }
    expect((await request(mkApp()).post('/api/auth/reset').send({ username: name, code, password: 'New-Pass-2026' })).status).toBe(400);
  });

  it('only 3 emails per address per hour', async () => {
    const name = fresh();
    const email = `${name}@example.com`;
    const app = mkApp();
    await request(app).post('/api/auth/signup').send({ username: name, email, password: GOOD }).expect(201);
    for (let i = 0; i < 3; i++) await request(app).post('/api/auth/forgot').send({ email }).expect(200);
    expect((await request(app).post('/api/auth/forgot').send({ email })).status).toBe(429);
  });

  it('without email set up, the app is told to use admin codes', async () => {
    const app = mkApp({ mailer: { enabled: false, send: async () => undefined } });
    expect((await request(app).get('/api/auth/config')).body.emailReset).toBe(false);
    const r = await request(app).post('/api/auth/forgot').send({ email: 'someone@example.com' });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('no_email');
  });
});

describe('change email', () => {
  it('needs the password; old emailed codes stop working; the address must be free', async () => {
    const name = fresh();
    const email = `${name}@example.com`;
    const a = request.agent(mkApp());
    await a.post('/api/auth/signup').send({ username: name, email, password: GOOD }).expect(201);
    await request(mkApp()).post('/api/auth/forgot').send({ email }).expect(200);
    const oldCode = await codeFor(email);

    expect((await a.put('/api/auth/email').send({ email: `new.${email}`, password: 'wrong-Pass-1' })).status).toBe(403);
    expect((await a.put('/api/auth/email').send({ email: 'shared@example.com', password: GOOD })).status).toBe(409);
    const r = await a.put('/api/auth/email').send({ email: `New.${email}`, password: GOOD }).expect(200);
    expect(r.body.user.email).toBe(`new.${email}`);
    expect((await a.get('/api/auth/me')).body.user.email).toBe(`new.${email}`);
    expect((await request(mkApp()).post('/api/auth/reset').send({ username: name, code: oldCode, password: 'New-Pass-2026' })).status).toBe(400);
  });

  it('changing the password needs the new rules too', async () => {
    const name = fresh();
    const a = request.agent(mkApp());
    await a.post('/api/auth/signup').send({ username: name, email: `${name}@example.com`, password: GOOD }).expect(201);
    expect((await a.post('/api/auth/password').send({ current: GOOD, next: 'onlylowercase' })).status).toBe(400);
    await a.post('/api/auth/password').send({ current: GOOD, next: 'Another-Pass-9' }).expect(200);
  });
});
