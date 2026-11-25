/**
 * Undo for deletes. Deleting an expense, savings entry, loan entry, whole savings goal (with its
 * entries) or person in Loans (all their entries) moves it (and any receipt)
 * into `trash` right away, so every total updates at once and no other query has to know about it.
 * "Undo" puts it back with the same id. After UNDO_SECONDS it is purged for good.
 * The app shows the Undo button for ~6 seconds; the server keeps a margin for slow connections.
 */
import { Router } from 'express';
import type { Db, Queryable, Row } from './db.js';
import { ah, HttpError } from './http.js';
import { underLimit } from './limits.js';
import { checkReceiptRoom } from './receipts.js';
import { id as idSchema } from './validation.js';

export const UNDO_SECONDS = 120;
/** One row, or a group: a goal with its entries, or every loan entry of one person. */
export type TrashKind = 'expense' | 'goal_entry' | 'loan_entry' | 'goal' | 'loan_person' | 'income';
type RowKind = 'expense' | 'goal_entry' | 'loan_entry' | 'goal' | 'income';

const TABLE: Record<RowKind, string> = { expense: 'expenses', goal_entry: 'goal_entries', loan_entry: 'loan_entries', goal: 'goals', income: 'incomes' };
const COLUMNS: Record<RowKind, string[]> = {
  expense: ['id', 'user_id', 'date', 'category_id', 'description', 'amount', 'created_at', 'tags', 'orig_amount', 'orig_currency', 'fx_rate', 'client_id', 'time_of_day'],
  income: ['id', 'user_id', 'date', 'description', 'amount', 'created_at'],
  goal_entry: ['id', 'user_id', 'goal_id', 'date', 'type', 'amount', 'note', 'created_at'],
  loan_entry: ['id', 'user_id', 'date', 'person', 'direction', 'kind', 'amount', 'note', 'created_at', 'expense_id'],
  goal: ['id', 'user_id', 'name', 'target', 'start_balance', 'monthly', 'sort'],
};

const pick = (kind: RowKind, row: Row) => Object.fromEntries(COLUMNS[kind].filter((c) => c in row).map((c) => [c, row[c]]));

async function insertRow(q: Queryable, kind: RowKind, item: Row) {
  const cols = COLUMNS[kind].filter((c) => c in item);
  await q.query(
    `INSERT INTO ${TABLE[kind]}(${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    cols.map((c) => item[c]),
  );
}

const addTrash = async (q: Queryable, u: number, kind: TrashKind, item: Row) =>
  (await q.query(`INSERT INTO trash(user_id, kind, item) VALUES ($1, $2, $3) RETURNING id`, [u, kind, JSON.stringify(item)])).rows[0].id as number;

/** Moves a savings goal and all its entries (already checked to belong to `u`) into the trash. */
export async function trashGoal(q: Queryable, u: number, goal: Row): Promise<number> {
  const entries = (await q.query('SELECT * FROM goal_entries WHERE goal_id = $1 AND user_id = $2 ORDER BY id', [goal.id, u])).rows;
  const id = await addTrash(q, u, 'goal', { ...pick('goal', goal), entries: entries.map((e) => pick('goal_entry', e)) });
  await q.query('DELETE FROM goals WHERE id = $1 AND user_id = $2', [goal.id, u]); // entries go with it (cascade)
  return id;
}

/** Moves every loan entry of one person (rows already checked to belong to `u`) into the trash. */
export async function trashLoanPerson(q: Queryable, u: number, rows: Row[]): Promise<number> {
  const id = await addTrash(q, u, 'loan_person', { user_id: u, entries: rows.map((r) => pick('loan_entry', r)) });
  await q.query('DELETE FROM loan_entries WHERE user_id = $1 AND id = ANY($2::bigint[])', [u, rows.map((r) => r.id)]);
  return id;
}

/** Moves one row (already checked to belong to `u`) into the trash. Returns the undo id. */
export async function moveToTrash(q: Queryable, u: number, kind: 'expense' | 'goal_entry' | 'loan_entry' | 'income', row: Row): Promise<number> {
  let receipt: Row | undefined;
  const item: Row = pick(kind, row);
  if (kind === 'expense') {
    receipt = (await q.query('SELECT mime, data FROM receipts WHERE expense_id = $1', [row.id])).rows[0];
    // A split expense takes its "Owed to me" entry with it (and Undo brings both back).
    const loan = (await q.query('SELECT * FROM loan_entries WHERE expense_id = $1', [row.id])).rows[0];
    if (loan) item.linked_loan = pick('loan_entry', loan);
  }
  const t = await q.query(
    `INSERT INTO trash(user_id, kind, item, receipt_mime, receipt_data) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [u, kind, JSON.stringify(item), receipt?.mime ?? null, receipt ? Buffer.from(receipt.data as Uint8Array) : null],
  );
  await q.query(`DELETE FROM ${TABLE[kind]} WHERE id = $1 AND user_id = $2`, [row.id, u]); // receipt goes with it (cascade)
  return t.rows[0].id as number;
}

