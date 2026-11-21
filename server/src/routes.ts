import express, { Router } from 'express';
import { z } from 'zod';
import type { Db, Queryable } from './db.js';
import { ah, ConfirmNeeded, forced, HttpError } from './http.js';
import {
  ensureMonth,
  goalsWithBalance,
  HAS_RECEIPT,
  inMonth,
  loadBudget,
  mapCategory,
  mapExpense,
  mapGoalEntry,
  mapLoan,
  recentActivity,
} from './repo.js';
import { exportBackup, restoreBackup } from './backup.js';
import { id as idSchema, monthStr, schemas } from './validation.js';

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

  /** Generous per-account caps so one account cannot grow the database without bound. */
  const LIMITS = { categories: 200, goals: 200, expenses: 50_000, goal_entries: 50_000, loan_entries: 20_000 } as const;
  const underLimit = async (q: Queryable, table: keyof typeof LIMITS, u: number) => {
    const n = (await q.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE user_id = $1`, [u])).rows[0].n as number;
    if (n >= LIMITS[table]) throw new HttpError(409, 'You have reached the limit for this kind of item.', 'limit');
  };

  // ---------- profile / settings ----------
  r.get('/auth/me', (req, res) => {
    res.json({ user: req.user });
  });

  r.put(
    '/settings',
    ah(async (req, res) => {
      const s = schemas.settings.parse(req.body);
      const user = { ...req.user!, ...(s.currency ? { currency: s.currency } : {}), ...(s.monthStartDay ? { monthStartDay: s.monthStartDay } : {}) };
      await db.query('UPDATE users SET currency = $1, month_start_day = $2 WHERE id = $3', [
        user.currency,
        user.monthStartDay,
        uid(req),
      ]);
      res.json({ user });
    }),
  );

  // ---------- everything a month screen needs, in one round trip ----------
  r.get(
    '/state',
    ah(async (req, res) => {
      const month = monthStr.parse(req.query.month);
      const u = uid(req);
      await db.tx((q) => ensureMonth(q, u, month));
      const [budget, cats, expenses, goals, entries, loans, recent, earlier] = await Promise.all([
        loadBudget(db, u, month),
        db.query('SELECT * FROM categories WHERE user_id = $1 ORDER BY sort, id', [u]),
        db.query(
          `SELECT e.*, ${HAS_RECEIPT} FROM expenses e WHERE e.user_id = $1 AND ${inMonth('e.date', '$2', '$3')} ORDER BY e.date DESC, e.id DESC`,
          [u, month, req.user!.monthStartDay],
        ),
        goalsWithBalance(db, u),
        db.query('SELECT * FROM goal_entries WHERE user_id = $1 ORDER BY date, id', [u]),
        db.query('SELECT * FROM loan_entries WHERE user_id = $1 ORDER BY date, id', [u]),
        recentActivity(db, u, 6),
        db.query('SELECT 1 FROM month_budgets WHERE user_id = $1 AND month < $2 LIMIT 1', [u, month]),
      ]);
      res.json({
        month,
        budget,
        categories: cats.rows.map(mapCategory),
        expenses: expenses.rows.map(mapExpense),
        goals,
        goalEntries: entries.rows.map(mapGoalEntry),
        loans: loans.rows.map(mapLoan),
        recent,
        hasEarlierMonth: earlier.rows.length > 0,
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
      await db.tx(async (q) => {
        const prev = await q.query('SELECT 1 FROM month_budgets WHERE user_id = $1 AND month < $2 LIMIT 1', [u, month]);
        if (!prev.rows.length) throw new HttpError(400, 'There is no earlier month to copy from.');
        await q.query('DELETE FROM category_plans WHERE user_id = $1 AND month = $2', [u, month]);
        await q.query('DELETE FROM month_budgets WHERE user_id = $1 AND month = $2', [u, month]);
        await ensureMonth(q, u, month);
      });
      res.json({ ok: true });
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
          `INSERT INTO categories(user_id, name, is_uni, sort)
           VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort), -1) + 1 FROM categories WHERE user_id = $1)) RETURNING *`,
          [u, c.name, c.perDay],
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
      const where = ['e.user_id = $1'];
      const params: unknown[] = [uid(req)];
      const add = (sql: string, v: unknown) => {
        params.push(v);
        where.push(sql.replace('?', `$${params.length}`));
      };
      if (f.from) add('e.date >= ?::date', f.from);
      if (f.to) add('e.date <= ?::date', f.to);
      if (f.categoryId) add('e.category_id = ?', f.categoryId);
      if (f.q) add(`(e.description ILIKE ? OR c.name ILIKE $${params.length + 1})`, `%${f.q.replace(/[\\%_]/g, '\\$&')}%`);
      const w = where.join(' AND ');
      const totals = await db.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(e.amount), 0) AS total
         FROM expenses e JOIN categories c ON c.id = e.category_id WHERE ${w}`,
        params,
      );
      const items = await db.query(
        `SELECT e.*, c.name AS category_name, ${HAS_RECEIPT} FROM expenses e JOIN categories c ON c.id = e.category_id
         WHERE ${w} ORDER BY e.date DESC, e.id DESC LIMIT ${f.limit} OFFSET ${f.offset}`,
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
      const row = await db.tx(async (q) => {
        const cat = await q.query('SELECT 1 FROM categories WHERE id = $1 AND user_id = $2', [e.categoryId, u]);
        if (!cat.rows.length) throw new HttpError(400, 'Pick a valid category.');
        if (!forced(req)) {
          const dup = await q.query(
            `SELECT 1 FROM expenses WHERE user_id = $1 AND id <> $2 AND date = $3 AND category_id = $4 AND amount = $5
             AND lower(trim(description)) = lower(trim($6)) LIMIT 1`,
            [u, id, e.date, e.categoryId, e.amount, e.description],
          );
          if (dup.rows.length) throw new ConfirmNeeded('An identical expense already exists. Save it anyway?');
        }
        if (mode === 'create') {
          await underLimit(q, 'expenses', u);
          return (
            await q.query(
              `INSERT INTO expenses(user_id, date, category_id, description, amount) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
              [u, e.date, e.categoryId, e.description, e.amount],
            )
          ).rows[0];
        }
        const up = await q.query(
          `UPDATE expenses SET date = $3, category_id = $4, description = $5, amount = $6
           WHERE id = $1 AND user_id = $2 RETURNING *`,
          [id, u, e.date, e.categoryId, e.description, e.amount],
        );
        if (!up.rows.length) throw new HttpError(404, 'Expense not found.');
        return up.rows[0];
      });
      res.status(mode === 'create' ? 201 : 200).json(mapExpense(row));
    });

  r.post('/expenses', saveExpense('create'));
  r.put('/expenses/:id', saveExpense('update'));
  r.delete(
    '/expenses/:id',
    ah(async (req, res) => {
      const d = await db.query('DELETE FROM expenses WHERE id = $1 AND user_id = $2', [pid(req.params.id), uid(req)]);
      if (!d.rowCount) throw new HttpError(404, 'Expense not found.');
      res.status(204).end();
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
      const d = await db.query('DELETE FROM goals WHERE id = $1 AND user_id = $2', [pid(req.params.id), uid(req)]);
      if (!d.rowCount) throw new HttpError(404, 'Goal not found.');
      res.status(204).end();
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
      await db.tx(async (q) => {
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
        await q.query('DELETE FROM goal_entries WHERE id = $1', [id]);
      });
      res.status(204).end();
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

  r.post('/loans', saveLoan('create'));
  r.put('/loans/:id', saveLoan('update'));
  r.delete(
    '/loans/:id',
    ah(async (req, res) => {
      const d = await db.query('DELETE FROM loan_entries WHERE id = $1 AND user_id = $2', [pid(req.params.id), uid(req)]);
      if (!d.rowCount) throw new HttpError(404, 'Entry not found.');
      res.status(204).end();
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
      const d = await db.query(
        `DELETE FROM loan_entries WHERE user_id = $1 AND direction = $2 AND lower(trim(person)) = lower(trim($3))`,
        [uid(req), p.borrowed ? 'borrowed' : 'lent', p.name],
      );
      if (!d.rowCount) throw new HttpError(404, 'Person not found.');
      res.status(204).end();
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
           COALESCE(mb.income, 0) AS income,
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
      if (restoring.has(u)) throw new HttpError(429, 'A restore is already running. Wait for it to finish.', 'busy');
      restoring.add(u);
      try {
        await restoreBackup(db, u, req.body);
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
      await db.tx(async (q) => {
        for (const t of ['expenses', 'goal_entries', 'goals', 'loan_entries', 'category_plans', 'month_budgets', 'categories']) {
          await q.query(`DELETE FROM ${t} WHERE user_id = $1`, [u]);
        }
        // Start completely blank: no template categories, the user builds their own.
      });
      res.json({ ok: true });
    }),
  );

  return r;
}
