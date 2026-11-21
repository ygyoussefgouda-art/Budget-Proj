/** Download expenses, loans or savings entries as CSV or Excel (.xlsx), for a date range. */
import { Router } from 'express';
import type { Db } from './db.js';
import { ah } from './http.js';
import { expenseWhere } from './repo.js';
import { schemas } from './validation.js';
import { csv, xlsx, type Cell } from './xlsx.js';

type Lang = 'en' | 'ar';
const WORDS: Record<Lang, Record<string, string>> = {
  en: {
    Date: 'Date', Category: 'Category', Description: 'Description', Amount: 'Amount', Currency: 'Currency', Tags: 'Tags',
    'Split with': 'Split with', 'Their share': 'Their share', 'Original amount': 'Original amount',
    'Original currency': 'Original currency', Rate: 'Rate', Person: 'Person', Side: 'Side', Type: 'Type', Note: 'Note',
    Goal: 'Goal', 'I owe': 'I owe', 'Owed to me': 'Owed to me', Borrowed: 'Borrowed', 'I paid back': 'I paid back',
    Lent: 'Lent', 'Paid me back': 'Paid me back', Deposit: 'Deposit', Withdrawal: 'Withdrawal',
    expenses: 'Expenses', loans: 'Loans', savings: 'Savings',
  },
  ar: {
    Date: 'التاريخ', Category: 'الفئة', Description: 'الوصف', Amount: 'المبلغ', Currency: 'العملة', Tags: 'الوسوم',
    'Split with': 'مقسوم مع', 'Their share': 'نصيبه', 'Original amount': 'المبلغ الأصلي', 'Original currency': 'العملة الأصلية',
    Rate: 'سعر الصرف', Person: 'الشخص', Side: 'الجهة', Type: 'النوع', Note: 'ملاحظة', Goal: 'الهدف',
    'I owe': 'عليّا', 'Owed to me': 'ليّا', Borrowed: 'استلفت', 'I paid back': 'سدّدت', Lent: 'سلّفت', 'Paid me back': 'رجّعلي',
    Deposit: 'إيداع', Withdrawal: 'سحب', expenses: 'المصاريف', loans: 'السلف', savings: 'التحويش',
  },
};

/** Money in minor units → a plain number (12.5), so spreadsheets can add it up. */
const money = (minor: number | null) => (minor === null || minor === undefined ? null : minor / 100);

export function exportRoutes(db: Db): Router {
  const r = Router();

  r.get(
    '/export',
    ah(async (req, res) => {
      const f = schemas.exportQuery.parse(req.query);
      const u = req.user!.id;
      const cur = req.user!.currency;
      const w = (k: string) => WORDS[f.lang][k] ?? k;
      const range = (col: string, params: unknown[]) => {
        const parts: string[] = [];
        if (f.from) parts.push(`${col} >= $${params.push(f.from)}::date`);
        if (f.to) parts.push(`${col} <= $${params.push(f.to)}::date`);
        return parts.map((p) => ` AND ${p}`).join('');
      };

      let rows: Cell[][];
      if (f.kind === 'expenses') {
        const { where, params } = expenseWhere(u, f);
        const list = await db.query(
          `SELECT e.date, c.name AS category, e.description, e.amount, e.tags, sl.person AS split_person, sl.amount AS split_share,
                  e.orig_amount, e.orig_currency, e.fx_rate
           FROM expenses e JOIN categories c ON c.id = e.category_id LEFT JOIN loan_entries sl ON sl.expense_id = e.id
           WHERE ${where} ORDER BY e.date, e.id`,
          params,
        );
        rows = [
          ['Date', 'Category', 'Description', 'Amount', 'Currency', 'Tags', 'Split with', 'Their share', 'Original amount', 'Original currency', 'Rate'].map(w),
          ...list.rows.map((x): Cell[] => [
            x.date,
            x.category,
            x.description,
            money(x.amount),
            cur,
            (x.tags as string[]).map((t) => `#${t}`).join(' '),
            x.split_person ?? null,
            money(x.split_share ?? null),
            money(x.orig_amount ?? null),
            x.orig_currency ?? null,
            x.fx_rate === null || x.fx_rate === undefined ? null : Number(x.fx_rate),
          ]),
        ];
      } else if (f.kind === 'loans') {
        const params: unknown[] = [u];
        const where = range('date', params);
        const list = await db.query(`SELECT * FROM loan_entries WHERE user_id = $1${where} ORDER BY date, id`, params);
        rows = [
          ['Date', 'Person', 'Side', 'Type', 'Amount', 'Currency', 'Note'].map(w),
          ...list.rows.map((x): Cell[] => {
            const borrowed = x.direction === 'borrowed';
            const repay = x.kind === 'repayment';
            const type = borrowed ? (repay ? 'I paid back' : 'Borrowed') : repay ? 'Paid me back' : 'Lent';
            return [x.date, x.person, w(borrowed ? 'I owe' : 'Owed to me'), w(type), money(x.amount), cur, x.note];
          }),
        ];
      } else {
        const params: unknown[] = [u];
        const where = range('ge.date', params);
        const list = await db.query(
          `SELECT ge.*, g.name AS goal FROM goal_entries ge JOIN goals g ON g.id = ge.goal_id
           WHERE ge.user_id = $1${where} ORDER BY ge.date, ge.id`,
          params,
        );
        rows = [
          ['Date', 'Goal', 'Type', 'Amount', 'Currency', 'Note'].map(w),
          ...list.rows.map((x): Cell[] => [x.date, x.goal, w(x.type === 'deposit' ? 'Deposit' : 'Withdrawal'), money(x.amount), cur, x.note]),
        ];
      }

      const name = `budget-me-${f.kind}${f.from ? `-${f.from}` : ''}${f.to ? `-to-${f.to}` : ''}.${f.format}`;
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      if (f.format === 'csv') {
        res.type('text/csv; charset=utf-8').send(csv(rows));
      } else {
        res
          .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .send(xlsx(w(f.kind), rows, { rightToLeft: f.lang === 'ar' }));
      }
    }),
  );

  // Reports: spending per tag in a date range. An expense with two tags counts under both.
  r.get(
    '/reports/tags',
    ah(async (req, res) => {
      const q = schemas.rangeQuery.parse(req.query);
      const u = req.user!.id;
      const [tags, all] = await Promise.all([
        db.query(
          `SELECT t AS tag, COALESCE(SUM(amount), 0) AS total, COUNT(*)::int AS n
           FROM expenses, unnest(tags) AS t WHERE user_id = $1 AND date >= $2::date AND date <= $3::date
           GROUP BY t ORDER BY total DESC, t LIMIT 50`,
          [u, q.from, q.to],
        ),
        db.query(
          `SELECT COALESCE(SUM(amount), 0) AS total, COALESCE(SUM(amount) FILTER (WHERE cardinality(tags) = 0), 0) AS untagged
           FROM expenses WHERE user_id = $1 AND date >= $2::date AND date <= $3::date`,
          [u, q.from, q.to],
        ),
      ]);
      res.json({
        from: q.from,
        to: q.to,
        tags: tags.rows.map((x) => ({ tag: x.tag, total: x.total, count: x.n })),
        total: all.rows[0].total,
        untagged: all.rows[0].untagged,
      });
    }),
  );

  return r;
}
