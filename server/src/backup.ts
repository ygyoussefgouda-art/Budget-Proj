import { z } from 'zod';
import type { Db } from './db.js';
import { HttpError } from './http.js';
import { isoDate, monthStr } from './validation.js';

/**
 * Backup format (version 2). Same table/column names as the original phone
 * app's export (version 1), so old phone backups can be restored here too.
 * Ids are only used to link rows inside the file; they are remapped on restore.
 */
export async function exportBackup(db: Db, userId: number) {
  const q = (sql: string) => db.query(sql, [userId]).then((r) => r.rows);
  return {
    app: 'student_budget',
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: (
      await db.query('SELECT currency, month_start_day AS "monthStartDay" FROM users WHERE id = $1', [userId])
    ).rows[0],
    tables: {
      categories: await q('SELECT id, name, is_uni, sort FROM categories WHERE user_id = $1 ORDER BY sort, id'),
      month_budgets: await q(
        `SELECT month, income, uni_days, uni_weeks, uni_cost, save_plan, loan_plan
         FROM month_budgets WHERE user_id = $1 ORDER BY month`,
      ),
      category_plans: await q('SELECT month, category_id, planned FROM category_plans WHERE user_id = $1 ORDER BY month'),
      goals: await q('SELECT id, name, target, start_balance, monthly, sort FROM goals WHERE user_id = $1 ORDER BY sort, id'),
      goal_entries: await q(
        'SELECT id, goal_id, date, type, amount, note FROM goal_entries WHERE user_id = $1 ORDER BY date, id',
      ),
      expenses: await q(
        'SELECT id, date, category_id, description, amount FROM expenses WHERE user_id = $1 ORDER BY date, id',
      ),
      loan_entries: await q(
        'SELECT id, date, person, direction, kind, amount, note FROM loan_entries WHERE user_id = $1 ORDER BY date, id',
      ),
    },
  };
}

const int = z.coerce.number().int();
const amount = z.coerce.number().int().min(0);
const bool = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => v === true || v === 1);
const str = z.string().nullish().transform((v) => v ?? '');

const backupSchema = z.object({
  app: z.literal('student_budget', { errorMap: () => ({ message: 'This is not a Budget me backup.' }) }),
  version: z.number().int().min(1).max(2).optional(),
  settings: z
    .object({ currency: z.string().max(10).optional(), monthStartDay: z.number().int().min(1).max(28).optional() })
    .optional(),
  tables: z.object({
    categories: z.array(z.object({ id: int, name: z.string().trim().min(1), is_uni: bool, sort: int.default(0) })),
    month_budgets: z.array(
      z.object({
        month: monthStr,
        income: amount,
        uni_days: z.coerce.number().min(0),
        uni_weeks: z.coerce.number().min(0),
        uni_cost: amount,
        save_plan: amount,
        loan_plan: amount,
      }),
    ),
    category_plans: z.array(z.object({ month: monthStr, category_id: int, planned: amount })),
    goals: z.array(
      z.object({ id: int, name: z.string().trim().min(1), target: amount, start_balance: amount, monthly: amount, sort: int.default(0) }),
    ),
    goal_entries: z.array(
      z.object({ id: int.optional(), goal_id: int, date: isoDate, type: z.enum(['deposit', 'withdrawal']), amount, note: str }),
    ),
    expenses: z.array(z.object({ id: int.optional(), date: isoDate, category_id: int, description: str, amount })),
    loan_entries: z.array(
      z.object({
        id: int.optional(),
        date: isoDate,
        person: z.string().trim().min(1),
        direction: z.enum(['borrowed', 'lent']),
        kind: z.enum(['principal', 'repayment']),
        amount,
        note: str,
      }),
    ),
  }),
});

/** Replaces ALL of the user's data with the backup, atomically. */
export async function restoreBackup(db: Db, userId: number, body: unknown) {
  const parsed = backupSchema.safeParse(body);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    const where = i.path.length ? ` (${i.path.join('.')})` : '';
    throw new HttpError(400, `Restore failed, nothing was changed: ${i.message}${where}`);
  }
  const t = parsed.data.tables;
  const settings = parsed.data.settings;
  await db.tx(async (q) => {
    if (settings?.currency) await q.query('UPDATE users SET currency = $1 WHERE id = $2', [settings.currency, userId]);
    if (settings?.monthStartDay) {
      await q.query('UPDATE users SET month_start_day = $1 WHERE id = $2', [settings.monthStartDay, userId]);
    }
    for (const table of ['expenses', 'goal_entries', 'goals', 'loan_entries', 'category_plans', 'month_budgets', 'categories']) {
      await q.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
    }
    const catMap = new Map<number, number>();
    for (const c of t.categories) {
      const r = await q.query('INSERT INTO categories(user_id, name, is_uni, sort) VALUES ($1, $2, $3, $4) RETURNING id', [
        userId,
        c.name,
        c.is_uni,
        c.sort,
      ]);
      catMap.set(c.id, r.rows[0].id);
    }
    const cat = (old: number) => {
      const n = catMap.get(old);
      if (n === undefined) throw new HttpError(400, `Restore failed, nothing was changed: unknown category ${old}.`);
      return n;
    };
    for (const b of t.month_budgets) {
      await q.query(
        `INSERT INTO month_budgets(user_id, month, income, uni_days, uni_weeks, uni_cost, save_plan, loan_plan)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, b.month, b.income, b.uni_days, b.uni_weeks, b.uni_cost, b.save_plan, b.loan_plan],
      );
    }
    for (const p of t.category_plans) {
      await q.query('INSERT INTO category_plans(user_id, month, category_id, planned) VALUES ($1, $2, $3, $4)', [
        userId,
        p.month,
        cat(p.category_id),
        p.planned,
      ]);
    }
    const goalMap = new Map<number, number>();
    for (const g of t.goals) {
      const r = await q.query(
        'INSERT INTO goals(user_id, name, target, start_balance, monthly, sort) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [userId, g.name, g.target, g.start_balance, g.monthly, g.sort],
      );
      goalMap.set(g.id, r.rows[0].id);
    }
    for (const e of t.goal_entries) {
      const gid = goalMap.get(e.goal_id);
      if (gid === undefined) throw new HttpError(400, `Restore failed, nothing was changed: unknown goal ${e.goal_id}.`);
      await q.query('INSERT INTO goal_entries(user_id, goal_id, date, type, amount, note) VALUES ($1, $2, $3, $4, $5, $6)', [
        userId,
        gid,
        e.date,
        e.type,
        e.amount,
        e.note,
      ]);
    }
    for (const e of t.expenses) {
      await q.query('INSERT INTO expenses(user_id, date, category_id, description, amount) VALUES ($1, $2, $3, $4, $5)', [
        userId,
        e.date,
        cat(e.category_id),
        e.description,
        e.amount,
      ]);
    }
    for (const l of t.loan_entries) {
      await q.query(
        'INSERT INTO loan_entries(user_id, date, person, direction, kind, amount, note) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [userId, l.date, l.person, l.direction, l.kind, l.amount, l.note],
      );
    }
  });
}
