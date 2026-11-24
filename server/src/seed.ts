import type { Queryable } from './db.js';

export const DEFAULT_CATEGORIES = ['Uni Transport & Food', 'Transportation', 'ETC', 'Hangouts'];

/**
 * 2.1.0: a new account starts with a few everyday categories (icon set, no budget), in the language
 * the sign-up screen was in, so the first expense can be logged right away. Users rename or delete them.
 */
const STARTER_CATEGORIES: Record<'en' | 'ar', [string, string][]> = {
  en: [['Food', 'food'], ['Transport', 'transport'], ['Coffee', 'coffee'], ['Going out', 'movies'], ['Phone & internet', 'phone'], ['Uni', 'uni']],
  ar: [['أكل', 'food'], ['مواصلات', 'transport'], ['قهوة', 'coffee'], ['خروجات', 'movies'], ['موبايل ونت', 'phone'], ['الجامعة', 'uni']],
};

export async function insertStarterCategories(q: Queryable, userId: number, lang: 'en' | 'ar' = 'en') {
  const list = STARTER_CATEGORIES[lang];
  for (let i = 0; i < list.length; i++) {
    await q.query('INSERT INTO categories(user_id, name, icon, sort) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [userId, list[i][0], list[i][1], i]);
  }
}

/** Inserts the default categories (the first one is the uni category). Returns their ids in order. */
export async function insertDefaultCategories(q: Queryable, userId: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
    const r = await q.query(
      'INSERT INTO categories(user_id, name, is_uni, sort) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, DEFAULT_CATEGORIES[i], i === 0, i],
    );
    ids.push(r.rows[0].id);
  }
  return ids;
}

/**
 * The agreed starting data from Student_Budget.xlsx:
 * income 2,500; uni 3 days x 4 weeks x 100; savings plan 500; loan plan 500;
 * Guitar goal 10,000 with 1,526 saved; Yaso 300 + Dad 200 borrowed, Yaso repaid 50;
 * two sample June 2026 expenses. Amounts are minor units (x100).
 */
export async function seedStartingData(q: Queryable, userId: number) {
  const [, transport, etc] = await insertDefaultCategories(q, userId);
  await q.query(
    `INSERT INTO month_budgets(user_id, month, income, uni_days, uni_weeks, uni_cost, save_plan, loan_plan)
     VALUES ($1, '2026-11', 250000, 3, 4, 10000, 50000, 50000)`,
    [userId],
  );
  await q.query(
    `INSERT INTO expenses(user_id, date, category_id, description, amount) VALUES
     ($1, '2026-06-11', $2, 'Guitar strings', 35000),
     ($1, '2026-06-11', $3, '', 2000)`,
    [userId, etc, transport],
  );
  await q.query(
    `INSERT INTO goals(user_id, name, target, start_balance, monthly, sort) VALUES ($1, 'Guitar', 1000000, 152600, 0, 0)`,
    [userId],
  );
  await q.query(
    `INSERT INTO loan_entries(user_id, date, person, direction, kind, amount, note) VALUES
     ($1, '2026-10-28', 'Yaso', 'borrowed', 'principal', 30000, ''),
     ($1, '2026-11-05', 'Dad', 'borrowed', 'principal', 20000, ''),
     ($1, '2026-11-06', 'Yaso', 'borrowed', 'repayment', 5000, '')`,
    [userId],
  );
}
