import type { Queryable } from './db.js';
import { HttpError } from './http.js';

/** Generous per-account caps so one account cannot grow the database without bound. */
export const LIMITS = {
  categories: 200,
  goals: 200,
  expenses: 50_000,
  goal_entries: 50_000,
  loan_entries: 20_000,
  recurring_rules: 100,
  incomes: 20_000,
} as const;

export async function underLimit(q: Queryable, table: keyof typeof LIMITS, u: number) {
  const n = (await q.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE user_id = $1`, [u])).rows[0].n as number;
  if (n >= LIMITS[table]) throw new HttpError(409, 'You have reached the limit for this kind of item.', 'limit');
}
