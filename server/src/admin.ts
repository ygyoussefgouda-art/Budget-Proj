/**
 * Admin page (only the "owner" account and accounts in ADMIN_USERNAMES): users, sign-up settings,
 * removing a user, and one-time password reset codes. Every admin action goes to audit_log.
 */
import { randomInt } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { checkPassword, hashPassword, isAdminName, OWNER, sha256 } from './auth.js';
import type { Db, Queryable } from './db.js';
import { ah, HttpError } from './http.js';
import { id as idSchema, schemas } from './validation.js';

/** Admins can't take over or remove each other; only the built-in owner can act on another admin. */
function protectAdmins(req: Request, target: string) {
  if (isAdminName(target) && req.user!.username !== OWNER) {
    throw new HttpError(403, 'Only the owner account can do this to another admin.');
  }
}

export interface SignupDefaults {
  allowSignup: boolean;
  inviteCode: string;
}

/** Sign-up settings in effect: what an admin set in the app, else the .env defaults. */
export async function signupConfig(db: Queryable, defaults: SignupDefaults) {
  const rows = (await db.query('SELECT key, value FROM app_settings')).rows;
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const allow = get('allow_signup');
  const code = get('invite_code');
  return {
    allowed: typeof allow === 'boolean' ? allow : defaults.allowSignup,
    inviteCode: typeof code === 'string' ? code : defaults.inviteCode,
  };
}

export async function audit(q: Queryable, req: Request, action: string, target: string | null, details: Record<string, unknown> = {}) {
  await q.query(
    'INSERT INTO audit_log(actor_id, actor_username, action, target, details, ip) VALUES ($1, $2, $3, $4, $5, $6)',
    [req.user?.id ?? null, req.user?.username ?? String((req.body as { username?: string })?.username ?? '?'), action, target, JSON.stringify(details), req.ip ?? null],
  );
}

