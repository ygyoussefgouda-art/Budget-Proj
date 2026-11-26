import express, { Router } from 'express';
import { z } from 'zod';
import type { Db, Queryable } from './db.js';
import { ah, ConfirmNeeded, forced, HttpError } from './http.js';
import {
  ensureMonth,
  EXPENSE_EXTRAS,
  expenseWhere,
  goalsWithBalance,
  inMonth,
  loadBudget,
  mapCategory,
  mapExpense,
  mapGoalEntry,
  mapIncome,
  mapLoan,
  recentActivity,
  SPLIT_JOIN,
} from './repo.js';
import { checkPassword, publicUser } from './auth.js';
import { exportBackup, restoreBackup } from './backup.js';
import { localToday } from './dates.js';
import { underLimit } from './limits.js';
import { applyAutoAdd, pendingDue } from './recurring.js';
import { carryover } from './rollover.js';
import { moveToTrash, purgeTrash, trashGoal, trashLoanPerson } from './undo.js';
import { convert, id as idSchema, monthStr, schemas } from './validation.js';

/** SQL: month budget row `mb` has something in it (income, a plan, or a category budget). */
const MONTH_HAS_DATA = `(mb.income > 0 OR mb.save_plan > 0 OR mb.loan_plan > 0 OR mb.uni_cost > 0
  OR EXISTS (SELECT 1 FROM category_plans cp WHERE cp.user_id = mb.user_id AND cp.month = mb.month AND cp.planned > 0))`;

/** The latest month before `month` that has a budget worth copying. */
const copySource = async (q: Queryable, u: number, month: string) =>
  ((await q.query(`SELECT * FROM month_budgets mb WHERE mb.user_id = $1 AND mb.month < $2 AND ${MONTH_HAS_DATA} ORDER BY mb.month DESC LIMIT 1`, [u, month])).rows[0] ??
    null) as Record<string, any> | null;

const fmtMinor = (minor: number) => {
  const neg = minor < 0;
  const a = Math.abs(minor);
  const s = (a / 100).toLocaleString('en-US', { minimumFractionDigits: a % 100 ? 2 : 0, maximumFractionDigits: 2 });
  return `${neg ? '−' : ''}${s}`;
};

