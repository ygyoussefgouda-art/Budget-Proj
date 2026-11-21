import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { configureAuth, ensureOwner } from './auth.js';
import { createPgDb, createPgliteDb, type Db } from './db.js';
import { migrate } from './migrate.js';
import { purgeTrash } from './undo.js';

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
    console.warn('[app] TRUST_PROXY=true trusts any X-Forwarded-For value; rate limits could be bypassed. Use 1 instead.');
    return true;
  }
  return v;
};

async function main() {
  const production = process.env.NODE_ENV === 'production';
  const fail = (msg: string) => {
    console.error(`[app] ${msg}`);
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
    console.warn('[app] COOKIE_SECURE=false: sign-in cookies can travel over plain HTTP. Use only for testing.');
  }
  // Anyone who can open the app may create an account, unless ALLOW_SIGNUP=false.
  const allowSignup = process.env.ALLOW_SIGNUP !== 'false';
  if (!allowSignup && !password) {
    console.warn('[app] ALLOW_SIGNUP=false and no APP_PASSWORD: only existing accounts can sign in.');
  }

  // DB_DRIVER=pglite runs an embedded Postgres for local development without Docker.
  const db: Db =
    process.env.DB_DRIVER === 'pglite' ? await createPgliteDb(process.env.PGLITE_DIR || undefined) : createPgDb();

  const migrationsDir = process.env.MIGRATIONS_DIR ?? path.join(root, 'migrations');
  const applied = await migrate(db, migrationsDir);
  if (applied.length) console.log(`[db] applied migrations: ${applied.join(', ')}`);
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
    if (!found.rows.length) console.warn(`[app] ADMIN_USERNAMES: "${name}" has no account yet (sign-up with that name is blocked).`);
  }

  const app = createApp(db, {
    publicDir: process.env.PUBLIC_DIR ?? path.join(root, 'public'),
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    allowSignup,
    inviteCode: process.env.SIGNUP_INVITE_CODE ?? '',
    hsts: process.env.HSTS === 'true',
    adminUsernames,
    loginLimit: positiveInt(process.env.LOGIN_RATE_LIMIT),
    signupLimit: positiveInt(process.env.SIGNUP_RATE_LIMIT),
  });
  const port = Number(process.env.PORT ?? 3000);
  const server = app.listen(port, () => console.log(`[app] Budget me listening on :${port}`));
  // Deleted items are kept briefly for "Undo"; clear the expired ones every few minutes.
  setInterval(() => purgeTrash(db).catch((e) => console.error('[db] trash purge failed', e)), 5 * 60_000).unref();

  const stop = (sig: string) => {
    console.log(`[app] ${sig} received, shutting down`);
    server.close(() => {
      db.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main().catch((e) => {
  console.error('[app] failed to start', e);
  process.exit(1);
});
