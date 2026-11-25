import { log } from './log.js';
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import type { Db, Queryable } from './db.js';
import { ah, HttpError } from './http.js';
import { insertStarterCategories, seedStartingData } from './seed.js';
import { passwordProblems } from './validation.js';
import { startChallenge } from './twoFactor.js';
import { noteActivity } from './activity.js';

const scrypt = (pw: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((res, rej) => scryptCb(pw, salt, keylen, opts, (e, k) => (e ? rej(e) : res(k))));

export const OWNER = 'owner';
export const COOKIE = 'sb_session';
/** A session ends after this many days without use… */
const IDLE_DAYS = 14;
/** …and at the latest this many days after sign-in. */
const MAX_DAYS = 30;

export interface AuthUser {
  id: number;
  username: string;
  currency: string;
  /** Day of the month the budget month starts (1..28). */
  monthStartDay: number;
  /** For "Forgot password?" codes; older accounts may have none. */
  email?: string | null;
  /** Two-step sign-in (authenticator app) is on. */
  twoFactor?: boolean;
  /** Unspent category budget carries into the next month. */
  rollover?: boolean;
  /** Same expense added again within 5 minutes is added to the last one. */
  mergeRepeats?: boolean;
}

export const USER_COLUMNS =
  'u.id, u.username, u.currency, u.month_start_day AS "monthStartDay", u.email, (u.totp_enabled_at IS NOT NULL) AS "twoFactor", ' +
  'u.rollover, u.merge_repeats AS "mergeRepeats"';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** 2.3.0: hash of this request's session token, and until when it may use the admin area. */
      sessionHash?: string;
      adminUntil?: Date | null;
    }
  }
}

// ---------- password hashing ----------
// scrypt, cost stored in the hash ("scrypt2$N$r$p$salt$key") so it can be raised later.
// N=2^14, r=8, p=5 is one of OWASP's equivalent minimum settings (same work as N=2^17,p=1)
// but needs only 16 MiB per hash, so a small VPS can't be exhausted by parallel sign-ins
// (Node runs at most 4 scrypt jobs at once on its thread pool).
const PARAMS = { N: 2 ** 14, r: 8, p: 5 };
const LEGACY = { N: 2 ** 14, r: 8, p: 1 }; // hashes written before 0.1.0-alpha hardening: "scrypt$salt$key"
const maxmem = (n: number, r: number) => 256 * n * r + 1024 * 1024;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p } = PARAMS;
  const key = await scrypt(pw, salt, 64, { N, r, p, maxmem: maxmem(N, r) });
  return `scrypt2$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function parseHash(stored: string) {
  const parts = stored.split('$');
  if (parts[0] === 'scrypt2' && parts.length === 6) {
    const [, n, r, p, salt, key] = parts;
    return { N: Number(n), r: Number(r), p: Number(p), salt, key };
  }
  if (parts[0] === 'scrypt' && parts.length === 3) return { ...LEGACY, salt: parts[1], key: parts[2] };
  return null;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const h = parseHash(stored);
  if (!h || !h.salt || !h.key || h.N > 2 ** 20 || h.r > 32 || h.p > 16) return false;
  const expected = Buffer.from(h.key, 'base64');
  const got = await scrypt(pw, Buffer.from(h.salt, 'base64'), expected.length, {
    N: h.N,
    r: h.r,
    p: h.p,
    maxmem: maxmem(h.N, h.r),
  });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** True when a stored hash uses weaker settings than today's: re-hash at the next sign-in. */
export function needsRehash(stored: string) {
  const h = parseHash(stored);
  return !h || h.N < PARAMS.N || h.r < PARAMS.r || h.p < PARAMS.p;
}

export const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');

// ---------- settings ----------
let cookieSecureMode: 'auto' | 'always' | 'never' = 'auto';
/** COOKIE_SECURE: 'true' (always, production behind HTTPS), 'false' (never), anything else = auto. */
export function configureAuth(opts: { cookieSecure?: string }) {
  const v = (opts.cookieSecure ?? '').toLowerCase();
  cookieSecureMode = v === 'true' ? 'always' : v === 'false' ? 'never' : 'auto';
}

/**
 * Optional built-in account: make sure "owner" exists and its password matches
 * APP_PASSWORD. Changing APP_PASSWORD signs that account out everywhere. Sign-up
 * cannot take the name "owner", so this never adopts someone else's account.
 * A brand-new owner starts empty, unless `seed` is true (example data, used by tests).
 */
export async function ensureOwner(db: Db, password: string, seed = false): Promise<number> {
  const r = await db.query('SELECT id, password_hash FROM users WHERE username = $1', [OWNER]);
  if (r.rows.length === 0) {
    const hash = await hashPassword(password);
    return db.tx(async (q) => {
      const ins = await q.query(
        `INSERT INTO users(username, password_hash) VALUES ($1, $2)
         ON CONFLICT (username) DO NOTHING RETURNING id`,
        [OWNER, hash],
      );
      if (ins.rows.length === 0) {
        // another replica created it at the same moment
        return (await q.query('SELECT id FROM users WHERE username = $1', [OWNER])).rows[0].id as number;
      }
      const id = ins.rows[0].id as number;
      if (seed) await seedStartingData(q, id);
      return id;
    });
  }
  const { id, password_hash } = r.rows[0];
  if (!(await verifyPassword(password, password_hash)) || needsRehash(password_hash)) {
    const changed = !(await verifyPassword(password, password_hash));
    await db.tx(async (q) => {
      await q.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(password), id]);
      if (changed) await q.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    });
    if (changed) log.info('APP_PASSWORD changed: password updated and old sessions signed out.');
  }
  return id as number;
}

export const cookieOptionsFor = (req: Request) => cookieOptions(req);
function cookieOptions(req: Request): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    // 'auto': Secure when the request came over HTTPS (via a trusted reverse proxy).
    secure: cookieSecureMode === 'always' ? true : cookieSecureMode === 'never' ? false : req.secure,
    path: '/',
    maxAge: MAX_DAYS * 24 * 3600 * 1000,
  };
}

export async function createSession(q: Queryable, userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await q.query(
    `INSERT INTO sessions(token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [sha256(token), userId, IDLE_DAYS],
  );
  return token;
}

