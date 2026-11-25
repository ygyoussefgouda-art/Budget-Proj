/**
 * Admin page (only the "owner" account and accounts in ADMIN_USERNAMES): users, sign-up settings,
 * removing a user, and one-time password reset codes. Every admin action goes to audit_log.
 */
import { randomInt } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { checkNewPassword, checkPassword, hashPassword, isAdminUser, OWNER, sha256, strictAdmin } from './auth.js';
import { usageStats } from './activity.js';
import { resetCodeMail, sendInBackground, type Mailer } from './mail.js';
import { codeFailed, codeLocked, turnOff, useCode } from './twoFactor.js';
import type { Db, Queryable } from './db.js';
import { ah, HttpError } from './http.js';
import { id as idSchema, schemas } from './validation.js';

/** How long the admin area stays open after unlocking (2.3.0). */
export const ADMIN_UNLOCK_MINUTES = 15;

/** Admins can't take over or remove each other; only the built-in owner can act on another admin. */
function protectAdmins(req: Request, target: { username?: unknown; email?: unknown }) {
  if (isAdminUser(target) && req.user!.username !== OWNER) {
    throw new HttpError(403, 'Only the owner account can do this to another admin.');
  }
}

export interface SignupDefaults {
  allowSignup: boolean;
}

/** Sign-up settings in effect: what an admin set in the app, else the .env defaults. */
export async function signupConfig(db: Queryable, defaults: SignupDefaults) {
  const rows = (await db.query('SELECT key, value FROM app_settings')).rows;
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const allow = get('allow_signup');
  return { allowed: typeof allow === 'boolean' ? allow : defaults.allowSignup };
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

  // 2.3.0: the admin area is gated three ways.
  // 1. Not the admin: it doesn't exist (404, the same answer as any unknown address).
  // 2. The admin must have two-step sign-in on.
  // 3. Each session must be unlocked with the password + a current code; it stays open ADMIN_UNLOCK_MINUTES.
  r.use('/admin', (req, _res, next) => {
    if (!req.user || !isAdminUser(req.user)) return next(new HttpError(404, 'Not found.', 'not_found'));
    // Without ADMIN_EMAIL (self-hosted servers, older tests) being an admin is enough, as before 2.3.0.
    if (!strictAdmin()) return next();
    if (req.path === '/status') return next();
    if (!req.user.twoFactor) return next(new HttpError(403, 'Turn on two-step sign-in in Settings to use the admin area.', 'admin_2fa'));
    if (req.path === '/unlock' || req.path === '/lock') return next();
    if (!req.adminUntil || req.adminUntil.getTime() <= Date.now()) {
      return next(new HttpError(403, 'The admin area is locked. Unlock it with your password and a code.', 'admin_locked'));
    }
    next();
  });

  r.get('/admin/status', (req, res) => {
    res.json({
      // false: no unlock needed on this server (no ADMIN_EMAIL)
      gated: strictAdmin(),
      twoFactor: !!req.user!.twoFactor,
      unlockedUntil: req.adminUntil?.toISOString() ?? null,
    });
  });

  r.post(
    '/admin/unlock',
    ah(async (req, res) => {
      const b = z.object({ password: z.string().min(1).max(200), code: z.string().trim().min(6).max(20) }).parse(req.body);
      const u = req.user!;
      if (codeLocked(u.id)) throw new HttpError(429, 'Too many wrong tries. Try again in 15 minutes.', 'too_many');
      const fail = async (msg: string, code: string) => {
        codeFailed(u.id);
        await audit(db, req, 'admin_unlock_failed', u.username);
        return new HttpError(403, msg, code);
      };
      try {
        await checkPassword(db, u.id, b.password);
      } catch {
        throw await fail('Your password is not right.', 'bad_password');
      }
      const ok = await db.tx((q) => useCode(q, u.id, b.code));
      if (!ok) throw await fail('That code is not right. Try the newest code from your app.', 'bad_code');
      const until = (
        await db.query(
          `UPDATE sessions SET admin_until = now() + make_interval(mins => $2) WHERE token_hash = $1 AND user_id = $3 RETURNING admin_until`,
          [req.sessionHash, ADMIN_UNLOCK_MINUTES, u.id],
        )
      ).rows[0]?.admin_until;
      await audit(db, req, 'admin_unlocked', u.username);
      res.json({ unlockedUntil: new Date(until).toISOString() });
    }),
  );

  r.post(
    '/admin/lock',
    ah(async (req, res) => {
      await db.query('UPDATE sessions SET admin_until = NULL WHERE token_hash = $1', [req.sessionHash]);
      res.status(204).end();
    }),
  );

  // How many people use the app (counts only).
  r.get(
    '/admin/stats',
    ah(async (_req, res) => {
      res.json(await usageStats(db));
    }),
  );

  r.get(
    '/admin/users',
    ah(async (_req, res) => {
      const rows = await db.query(
        `SELECT u.id, u.username, u.email, u.created_at, u.last_active_at, (u.totp_enabled_at IS NOT NULL) AS two_factor,
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
          isAdmin: isAdminUser(x),
          twoFactor: !!x.two_factor,
        })),
      );
    }),
  );

  r.get(
    '/admin/settings',
    ah(async (_req, res) => {
      const c = await signupConfig(db, defaults);
      res.json({ allowSignup: c.allowed });
    }),
  );

  r.put(
    '/admin/settings',
    ah(async (req, res) => {
      const b = schemas.adminSettings.parse(req.body);
      await db.tx(async (q) => {
        await q.query(
          `INSERT INTO app_settings(key, value, updated_at) VALUES ('allow_signup', $1, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [JSON.stringify(b.allowSignup)],
        );
        await audit(q, req, 'signup_settings_changed', null, { allowSignup: b.allowSignup });
      });
      res.json({ allowSignup: b.allowSignup });
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
        const u = (await q.query('SELECT id, username, email FROM users WHERE id = $1', [userId])).rows[0];
        if (!u) throw new HttpError(404, 'User not found.');
        if (u.id === req.user!.id) throw new HttpError(400, 'Change your own password in Settings instead.');
        if (u.username === OWNER) throw new HttpError(400, 'The owner password is set with APP_PASSWORD on the server.');
        protectAdmins(req, u);
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

  // Lost phone and backup codes: an admin turns two-step sign-in off (their password; not for other admins unless owner).
  r.post(
    '/admin/users/:id/disable-2fa',
    ah(async (req, res) => {
      const userId = pid(req.params.id);
      const b = schemas.adminResetCode.parse(req.body);
      await checkPassword(db, req.user!.id, b.password);
      await db.tx(async (q) => {
        const u = (await q.query('SELECT id, username, email FROM users WHERE id = $1', [userId])).rows[0];
        if (!u) throw new HttpError(404, 'User not found.');
        if (u.id === req.user!.id) throw new HttpError(400, 'Turn it off in your own Settings instead.');
        protectAdmins(req, u);
        await turnOff(q, u.id);
        await q.query('DELETE FROM sessions WHERE user_id = $1', [u.id]);
        await audit(q, req, 'two_factor_reset', u.username);
      });
      res.status(204).end();
    }),
  );
  r.post(
    '/admin/users/:id/delete',
    ah(async (req, res) => {
      const userId = pid(req.params.id);
      const b = schemas.adminDeleteUser.parse(req.body);
      await checkPassword(db, req.user!.id, b.password); // strong confirmation: your own password…
      await db.tx(async (q) => {
        const u = (await q.query('SELECT id, username, email FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
        if (!u) throw new HttpError(404, 'User not found.');
        if (u.id === req.user!.id) throw new HttpError(400, 'Use "Delete my account" in Settings to delete your own account.');
        if (u.username === OWNER) throw new HttpError(400, 'The built-in owner account cannot be removed here.');
        protectAdmins(req, u);
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
    // The person may type their username or their email.
    const by = b.username.includes('@') ? 'lower(email)' : 'username';
    const found = (await db.query(`SELECT id FROM users WHERE ${by} = $1`, [b.username])).rows[0];
    if (!found) throw wrong();
    // 2.3.0 (security audit): every try is counted and saved BEFORE the code is checked, so requests sent
    // at once can't all slip under the limit; after MAX_CODE_TRIES the current code stops working.
    await db.query('UPDATE password_resets SET attempts = attempts + 1 WHERE user_id = $1 AND used_at IS NULL', [found.id]);
    await db.tx(async (q) => {
      const u = (await q.query('SELECT id, username FROM users WHERE id = $1', [found.id])).rows[0];
      if (!u) throw wrong();
      const used = await q.query(
        `UPDATE password_resets SET used_at = now()
         WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL AND expires_at > now() AND attempts <= $3 RETURNING id`,
        [u.id, sha256(normalizeCode(b.code)), MAX_CODE_TRIES],
      );
      if (!used.rows.length) throw wrong();
      checkNewPassword(b.password, u.username);
      await q.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(b.password), u.id]);
      await q.query('DELETE FROM sessions WHERE user_id = $1', [u.id]); // signed out everywhere
      await q.query('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [u.id]);
      req.user = { id: u.id, username: u.username, currency: '', monthStartDay: 1 };
      await audit(q, req, 'password_reset', u.username);
    });
    res.json({ ok: true });
  });
}

/** Wrong codes allowed before the current code is void. */
const MAX_CODE_TRIES = 5;
/** Emailed codes are valid this long. */
export const EMAIL_CODE_MINUTES = 30;

/**
 * "Forgot password?" by email: always answers the same way, whether or not the address belongs
 * to an account (so nobody can find out who has one); the email is sent in the background.
 */
export function forgotPasswordHandler(db: Db, mailer: Mailer) {
  return ah(async (req, res) => {
    if (!mailer.enabled) {
      throw new HttpError(503, 'Email is not set up on this server. Ask the person who runs the app for a reset code.', 'no_email');
    }
    // Username or email; the code always goes to the email registered on that account. The answer is the
    // same whether or not the account exists (or has an email), so this can't be used to find accounts.
    const { login } = schemas.forgotPassword.parse(req.body);
    const u = (
      await db.query('SELECT id, username, email FROM users WHERE lower(email) = $1 OR lower(username) = $1 LIMIT 1', [login])
    ).rows[0];
    if (u?.email) {
      const code = newResetCode();
      await db.tx(async (q) => {
        await q.query('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [u.id]); // only the newest code works
        await q.query(
          `INSERT INTO password_resets(user_id, code_hash, created_by, expires_at, via)
           VALUES ($1, $2, NULL, now() + make_interval(mins => $3), 'email')`,
          [u.id, sha256(normalizeCode(code)), EMAIL_CODE_MINUTES],
        );
        req.user = { id: u.id, username: u.username, currency: '', monthStartDay: 1 };
        await audit(q, req, 'reset_code_emailed', u.username);
        req.user = undefined;
      });
      sendInBackground(mailer, resetCodeMail(u.email, u.username, code, EMAIL_CODE_MINUTES));
    }
    res.json({ ok: true });
  });
}