/** All routes below require a signed-in user (req.user). */
export function apiRoutes(db: Db): Router {
  const r = Router();
  const uid = (req: { user?: { id: number } }) => req.user!.id;
  const pid = (v: unknown) => idSchema.parse(v);

  /** Accounts with a backup restore in progress (one at a time per account). */
  const restoring = new Set<number>();

  // Deleted items wait in the trash for the undo window; clear old ones now and then (at most every 30 s per account).
  const lastPurge = new Map<number, number>();
  r.use(
    ah(async (req, _res, next) => {
      const u = uid(req);
      const now = Date.now();
      if (now - (lastPurge.get(u) ?? 0) > 30_000) {
        lastPurge.set(u, now);
        if (lastPurge.size > 10_000) lastPurge.clear();
        await purgeTrash(db, u);
      }
      next();
    }),
  );

  // ---------- profile / settings ----------
  r.get('/auth/me', (req, res) => {
    res.json({ user: publicUser(req.user!) });
  });

  r.put(
    '/settings',
    ah(async (req, res) => {
      const s = schemas.settings.parse(req.body);
      const user = {
        ...req.user!,
        ...(s.currency ? { currency: s.currency } : {}),
        ...(s.monthStartDay ? { monthStartDay: s.monthStartDay } : {}),
        ...(s.rollover !== undefined ? { rollover: s.rollover } : {}),
        ...(s.mergeRepeats !== undefined ? { mergeRepeats: s.mergeRepeats } : {}),
        ...(s.accent ? { accent: s.accent } : {}),
      };
      await db.query('UPDATE users SET currency = $1, month_start_day = $2, rollover = $3, merge_repeats = $4, accent = $5 WHERE id = $6', [
        user.currency,
        user.monthStartDay,
        !!user.rollover,
        !!user.mergeRepeats,
        user.accent ?? 'lime',
        uid(req),
      ]);
      res.json({ user: publicUser(user) });
    }),
  );

  // ---------- everything a month screen needs, in one round trip ----------
  r.get(
    '/state',
    ah(async (req, res) => {
      const month = monthStr.parse(req.query.month);
      const u = uid(req);
      const today = localToday(req);
      await db.tx((q) => ensureMonth(q, u, month));
      await applyAutoAdd(db, u, today); // recurring expenses set to "add automatically"
      const [budget, cats, expenses, goals, entries, loans, recent, earlier, due, thisHasData, source, incomes] = await Promise.all([
        loadBudget(db, u, month),
        db.query('SELECT * FROM categories WHERE user_id = $1 ORDER BY sort, id', [u]),
        db.query(
          `SELECT e.*, ${EXPENSE_EXTRAS} FROM expenses e ${SPLIT_JOIN} WHERE e.user_id = $1 AND ${inMonth('e.date', '$2', '$3')} ORDER BY e.date DESC, e.time_of_day DESC NULLS LAST, e.id DESC`,
          [u, month, req.user!.monthStartDay],
        ),
        goalsWithBalance(db, u),
        db.query('SELECT * FROM goal_entries WHERE user_id = $1 ORDER BY date, id', [u]),
        db.query('SELECT * FROM loan_entries WHERE user_id = $1 ORDER BY date, id', [u]),
        recentActivity(db, u, 6),
        db.query('SELECT 1 FROM month_budgets WHERE user_id = $1 AND month < $2 LIMIT 1', [u, month]),
        pendingDue(db, u, today),
        db.query(`SELECT 1 FROM month_budgets mb WHERE mb.user_id = $1 AND mb.month = $2 AND ${MONTH_HAS_DATA}`, [u, month]),
        copySource(db, u, month),
        db.query(`SELECT * FROM incomes WHERE user_id = $1 AND ${inMonth('date', '$2', '$3')} ORDER BY date DESC, id DESC`, [
          u,
          month,
          req.user!.monthStartDay,
        ]),
      ]);
      // Rollover on: unspent budget per category carried in from earlier months.
      const carry = req.user!.rollover ? await carryover(db, u, month, req.user!.monthStartDay) : {};
      res.json({
        month,
        budget,
        categories: cats.rows.map(mapCategory),
        expenses: expenses.rows.map(mapExpense),
        /** 2.2.0: extra income in this budget month (on top of budget.income). */
        incomes: incomes.rows.map(mapIncome),
        goals,
        goalEntries: entries.rows.map(mapGoalEntry),
        loans: loans.rows.map(mapLoan),
        recent,
        hasEarlierMonth: earlier.rows.length > 0,
        // Empty month and an earlier month to copy from: offer "Same as last month".
        canCopyPrevious: thisHasData.rows.length === 0 && source !== null,
        copyFrom: source?.month ?? null,
        recurringDue: due,
        carry,
      });
    }),
  );

  // ---------- month budget ----------
  r.put(
    '/budget/:month',
    ah(async (req, res) => {
      const month = monthStr.parse(req.params.month);
      const b = schemas.budget.parse(req.body);
      await db.tx(async (q) => {
        await ensureMonth(q, uid(req), month);
        await q.query(
          `UPDATE month_budgets SET income = $3, uni_days = $4, uni_weeks = $5, uni_cost = $6, save_plan = $7, loan_plan = $8
           WHERE user_id = $1 AND month = $2`,
          [uid(req), month, b.income, b.uniDays, b.uniWeeks, b.uniCost, b.savePlan, b.loanPlan],
        );
      });
      res.json({ ok: true });
    }),
  );

  r.post(
    '/budget/:month/copy-previous',
    ah(async (req, res) => {
      const month = monthStr.parse(req.params.month);
      const u = uid(req);
      const from = await db.tx(async (q) => {
        // The latest earlier month that has a budget (skipping empty ones in between).
        const src = await copySource(q, u, month);
        if (!src) throw new HttpError(400, 'There is no earlier month to copy from.');
        await q.query('DELETE FROM category_plans WHERE user_id = $1 AND month = $2', [u, month]);
        await q.query('DELETE FROM month_budgets WHERE user_id = $1 AND month = $2', [u, month]);
        await q.query(
          `INSERT INTO month_budgets(user_id, month, income, uni_days, uni_weeks, uni_cost, save_plan, loan_plan)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [u, month, src.income, src.uni_days, src.uni_weeks, src.uni_cost, src.save_plan, src.loan_plan],
        );
        await q.query(
          `INSERT INTO category_plans(user_id, month, category_id, planned)
           SELECT user_id, $2, category_id, planned FROM category_plans WHERE user_id = $1 AND month = $3`,
          [u, month, src.month],
        );
        return src.month as string;
      });
      res.json({ ok: true, from });
    }),
  );

  r.post(
    '/budget/:month/clear-plans',
    ah(async (req, res) => {
      const month = monthStr.parse(req.params.month);
      await db.query('DELETE FROM category_plans WHERE user_id = $1 AND month = $2', [uid(req), month]);
      res.json({ ok: true });
    }),
  );

  // ---------- categories ----------
  const setPlan = (q: Queryable, u: number, month: string, catId: number, planned: number) =>
    q.query(
      `INSERT INTO category_plans(user_id, month, category_id, planned) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, month, category_id) DO UPDATE SET planned = EXCLUDED.planned`,
      [u, month, catId, planned],
    );

  const nameTaken = async (q: Queryable, u: number, name: string, exceptId?: number) =>
    (
      await q.query('SELECT 1 FROM categories WHERE user_id = $1 AND lower(name) = lower($2) AND id <> $3', [
        u,
        name,
        exceptId ?? 0,
      ])
    ).rows.length > 0;

  r.post(
    '/categories',
    ah(async (req, res) => {
      const c = schemas.categoryCreate.parse(req.body);
      const u = uid(req);
      const out = await db.tx(async (q) => {
        if (await nameTaken(q, u, c.name)) throw new HttpError(409, 'That category already exists.', 'conflict');
        await underLimit(q, 'categories', u);
        await ensureMonth(q, u, c.month);
        // Only one category can use the per-day formula (days x weeks x cost per day).
        if (c.perDay) await q.query('UPDATE categories SET is_uni = false WHERE user_id = $1', [u]);
        const ins = await q.query(
          `INSERT INTO categories(user_id, name, is_uni, sort, icon, color)
           VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort), -1) + 1 FROM categories WHERE user_id = $1), $4, $5) RETURNING *`,
          [u, c.name, c.perDay, c.icon ?? null, c.color ?? null],
        );
        if (c.planned > 0 && !c.perDay) await setPlan(q, u, c.month, ins.rows[0].id, c.planned);
        return ins.rows[0];
      });
      res.status(201).json(mapCategory(out));
    }),
  );

  r.put(
    '/categories/:id',
    ah(async (req, res) => {
      const id = pid(req.params.id);
      const c = schemas.categoryUpdate.parse(req.body);
      const u = uid(req);
      await db.tx(async (q) => {
        const cur = (await q.query('SELECT * FROM categories WHERE id = $1 AND user_id = $2', [id, u])).rows[0];
        if (!cur) throw new HttpError(404, 'Category not found.');
        if (await nameTaken(q, u, c.name, id)) throw new HttpError(409, 'That name is already used.', 'conflict');
        await q.query('UPDATE categories SET name = $1 WHERE id = $2', [c.name, id]);
        // Icon / colour: left alone when not sent, cleared with null.
        if (c.icon !== undefined) await q.query('UPDATE categories SET icon = $1 WHERE id = $2', [c.icon, id]);
        if (c.color !== undefined) await q.query('UPDATE categories SET color = $1 WHERE id = $2', [c.color, id]);
        let perDay: boolean = cur.is_uni;
        if (c.perDay !== undefined && c.perDay !== cur.is_uni) {
          if (c.perDay) await q.query('UPDATE categories SET is_uni = false WHERE user_id = $1', [u]);
          await q.query('UPDATE categories SET is_uni = $1 WHERE id = $2', [c.perDay, id]);
          perDay = c.perDay;
        }
        if (c.planned !== undefined && !perDay) {
          await ensureMonth(q, u, c.month);
          await setPlan(q, u, c.month, id, c.planned);
        }
      });
      res.json({ ok: true });
    }),
  );

  r.delete(
    '/categories/:id',
    ah(async (req, res) => {
      const id = pid(req.params.id);
      const u = uid(req);
      await db.tx(async (q) => {
        const cur = (await q.query('SELECT * FROM categories WHERE id = $1 AND user_id = $2', [id, u])).rows[0];
        if (!cur) throw new HttpError(404, 'Category not found.');
        const n = (await q.query('SELECT COUNT(*)::int AS n FROM expenses WHERE category_id = $1', [id])).rows[0].n;
        if (n > 0) throw new HttpError(400, `This category has ${n} expense(s). Move or delete them first.`);
        const rules = (await q.query('SELECT COUNT(*)::int AS n FROM recurring_rules WHERE category_id = $1', [id])).rows[0].n;
        if (rules > 0) throw new HttpError(400, `This category is used by ${rules} recurring expense(s). Change or delete them first.`);
        await q.query('DELETE FROM categories WHERE id = $1', [id]);
      });
      res.status(204).end();
    }),
  );

  // ---------- expenses ----------
  r.get(
    '/expenses',
    ah(async (req, res) => {
      const f = schemas.expenseQuery.parse(req.query);
      const { where: w, params } = expenseWhere(uid(req), f);
      const totals = await db.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(e.amount), 0) AS total
         FROM expenses e JOIN categories c ON c.id = e.category_id WHERE ${w}`,
        params,
      );
      const items = await db.query(
        `SELECT e.*, c.name AS category_name, ${EXPENSE_EXTRAS} FROM expenses e JOIN categories c ON c.id = e.category_id ${SPLIT_JOIN}
         WHERE ${w} ORDER BY e.date DESC, e.time_of_day DESC NULLS LAST, e.id DESC LIMIT ${f.limit} OFFSET ${f.offset}`,
        params,
      );
      res.json({ items: items.rows.map(mapExpense), count: totals.rows[0].count, total: totals.rows[0].total });
    }),
  );

  const saveExpense = (mode: 'create' | 'update') =>
    ah(async (req, res) => {
      const e = schemas.expense.parse(req.body);
      const u = uid(req);
      const id = mode === 'update' ? pid(req.params.id) : 0;
      // Foreign currency: the bill converted at the user's rate must equal my share + their share.
      if (e.foreign) {
        if (e.foreign.currency === req.user!.currency) throw new HttpError(400, 'Pick a currency different from your own.');
        if (convert(e.foreign.amount, e.foreign.rate) !== e.amount + (e.split?.share ?? 0)) {
          throw new HttpError(400, 'The amounts do not add up. Check the rate and the split.');
        }
      }
      const fx = e.foreign ? [e.foreign.amount, e.foreign.currency, e.foreign.rate] : [null, null, null];
      let alreadySaved = false;
      let merged = false;
      const savedId = await db.tx(async (q) => {
        // An offline retry of something already saved: answer with that expense before any check or cap.
        if (mode === 'create' && e.clientId) {
          const known = await q.query('SELECT id FROM expenses WHERE user_id = $1 AND client_id = $2', [u, e.clientId]);
          if (known.rows.length) {
            alreadySaved = true;
            return known.rows[0].id as number;
          }
          // Saved, then deleted (still in the Undo window): don't bring it back.
          const gone = await q.query(`SELECT 1 FROM trash WHERE user_id = $1 AND kind = 'expense' AND item->>'client_id' = $2`, [u, e.clientId]);
          if (gone.rows.length) throw new HttpError(409, 'This expense was saved and then deleted.', 'deleted');
        }
        const cat = await q.query('SELECT name FROM categories WHERE id = $1 AND user_id = $2', [e.categoryId, u]);
        if (!cat.rows.length) throw new HttpError(400, 'Pick a valid category.');
        // Merge repeats (Settings, off by default): "Transport 10" right after "Transport 10" becomes one
        // "Transport 20". Only into the very last expense added, within 5 minutes, same category, date and
        // description, and never with splits, other currencies, offline syncs or a new receipt.
        if (mode === 'create' && req.user!.mergeRepeats && !e.split && !e.foreign && !e.clientId && !e.noMerge) {
          const last = (
            await q.query(
              `SELECT e.id FROM expenses e
               WHERE e.id = (SELECT id FROM expenses WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1)
                 AND e.created_at > now() - interval '5 minutes'
                 AND e.date = $2 AND e.category_id = $3 AND lower(trim(e.description)) = lower(trim($4))
                 AND e.orig_currency IS NULL AND e.amount + $5 <= 10000000000000
                 AND NOT EXISTS (SELECT 1 FROM loan_entries l WHERE l.expense_id = e.id)
               FOR UPDATE`,
              [u, e.date, e.categoryId, e.description, e.amount],
            )
          ).rows[0];
          if (last) {
            await q.query(
              `UPDATE expenses SET amount = amount + $2,
                 tags = ARRAY(SELECT DISTINCT t FROM unnest(tags || $3::text[]) AS t ORDER BY t LIMIT 5)
               WHERE id = $1`,
              [last.id, e.amount, e.tags],
            );
            merged = true;
            return last.id as number;
          }
        }
        if (!forced(req)) {
          const dup = await q.query(
            `SELECT 1 FROM expenses WHERE user_id = $1 AND id <> $2 AND date = $3 AND category_id = $4 AND amount = $5
             AND lower(trim(description)) = lower(trim($6)) LIMIT 1`,
            [u, id, e.date, e.categoryId, e.amount, e.description],
          );
          if (dup.rows.length) throw new ConfirmNeeded('An identical expense already exists. Save it anyway?');
        }
        let expenseId: number;
        if (mode === 'create') {
          await underLimit(q, 'expenses', u);
          const ins = await q.query(
            `INSERT INTO expenses(user_id, date, category_id, description, amount, tags, orig_amount, orig_currency, fx_rate, client_id, time_of_day)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO NOTHING RETURNING id`,
            [u, e.date, e.categoryId, e.description, e.amount, e.tags, ...fx, e.clientId ?? null, e.time ?? null],
          );
          if (!ins.rows.length) {
            // Sent before (offline sync retried): hand back the expense it already created, change nothing.
            const existing = await q.query('SELECT id FROM expenses WHERE user_id = $1 AND client_id = $2', [u, e.clientId]);
            alreadySaved = true;
            return existing.rows[0].id as number;
          }
          expenseId = ins.rows[0].id;
        } else {
          const up = await q.query(
            `UPDATE expenses SET date = $3, category_id = $4, description = $5, amount = $6, tags = $7,
               orig_amount = $8, orig_currency = $9, fx_rate = $10,
               time_of_day = CASE WHEN $12::boolean THEN $11 ELSE time_of_day END
             WHERE id = $1 AND user_id = $2 RETURNING id`,
            // A client that doesn't send `time` (older app) leaves it as it is; null clears it.
            [id, u, e.date, e.categoryId, e.description, e.amount, e.tags, ...fx, e.time ?? null, e.time !== undefined],
          );
          if (!up.rows.length) throw new HttpError(404, 'Expense not found.');
          expenseId = id;
        }
        // Split: keep the linked "Owed to me" entry in step with the expense (create, update or remove it).
        const link = (await q.query('SELECT id FROM loan_entries WHERE expense_id = $1 AND user_id = $2', [expenseId, u])).rows[0];
        if (e.split) {
          const note = e.description || (cat.rows[0].name as string);
          if (link) {
            await q.query('UPDATE loan_entries SET date = $2, person = $3, amount = $4, note = $5 WHERE id = $1', [
              link.id,
              e.date,
              e.split.person,
              e.split.share,
              note,
            ]);
          } else {
            await underLimit(q, 'loan_entries', u);
            await q.query(
              `INSERT INTO loan_entries(user_id, date, person, direction, kind, amount, note, expense_id)
               VALUES ($1, $2, $3, 'lent', 'principal', $4, $5, $6)`,
              [u, e.date, e.split.person, e.split.share, note, expenseId],
            );
          }
        } else if (link) {
          await q.query('DELETE FROM loan_entries WHERE id = $1', [link.id]);
        }
        return expenseId;
      });
      const row = (
        await db.query(`SELECT e.*, ${EXPENSE_EXTRAS} FROM expenses e ${SPLIT_JOIN} WHERE e.id = $1`, [savedId])
      ).rows[0];
      if (merged) return void res.status(200).json({ ...mapExpense(row), merged: true });
      res.status(mode === 'create' && !alreadySaved ? 201 : 200).json(mapExpense(row));
    });

  // Tags used so far (most used first), for the filter chips and the tag picker.
  r.get(
    '/tags',
    ah(async (req, res) => {
      const rows = await db.query(
        `SELECT t AS tag, COUNT(*)::int AS n FROM expenses, unnest(tags) AS t
         WHERE user_id = $1 GROUP BY t ORDER BY n DESC, t LIMIT 40`,
        [uid(req)],
      );
      res.json(rows.rows.map((x) => ({ tag: x.tag, count: x.n })));
    }),
  );

  // Quick add: the descriptions used most in the last 6 months (with their usual category), as tap-to-fill chips.
  r.get(
    '/expenses/suggestions',
    ah(async (req, res) => {
      const rows = await db.query(
        `SELECT (array_agg(description ORDER BY date DESC, id DESC))[1] AS description,
                (array_agg(category_id ORDER BY date DESC, id DESC))[1] AS category_id,
                COUNT(*)::int AS n
         FROM expenses
         WHERE user_id = $1 AND trim(description) <> '' AND date > CURRENT_DATE - 183
         GROUP BY lower(trim(description))
         ORDER BY n DESC, MAX(date) DESC
         LIMIT 8`,
        [uid(req)],
      );
      res.json(rows.rows.map((x) => ({ description: x.description, categoryId: x.category_id, count: x.n })));
    }),
  );

  r.post('/expenses', saveExpense('create'));
  r.put('/expenses/:id', saveExpense('update'));
  r.delete(
    '/expenses/:id',
    ah(async (req, res) => {
      const u = uid(req);
      const undo = await db.tx(async (q) => {
        const row = (await q.query('SELECT * FROM expenses WHERE id = $1 AND user_id = $2 FOR UPDATE', [pid(req.params.id), u])).rows[0];
        if (!row) throw new HttpError(404, 'Expense not found.');
        return moveToTrash(q, u, 'expense', row);
      });
      res.json({ undo });
    }),
  );

  // ---------- extra income (2.2.0): on top of the month's fixed income ----------
  r.post(
    '/incomes',
    ah(async (req, res) => {
      const i = schemas.income.parse(req.body);
      const u = uid(req);
      const row = await db.tx(async (q) => {
        if (!forced(req)) {
          const dup = await q.query(
            `SELECT 1 FROM incomes WHERE user_id = $1 AND date = $2 AND amount = $3 AND lower(trim(description)) = lower(trim($4)) LIMIT 1`,
            [u, i.date, i.amount, i.description],
          );
          if (dup.rows.length) throw new ConfirmNeeded('An identical income already exists. Save it anyway?');
        }
        await underLimit(q, 'incomes', u);
        return (
          await q.query('INSERT INTO incomes(user_id, date, amount, description) VALUES ($1, $2, $3, $4) RETURNING *', [
            u,
            i.date,
            i.amount,
            i.description,
          ])
        ).rows[0];
      });
      res.status(201).json(mapIncome(row));
    }),
  );

  r.put(
    '/incomes/:id',
    ah(async (req, res) => {
      const i = schemas.income.parse(req.body);
      const up = await db.query(
        'UPDATE incomes SET date = $3, amount = $4, description = $5 WHERE id = $1 AND user_id = $2 RETURNING *',
        [pid(req.params.id), uid(req), i.date, i.amount, i.description],
      );
      if (!up.rows.length) throw new HttpError(404, 'Income not found.');
      res.json(mapIncome(up.rows[0]));
    }),
  );

  r.delete(
    '/incomes/:id',
    ah(async (req, res) => {
      const u = uid(req);
      const undo = await db.tx(async (q) => {
        const row = (await q.query('SELECT * FROM incomes WHERE id = $1 AND user_id = $2 FOR UPDATE', [pid(req.params.id), u])).rows[0];
        if (!row) throw new HttpError(404, 'Income not found.');
        return moveToTrash(q, u, 'income', row);
      });
      res.json({ undo });
    }),
  );

  // ---------- savings goals ----------
  r.post(
    '/goals',
    ah(async (req, res) => {
      const g = schemas.goal.parse(req.body);
      const u = uid(req);
      await underLimit(db, 'goals', u);
      const row = (
        await db.query(
          `INSERT INTO goals(user_id, name, target, start_balance, monthly, sort)
           VALUES ($1, $2, $3, $4, $5, (SELECT COALESCE(MAX(sort), -1) + 1 FROM goals WHERE user_id = $1)) RETURNING id`,
          [u, g.name, g.target, g.start, g.monthly],
        )
      ).rows[0];
      res.status(201).json({ id: row.id });
    }),
  );

  r.put(
    '/goals/:id',
    ah(async (req, res) => {
      const g = schemas.goal.parse(req.body);
      const goalId = pid(req.params.id);
      const u = uid(req);
      await db.tx(async (q) => {
        // Lowering the starting amount must not push the balance below zero.
        const bal = await goalBalanceExcept(q, u, goalId, 0);
        const cur = (await q.query('SELECT start_balance FROM goals WHERE id = $1', [goalId])).rows[0];
        if (bal - (cur.start_balance as number) + g.start < 0) {
          throw new HttpError(400, 'This change would make the balance negative. Remove later withdrawals first.');
        }
        await q.query('UPDATE goals SET name = $3, target = $4, start_balance = $5, monthly = $6 WHERE id = $1 AND user_id = $2', [
          goalId,
          u,
          g.name,
          g.target,
          g.start,
          g.monthly,
        ]);
      });
      res.json({ ok: true });
    }),
  );

  r.delete(
    '/goals/:id',
    ah(async (req, res) => {
      const u = uid(req);
      const undo = await db.tx(async (q) => {
        const g = (await q.query('SELECT * FROM goals WHERE id = $1 AND user_id = $2 FOR UPDATE', [pid(req.params.id), u])).rows[0];
        if (!g) throw new HttpError(404, 'Goal not found.');
        return trashGoal(q, u, g); // its entries go with it; Undo brings both back
      });
      res.json({ undo });
    }),
  );

  /**
   * Locks the goal and returns its balance without the given entry, so a change
   * can be checked against it (a withdrawal may never take the balance below 0).
   */
  const goalBalanceExcept = async (q: Queryable, u: number, goalId: number, entryId: number) => {
    const g = await q.query('SELECT start_balance FROM goals WHERE id = $1 AND user_id = $2 FOR UPDATE', [goalId, u]);
    if (!g.rows.length) throw new HttpError(404, 'Goal not found.');
    const s = await q.query(
      `SELECT COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE -amount END), 0) AS net
       FROM goal_entries WHERE goal_id = $1 AND id <> $2`,
      [goalId, entryId],
    );
    return (g.rows[0].start_balance as number) + (s.rows[0].net as number);
  };

  const saveGoalEntry = (mode: 'create' | 'update') =>
    ah(async (req, res) => {
      const e = schemas.goalEntry.parse(req.body);
      const u = uid(req);
      const out = await db.tx(async (q) => {
        let goalId: number;
        let entryId = 0;
        if (mode === 'create') {
          goalId = pid(req.params.goalId);
        } else {
          entryId = pid(req.params.id);
          const cur = await q.query('SELECT goal_id FROM goal_entries WHERE id = $1 AND user_id = $2', [entryId, u]);
          if (!cur.rows.length) throw new HttpError(404, 'Entry not found.');
          goalId = cur.rows[0].goal_id;
        }
        const bal = await goalBalanceExcept(q, u, goalId, entryId);
        if (!e.deposit && e.amount > bal) {
          throw new HttpError(400, `You cannot withdraw more than the balance (${fmtMinor(bal)}).`);
        }
        if (e.deposit && bal + e.amount < 0) {
          throw new HttpError(400, 'This change would make the balance negative. Remove later withdrawals first.');
        }
        if (!forced(req)) {
          const dup = await q.query(
            `SELECT 1 FROM goal_entries WHERE goal_id = $1 AND id <> $2 AND date = $3 AND type = $4 AND amount = $5
             AND lower(trim(note)) = lower(trim($6)) LIMIT 1`,
            [goalId, entryId, e.date, e.deposit ? 'deposit' : 'withdrawal', e.amount, e.note],
          );
          if (dup.rows.length) throw new ConfirmNeeded('An identical entry already exists. Save it anyway?');
        }
        if (mode === 'create') {
          await underLimit(q, 'goal_entries', u);
          return (
            await q.query(
              `INSERT INTO goal_entries(user_id, goal_id, date, type, amount, note) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
              [u, goalId, e.date, e.deposit ? 'deposit' : 'withdrawal', e.amount, e.note],
            )
          ).rows[0];
        }
        return (
          await q.query(
            `UPDATE goal_entries SET date = $2, type = $3, amount = $4, note = $5 WHERE id = $1 RETURNING *`,
            [entryId, e.date, e.deposit ? 'deposit' : 'withdrawal', e.amount, e.note],
          )
        ).rows[0];
      });
      res.status(mode === 'create' ? 201 : 200).json(mapGoalEntry(out));
    });

  r.post('/goals/:goalId/entries', saveGoalEntry('create'));
  r.put('/goal-entries/:id', saveGoalEntry('update'));
  r.delete(
    '/goal-entries/:id',
    ah(async (req, res) => {
      const u = uid(req);
      const id = pid(req.params.id);
      const undo = await db.tx(async (q) => {
        const cur = (await q.query('SELECT * FROM goal_entries WHERE id = $1 AND user_id = $2', [id, u])).rows[0];
        if (!cur) throw new HttpError(404, 'Entry not found.');
        if (cur.type === 'deposit') {
          const bal = await goalBalanceExcept(q, u, cur.goal_id, id);
          if (bal < 0) {
            throw new HttpError(
              400,
              'Deleting this deposit would make the balance negative. Remove later withdrawals first.',
            );
          }
        }
        return moveToTrash(q, u, 'goal_entry', cur);
      });
      res.json({ undo });
    }),
  );

  // ---------- loans ----------
  const saveLoan = (mode: 'create' | 'update') =>
    ah(async (req, res) => {
      const l = schemas.loan.parse(req.body);
      const u = uid(req);
      const id = mode === 'update' ? pid(req.params.id) : 0;
      const direction = l.borrowed ? 'borrowed' : 'lent';
      const kind = l.repayment ? 'repayment' : 'principal';
      const row = await db.tx(async (q) => {
        if (mode === 'update') await notFromSplit(q, id, u);
        if (!forced(req)) {
          if (l.repayment) {
            const o = await q.query(
              `SELECT COALESCE(SUM(CASE WHEN kind = 'principal' THEN amount ELSE -amount END), 0) AS owed
               FROM loan_entries WHERE user_id = $1 AND id <> $2 AND direction = $3 AND lower(trim(person)) = lower($4)`,
              [u, id, direction, l.person],
            );
            const owed = Math.max(0, o.rows[0].owed as number);
            if (l.amount > owed) {
              throw new ConfirmNeeded(`This is more than the outstanding ${fmtMinor(owed)} for ${l.person}. Save anyway?`);
            }
          }
          const dup = await q.query(
            `SELECT 1 FROM loan_entries WHERE user_id = $1 AND id <> $2 AND date = $3 AND direction = $4 AND kind = $5
             AND amount = $6 AND lower(trim(person)) = lower($7) AND lower(trim(note)) = lower($8) LIMIT 1`,
            [u, id, l.date, direction, kind, l.amount, l.person, l.note],
          );
          if (dup.rows.length) throw new ConfirmNeeded('An identical entry already exists. Save it anyway?');
        }
        if (mode === 'create') {
          await underLimit(q, 'loan_entries', u);
          return (
            await q.query(
              `INSERT INTO loan_entries(user_id, date, person, direction, kind, amount, note)
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
              [u, l.date, l.person, direction, kind, l.amount, l.note],
            )
          ).rows[0];
        }
        const up = await q.query(
          `UPDATE loan_entries SET date = $3, person = $4, direction = $5, kind = $6, amount = $7, note = $8
           WHERE id = $1 AND user_id = $2 RETURNING *`,
          [id, u, l.date, l.person, direction, kind, l.amount, l.note],
        );
        if (!up.rows.length) throw new HttpError(404, 'Entry not found.');
        return up.rows[0];
      });
      res.status(mode === 'create' ? 201 : 200).json(mapLoan(row));
    });

  /** An "Owed to me" entry made by splitting an expense belongs to that expense: change it there. */
  const SPLIT_LOCKED = 'This entry comes from a split expense. Edit or delete the expense instead.';
  async function notFromSplit(q: Queryable, id: number, u: number) {
    const r = await q.query('SELECT expense_id FROM loan_entries WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, u]);
    if (r.rows[0] && r.rows[0].expense_id !== null) throw new HttpError(400, SPLIT_LOCKED);
  }
  r.post('/loans', saveLoan('create'));
  r.put('/loans/:id', saveLoan('update'));
  r.delete(
    '/loans/:id',
    ah(async (req, res) => {
      const u = uid(req);
      const undo = await db.tx(async (q) => {
        const row = (await q.query('SELECT * FROM loan_entries WHERE id = $1 AND user_id = $2 FOR UPDATE', [pid(req.params.id), u])).rows[0];
        if (!row) throw new HttpError(404, 'Entry not found.');
        if (row.expense_id !== null) throw new HttpError(400, SPLIT_LOCKED);
        return moveToTrash(q, u, 'loan_entry', row);
      });
      res.json({ undo });
    }),
  );

  // People in the loan log: rename (merges with an existing name) or delete with all their entries.
  r.put(
    '/loan-people',
    ah(async (req, res) => {
      const p = schemas.loanPersonRename.parse(req.body);
      const up = await db.query(
        `UPDATE loan_entries SET person = $4
         WHERE user_id = $1 AND direction = $2 AND lower(trim(person)) = lower(trim($3))`,
        [uid(req), p.borrowed ? 'borrowed' : 'lent', p.from, p.to],
      );
      if (!up.rowCount) throw new HttpError(404, 'Person not found.');
      res.json({ ok: true, updated: up.rowCount });
    }),
  );

  r.delete(
    '/loan-people',
    ah(async (req, res) => {
      const p = schemas.loanPersonDelete.parse(req.query);
      const args = [uid(req), p.borrowed ? 'borrowed' : 'lent', p.name];
      const undo = await db.tx(async (q) => {
        const rows = (
          await q.query(
            `SELECT * FROM loan_entries WHERE user_id = $1 AND direction = $2 AND lower(trim(person)) = lower(trim($3)) FOR UPDATE`,
            args,
          )
        ).rows;
        if (!rows.length) throw new HttpError(404, 'Person not found.');
        if (rows.some((r) => r.expense_id !== null)) {
          throw new HttpError(400, 'This person has entries from split expenses. Change or delete those expenses first.');
        }
        return trashLoanPerson(q, uid(req), rows);
      });
      res.json({ undo });
    }),
  );

  // ---------- reports ----------
  r.get(
    '/reports/year',
    ah(async (req, res) => {
      const y = z.coerce.number().int().min(2000).max(2100).parse(req.query.y);
      const u = uid(req);
      const rows = await db.query(
        `WITH m AS (SELECT to_char(make_date($2::int, g, 1), 'YYYY-MM') AS month FROM generate_series(1, 12) g)
         SELECT m.month,
           (mb.month IS NOT NULL) AS has_budget,
           COALESCE(mb.income, 0)
             + (SELECT COALESCE(SUM(amount), 0) FROM incomes WHERE user_id = $1 AND ${inMonth('date', 'm.month', '$3')}) AS income,
           (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE user_id = $1 AND ${inMonth('date', 'm.month', '$3')}) AS spent,
           (SELECT COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE -amount END), 0)
              FROM goal_entries WHERE user_id = $1 AND ${inMonth('date', 'm.month', '$3')}) AS saved,
           (SELECT COALESCE(SUM(amount), 0) FROM loan_entries
              WHERE user_id = $1 AND direction = 'borrowed' AND kind = 'repayment' AND ${inMonth('date', 'm.month', '$3')}) AS repaid
         FROM m LEFT JOIN month_budgets mb ON mb.user_id = $1 AND mb.month = m.month
         ORDER BY m.month`,
        [u, y, req.user!.monthStartDay],
      );
      res.json({
        year: y,
        months: rows.rows.map((x) => ({
          month: x.month,
          hasBudget: x.has_budget,
          income: x.income,
          spent: x.spent,
          saved: x.saved,
          repaid: x.repaid,
        })),
      });
    }),
  );

  // Month-over-month: spending per category in `month` and in the month before (same start day).
  r.get(
    '/reports/compare',
    ah(async (req, res) => {
      const month = monthStr.parse(req.query.month);
      const prev = (() => {
        const [y, m] = month.split('-').map(Number);
        return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
      })();
      const rows = await db.query(
        `SELECT c.id, c.name,
           COALESCE(SUM(e.amount) FILTER (WHERE ${inMonth('e.date', '$2', '$4')}), 0) AS current,
           COALESCE(SUM(e.amount) FILTER (WHERE ${inMonth('e.date', '$3', '$4')}), 0) AS previous
         FROM categories c LEFT JOIN expenses e ON e.category_id = c.id AND e.user_id = $1
         WHERE c.user_id = $1 GROUP BY c.id ORDER BY c.sort, c.id`,
        [uid(req), month, prev, req.user!.monthStartDay],
      );
      const categories = rows.rows.map((x) => ({ categoryId: x.id, name: x.name, current: x.current, previous: x.previous }));
      res.json({
        month,
        previous: prev,
        categories,
        total: {
          current: categories.reduce((s, c) => s + c.current, 0),
          previous: categories.reduce((s, c) => s + c.previous, 0),
        },
      });
    }),
  );

  // Spending by day of the week: total and average per weekday (every Saturday counts, even with no spending).
  r.get(
    '/reports/weekdays',
    ah(async (req, res) => {
      const q = schemas.weekdayQuery.parse(req.query);
      const today = localToday(req);
      const to = q.to > today ? today : q.to; // future days would only pull the averages down
      if (to < q.from) {
        res.json({ from: q.from, to, days: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, total: 0, days: 0, average: 0 })) });
        return;
      }
      const sums = await db.query(
        `SELECT EXTRACT(DOW FROM date)::int AS dow, COALESCE(SUM(amount), 0) AS total
         FROM expenses WHERE user_id = $1 AND date >= $2::date AND date <= $3::date GROUP BY 1`,
        [uid(req), q.from, to],
      );
      const totals = new Map<number, number>(sums.rows.map((x) => [x.dow as number, x.total as number]));
      // How many of each weekday the range has (calendar maths in UTC, no timezone shifts).
      const count = [0, 0, 0, 0, 0, 0, 0];
      for (let d = Date.parse(`${q.from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); d <= end; d += 86_400_000) {
        count[new Date(d).getUTCDay()] += 1;
      }
      res.json({
        from: q.from,
        to,
        days: count.map((days, dow) => {
          const total = totals.get(dow) ?? 0;
          return { dow, total, days, average: days ? Math.round(total / days) : 0 };
        }),
      });
    }),
  );

  // ---------- backup / reset ----------
  r.get(
    '/backup',
    ah(async (req, res) => {
      const data = await exportBackup(db, uid(req));
      const day = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Disposition', `attachment; filename="budget-me-${day}.json"`);
      res.json(data);
    }),
  );

  r.post(
    '/backup/restore',
    express.json({ limit: '5mb' }), // the only route that accepts a big body, and only when signed in
    ah(async (req, res) => {
      const u = uid(req);
      // Replaces everything, so it needs the password (sent next to the backup: { password, backup }).
      const b = schemas.withPassword.parse(req.body);
      await checkPassword(db, u, b.password);
      if (restoring.has(u)) throw new HttpError(429, 'A restore is already running. Wait for it to finish.', 'busy');
      restoring.add(u);
      try {
        await restoreBackup(db, u, (req.body as { backup?: unknown }).backup);
      } finally {
        restoring.delete(u);
      }
      res.json({ ok: true });
    }),
  );

  r.post(
    '/reset',
    ah(async (req, res) => {
      const u = uid(req);
      // Erases everything: confirm with the password (like deleting the account).
      await checkPassword(db, u, schemas.withPassword.parse(req.body).password);
      await db.tx(async (q) => {
        for (const t of ['trash', 'recurring_rules', 'expenses', 'incomes', 'goal_entries', 'goals', 'loan_entries', 'category_plans', 'month_budgets', 'categories']) {
          await q.query(`DELETE FROM ${t} WHERE user_id = $1`, [u]);
        }
        // Start completely blank: no template categories, the user builds their own.
      });
      res.json({ ok: true });
    }),
  );

  return r;
}
