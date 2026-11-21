import type { Queryable, Row } from './db.js';

// Row -> API shape mappers (camelCase, booleans).
export const mapCategory = (r: Row) => ({ id: r.id, name: r.name, isUni: r.is_uni, sort: r.sort });
export const mapExpense = (r: Row) => ({
  id: r.id,
  date: r.date,
  categoryId: r.category_id,
  description: r.description,
  amount: r.amount,
  ...(r.category_name !== undefined ? { categoryName: r.category_name } : {}),
  ...(r.has_receipt !== undefined ? { hasReceipt: r.has_receipt } : {}),
  tags: (r.tags as string[] | undefined) ?? [],
  // Split with someone: the linked "Owed to me" loan entry holds their share.
  split: r.split_loan_id ? { loanId: r.split_loan_id, person: r.split_person, share: r.split_share } : null,
  foreign: r.orig_amount ? { amount: r.orig_amount, currency: r.orig_currency, rate: Number(r.fx_rate) } : null,
});

/** SQL column: whether expense alias `e` has a receipt attached. */
export const HAS_RECEIPT = 'EXISTS (SELECT 1 FROM receipts rc WHERE rc.expense_id = e.id) AS has_receipt';
/** SQL: extra expense columns (receipt flag + split), used with SPLIT_JOIN. */
export const EXPENSE_EXTRAS = `${HAS_RECEIPT}, sl.id AS split_loan_id, sl.person AS split_person, sl.amount AS split_share`;
export const SPLIT_JOIN = 'LEFT JOIN loan_entries sl ON sl.expense_id = e.id';
export const mapGoal = (r: Row) => ({
  id: r.id,
  name: r.name,
  target: r.target,
  start: r.start_balance,
  monthly: r.monthly,
  sort: r.sort,
  ...(r.balance !== undefined ? { balance: r.balance } : {}),
});
export const mapGoalEntry = (r: Row) => ({
  id: r.id,
  goalId: r.goal_id,
  date: r.date,
  deposit: r.type === 'deposit',
  amount: r.amount,
  note: r.note,
});
export const mapLoan = (r: Row) => ({
  id: r.id,
  date: r.date,
  person: r.person,
  borrowed: r.direction === 'borrowed',
  repayment: r.kind === 'repayment',
  amount: r.amount,
  note: r.note,
  /** Created by splitting this expense (edit the expense to change it). */
  expenseId: r.expense_id ?? null,
});

/** Expense list filters (also used by the export). Needs `expenses e JOIN categories c`. */
export function expenseWhere(u: number, f: { from?: string; to?: string; categoryId?: number; q?: string; tag?: string }) {
  const where = ['e.user_id = $1'];
  const params: unknown[] = [u];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replaceAll('?', `$${params.length}`));
  };
  if (f.from) add('e.date >= ?::date', f.from);
  if (f.to) add('e.date <= ?::date', f.to);
  if (f.categoryId) add('e.category_id = ?', f.categoryId);
  if (f.tag) add('? = ANY(e.tags)', f.tag);
  // Search matches the description, the category name and the tags.
  if (f.q) add(`(e.description ILIKE ? OR c.name ILIKE ? OR array_to_string(e.tags, ' ') ILIKE ?)`, `%${f.q.replace(/[\\%_]/g, '\\$&')}%`);
  return { where: where.join(' AND '), params };
}

/**
 * SQL fragment: `col` falls inside budget month `p` ('YYYY-MM'), which starts on
 * day `d` (1..28) of that month and ends the day before day `d` of the next. Index friendly.
 */
export const inMonth = (col: string, p: string, d: string) =>
  `${col} >= ((${p} || '-01')::date + (${d}::int - 1)) AND ` +
  `${col} < (((${p} || '-01')::date + interval '1 month')::date + (${d}::int - 1))`;

/**
 * Creates the budget for `month` if missing by copying the nearest earlier
 * month (or the nearest later one, or blank defaults), like the original app.
 */
