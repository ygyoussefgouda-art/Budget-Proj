import pg from 'pg';

export type Row = Record<string, any>;
export interface QueryResult { rows: Row[]; rowCount: number }

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
  /** Runs a script that may contain several statements (no parameters). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** Runs fn inside BEGIN/COMMIT; any thrown error rolls everything back. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// Postgres type OIDs we parse ourselves.
const DATE = 1082; // keep 'YYYY-MM-DD' strings (no timezone shifts)
const INT8 = 20; // BIGINT money values -> number (safe below 2^53)
const NUMERIC = 1700; // SUM() results and uni_days/weeks -> number

/** Production driver: a pg connection pool configured from PG* env vars. */
export function createPgDb(): Db {
  pg.types.setTypeParser(DATE, (v) => v);
  pg.types.setTypeParser(INT8, (v) => Number(v));
  pg.types.setTypeParser(NUMERIC, (v) => Number(v));
  const pool = new pg.Pool({ max: Number(process.env.PG_POOL_MAX ?? 10) });
  pool.on('error', (e) => console.error('[db] idle client error', e));

  type PgLike = { query: (text: string, params?: unknown[]) => Promise<pg.QueryResult> };
  const wrap = (c: PgLike): Queryable => ({
    async query(text, params) {
      const r = await c.query(text, params as unknown[] | undefined);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    async exec(sql) {
      await c.query(sql); // simple protocol allows several statements
    },
  });

  return {
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/**
 * Embedded Postgres (WASM) for tests and local development without Docker.
 * Only loaded when asked for; it is a dev dependency and not in the image.
 */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const mod = await import('@electric-sql/pglite');
  const { PGlite, types } = mod;
  // Single options object: with `new PGlite(undefined, opts)` the opts would be ignored.
  const db = new PGlite({
    dataDir,
    parsers: {
      [types.DATE]: (v: string) => v,
      [types.INT8]: (v: string) => Number(v),
      [types.NUMERIC]: (v: string) => Number(v),
    },
  });
  const wrap = (c: { query: (t: string, p?: any[]) => Promise<any>; exec: (s: string) => Promise<any> }): Queryable => ({
    async query(text, params) {
      const r = await c.query(text, params as any[] | undefined);
      return { rows: r.rows as Row[], rowCount: r.affectedRows ?? r.rows.length };
    },
    async exec(sql) {
      await c.exec(sql);
    },
  });
  return {
    ...wrap(db),
    tx: <T,>(fn: (q: Queryable) => Promise<T>) => db.transaction((t) => fn(wrap(t))) as Promise<T>,
    close: () => db.close(),
  };
}
