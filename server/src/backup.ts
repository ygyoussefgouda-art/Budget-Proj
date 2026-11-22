import { z } from 'zod';
import type { Db } from './db.js';
import { HttpError } from './http.js';
import { CATEGORY_COLORS, CATEGORY_ICONS, CURRENCIES, isoDate, monthStr, tag } from './validation.js';

/**
 * Backup format (version 2). Same table/column names as the original phone
 * app's export (version 1), so old phone backups can be restored here too.
 * Ids are only used to link rows inside the file; they are remapped on restore.
 */
export async function exportBackup(db: Db, userId: number) {
  // One snapshot: an edit made while the file is written can't leave an entry without its goal.
  return db.tx(async (t) => {
  await t.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const q = (sql: string) => t.query(sql, [userId]).then((r) => r.rows);
  return {
    app: 'student_budget',
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: (
      await t.query('SELECT currency, month_start_day AS "monthStartDay", rollover, merge_repeats AS "mergeRepeats" FROM users WHERE id = $1', [userId])
    ).rows[0],
    tables: {
      categories: await q('SELECT id, name, is_uni, sort, icon, color FROM categories WHERE user_id = $1 ORDER BY sort, id'),
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
        `SELECT id, date, category_id, description, amount, tags, orig_amount, orig_currency, fx_rate
         FROM expenses WHERE user_id = $1 ORDER BY date, id`,
      ),
      loan_entries: await q(
        'SELECT id, date, person, direction, kind, amount, note, expense_id FROM loan_entries WHERE user_id = $1 ORDER BY date, id',
      ),
      recurring_rules: await q(
        `SELECT id, category_id, amount, description, day_of_month, start_date, end_date, auto_add, paused
         FROM recurring_rules WHERE user_id = $1 ORDER BY id`,
      ),
      // Which occurrences were already added or skipped, so a restore doesn't make them due again.
      recurring_done: await q('SELECT rule_id, due_date, status FROM recurring_occurrences WHERE user_id = $1 ORDER BY rule_id, due_date'),
    },
  };
  });
}

// Same limits as the normal API, so a backup can never hold values the app itself would refuse.
const int = z.coerce.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const amount = z.coerce.number().int().min(0).max(1e13);
const bool = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => v === true || v === 1);
const str = (max: number) => z.string().max(max).nullish().transform((v) => (v ?? '').trim());
const name = (max: number) => z.string().trim().min(1).max(max);

