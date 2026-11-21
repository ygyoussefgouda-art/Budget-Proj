import express, { Router } from 'express';
import type { Db } from './db.js';
import { ah, HttpError } from './http.js';
import { id as idSchema } from './validation.js';

export const RECEIPT_MAX_BYTES = 6 * 1024 * 1024;
/** Total receipt storage per account. RECEIPT_QUOTA_MB (default 200). */
const quotaBytes = () => (Number(process.env.RECEIPT_QUOTA_MB) > 0 ? Number(process.env.RECEIPT_QUOTA_MB) : 200) * 1024 * 1024;

/** Detects the real file type from its first bytes (never trusts the client's Content-Type). */
export function sniffReceipt(buf: Uint8Array): string | null {
  const b = (i: number) => buf[i];
  if (buf.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png';
  if (
    buf.length >= 12 &&
    String.fromCharCode(b(0), b(1), b(2), b(3)) === 'RIFF' &&
    String.fromCharCode(b(8), b(9), b(10), b(11)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buf.length >= 5 && String.fromCharCode(b(0), b(1), b(2), b(3), b(4)) === '%PDF-') return 'application/pdf';
  return null;
}

/** Upload, view and remove the receipt of an expense the signed-in user owns. */
export function receiptRoutes(db: Db): Router {
  const r = Router();
  const uid = (req: { user?: { id: number } }) => req.user!.id;

  const ownExpense = async (userId: number, expenseId: number) => {
    const e = await db.query('SELECT 1 FROM expenses WHERE id = $1 AND user_id = $2', [expenseId, userId]);
    if (!e.rows.length) throw new HttpError(404, 'Expense not found.');
  };

  r.put(
    '/expenses/:id/receipt',
    express.raw({ type: () => true, limit: RECEIPT_MAX_BYTES }),
    ah(async (req, res) => {
      const expenseId = idSchema.parse(req.params.id);
      const u = uid(req);
      await ownExpense(u, expenseId);
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, 'The file is empty.');
      const mime = sniffReceipt(body);
      if (!mime) throw new HttpError(415, 'Receipts must be a photo (JPEG, PNG, WebP) or a PDF.', 'bad_file_type');
      // Storage quota per account (other receipts + this one).
      const used = (
        await db.query('SELECT COALESCE(SUM(size), 0) AS used FROM receipts WHERE user_id = $1 AND expense_id <> $2', [u, expenseId])
      ).rows[0].used as number;
      if (used + body.length > quotaBytes()) {
        throw new HttpError(413, 'Your receipt storage is full. Remove some old receipts first.', 'quota');
      }
      await db.query(
        `INSERT INTO receipts(expense_id, user_id, mime, size, data) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (expense_id) DO UPDATE SET mime = EXCLUDED.mime, size = EXCLUDED.size, data = EXCLUDED.data, created_at = now()`,
        [expenseId, u, mime, body.length, body],
      );
      res.json({ ok: true, mime, size: body.length });
    }),
  );

  r.get(
    '/expenses/:id/receipt',
    ah(async (req, res) => {
      const expenseId = idSchema.parse(req.params.id);
      const row = (
        await db.query('SELECT mime, data FROM receipts WHERE expense_id = $1 AND user_id = $2', [expenseId, uid(req)])
      ).rows[0];
      if (!row) throw new HttpError(404, 'This expense has no receipt.');
      const data = Buffer.from(row.data as Uint8Array);
      const pdf = row.mime === 'application/pdf';
      res.setHeader('Content-Type', row.mime);
      res.setHeader('Content-Length', String(data.length));
      res.setHeader('Cache-Control', 'no-store'); // not left behind on shared devices after sign-out
      // Opened on its own, a receipt can never run scripts or reach the app (sandboxed, no sub-resources).
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
      const ext = pdf ? 'pdf' : row.mime.split('/')[1];
      // Photos show in the app; PDFs are downloaded and opened by the phone's own viewer.
      res.setHeader('Content-Disposition', `${pdf ? 'attachment' : 'inline'}; filename="receipt-${expenseId}.${ext}"`);
      res.end(data);
    }),
  );

  r.delete(
    '/expenses/:id/receipt',
    ah(async (req, res) => {
      const expenseId = idSchema.parse(req.params.id);
      const d = await db.query('DELETE FROM receipts WHERE expense_id = $1 AND user_id = $2', [expenseId, uid(req)]);
      if (!d.rowCount) throw new HttpError(404, 'This expense has no receipt.');
      res.status(204).end();
    }),
  );

  return r;
}
