/**
 * Budget rollover (Settings → "Carry over unspent budget", off by default).
 * A category's budget for a month = its own plan + what carried in from the month before.
 * Whatever of that is left unspent at the end of the month carries on into the next one;
 * overspending does not cut next month's budget (it never carries a negative amount).
 * The chain looks back at most LOOKBACK months.
 */
import type { Queryable } from './db.js';

export const LOOKBACK = 12;

/** 'YYYY-MM' shifted by `n` months. */
export function addMonths(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface MonthInput {
  /** Budget per category for that month (already including the per-day formula). */
  planned: Record<string, number>;
  /** Spent per category in that month. */
  spent: Record<string, number>;
}

/** Pure part (unit-tested): carry into the month after the last of `months` (oldest first). */
export function carryChain(months: MonthInput[], categoryIds: number[]): Record<string, number> {
  const carry: Record<string, number> = {};
  for (const m of months) {
    for (const id of categoryIds) {
      const k = String(id);
      const left = (m.planned[k] ?? 0) + (carry[k] ?? 0) - (m.spent[k] ?? 0);
      carry[k] = Math.max(0, left);
    }
  }
  return Object.fromEntries(Object.entries(carry).filter(([, v]) => v > 0));
}

/** What each category carries into `month` (only categories with something to carry). */
export async function carryover(q: Queryable, userId: number, month: string, startDay: number): Promise<Record<string, number>> {
  const first = addMonths(month, -LOOKBACK);
  const pad = String(startDay).padStart(2, '0');
  const [cats, budgets, plans, spent] = await Promise.all([
    q.query('SELECT id, is_uni FROM categories WHERE user_id = $1', [userId]),
    q.query('SELECT month, uni_days, uni_weeks, uni_cost FROM month_budgets WHERE user_id = $1 AND month >= $2 AND month < $3', [userId, first, month]),
    q.query('SELECT month, category_id, planned FROM category_plans WHERE user_id = $1 AND month >= $2 AND month < $3', [userId, first, month]),
    // Spending per category and budget month (a budget month starts on `startDay`).
    q.query(
      `SELECT category_id, to_char(date - ($4::int - 1), 'YYYY-MM') AS month, SUM(amount)::bigint AS spent
       FROM expenses WHERE user_id = $1 AND date >= $2::date AND date < $3::date
       GROUP BY 1, 2`,
      [userId, `${first}-${pad}`, `${month}-${pad}`, startDay],
    ),
  ]);
  const uniCat = cats.rows.find((c) => c.is_uni)?.id as number | undefined;
  const months: MonthInput[] = [];
  for (let i = LOOKBACK; i >= 1; i--) {
    const m = addMonths(month, -i);
    const planned: Record<string, number> = {};
    for (const p of plans.rows) if (p.month === m) planned[String(p.category_id)] = Number(p.planned);
    const b = budgets.rows.find((x) => x.month === m);
    if (uniCat !== undefined && b) planned[String(uniCat)] = Math.round(Number(b.uni_days) * Number(b.uni_weeks) * Number(b.uni_cost));
    const s: Record<string, number> = {};
    for (const x of spent.rows) if (x.month === m) s[String(x.category_id)] = Number(x.spent);
    months.push({ planned, spent: s });
  }
  return carryChain(
    months,
    cats.rows.map((c) => c.id as number),
  );
}