const backupSchema = z.object({
  app: z.literal('student_budget', { error: 'This is not a Budget me backup.' }),
  version: z.number().int().min(1).max(2).optional(),
  settings: z
    .object({ currency: z.enum(CURRENCIES).optional(), monthStartDay: z.number().int().min(1).max(28).optional(), rollover: z.boolean().optional(), mergeRepeats: z.boolean().optional() })
    .optional(),
  tables: z.object({
    categories: z
      .array(
        z.object({
          id: int,
          name: name(60),
          is_uni: bool,
          sort: int.default(0),
          // Added in 1.2.0; older backups have none. An unknown value is dropped rather than failing the restore.
          icon: z.enum(CATEGORY_ICONS).nullish().catch(null),
          color: z.enum(CATEGORY_COLORS).nullish().catch(null),
        }),
      )
      .max(200),
    month_budgets: z
      .array(
        z.object({
          month: monthStr,
          income: amount,
          uni_days: z.coerce.number().min(0).max(7),
          uni_weeks: z.coerce.number().min(0).max(6),
          uni_cost: amount,
          save_plan: amount,
          loan_plan: amount,
        }),
      )
      .max(1300),
    category_plans: z.array(z.object({ month: monthStr, category_id: int, planned: amount })).max(50_000),
    goals: z
      .array(z.object({ id: int, name: name(60), target: amount, start_balance: amount, monthly: amount, sort: int.default(0) }))
      .max(200),
    goal_entries: z
      .array(z.object({ id: int.optional(), goal_id: int, date: isoDate, type: z.enum(['deposit', 'withdrawal']), amount, note: str(200) }))
      .max(50_000),
    expenses: z
      .array(
        z.object({
          id: int.optional(),
          date: isoDate,
          category_id: int,
          description: str(200),
          amount: amount.refine((v) => v > 0),
          // 0.5.4+: tags, foreign currency
          tags: z.array(tag).max(5).nullish().transform((v) => [...new Set(v ?? [])]),
          orig_amount: amount.refine((v) => v > 0).nullish(),
          orig_currency: z.string().regex(/^[A-Z]{3}$/).nullish(),
          fx_rate: z.coerce.number().positive().max(1_000_000).nullish(),
        }),
      )
      .max(50_000),
    loan_entries: z
      .array(
        z.object({
          id: int.optional(),
          date: isoDate,
          person: name(60),
          direction: z.enum(['borrowed', 'lent']),
          kind: z.enum(['principal', 'repayment']),
          amount: amount.refine((v) => v > 0),
          note: str(200),
          expense_id: int.nullish(), // 0.5.4+: the split expense it belongs to
        }),
      )
      .max(20_000),
    // Added in 0.1.0 (recurring expenses); older backups don't have them.
    recurring_rules: z
      .array(
        z.object({
          id: int,
          category_id: int,
          amount: amount.refine((v) => v > 0),
          description: str(200),
          day_of_month: z.coerce.number().int().min(1).max(31),
          start_date: isoDate,
          end_date: isoDate.nullish(),
          auto_add: bool,
          paused: bool,
        }),
      )
      .max(100)
      .default([]),
    recurring_done: z
      .array(z.object({ rule_id: int, due_date: isoDate, status: z.enum(['added', 'skipped']) }))
      .max(50_000)
      .default([]),
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
    if (settings?.rollover !== undefined) await q.query('UPDATE users SET rollover = $1 WHERE id = $2', [settings.rollover, userId]);
    if (settings?.mergeRepeats !== undefined) await q.query('UPDATE users SET merge_repeats = $1 WHERE id = $2', [settings.mergeRepeats, userId]);
    for (const table of ['trash', 'recurring_rules', 'expenses', 'goal_entries', 'goals', 'loan_entries', 'category_plans', 'month_budgets', 'categories']) {
      await q.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
    }
    const catMap = new Map<number, number>();
    for (const c of t.categories) {
      const r = await q.query('INSERT INTO categories(user_id, name, is_uni, sort, icon, color) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [
        userId,
        c.name,
        c.is_uni,
        c.sort,
        c.icon ?? null,
        c.color ?? null,
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
    const expMap = new Map<number, number>();
    for (const e of t.expenses) {
      // Foreign currency only when all three parts are there.
      const fx = e.orig_amount && e.orig_currency && e.fx_rate ? [e.orig_amount, e.orig_currency, e.fx_rate] : [null, null, null];
      const ins = await q.query(
        `INSERT INTO expenses(user_id, date, category_id, description, amount, tags, orig_amount, orig_currency, fx_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [userId, e.date, cat(e.category_id), e.description, e.amount, e.tags, ...fx],
      );
      if (e.id !== undefined) expMap.set(e.id, ins.rows[0].id);
    }
    const linked = new Set<number>();
    for (const l of t.loan_entries) {
      // Keep the link to its split expense (each expense has at most one).
      let expenseId: number | null = l.expense_id != null ? (expMap.get(l.expense_id) ?? null) : null;
      if (expenseId !== null && linked.has(expenseId)) expenseId = null;
      if (expenseId !== null) linked.add(expenseId);
      await q.query(
        'INSERT INTO loan_entries(user_id, date, person, direction, kind, amount, note, expense_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [userId, l.date, l.person, l.direction, l.kind, l.amount, l.note, expenseId],
      );
    }
    const ruleMap = new Map<number, number>();
    for (const r of t.recurring_rules) {
      const end = r.end_date && r.end_date >= r.start_date ? r.end_date : null;
      const ins = await q.query(
        `INSERT INTO recurring_rules(user_id, category_id, amount, description, day_of_month, start_date, end_date, auto_add, paused)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [userId, cat(r.category_id), r.amount, r.description, r.day_of_month, r.start_date, end, r.auto_add, r.paused],
      );
      ruleMap.set(r.id, ins.rows[0].id);
    }
    for (const o of t.recurring_done) {
      const rid = ruleMap.get(o.rule_id);
      if (rid === undefined) continue;
      await q.query(
        `INSERT INTO recurring_occurrences(rule_id, due_date, user_id, status) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [rid, o.due_date, userId, o.status],
      );
    }
  });
}
