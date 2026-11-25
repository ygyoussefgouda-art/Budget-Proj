import type { Queryable } from './db.js';
import { log } from './log.js';

/**
 * 2.3.0: "how many people use the app" for the admin area. One row per account per UTC day, with
 * whether it was the Android app or a browser. Written at most once per account, day and kind per
 * server process (an in-memory note), so normal requests cost nothing extra.
 */
const noted = new Set<string>();
let notedDay = '';

export async function noteActivity(db: Queryable, userId: number, android: boolean) {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== notedDay) {
    noted.clear();
    notedDay = day;
  }
  const key = `${userId}:${android ? 'a' : 'w'}`;
  if (noted.has(key)) return;
  noted.add(key);
  try {
    await db.query(
      `INSERT INTO activity_days(user_id, day, android, web) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, day) DO UPDATE SET android = activity_days.android OR EXCLUDED.android, web = activity_days.web OR EXCLUDED.web`,
      [userId, day, android, !android],
    );
  } catch (err) {
    noted.delete(key); // try again on the next request
    log.warn({ err }, 'could not note activity');
  }
}

/** Counts for the admin area. Only totals: never who did what. */
export async function usageStats(db: Queryable) {
  const one = async (sql: string) => Number((await db.query(sql)).rows[0].n);
  const [accounts, twoFactor, new7, new30, activeToday, active7, active30] = await Promise.all([
    one('SELECT COUNT(*) AS n FROM users'),
    one('SELECT COUNT(*) AS n FROM users WHERE totp_enabled_at IS NOT NULL'),
    one(`SELECT COUNT(*) AS n FROM users WHERE created_at > now() - interval '7 days'`),
    one(`SELECT COUNT(*) AS n FROM users WHERE created_at > now() - interval '30 days'`),
    one(`SELECT COUNT(*) AS n FROM users WHERE last_active_at >= date_trunc('day', now())`),
    one(`SELECT COUNT(*) AS n FROM users WHERE last_active_at > now() - interval '7 days'`),
    one(`SELECT COUNT(*) AS n FROM users WHERE last_active_at > now() - interval '30 days'`),
  ]);
  const signups = await db.query(
    `SELECT to_char(m, 'YYYY-MM') AS month,
            (SELECT COUNT(*) FROM users u WHERE u.created_at >= m AND u.created_at < m + interval '1 month')::int AS n
     FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') AS m
     ORDER BY m`,
  );
  const daily = await db.query(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day,
            COUNT(a.user_id)::int AS users,
            COUNT(a.user_id) FILTER (WHERE a.android)::int AS android,
            COUNT(a.user_id) FILTER (WHERE a.web)::int AS web
     FROM generate_series(CURRENT_DATE - 29, CURRENT_DATE, interval '1 day') AS d
     LEFT JOIN activity_days a ON a.day = d::date
     GROUP BY d ORDER BY d`,
  );
  const clients = (
    await db.query(
      `SELECT COUNT(*) FILTER (WHERE a AND NOT w)::int AS android_only,
              COUNT(*) FILTER (WHERE w AND NOT a)::int AS web_only,
              COUNT(*) FILTER (WHERE a AND w)::int AS both
       FROM (SELECT user_id, bool_or(android) AS a, bool_or(web) AS w FROM activity_days
             WHERE day > CURRENT_DATE - 30 GROUP BY user_id) t`,
    )
  ).rows[0];
  const since = (await db.query(`SELECT to_char(MIN(day), 'YYYY-MM-DD') AS d FROM activity_days`)).rows[0].d as string | null;
  return {
    accounts: { total: accounts, twoFactor, new7, new30 },
    active: { today: activeToday, d7: active7, d30: active30 },
    signupsByMonth: signups.rows.map((r) => ({ month: r.month as string, count: r.n as number })),
    dailyActive: daily.rows.map((r) => ({ day: r.day as string, users: r.users as number, android: r.android as number, web: r.web as number })),
    clients30d: { androidOnly: clients.android_only as number, webOnly: clients.web_only as number, both: clients.both as number },
    /** The first day with daily numbers (they start when 2.3.0 was installed). */
    trackedSince: since,
  };
}
