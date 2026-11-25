/** Pure calculations. They mirror the formulas of Student_Budget.xlsx. */

export interface Category { id: number; name: string; isUni: boolean; sort: number; icon?: string | null; color?: string | null }
export interface Expense {
  id: number;
  date: string;
  categoryId: number;
  description: string;
  amount: number;
  categoryName?: string;
  /** A receipt photo/PDF is attached. */
  hasReceipt?: boolean;
  /** Lower-case, without '#'. */
  tags?: string[];
  /** Split with someone: their share is a linked "Owed to me" loan entry; `amount` is my share. */
  split?: { loanId: number; person: string; share: number } | null;
  /** Paid in another currency: original amount (minor units), code and the rate used. */
  foreign?: { amount: number; currency: string; rate: number } | null;
  /** 2.2.0: time of day "HH:MM" on the phone's clock (null on older expenses). */
  time?: string | null;
}
/** 2.2.0: extra (variable) income on top of the month's fixed income. */
export interface Income { id: number; date: string; amount: number; description: string }
export interface MonthBudget {
  month: string;
  income: number;
  uniDays: number;
  uniWeeks: number;
  uniCost: number;
  savePlan: number;
  loanPlan: number;
  plans: Record<string, number>;
}
export interface Goal { id: number; name: string; target: number; start: number; monthly: number; sort: number; balance?: number }
export interface GoalEntry { id: number; goalId: number; date: string; deposit: boolean; amount: number; note: string }
export interface LoanEntry {
  id: number;
  date: string;
  person: string;
  borrowed: boolean;
  repayment: boolean;
  amount: number;
  note: string;
  /** Created by splitting this expense. */
  expenseId?: number | null;
}

/** Same rounding as the server: converted amount in the account currency. */
export const convert = (amount: number, rate: number) => Math.round(amount * rate);

/**
 * What I pay and what the other person owes for a bill of `total` (minor units).
 * Even split: they owe half rounded down, I keep the odd piastre.
 */
export function splitShares(total: number, mode: 'even' | 'share', theirs: number) {
  const their = mode === 'even' ? Math.floor(total / 2) : theirs;
  return { mine: total - their, their };
}

