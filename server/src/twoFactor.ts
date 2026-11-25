import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { audit } from './admin.js';
import { checkPassword, COOKIE, cookieOptionsFor, createSession, publicUser, sha256, USER_COLUMNS, type AuthUser } from './auth.js';
import type { Db, Queryable } from './db.js';
import { ah, HttpError } from './http.js';
import { newBackupCodes, newTotpSecret, normalizeBackupCode, otpauthUri, verifyTotp } from './totp.js';

/**
 * Two-step sign-in. With it on, signing in is password + a 6-digit code from an authenticator app
 * (or one of 8 one-time backup codes). Anyone can turn it on in Settings; recommended for admins.
 */
const TICKET_MINUTES = 5;
const MAX_TRIES = 5;
const code = z.string().trim().min(6).max(20);

/** After the right password: a short-lived ticket that only a valid code turns into a session. */
export async function startChallenge(q: Queryable, userId: number): Promise<string> {
  const ticket = randomBytes(32).toString('base64url');
  await q.query('DELETE FROM login_challenges WHERE expires_at < now()');
  await q.query(
    `INSERT INTO login_challenges(token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))`,
    [sha256(ticket), userId, TICKET_MINUTES],
  );
  return ticket;
}

/**
 * 2.3.0 (security audit): wrong codes per account, from every network together. A stolen password plus
 * many IP addresses must not be enough to guess the 6-digit code: after 10 wrong codes in 15 minutes the
 * account takes no more codes for the rest of that window. Kept in memory (one app container).
 */
const CODE_FAILS = 10;
const CODE_WINDOW_MS = 15 * 60_000;
const codeFails = new Map<number, { n: number; until: number }>();
export function codeLocked(userId: number) {
  const f = codeFails.get(userId);
  if (f && f.until < Date.now()) codeFails.delete(userId);
  return (codeFails.get(userId)?.n ?? 0) >= CODE_FAILS;
}
export function codeFailed(userId: number) {
  const f = codeFails.get(userId);
  if (!f || f.until < Date.now()) codeFails.set(userId, { n: 1, until: Date.now() + CODE_WINDOW_MS });
  else f.n += 1;
  if (codeFails.size > 50_000) codeFails.clear();
}
const tooMany = () => new HttpError(429, 'Too many wrong codes. Try again in 15 minutes.', 'too_many');

