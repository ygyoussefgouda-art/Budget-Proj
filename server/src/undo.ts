/**
 * Undo for deletes. Deleting an expense, savings entry or loan entry moves it (and its receipt)
 * into `trash` right away, so every total updates at once and no other query has to know about it.
 * "Undo" puts it back with the same id. After UNDO_SECONDS it is purged for good.
 * The app shows the Undo button for ~6 seconds; the server keeps a margin for slow connections.
 */
import { Router } from 'express';
import type { Db, Queryable, Row } from './db.js';
import { ah, HttpError } from './http.js';
import { checkReceiptRoom } from './receipts.js';
import { id as idSchema } from './validation.js';

export const UNDO_SECONDS = 120;
export type TrashKind = 'expense' | 'goal_entry' | 'loan_entry';

const TABLE: Record<TrashKind, string> = { expense: 'expenses', goal_entry: 'goal_entries', loan_entry: 'loan_entries' };
const COLUMNS: Record<TrashKind, string[]> = {
  expense: ['id', 'user_id', 'date', 'category_id', 'description', 'amount', 'created_at', 'tags', 'orig_amount', 'orig_currency', 'fx_rate', 'client_id'],
  goal_entry: ['id', 'user_id', 'goal_id', 'date', 'type', 'amount', 'note', 'created_at'],
  loan_entry: ['id', 'user_id', 'date', 'person', 'direction', 'kind', 'amount', 'note', 'created_at', 'expense_id'],
};

const pick = (kind: TrashKind, row: Row) => Object.fromEntries(COLUMNS[kind].filter((c) => c in row).map((c) => [c, row[c]]));

async function insertRow(q: Queryable, kind: TrashKind, item: Row) {
  const cols = COLUMNS[kind].filter((c) => c in item);
  await q.query(
    `INSERT INTO ${TABLE[kind]}(${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    cols.map((c) => item[c]),
  );
}

/** Moves one row (already checked to belong to `u`) into the trash. Returns the undo id. */
export async function moveToTrash(q: Queryable, u: number, kind: TrashKind, row: Row): Promise<number> {
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