// ---------- reset codes ----------
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I: easy to read out loud
/** 10 random characters (≈50 bits), shown as XXXXX-XXXXX. */
export function newResetCode() {
  const c = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${c.slice(0, 5)}-${c.slice(5)}`;
}
/** Case, spaces and dashes don't matter when the code is typed in. */
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, '');
const RESET_HOURS = 1;

export function adminRoutes(db: Db, defaults: SignupDefaults): Router {
  const r = Router();
  const pid = (v: unknown) => idSchema.parse(v);

  // Everything below is for admins only.
  r.use('/admin', (req, _res, next) => {
    if (!req.user || !isAdminName(req.user.username)) return next(new HttpError(403, 'Only an admin can do that.', 'not_admin'));
    next();
  });

  r.get(
    '/admin/users',
    ah(async (_req, res) => {
      const rows = await db.query(
        `SELECT u.id, u.username, u.created_at, u.last_active_at,
           (SELECT COALESCE(SUM(size), 0) FROM receipts r WHERE r.user_id = u.id) AS receipt_bytes,
           (SELECT COUNT(*) FROM expenses e WHERE e.user_id = u.id)
             + (SELECT COUNT(*) FROM goal_entries g WHERE g.user_id = u.id)
             + (SELECT COUNT(*) FROM loan_entries l WHERE l.user_id = u.id) AS items
         FROM users u ORDER BY u.created_at, u.id LIMIT 1000`,
      );
      res.json(
        rows.rows.map((x) => ({
          id: x.id,
          username: x.username,
          createdAt: x.created_at,
          lastActiveAt: x.last_active_at,
          receiptBytes: Number(x.receipt_bytes),
          items: Number(x.items),
          isAdmin: isAdminName(x.username),
        })),
      );
    }),
  );

  r.get(
    '/admin/settings',
    ah(async (_req, res) => {
      const c = await signupConfig(db, defaults);
      res.json({ allowSignup: c.allowed, inviteCode: c.inviteCode });
    }),
  );

  r.put(
    '/admin/settings',
    ah(async (req, res) => {
      const b = schemas.adminSettings.parse(req.body);
      const before = await signupConfig(db, defaults);
      await db.tx(async (q) => {
        await q.query(
          `INSERT INTO app_settings(key, value, updated_at) VALUES ('allow_signup', $1, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [JSON.stringify(b.allowSignup)],
        );
        await q.query(
          `INSERT INTO app_settings(key, value, updated_at) VALUES ('invite_code', $1, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [JSON.stringify(b.inviteCode)],
        );
        // The code itself is not written to the log, only that it changed.
        await audit(q, req, 'signup_settings_changed', null, {
          allowSignup: b.allowSignup,
          inviteCode: b.inviteCode === before.inviteCode ? 'unchanged' : b.inviteCode ? 'set' : 'cleared',
        });
      });
      res.json({ allowSignup: b.allowSignup, inviteCode: b.inviteCode });
    }),
  );

  r.post(
    '/admin/users/:id/reset-code',
    ah(async (req, res) => {
      const userId = pid(req.params.id);
      const b = schemas.adminResetCode.parse(req.body);
      // A reset code takes over an account, so it needs the admin's own password (like removing one).
      await checkPassword(db, req.user!.id, b.password);
      const out = await db.tx(async (q) => {
        const u = (await q.query('SELECT id, username FROM users WHERE id = $1', [userId])).rows[0];
        if (!u) throw new HttpError(404, 'User not found.');
        if (u.id === req.user!.id) throw new HttpError(400, 'Change your own password in Settings instead.');
        if (u.username === OWNER) throw new HttpError(400, 'The owner password is set with APP_PASSWORD on the server.');
        protectAdmins(req, u.username);
        // Only the newest code works.
        await q.query('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [u.id]);
        const code = newResetCode();
        const row = await q.query(
          `INSERT INTO password_resets(user_id, code_hash, created_by, expires_at)
           VALUES ($1, $2, $3, now() + make_interval(hours => $4)) RETURNING expires_at`,
          [u.id, sha256(normalizeCode(code)), req.user!.id, RESET_HOURS],
        );
        await audit(q, req, 'reset_code_created', u.username, { expiresAt: row.rows[0].expires_at });
        return { code, username: u.username as string, expiresAt: row.rows[0].expires_at };
      });
      // The code is shown once, here; the server only keeps its hash.
      res.status(201).json(out);
    }),
  );

  r.post(
    '/admin/users/:id/delete',
    ah(async (req, res) => {
      const userId = pid(req.params.id);
      const b = schemas.adminDeleteUser.parse(req.body);
      await checkPassword(db, req.user!.id, b.password); // strong confirmation: your own password…
      await db.tx(async (q) => {
        const u = (await q.query('SELECT id, username FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
        if (!u) throw new HttpError(404, 'User not found.');
        if (u.id === req.user!.id) throw new HttpError(400, 'Use "Delete my account" in Settings to delete your own account.');
        if (u.username === OWNER) throw new HttpError(400, 'The built-in owner account cannot be removed here.');
        protectAdmins(req, u.username);
        // …and their username typed exactly.
        if (b.confirmUsername.trim().toLowerCase() !== u.username) throw new HttpError(400, 'Type the username exactly to confirm.');
        await q.query('DELETE FROM users WHERE id = $1', [u.id]); // all their data, sessions and receipts go with it
        await audit(q, req, 'user_deleted', u.username, { userId: u.id });
      });
      res.status(204).end();
    }),
  );

  r.get(
    '/admin/audit',
    ah(async (req, res) => {
      const limit = z.coerce.number().int().min(1).max(200).default(50).parse(req.query.limit);
      const rows = await db.query(
        'SELECT id, actor_username, action, target, details, created_at FROM audit_log ORDER BY created_at DESC, id DESC LIMIT $1',
        [limit],
      );
      res.json(
        rows.rows.map((x) => ({ id: x.id, actor: x.actor_username, action: x.action, target: x.target, details: x.details, at: x.created_at })),
      );
    }),
  );

  return r;
}

/** Public: use a reset code from an admin to choose a new password. Signs out every session. */
export function resetPasswordHandler(db: Db) {
  return ah(async (req, res) => {
    const b = schemas.resetPassword.parse(req.body);
    const wrong = () => new HttpError(400, 'That reset code is not right or has expired.', 'bad_reset_code');
    await db.tx(async (q) => {
      const u = (await q.query('SELECT id, username FROM users WHERE username = $1', [b.username])).rows[0];
      if (!u) throw wrong();
      const used = await q.query(
        `UPDATE password_resets SET used_at = now()
         WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL AND expires_at > now() RETURNING id`,
        [u.id, sha256(normalizeCode(b.code))],
      );
      if (!used.rows.length) throw wrong();
      await q.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(b.password), u.id]);
      await q.query('DELETE FROM sessions WHERE user_id = $1', [u.id]); // signed out everywhere
      await q.query('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [u.id]);
      req.user = { id: u.id, username: u.username, currency: '', monthStartDay: 1 };
      await audit(q, req, 'password_reset', u.username);
    });
    res.json({ ok: true });
  });
}
