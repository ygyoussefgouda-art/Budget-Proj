import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from './db.js';

const LOCK_ID = 774_211; // advisory lock so several app replicas never migrate at once

/** Applies every *.sql file in `dir` that has not run yet, in name order. */
export async function migrate(db: Db, dir: string): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  return db.tx(async (q) => {
    await q.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID]);
    await q.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Set((await q.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string));
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir, f), 'utf8');
      await q.exec(sql);
      await q.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      applied.push(f);
    }
    return applied;
  });
}
