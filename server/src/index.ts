import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { configureAuth, ensureOwner } from './auth.js';
import { createPgDb, createPgliteDb, type Db } from './db.js';
import { migrate } from './migrate.js';
import { APP_VERSION, log } from './log.js';
import { mailerFromEnv } from './mail.js';
import { housekeeping } from './undo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..'); // server/ (dev) or /app (Docker)

const positiveInt = (v: string | undefined) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** TRUST_PROXY: a hop count ("1"), "false", or a list of addresses/subnets ("loopback, 172.16.0.0/12"). */
const parseTrustProxy = (v: string | undefined): string | number | boolean | undefined => {
  if (v === undefined || v.trim() === '') return undefined;
  if (/^\d+$/.test(v.trim())) return Number(v.trim());
  if (v.trim() === 'false') return false;
  if (v.trim() === 'true') {
    log.warn('TRUST_PROXY=true trusts any X-Forwarded-For value; rate limits could be bypassed. Use 1 instead.');
    return true;
  }
  return v;
};

async function main() {
  const production = process.env.NODE_ENV === 'production';
  const fail = (msg: string) => {
    log.fatal(msg);
    process.exit(1);
  };

  // Optional: APP_PASSWORD keeps a built-in "owner" account (sign in with username "owner").
  const password = process.env.APP_PASSWORD ?? '';
  if (password && password.length < 10) fail('APP_PASSWORD must be at least 10 characters long (or leave it empty).');
  if (production && /change-me/i.test(`${password} ${process.env.PGPASSWORD ?? ''}`)) {
    fail('A password in .env is still the example value ("change-me..."). Set real passwords before starting.');
  }
  if (production && process.env.DB_DRIVER !== 'pglite' && (process.env.PGPASSWORD ?? '').length < 16) {
    fail('POSTGRES_PASSWORD must be at least 16 characters in production.');
  }
  configureAuth({ cookieSecure: process.env.COOKIE_SECURE });
  if (production && process.env.COOKIE_SECURE === 'false') {
    log.warn('COOKIE_SECURE=false: sign-in cookies can travel over plain HTTP. Use only for testing.');
  }
  // Anyone who can open the app may create an account, unless ALLOW_SIGNUP=false.
  const allowSignup = process.env.ALLOW_SIGNUP !== 'false';
  if (!allowSignup && !password) {
    log.warn('ALLOW_SIGNUP=false and no APP_PASSWORD: only existing accounts can sign in.');
  }

  // DB_DRIVER=pglite runs an embedded Postgres for local development without Docker.
  const db: Db =
    process.env.DB_DRIVER === 'pglite' ? await createPgliteDb(process.env.PGLITE_DIR || undefined) : createPgDb();

  const migrationsDir = process.env.MIGRATIONS_DIR ?? path.join(root, 'migrations');
  const applied = await migrate(db, migrationsDir);
  if (applied.length) log.info({ migrations: applied }, 'applied migrations');
  // New accounts start empty. SEED_EXAMPLE_DATA=true fills a brand-new owner account with example data.
  if (password) await ensureOwner(db, password, process.env.SEED_EXAMPLE_DATA === 'true');

  // ADMIN_USERNAMES=alice,bob: these accounts (and "owner") can open the admin page.
  // A listed name that doesn't exist yet is blocked from sign-up, so nobody else can grab it.
  const adminUsernames = (process.env.ADMIN_USERNAMES ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const name of adminUsernames) {
    const found = await db.query('SELECT 1 FROM users WHERE username = $1', [name]);
    if (!found.rows.length) log.warn(`ADMIN_USERNAMES: "${name}" has no account yet (sign-up with that name is blocked).`);
  }

  // 2.3.0: ADMIN_EMAIL=you@example.com makes the ONE account with that email the only admin ("owner" and
  // ADMIN_USERNAMES then give no admin rights). Nobody else can sign up with it or switch to it.
  const adminEmail = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase() || undefined;
  if (adminEmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) fail('ADMIN_EMAIL is not a valid email address.');
    const found = await db.query('SELECT (totp_enabled_at IS NOT NULL) AS tfa FROM users WHERE lower(email) = $1', [adminEmail]);
    if (!found.rows.length) log.warn('ADMIN_EMAIL: no account has this email yet, so nobody can open the admin area.');
    else if (!found.rows[0].tfa) log.warn('ADMIN_EMAIL: the admin account has no two-step sign-in; the admin area stays closed until it is on.');
    if (adminUsernames.length) log.warn('ADMIN_EMAIL is set, so ADMIN_USERNAMES is ignored.');
  }

  // Email for "Forgot password?" codes (any SMTP server; free options in DEPLOY.md).
  const mailer = mailerFromEnv();
  if (!mailer.enabled) log.warn('No SMTP_HOST: "Forgot password?" emails are off; admins can still make reset codes.');
  if (production && process.env.MAIL_OUTBOX_DIR) fail('MAIL_OUTBOX_DIR is for development only: in production emails would never be sent.');

  const app = createApp(db, {
    publicDir: process.env.PUBLIC_DIR ?? path.join(root, 'public'),
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    allowSignup,
    hsts: process.env.HSTS === 'true',
    adminUsernames,
    adminEmail,
    loginLimit: positiveInt(process.env.LOGIN_RATE_LIMIT),
    signupLimit: positiveInt(process.env.SIGNUP_RATE_LIMIT),
    minNativeVersionCode: positiveInt(process.env.MIN_NATIVE_VERSION_CODE),
    mailer,
    contactEmail: process.env.CONTACT_EMAIL || undefined,
    downloadsDir: process.env.DOWNLOADS_DIR || path.join(root, 'downloads'),
    appOnly: process.env.APP_ONLY === 'true',
    starterCategories: process.env.STARTER_CATEGORIES !== 'false',
  });
  if (process.env.APP_ONLY === 'true') log.info('APP_ONLY: only the Android app can use Masrofy; browsers see the "Get the app" page.');
  const port = Number(process.env.PORT ?? 3000);
  const server = app.listen(port, () => log.info({ port, version: APP_VERSION }, 'Masrofy listening'));
  // Deleted items are kept briefly for "Undo"; expired items, sessions and codes are cleared every few minutes.
  const auditKeepDays = positiveInt(process.env.AUDIT_KEEP_DAYS) ?? 365;
  setInterval(() => housekeeping(db, auditKeepDays).catch((err) => log.error({ err }, 'housekeeping failed')), 5 * 60_000).unref();

  const stop = (sig: string) => {
    log.info({ signal: sig }, 'shutting down');
    server.close(() => {
      db.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main().catch((e) => {
  log.fatal({ err: e }, 'failed to start');
  process.exit(1);
});
