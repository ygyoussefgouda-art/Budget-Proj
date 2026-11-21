import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { ensureOwner } from './auth.js';
import { createPgDb, createPgliteDb, type Db } from './db.js';
import { migrate } from './migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..'); // server/ (dev) or /app (Docker)

async function main() {
  // Optional: APP_PASSWORD keeps a built-in "owner" account (sign in with username "owner").
  const password = process.env.APP_PASSWORD ?? '';
  if (password && password.length < 8) {
    console.error('APP_PASSWORD must be at least 8 characters long (or leave it empty).');
    process.exit(1);
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

  const app = createApp(db, {
    publicDir: process.env.PUBLIC_DIR ?? path.join(root, 'public'),
    trustProxy: process.env.TRUST_PROXY,
    allowSignup,
  });
  const port = Number(process.env.PORT ?? 3000);
  const server = app.listen(port, () => console.log(`[app] Budget me listening on :${port}`));

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