/** Deletes trash older than the undo window (for one account, or everyone). */
export async function purgeTrash(db: Queryable, userId?: number) {
  if (userId === undefined) {
    await db.query(`DELETE FROM trash WHERE deleted_at < now() - make_interval(secs => $1)`, [UNDO_SECONDS]);
  } else {
    await db.query(`DELETE FROM trash WHERE user_id = $1 AND deleted_at < now() - make_interval(secs => $2)`, [userId, UNDO_SECONDS]);
  }
}

/**
 * Regular clean-up (every few minutes): expired Undo items, sessions and reset codes, and admin
 * activity older than `AUDIT_KEEP_DAYS` (default 365), so these tables don't grow forever.
 */
export async function housekeeping(db: Queryable, auditKeepDays = 365) {
  await purgeTrash(db);
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  await db.query(`DELETE FROM password_resets WHERE expires_at < now() - interval '1 day' OR used_at < now() - interval '30 days'`);
  await db.query('DELETE FROM audit_log WHERE created_at < now() - make_interval(days => $1)', [auditKeepDays]);
  // 2.3.0: daily usage counts for the admin area are kept about 13 months.
  await db.query(`DELETE FROM activity_days WHERE day < CURRENT_DATE - 400`);
}

const gone = () => new HttpError(410, 'Too late to undo.', 'undo_expired');

export function undoRoutes(db: Db): Router {
  const r = Router();

  r.post(
    '/undo/:id',
    ah(async (req, res) => {
      const trashId = idSchema.parse(req.params.id);
      const u = req.user!.id;
      const kind = await db.tx(async (q) => {
        // Take it out of the trash first: a second Undo tap finds nothing. Any failure below rolls this back.
        const t = (
          await q.query(
            `DELETE FROM trash WHERE id = $1 AND user_id = $2 AND deleted_at > now() - make_interval(secs => $3) RETURNING *`,
            [trashId, u, UNDO_SECONDS],
          )
        ).rows[0];
        if (!t) throw gone();
        const kind = t.kind as TrashKind;
        const item = (typeof t.item === 'string' ? JSON.parse(t.item) : t.item) as Row;
        if (Number(item.user_id) !== u) throw gone();

        if (kind === 'expense') {
          const c = await q.query('SELECT 1 FROM categories WHERE id = $1 AND user_id = $2', [item.category_id, u]);
          if (!c.rows.length) throw new HttpError(409, 'Its category was removed, so it cannot be brought back.');
        }
        if (kind === 'goal_entry') {
          const g = await q.query('SELECT start_balance FROM goals WHERE id = $1 AND user_id = $2 FOR UPDATE', [item.goal_id, u]);
          if (!g.rows.length) throw new HttpError(409, 'Its savings goal was deleted, so it cannot be brought back.');
          if (item.type === 'withdrawal') {
            const s = await q.query(
              `SELECT COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE -amount END), 0) AS net FROM goal_entries WHERE goal_id = $1`,
              [item.goal_id],
            );
            if ((g.rows[0].start_balance as number) + (s.rows[0].net as number) - Number(item.amount) < 0) {
              throw new HttpError(409, 'Bringing this withdrawal back would make the balance negative.');
            }
          }
        }
        if (kind === 'income') await underLimit(q, 'incomes', u);
        if (kind === 'goal') {
          await underLimit(q, 'goals', u);
          const entries = (item.entries as Row[] | undefined) ?? [];
          delete item.entries;
          await insertRow(q, 'goal', item);
          for (const e of entries) await insertRow(q, 'goal_entry', e);
          return kind;
        }
        if (kind === 'loan_person') {
          for (const e of (item.entries as Row[] | undefined) ?? []) {
            if (Number(e.user_id) !== u) throw gone();
            await insertRow(q, 'loan_entry', { ...e, expense_id: null }); // split-expense entries can't be deleted this way
          }
          return kind;
        }
        if (kind === 'loan_entry' && item.expense_id) {
          // Re-link to its split expense only if that expense is still there and not linked again.
          const ok = await q.query(
            `SELECT 1 FROM expenses e WHERE e.id = $1 AND e.user_id = $2 AND NOT EXISTS (SELECT 1 FROM loan_entries l WHERE l.expense_id = e.id)`,
            [item.expense_id, u],
          );
          if (!ok.rows.length) item.expense_id = null;
        }
        await insertRow(q, kind, item);
        if (kind === 'expense' && item.linked_loan) await insertRow(q, 'loan_entry', item.linked_loan as Row);
        if (kind === 'expense' && t.receipt_data) {
          const data = Buffer.from(t.receipt_data as Uint8Array);
          await checkReceiptRoom(q, u, data.length); // the trash row is already gone, so it isn't counted twice
          await q.query('INSERT INTO receipts(expense_id, user_id, mime, size, data) VALUES ($1, $2, $3, $4, $5)', [
            item.id,
            u,
            t.receipt_mime,
            data.length,
            data,
          ]);
        }
        return kind;
      });
      res.json({ ok: true, kind });
    }),
  );

  return r;
}