export const requireAuth =
  (db: Db): RequestHandler =>
  ah(async (req, _res, next) => {
    const token = req.cookies?.[COOKIE];
    if (!token || typeof token !== 'string' || token.length > 100) {
      throw new HttpError(401, 'Please sign in.', 'unauthenticated');
    }
    const hash = sha256(token);
    const r = await db.query(
      `SELECT ${USER_COLUMNS}, s.expires_at < now() + make_interval(days => $2) AS refresh,
              (u.last_active_at IS NULL OR u.last_active_at < now() - interval '1 hour') AS stale,
              CASE WHEN s.admin_until > now() THEN s.admin_until END AS "adminUntil"
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hash, IDLE_DAYS - 1],
    );
    if (r.rows.length === 0) throw new HttpError(401, 'Your session expired. Please sign in again.', 'unauthenticated');
    const { refresh, stale, adminUntil, ...user } = r.rows[0];
    // "Last active" for the admin page, written at most about once an hour per account.
    if (stale) await db.query('UPDATE users SET last_active_at = now() WHERE id = $1', [user.id]);
    // Which days the account was used, in the app or a browser (admin area counts; once a day per kind).
    await noteActivity(db, user.id, /\bBudgetMeApp\b/.test(req.get('user-agent') ?? ''));
    // Sliding expiry (at most once a day): idle timeout, capped at MAX_DAYS after sign-in.
    if (refresh) {
      await db.query(
        `UPDATE sessions SET expires_at = LEAST(created_at + make_interval(days => $2), now() + make_interval(days => $3))
         WHERE token_hash = $1`,
        [hash, MAX_DAYS, IDLE_DAYS],
      );
    }
    req.user = user as AuthUser;
    req.sessionHash = hash;
    req.adminUntil = adminUntil ? new Date(adminUntil) : null;
    next();
  });

// ---------- admins ----------
/**
 * Who may open the admin area.
 * - ADMIN_EMAIL set (2.3.0, production): exactly ONE account, the one with that email. "owner" and
 *   ADMIN_USERNAMES give no admin rights then. Nobody else can take that email (sign-up and Settings refuse it).
 * - Not set: the built-in "owner" plus ADMIN_USERNAMES (self-hosted servers, tests).
 */
let adminNames = new Set<string>();
let adminEmail: string | null = null;
export function setAdminUsernames(names: string[]) {
  adminNames = new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
}
export function setAdminEmail(email: string | undefined | null) {
  adminEmail = email ? email.trim().toLowerCase() : null;
}
/** ADMIN_EMAIL is set: one admin, and the admin area needs two-step sign-in and an unlock (2.3.0). */
export const strictAdmin = () => !!adminEmail;
/** Username-only check (no email at hand): never true when ADMIN_EMAIL decides. */
export const isAdminName = (username: string) => !adminEmail && (username === OWNER || adminNames.has(username));
export const isAdminUser = (u: { username?: unknown; email?: unknown }) =>
  adminEmail ? String(u.email ?? '').trim().toLowerCase() === adminEmail : isAdminName(String(u.username ?? ''));
/** Listed admin names can't be taken by sign-up (create the account first, then list it). */
export const isListedAdminName = (username: string) => !adminEmail && adminNames.has(username.trim().toLowerCase());
/** The admin email can't be used by sign-up or moved onto another account. */
export const isAdminEmail = (email: string | undefined | null) => !!adminEmail && !!email && email.trim().toLowerCase() === adminEmail;

export const publicUser = (u: AuthUser) => ({
  id: u.id,
  username: u.username,
  currency: u.currency,
  monthStartDay: u.monthStartDay,
  email: u.email ?? null,
  twoFactor: !!u.twoFactor,
  rollover: !!u.rollover,
  mergeRepeats: !!u.mergeRepeats,
  isAdmin: isAdminUser(u),
});

// ---------- sign-up rules ----------
/** Production: email required and strong passwords. Older tests turn these off to keep their fixtures short. */
let policy = { requireEmail: true, strongPasswords: true };
export function setSignupPolicy(p: { requireEmail?: boolean; strongPasswords?: boolean }) {
  policy = { requireEmail: p.requireEmail ?? true, strongPasswords: p.strongPasswords ?? true };
}
export const signupPolicy = () => policy;

/** Every new password (sign-up, change, reset) must meet the rules shown on screen. */
export function checkNewPassword(pw: string, username: string) {
  if (pw.toLowerCase() === username.toLowerCase()) {
    throw new HttpError(400, 'Your password must not be the same as your username.', 'weak_password');
  }
  if (policy.strongPasswords) {
    if (passwordProblems(pw).length) {
      throw new HttpError(
        400,
        'Use at least 8 characters with a lowercase letter, an uppercase letter, a number and a special character.',
        'weak_password',
      );
    }
  } else if (pw.length < 10) {
    throw new HttpError(400, 'Use a password of at least 10 characters.', 'weak_password');
  }
}

// A real hash of a random password, so a login for an unknown username costs the
// same scrypt work as a real one (response time doesn't reveal which usernames exist).
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')));

export function loginHandler(db: Db, parse: (b: unknown) => { username?: string; password: string }) {
  return ah(async (req: Request, res: Response) => {
    const { username, password } = parse(req.body);
    // Sign in with the username or the account's email.
    const login = (username || OWNER).trim().toLowerCase();
    const r = await db.query(
      `SELECT ${USER_COLUMNS}, u.password_hash FROM users u WHERE ${login.includes('@') ? 'lower(u.email)' : 'u.username'} = $1`,
      [login],
    );
    const user = r.rows[0];
    const ok = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
    if (!user || !ok) throw new HttpError(401, 'Wrong username or password.', 'bad_credentials');
    if (needsRehash(user.password_hash)) {
      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(password), user.id]);
    }
    await db.query('DELETE FROM sessions WHERE expires_at < now()');
    // Two-step sign-in: no session yet, only a ticket for the code (POST /auth/login/2fa).
    if (user.twoFactor) {
      res.json({ twoFactor: true, ticket: await startChallenge(db, user.id) });
      return;
    }
    const token = await createSession(db, user.id);
    res.cookie(COOKIE, token, cookieOptions(req));
    res.json({ user: publicUser(user as AuthUser) });
  });
}

/**
 * Create a new account and sign it in. Can be turned off. With `starter` (2.1.0, on in production) it
 * comes with a few everyday categories so the first expense can be logged at once; otherwise it starts empty.
 */
export function signupHandler(
  db: Db,
  parse: (b: unknown) => { username: string; email?: string; password: string; lang?: 'en' | 'ar' },
  opts: () => Promise<{ allowed: boolean }>,
  starter = false,
) {
  return ah(async (req: Request, res: Response) => {
    const o = await opts();
    if (!o.allowed) throw new HttpError(403, 'Creating new accounts is turned off on this server.', 'signup_disabled');
    const { username, email, password, lang } = parse(req.body);
    if (policy.requireEmail && !email) throw new HttpError(400, 'Enter your email address.', 'email_required');
    checkNewPassword(password, username);
    if (isListedAdminName(username)) throw new HttpError(403, 'That username is reserved, please choose another one.', 'reserved');
    if (isAdminEmail(email)) throw new HttpError(403, 'That email cannot be used for a new account.', 'reserved');
    const hash = await hashPassword(password);
    if (email && (await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [email])).rows.length) {
      throw new HttpError(409, 'An account with that email already exists. Sign in, or use "Forgot password?".', 'email_taken');
    }
    const ins = await db.query(
      `INSERT INTO users(username, password_hash, email) VALUES ($1, $2, $3)
       ON CONFLICT (username) DO NOTHING
       RETURNING id, username, currency, month_start_day AS "monthStartDay", email`,
      [username, hash, email ?? null],
    );
    if (!ins.rows.length) throw new HttpError(409, 'That username is already taken. Try another one.', 'username_taken');
    const user = ins.rows[0] as AuthUser;
    if (starter) await insertStarterCategories(db, user.id, lang);
    const token = await createSession(db, user.id);
    res.cookie(COOKIE, token, cookieOptions(req));
    res.status(201).json({ user: publicUser(user) });
  });
}

export function logoutHandler(db: Db) {
  return ah(async (req, res) => {
    const token = req.cookies?.[COOKIE];
    if (typeof token === 'string') await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
    res.clearCookie(COOKIE, { path: '/' });
    res.status(204).end();
  });
}

// ---------- account controls (signed in) ----------

export async function checkPassword(db: Db, userId: number, password: string) {
  const r = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!r.rows.length || !(await verifyPassword(password, r.rows[0].password_hash))) {
    throw new HttpError(403, 'Your current password is not right.', 'bad_password');
  }
}

/** Change password: keeps this device signed in, signs out every other one. */
export function changePasswordHandler(db: Db, parse: (b: unknown) => { current: string; next: string }) {
  return ah(async (req, res) => {
    const { current, next } = parse(req.body);
    const u = req.user!;
    await checkPassword(db, u.id, current);
    checkNewPassword(next, u.username);
    const token = String(req.cookies?.[COOKIE] ?? '');
    await db.tx(async (q) => {
      await q.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(next), u.id]);
      await q.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [u.id, sha256(token)]);
      // A reset code made before this change must not undo it.
      await q.query('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [u.id]);
    });
    res.json({ ok: true });
  });
}

/** Add or change the account's email (used for "Forgot password?"). Needs the current password. */
export function setEmailHandler(db: Db, parse: (b: unknown) => { email: string; password: string }) {
  return ah(async (req, res) => {
    const { email, password } = parse(req.body);
    const u = req.user!;
    await checkPassword(db, u.id, password);
    // The admin email stays on the admin account: no other account can switch to it.
    if (isAdminEmail(email) && !isAdminEmail(u.email)) throw new HttpError(403, 'That email cannot be used.', 'reserved');
    const taken = await db.query('SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2', [email, u.id]);
    if (taken.rows.length) throw new HttpError(409, 'Another account already uses that email.', 'email_taken');
    await db.query('UPDATE users SET email = $1 WHERE id = $2', [email, u.id]);
    // A code sent to the old address must not work any more.
    await db.query("DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL AND via = 'email'", [u.id]);
    res.json({ user: publicUser({ ...u, email }) });
  });
}
/** Sign out on every device (including this one). */
export function logoutAllHandler(db: Db) {
  return ah(async (req, res) => {
    await db.query('DELETE FROM sessions WHERE user_id = $1', [req.user!.id]);
    res.clearCookie(COOKIE, { path: '/' });
    res.status(204).end();
  });
}

/** Delete the account and everything in it (expenses, receipts, goals, loans...). */
export function deleteAccountHandler(db: Db, parse: (b: unknown) => { password: string }) {
  return ah(async (req, res) => {
    const { password } = parse(req.body);
    const u = req.user!;
    await checkPassword(db, u.id, password);
    await db.query('DELETE FROM users WHERE id = $1', [u.id]); // cascades to all data and sessions
    res.clearCookie(COOKIE, { path: '/' });
    res.status(204).end();
  });
}