/** "#Trip, friends  #سفر" → ['trip', 'friends', 'سفر'] (same rules as the server, max 5). */
export function parseTags(text: string): { tags: string[]; bad: string | null } {
  const parts = text
    .split(/[\s,،]+/)
    .map((s) => s.replace(/^#+/, '').toLowerCase())
    .filter(Boolean);
  const bad = parts.find((p) => !/^[\p{L}\p{N}_-]{1,30}$/u.test(p)) ?? null;
  return { tags: [...new Set(parts)], bad };
}
export interface Txn { date: string; id: number; kind: string; title: string; sub: string; amount: number; time?: string | null }
/** "Every month on day N" expense. */
export interface RecurringRule {
  id: number;
  categoryId: number;
  amount: number;
  description: string;
  day: number;
  startDate: string;
  endDate: string | null;
  autoAdd: boolean;
  paused: boolean;
  /** Oldest occurrence waiting for Add/Skip, else the next one to come (null when paused/ended). */
  nextDate: string | null;
}
/** One occurrence of a recurring expense waiting for Add / Skip. */
export interface DueItem { ruleId: number; date: string; amount: number; categoryId: number; description: string }

export interface BudgetRow {
  catId: number | null; // null for the Savings / Loan repayment rows
  name: string;
  /** This month's budget, including `carried`. */
  planned: number;
  actual: number;
  isGoal: boolean;
  /** Budget rollover: unspent budget carried in from earlier months (part of `planned`). */
  carried?: number;
}

export const rowLeft = (r: BudgetRow) => r.planned - r.actual;
export const rowBar = (r: BudgetRow) =>
  r.planned === 0 ? (r.actual > 0 && !r.isGoal ? 1 : 0) : Math.min(1, Math.max(0, r.actual / r.planned));
export const rowOver = (r: BudgetRow) => !r.isGoal && r.actual > r.planned;
/** A savings/loan plan reached. Nothing planned is not a goal met (a new account would show false success). */
export const rowMet = (r: BudgetRow) => r.isGoal && r.planned > 0 && r.actual >= r.planned;
/** No plan and nothing spent or saved yet: neutral, neither "OK" nor "Goal met". */
export const rowUnplanned = (r: BudgetRow) => r.planned === 0 && r.actual === 0;

/**
 * Budget alert for a spending category: 'warn' from 80% of its budget, 'full' at exactly 100%,
 * 'over' above it (or any spending in a category with no budget). Null for savings/loan rows.
 */
export type AlertLevel = 'warn' | 'full' | 'over';
export function alertLevel(r: BudgetRow): AlertLevel | null {
  if (r.isGoal || r.catId === null) return null;
  if (r.actual > r.planned) return 'over';
  if (r.planned > 0 && r.actual >= r.planned) return 'full';
  if (r.planned > 0 && r.actual >= r.planned * 0.8) return 'warn';
  return null;
}
export const rowStatus = (r: BudgetRow) => {
  if (rowUnplanned(r)) return 'No plan';
  if (r.isGoal) return r.planned === 0 ? 'Done' : rowMet(r) ? 'Goal met' : 'Behind';
  const a = alertLevel(r);
  return a === 'over' ? 'Over budget' : a === 'full' ? 'Used up' : a === 'warn' ? 'Almost used up' : 'OK';
};

export interface BudgetAlert {
  catId: number;
  name: string;
  level: AlertLevel;
  /** Share of the budget used, in % (null when the category has no budget). */
  pct: number | null;
  /** How much over budget (0 unless level is 'over'). */
  over: number;
}

/** Categories at 80% of their budget or more, worst first: over budget, used up, then almost used up. */
export function budgetAlerts(rows: BudgetRow[]): BudgetAlert[] {
  const rank: Record<AlertLevel, number> = { over: 0, full: 1, warn: 2 };
  return rows
    .flatMap((r) => {
      const level = alertLevel(r);
      if (!level || r.catId === null) return [];
      return [{ catId: r.catId, name: r.name, level, pct: r.planned > 0 ? Math.floor((r.actual / r.planned) * 100) : null, over: Math.max(0, r.actual - r.planned) }];
    })
    .sort((a, b) => rank[a.level] - rank[b.level] || b.over - a.over || (b.pct ?? 0) - (a.pct ?? 0));
}

/** Workbook: uni days per month = days x weeks; cost = that x cost per day. */
export const uniMonthly = (b: MonthBudget) => Math.round(b.uniDays * b.uniWeeks * b.uniCost);

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The dates covered by budget month `month` ('YYYY-MM') when the month starts on
 * `startDay` (the day you get your money): from day `startDay` of that month up to,
 * but not including, day `startDay` of the next month.
 */
export function periodRange(month: string, startDay = 1) {
  const [y, m] = month.split('-').map(Number);
  const from = new Date(y, m - 1, startDay);
  const to = new Date(y, m, startDay); // exclusive
  const last = new Date(y, m, startDay - 1); // inclusive end
  return { from: iso(from), to: iso(to), last: iso(last) };
}

/** Budget month that contains `date`. */
export function monthOf(date: string, startDay = 1) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1 - (d < startDay ? 1 : 0), 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

export const inMonth = (date: string, month: string, startDay = 1) => {
  if (startDay === 1) return date.startsWith(month);
  const r = periodRange(month, startDay);
  return date >= r.from && date < r.to;
};

export interface MonthSummary {
  budget: MonthBudget;
  rows: BudgetRow[];
  spending: number; // expenses only
  netSaved: number; // deposits - withdrawals in month
  repaid: number; // loan repayments I made in month
  plannedTotal: number;
  actualTotal: number; // spent + saved + repaid
  /** Fixed monthly income + extra income. */
  income: number;
  /** The month's fixed income (the Budget form). */
  fixedIncome: number;
  /** 2.2.0: extra income entries this month. */
  extraIncome: number;
  unallocated: number; // income - planned
  moneyLeft: number; // income - actual
}

export function netSaved(entries: GoalEntry[], month: string, goalId?: number, startDay = 1) {
  return entries
    .filter((x) => inMonth(x.date, month, startDay) && (goalId === undefined || x.goalId === goalId))
    .reduce((s, x) => s + (x.deposit ? x.amount : -x.amount), 0);
}

export function monthSummary(
  b: MonthBudget,
  cats: Category[],
  expenses: Expense[],
  goalEntries: GoalEntry[],
  loans: LoanEntry[],
  startDay = 1,
  /** Budget rollover: unspent budget per category carried in from earlier months. */
  carry: Record<string, number> = {},
  /** 2.2.0: extra income this month (added to the fixed income). */
  extraIncome = 0,
): MonthSummary {
  const rows: BudgetRow[] = [];
  let spending = 0;
  let carriedTotal = 0;
  for (const c of cats) {
    const carried = carry[String(c.id)] ?? 0;
    const planned = (c.isUni ? uniMonthly(b) : b.plans[String(c.id)] ?? 0) + carried;
    const actual = expenses
      .filter((e) => e.categoryId === c.id && inMonth(e.date, b.month, startDay))
      .reduce((s, e) => s + e.amount, 0);
    spending += actual;
    carriedTotal += carried;
    rows.push({ catId: c.id, name: c.name, planned, actual, isGoal: false, ...(carried ? { carried } : {}) });
  }
  const net = netSaved(goalEntries, b.month, undefined, startDay);
  const rep = loans
    .filter((l) => l.borrowed && l.repayment && inMonth(l.date, b.month, startDay))
    .reduce((s, l) => s + l.amount, 0);
  rows.push({ catId: null, name: 'Savings', planned: b.savePlan, actual: net, isGoal: true });
  rows.push({ catId: null, name: 'Loan repayments', planned: b.loanPlan, actual: rep, isGoal: true });
  // Carried-over money was budgeted in an earlier month, so it is not planned out of this month's income.
  const plannedTotal = rows.reduce((s, r) => s + r.planned, 0) - carriedTotal;
  const actualTotal = rows.reduce((s, r) => s + r.actual, 0);
  return {
    budget: b,
    rows,
    spending,
    netSaved: net,
    repaid: rep,
    plannedTotal,
    actualTotal,
    income: b.income + extraIncome,
    fixedIncome: b.income,
    extraIncome,
    unallocated: b.income + extraIncome - plannedTotal,
    moneyLeft: b.income + extraIncome - actualTotal,
  };
}

/** Whole days from `a` to `b` ('YYYY-MM-DD'), counted on the calendar (no timezone or DST effects). */
const dayNumber = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/**
 * How much can be spent per day for the rest of budget month `month`: what's left divided by the
 * days remaining, today included. Null when `today` is not inside that month.
 * Negative `left` gives a negative amount (already over budget).
 */
export function dailyAllowance(left: number, today: string, month: string, startDay = 1) {
  if (!inMonth(today, month, startDay)) return null;
  const { last } = periodRange(month, startDay);
  const days = dayNumber(last) - dayNumber(today) + 1;
  return { perDay: Math.trunc(left / days), days, until: last };
}

export const goalBalance = (g: Goal, entries: GoalEntry[]) =>
  g.start + entries.filter((x) => x.goalId === g.id).reduce((s, x) => s + (x.deposit ? x.amount : -x.amount), 0);

export const goalProgress = (g: Goal, balance: number) =>
  g.target <= 0 ? 0 : Math.min(1, Math.max(0, balance / g.target));

export const remaining = (g: Goal, balance: number) => Math.max(0, g.target - balance);

/** 0 = reached, -1 = cannot estimate (no monthly saving). */
export function monthsToGoal(remainingAmount: number, monthly: number) {
  if (remainingAmount <= 0) return 0;
  if (monthly <= 0) return -1;
  return Math.ceil(remainingAmount / monthly);
}

/** Change from `previous` to `current` in whole %; null when there was nothing before (a "new" category). */
export function changePct(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
}

const addMonths = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export interface GoalForecast {
  /** Average net saved per budget month (deposits minus withdrawals) over the periods below. */
  pace: number;
  /** How many periods the pace is based on (1–3). */
  periods: number;
  /** Budget month ('YYYY-MM') the goal is reached at this pace; null when it never will (pace ≤ 0) or it's reached already. */
  reach: string | null;
  reached: boolean;
  /** Saving less than the planned monthly amount. */
  behind: boolean;
}

/**
 * "At this pace you'll reach it in <month>": the average saved in the last 3 budget periods
 * (the current one and the two before), not counting periods before the goal's first entry.
 * Null when the goal has no deposits or withdrawals yet.
 */
export function goalForecast(
  g: Goal,
  balance: number,
  entries: GoalEntry[],
  currentMonth: string,
  planned: number,
  startDay = 1,
): GoalForecast | null {
  const mine = entries.filter((e) => e.goalId === g.id);
  if (!mine.length) return null;
  const first = monthOf(mine.reduce((min, e) => (e.date < min ? e.date : min), mine[0].date), startDay);
  const periods = [0, -1, -2].map((k) => addMonths(currentMonth, k)).filter((p) => p >= first);
  const total = periods.reduce((s, p) => s + netSaved(mine, p, g.id, startDay), 0);
  const pace = Math.round(total / Math.max(1, periods.length));
  const rem = remaining(g, balance);
  const reached = rem <= 0;
  const reach = !reached && pace > 0 ? addMonths(currentMonth, Math.ceil(rem / pace)) : null;
  return { pace, periods: periods.length, reach, reached, behind: !reached && planned > 0 && pace < planned };
}

export interface PersonBalance { name: string; principal: number; repaid: number; owed: number; settled: boolean }

export function balances(all: LoanEntry[], borrowed: boolean): PersonBalance[] {
  const out = new Map<string, { name: string; principal: number; repaid: number }>();
  for (const l of all.filter((x) => x.borrowed === borrowed)) {
    const key = l.person.trim().toLowerCase();
    const p = out.get(key) ?? { name: l.person.trim(), principal: 0, repaid: 0 };
    if (l.repayment) p.repaid += l.amount;
    else p.principal += l.amount;
    out.set(key, p);
  }
  return [...out.values()].map((p) => ({ ...p, owed: p.principal - p.repaid, settled: p.principal - p.repaid <= 0 }));
}

/** Total still owed. Someone who was overpaid counts as 0: it never lowers what others owe. */
export const outstanding = (all: LoanEntry[], borrowed: boolean) =>
  balances(all, borrowed).reduce((s, p) => s + Math.max(0, p.owed), 0);

/** Planned monthly contribution for a goal (own value, else an even share of the Savings plan). */
export const goalMonthly = (g: Goal, goals: Goal[], savePlan: number) =>
  g.monthly > 0 ? g.monthly : goals.length === 0 ? 0 : Math.floor(savePlan / goals.length);
