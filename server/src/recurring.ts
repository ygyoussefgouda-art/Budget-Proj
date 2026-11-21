/**
 * Recurring expenses: monthly rules ("rent, 3,000, every month on the 1st").
 * When an occurrence is due it shows as "Due" with Add / Skip, or is added automatically.
 * Each handled occurrence is stored with PRIMARY KEY (rule_id, due_date), so the same
 * occurrence can never be added twice.
 */
import { Router } from 'express';
import type { Db, Queryable, Row } from './db.js';
import { addDays, firstOfNextMonth, localToday, monthlyDates } from './dates.js';
import { ah, HttpError } from './http.js';
import { underLimit } from './limits.js';
import { mapExpense } from './repo.js';
import { id as idSchema, schemas } from './validation.js';

const mapRule = (r: Row, nextDate: string | null) => ({
  id: r.id,
  categoryId: r.category_id,
  amount: r.amount,
  description: r.description,
  day: r.day_of_month,
  startDate: r.start_date,
  endDate: r.end_date,
  autoAdd: r.auto_add,
  paused: r.paused,
  nextDate,
});

export interface DueItem {
  ruleId: number;
  date: string;
  amount: number;
  categoryId: number;
  description: string;
}

async function handledDates(q: Queryable, ruleIds: number[]) {
  const out = new Map<number, Set<string>>();
  if (!ruleIds.length) return out;
  const r = await q.query('SELECT rule_id, due_date FROM recurring_occurrences WHERE rule_id = ANY($1::bigint[])', [ruleIds]);
  for (const row of r.rows) {
    if (!out.has(row.rule_id)) out.set(row.rule_id, new Set());
    out.get(row.rule_id)!.add(row.due_date);
  }
  return out;
}

/** Occurrences of `rule` up to `today` that were neither added nor skipped (oldest first). */
const pendingFor = (rule: Row, handled: Set<string> | undefined, today: string) =>
  rule.paused
    ? []
    : monthlyDates(rule.day_of_month, rule.start_date, rule.end_date, rule.start_date, today).filter((d) => !handled?.has(d));

