import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import type { Db, Queryable } from './db.js';
import { ah, HttpError } from './http.js';
import { seedStartingData } from './seed.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const OWNER = 'owner';
export const COOKIE = 'sb_session';
const SESSION_DAYS = 30;

export interface AuthUser {
  id: number;
  username: string;
  currency: string;
  /** Day of the month the budget month starts (1..28). */
  monthStartDay: number;
}

const USER_COLUMNS = 'u.id, u.username, u.currency, u.month_start_day AS "monthStartDay"';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, s, k] = stored.split('$');
  if (algo !== 'scrypt' || !s || !k) return false;
  const expected = Buffer.from(k, 'base64');
  const got = await scrypt(pw, Buffer.from(s, 'base64'), expected.length);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');

/**
 * Single-password mode: make sure the "owner" account exists and its
 * password matches APP_PASSWORD. Changing APP_PASSWORD signs everyone out.
 * A brand-new owner starts completely empty, unless `seed` is true
 * (example data from Student_Budget.xlsx, used by the tests or SEED_EXAMPLE_DATA=true).
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
  if (!(await verifyPassword(password, password_hash))) {
    await db.tx(async (q) => {
      await q.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(password), id]);
      await q.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    });
    console.log('[auth] APP_PASSWORD changed: password updated and old sessions signed out.');
  }
  return id as number;
}

function cookieOptions(req: Request): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure, // true behind an HTTPS reverse proxy (trust proxy is set)
    path: '/',
    maxAge: SESSION_DAYS * 24 * 3600 * 1000,
  };
}

export async function createSession(q: Queryable, userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await q.query(
    `INSERT INTO sessions(token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [sha256(token), userId, SESSION_DAYS],
  );
  return token;
}

export const requireAuth =
  (db: Db): RequestHandler =>
  ah(async (req, _res, next) => {
    const token = req.cookies?.[COOKIE];
    if (!token || typeof token !== 'string') throw new HttpError(401, 'Please sign in.', 'unauthenticated');
    const r = await db.query(
      `SELECT ${USER_COLUMNS} FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)],
    );
    if (r.rows.length === 0) throw new HttpError(401, 'Your session expired. Please sign in again.', 'unauthenticated');
    req.user = r.rows[0] as AuthUser;
    next();
  });

const publicUser = (u: AuthUser) => ({ id: u.id, username: u.username, currency: u.currency, monthStartDay: u.monthStartDay });

// A real hash of a random password, so a login for an unknown username costs the
// same scrypt work as a real one (response time doesn't reveal which usernames exist).
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')));

export function loginHandler(db: Db, parse: (b: unknown) => { username?: string; password: string }) {
  return ah(async (req: Request, res: Response) => {
    const { username, password } = parse(req.body);
    const r = await db.query(`SELECT ${USER_COLUMNS}, u.password_hash FROM users u WHERE u.username = $1`, [
      (username || OWNER).trim().toLowerCase(),
    ]);
    const user = r.rows[0];
    const ok = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
    if (!user || !ok) throw new HttpError(401, 'Wrong username or password.', 'bad_credentials');
    await db.query('DELETE FROM sessions WHERE expires_at < now()');
    const token = await createSession(db, user.id);
    res.cookie(COOKIE, token, cookieOptions(req));
    res.json({ user: publicUser(user as AuthUser) });
  });
}

/** Create a new account (starts empty) and sign it in. Can be turned off with ALLOW_SIGNUP=false. */
export function signupHandler(
  db: Db,
  parse: (b: unknown) => { username: string; password: string },
  allowed: () => boolean,
) {
  return ah(async (req: Request, res: Response) => {
    if (!allowed()) throw new HttpError(403, 'Creating new accounts is turned off on this server.', 'signup_disabled');
    const { username, password } = parse(req.body);
    const hash = await hashPassword(password);
    const ins = await db.query(
      `INSERT INTO users(username, password_hash) VALUES ($1, $2)
       ON CONFLICT (username) DO NOTHING
       RETURNING id, username, currency, month_start_day AS "monthStartDay"`,
      [username, hash],
    );
    if (!ins.rows.length) throw new HttpError(409, 'That username is already taken. Try another one.', 'username_taken');
    const user = ins.rows[0] as AuthUser;
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