export async function ensureMonth(q: Queryable, userId: number, month: string) {
  const ex = await q.query('SELECT 1 FROM month_budgets WHERE user_id = $1 AND month = $2', [userId, month]);
  if (ex.rows.length) return;
  let src = await q.query(
    'SELECT * FROM month_budgets WHERE user_id = $1 AND month < $2 ORDER BY month DESC LIMIT 1',
    [userId, month],
  );
  if (!src.rows.length) {
    src = await q.query('SELECT * FROM month_budgets WHERE user_id = $1 AND month > $2 ORDER BY month ASC LIMIT 1', [
      userId,
      month,
    ]);
  }
  const s = src.rows[0];
  const ins = await q.query(
    `INSERT INTO month_budgets(user_id, month, income, uni_days, uni_weeks, uni_cost, save_plan, loan_plan)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING RETURNING month`,
    [userId, month, s?.income ?? 0, s?.uni_days ?? 0, s?.uni_weeks ?? 4, s?.uni_cost ?? 0, s?.save_plan ?? 0, s?.loan_plan ?? 0],
  );
  if (s && ins.rows.length) {
    await q.query(
      `INSERT INTO category_plans(user_id, month, category_id, planned)
       SELECT user_id, $2, category_id, planned FROM category_plans WHERE user_id = $1 AND month = $3`,
      [userId, month, s.month],
    );
  }
}

export async function loadBudget(q: Queryable, userId: number, month: string) {
  const r = (await q.query('SELECT * FROM month_budgets WHERE user_id = $1 AND month = $2', [userId, month])).rows[0];
  const plans = await q.query('SELECT category_id, planned FROM category_plans WHERE user_id = $1 AND month = $2', [
    userId,
    month,
  ]);
  return {
    month,
    income: r.income,
    uniDays: r.uni_days,
    uniWeeks: r.uni_weeks,
    uniCost: r.uni_cost,
    savePlan: r.save_plan,
    loanPlan: r.loan_plan,
    plans: Object.fromEntries(plans.rows.map((p) => [p.category_id, p.planned])) as Record<string, number>,
  };
}

export async function goalsWithBalance(q: Queryable, userId: number) {
  const r = await q.query(
    `SELECT g.*, g.start_balance + COALESCE(SUM(CASE WHEN e.type = 'deposit' THEN e.amount ELSE -e.amount END), 0) AS balance
     FROM goals g LEFT JOIN goal_entries e ON e.goal_id = g.id
     WHERE g.user_id = $1 GROUP BY g.id ORDER BY g.sort, g.id`,
    [userId],
  );
  return r.rows.map(mapGoal);
}

/** Latest activity across expenses, savings and loans (signed cash flow). */
export async function recentActivity(q: Queryable, userId: number, limit: number) {
  const r = await q.query(
    `SELECT * FROM (
       SELECT e.date, e.id, 'expense' AS kind, COALESCE(NULLIF(e.description, ''), c.name) AS title,
              c.name AS sub, -e.amount AS amount
       FROM expenses e JOIN categories c ON c.id = e.category_id WHERE e.user_id = $1
       UNION ALL
       SELECT ge.date, ge.id,
              CASE WHEN ge.type = 'deposit' THEN 'deposit' ELSE 'withdrawal' END,
              CASE WHEN ge.type = 'deposit' THEN 'Saved' ELSE 'Withdrawn' END,
              g.name,
              CASE WHEN ge.type = 'deposit' THEN ge.amount ELSE -ge.amount END
       FROM goal_entries ge JOIN goals g ON g.id = ge.goal_id WHERE ge.user_id = $1
       UNION ALL
       SELECT l.date, l.id,
              CASE WHEN l.direction = 'borrowed' AND l.kind = 'principal' THEN 'borrow'
                   WHEN l.direction = 'borrowed' THEN 'repay'
                   WHEN l.kind = 'principal' THEN 'lend' ELSE 'received' END,
              CASE WHEN l.direction = 'borrowed' AND l.kind = 'principal' THEN 'Borrowed from ' || l.person
                   WHEN l.direction = 'borrowed' THEN 'Paid back ' || l.person
                   WHEN l.kind = 'principal' THEN 'Lent to ' || l.person
                   ELSE l.person || ' paid me back' END,
              'Loans',
              CASE WHEN (l.direction = 'borrowed') = (l.kind = 'principal') THEN l.amount ELSE -l.amount END
       FROM loan_entries l WHERE l.user_id = $1
     ) t ORDER BY date DESC, id DESC LIMIT $2`,
    [userId, limit],
  );
  return r.rows.map((x) => ({ date: x.date, id: x.id, kind: x.kind, title: x.title, sub: x.sub, amount: x.amount }));
}