/** Adds the rule's expense for `date` and records the occurrence. Returns null if it was already handled. */
async function addOccurrence(q: Queryable, u: number, rule: Row, date: string) {
  const ins = await q.query(
    `INSERT INTO recurring_occurrences(rule_id, due_date, user_id, status) VALUES ($1, $2, $3, 'added')
     ON CONFLICT (rule_id, due_date) DO NOTHING RETURNING rule_id`,
    [rule.id, date, u],
  );
  if (!ins.rows.length) return null;
  await underLimit(q, 'expenses', u);
  const e = (
    await q.query(
      `INSERT INTO expenses(user_id, date, category_id, description, amount) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [u, date, rule.category_id, rule.description, rule.amount],
    )
  ).rows[0];
  await q.query('UPDATE recurring_occurrences SET expense_id = $1 WHERE rule_id = $2 AND due_date = $3', [e.id, rule.id, date]);
  return e;
}

/** Adds everything that is due for "add automatically" rules. Safe to run any number of times. */
export async function applyAutoAdd(db: Db, u: number, today: string) {
  const rules = (await db.query('SELECT * FROM recurring_rules WHERE user_id = $1 AND auto_add AND NOT paused', [u])).rows;
  if (!rules.length) return;
  const handled = await handledDates(db, rules.map((r) => r.id));
  for (const rule of rules) {
    for (const date of pendingFor(rule, handled.get(rule.id), today)) {
      try {
        await db.tx((q) => addOccurrence(q, u, rule, date));
      } catch (e) {
        if (e instanceof HttpError && e.code === 'limit') return; // expense limit reached: try again later
        throw e;
      }
    }
  }
}

/** Due occurrences waiting for Add / Skip (rules that are not added automatically). */
export async function pendingDue(q: Queryable, u: number, today: string): Promise<DueItem[]> {
  const rules = (
    await q.query('SELECT * FROM recurring_rules WHERE user_id = $1 AND NOT auto_add AND NOT paused ORDER BY id', [u])
  ).rows;
  const handled = await handledDates(q, rules.map((r) => r.id));
  const out: DueItem[] = [];
  for (const rule of rules) {
    for (const date of pendingFor(rule, handled.get(rule.id), today).slice(-12)) {
      out.push({ ruleId: rule.id, date, amount: rule.amount, categoryId: rule.category_id, description: rule.description });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ruleId - b.ruleId));
}

/** The next date the rule needs attention: the oldest pending one, else the next one to come. */
function nextDateOf(rule: Row, handled: Set<string> | undefined, today: string) {
  if (rule.paused) return null;
  const pending = pendingFor(rule, handled, today);
  if (pending.length) return pending[0];
  const tomorrow = addDays(today, 1);
  return monthlyDates(rule.day_of_month, rule.start_date, rule.end_date, tomorrow, addDays(today, 62))[0] ?? null;
}

export function recurringRoutes(db: Db): Router {
  const r = Router();
  const uid = (req: { user?: { id: number } }) => req.user!.id;
  const pid = (v: unknown) => idSchema.parse(v);

  const checkCategory = async (q: Queryable, u: number, categoryId: number) => {
    const c = await q.query('SELECT 1 FROM categories WHERE id = $1 AND user_id = $2', [categoryId, u]);
    if (!c.rows.length) throw new HttpError(400, 'Pick a valid category.');
  };

  r.get(
    '/recurring',
    ah(async (req, res) => {
      const u = uid(req);
      const today = localToday(req);
      const rules = (await db.query('SELECT * FROM recurring_rules WHERE user_id = $1 ORDER BY paused, day_of_month, id', [u])).rows;
      const handled = await handledDates(db, rules.map((x) => x.id));
      res.json({ rules: rules.map((x) => mapRule(x, nextDateOf(x, handled.get(x.id), today))) });
    }),
  );

  r.post(
    '/recurring',
    ah(async (req, res) => {
      const b = schemas.recurringRule.parse(req.body);
      const u = uid(req);
      const today = localToday(req);
      if (b.endDate && b.endDate < today) throw new HttpError(400, 'The end date is before today.');
      const row = await db.tx(async (q) => {
        await checkCategory(q, u, b.categoryId);
        await underLimit(q, 'recurring_rules', u);
        // Starts today: an occurrence earlier this month (probably already logged by hand) is not due.
        return (
          await q.query(
            `INSERT INTO recurring_rules(user_id, category_id, amount, description, day_of_month, start_date, end_date, auto_add, paused)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [u, b.categoryId, b.amount, b.description, b.day, today, b.endDate ?? null, b.autoAdd, b.paused],
          )
        ).rows[0];
      });
      res.status(201).json(mapRule(row, nextDateOf(row, undefined, today)));
    }),
  );

  r.put(
    '/recurring/:id',
    ah(async (req, res) => {
      const ruleId = pid(req.params.id);
      const b = schemas.recurringRule.parse(req.body);
      const u = uid(req);
      const today = localToday(req);
      const row = await db.tx(async (q) => {
        const cur = (await q.query('SELECT * FROM recurring_rules WHERE id = $1 AND user_id = $2 FOR UPDATE', [ruleId, u])).rows[0];
        if (!cur) throw new HttpError(404, 'Recurring expense not found.');
        await checkCategory(q, u, b.categoryId);
        let start: string = cur.start_date;
        // New day of the month: the new schedule starts after the month already handled,
        // so moving the 1st to the 15th doesn't make this month due twice.
        if (b.day !== cur.day_of_month) {
          const last = (await q.query('SELECT MAX(due_date) AS d FROM recurring_occurrences WHERE rule_id = $1', [ruleId])).rows[0].d;
          if (last && firstOfNextMonth(last) > start) start = firstOfNextMonth(last);
        }
        // Resuming a paused rule continues from today: what fell in the pause is not due.
        if (cur.paused && !b.paused && start < today) start = today;
        if (b.endDate && b.endDate < start) throw new HttpError(400, 'The end date is before the first date of this recurring expense.');
        return (
          await q.query(
            `UPDATE recurring_rules SET category_id = $3, amount = $4, description = $5, day_of_month = $6, start_date = $7,
               end_date = $8, auto_add = $9, paused = $10
             WHERE id = $1 AND user_id = $2 RETURNING *`,
            [ruleId, u, b.categoryId, b.amount, b.description, b.day, start, b.endDate ?? null, b.autoAdd, b.paused],
          )
        ).rows[0];
      });
      const handled = await handledDates(db, [row.id]);
      res.json(mapRule(row, nextDateOf(row, handled.get(row.id), today)));
    }),
  );

  r.delete(
    '/recurring/:id',
    ah(async (req, res) => {
      // Expenses it already added stay; only the rule (and its history) goes.
      const d = await db.query('DELETE FROM recurring_rules WHERE id = $1 AND user_id = $2', [pid(req.params.id), uid(req)]);
      if (!d.rowCount) throw new HttpError(404, 'Recurring expense not found.');
      res.status(204).end();
    }),
  );

  // Add or skip one due occurrence.
  const handle = (action: 'add' | 'skip') =>
    ah(async (req, res) => {
      const ruleId = pid(req.params.id);
      const { date } = schemas.recurringAction.parse(req.body);
      const u = uid(req);
      const today = localToday(req);
      const out = await db.tx(async (q) => {
        const rule = (await q.query('SELECT * FROM recurring_rules WHERE id = $1 AND user_id = $2 FOR UPDATE', [ruleId, u])).rows[0];
        if (!rule) throw new HttpError(404, 'Recurring expense not found.');
        const handled = await handledDates(q, [ruleId]);
        if (!pendingFor(rule, handled.get(ruleId), today).includes(date)) {
          throw new HttpError(409, 'This recurring expense is no longer due.', 'not_due');
        }
        if (action === 'skip') {
          const ins = await q.query(
            `INSERT INTO recurring_occurrences(rule_id, due_date, user_id, status) VALUES ($1, $2, $3, 'skipped')
             ON CONFLICT (rule_id, due_date) DO NOTHING RETURNING rule_id`,
            [ruleId, date, u],
          );
          if (!ins.rows.length) throw new HttpError(409, 'This recurring expense is no longer due.', 'not_due');
          return null;
        }
        const e = await addOccurrence(q, u, rule, date);
        if (!e) throw new HttpError(409, 'This recurring expense is no longer due.', 'not_due');
        return e;
      });
      if (out) res.status(201).json(mapExpense(out));
      else res.json({ ok: true });
    });
  r.post('/recurring/:id/add', handle('add'));
  r.post('/recurring/:id/skip', handle('skip'));

  return r;
}