/** A TOTP code or an unused backup code for this account; marks it used. True when it was right. */
export async function useCode(q: Queryable, userId: number, typed: string): Promise<boolean> {
  const u = (await q.query('SELECT totp_secret, totp_last_step FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
  if (!u?.totp_secret) return false;
  const step = verifyTotp(u.totp_secret, typed, Date.now(), u.totp_last_step === null ? null : Number(u.totp_last_step));
  if (step !== null) {
    await q.query('UPDATE users SET totp_last_step = $2 WHERE id = $1', [userId, step]);
    return true;
  }
  const backup = normalizeBackupCode(typed);
  if (!/^[A-Z2-9]{8}$/.test(backup)) return false;
  const hit = await q.query(
    'UPDATE totp_backup_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id',
    [userId, sha256(backup)],
  );
  return hit.rows.length > 0;
}

/** POST /auth/login/2fa { ticket, code }: second step of signing in. */
export function loginSecondStepHandler(db: Db) {
  return ah(async (req: Request, res: Response) => {
    const b = z.object({ ticket: z.string().min(20).max(100), code }).parse(req.body);
    const wrong = () => new HttpError(400, 'That code is not right. Try the newest code from your app.', 'bad_code');
    // 2.3.0 (security audit): the try is counted and saved BEFORE the code is checked, so many requests sent
    // at once on one ticket can't all see "0 tries" (they used to be counted only after a rollback).
    const c = (
      await db.query(
        `UPDATE login_challenges SET attempts = attempts + 1 WHERE token_hash = $1 AND expires_at > now() RETURNING user_id, attempts`,
        [sha256(b.ticket)],
      )
    ).rows[0];
    if (!c) throw new HttpError(401, 'That took too long. Sign in again.', 'ticket_expired');
    if (c.attempts > MAX_TRIES) throw new HttpError(429, 'Too many wrong codes. Sign in again.', 'too_many');
    if (codeLocked(c.user_id)) throw tooMany();
    const user = await db.tx(async (q) => {
      if (!(await useCode(q, c.user_id, b.code))) return null;
      await q.query('DELETE FROM login_challenges WHERE token_hash = $1', [sha256(b.ticket)]);
      return (await q.query(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [c.user_id])).rows[0] as AuthUser;
    });
    if (!user) {
      codeFailed(c.user_id);
      throw wrong();
    }
    const token = await createSession(db, user.id);
    res.cookie(COOKIE, token, cookieOptionsFor(req));
    res.json({ user: publicUser(user) });
  });
}

/** Settings → Two-step sign-in (signed in). */
export function twoFactorRoutes(db: Db): Router {
  const r = Router();

  // 1. Start: needs the password; returns a new secret (not active until a code proves the app has it).
  r.post(
    '/auth/2fa/setup',
    ah(async (req, res) => {
      const { password } = z.object({ password: z.string().min(1).max(200) }).parse(req.body);
      const u = req.user!;
      await checkPassword(db, u.id, password);
      if (u.twoFactor) throw new HttpError(409, 'Two-step sign-in is already on.', 'already_on');
      const secret = newTotpSecret();
      await db.query('UPDATE users SET totp_secret = $2, totp_last_step = NULL WHERE id = $1 AND totp_enabled_at IS NULL', [u.id, secret]);
      res.json({ secret, uri: otpauthUri(u.username, secret) });
    }),
  );

  // 2. Turn on with the first code; returns 8 one-time backup codes (shown once, stored hashed).
  r.post(
    '/auth/2fa/enable',
    ah(async (req, res) => {
      const b = z.object({ code }).parse(req.body);
      const u = req.user!;
      const codes = await db.tx(async (q) => {
        const row = (await q.query('SELECT totp_secret, totp_enabled_at FROM users WHERE id = $1 FOR UPDATE', [u.id])).rows[0];
        if (row.totp_enabled_at) throw new HttpError(409, 'Two-step sign-in is already on.', 'already_on');
        if (!row.totp_secret) throw new HttpError(400, 'Start the setup again.', 'no_setup');
        const step = verifyTotp(row.totp_secret, b.code, Date.now());
        if (step === null) throw new HttpError(400, 'That code is not right. Check the time on your phone and try the newest code.', 'bad_code');
        await q.query('UPDATE users SET totp_enabled_at = now(), totp_last_step = $2 WHERE id = $1', [u.id, step]);
        await q.query('DELETE FROM totp_backup_codes WHERE user_id = $1', [u.id]);
        const list = newBackupCodes();
        for (const c of list) await q.query('INSERT INTO totp_backup_codes(user_id, code_hash) VALUES ($1, $2)', [u.id, sha256(normalizeBackupCode(c))]);
        // 2.3.0 (security audit): someone turning this on because they fear a break-in must not leave a
        // stolen session signed in: every other device is signed out (this one stays).
        await q.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [u.id, req.sessionHash ?? '']);
        await audit(q, req, 'two_factor_on', u.username);
        return list;
      });
      res.json({ backupCodes: codes, user: publicUser({ ...u, twoFactor: true }) });
    }),
  );

  // Turn off: the password and a current code (or a backup code).
  r.post(
    '/auth/2fa/disable',
    ah(async (req, res) => {
      const b = z.object({ password: z.string().min(1).max(200), code }).parse(req.body);
      const u = req.user!;
      await checkPassword(db, u.id, b.password);
      if (codeLocked(u.id)) throw tooMany();
      await db.tx(async (q) => {
        if (!(await useCode(q, u.id, b.code))) {
          codeFailed(u.id);
          throw new HttpError(400, 'That code is not right. Try the newest code from your app.', 'bad_code');
        }
        await turnOff(q, u.id);
        await audit(q, req, 'two_factor_off', u.username);
      });
      res.json({ user: publicUser({ ...u, twoFactor: false }) });
    }),
  );

  return r;
}

export async function turnOff(q: Queryable, userId: number) {
  await q.query('UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = $1', [userId]);
  await q.query('DELETE FROM totp_backup_codes WHERE user_id = $1', [userId]);
  await q.query('DELETE FROM login_challenges WHERE user_id = $1', [userId]);
}
