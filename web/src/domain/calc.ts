/** Pure calculations. They mirror the formulas of Student_Budget.xlsx. */

export interface Category { id: number; name: string; isUni: boolean; sort: number }
export interface Expense {
  id: number;
  date: string;
  categoryId: number;
  description: string;
  amount: number;
  categoryName?: string;
  /** A receipt photo/PDF is attached. */
  hasReceipt?: boolean;
}
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
export interface LoanEntry { id: number; date: string; person: string; borrowed: boolean; repayment: boolean; amount: number; note: string }
export interface Txn { date: string; id: number; kind: string; title: string; sub: string; amount: number }

export interface BudgetRow {
  catId: number | null; // null for the Savings / Loan repayment rows
  name: string;
  planned: number;
  actual: number;
  isGoal: boolean;
}

export const rowLeft = (r: BudgetRow) => r.planned - r.actual;
export const rowBar = (r: BudgetRow) =>
  r.planned === 0 ? (r.actual > 0 && !r.isGoal ? 1 : 0) : Math.min(1, Math.max(0, r.actual / r.planned));
export const rowOver = (r: BudgetRow) => !r.isGoal && r.actual > r.planned;
export const rowMet = (r: BudgetRow) => r.isGoal && r.actual >= r.planned;
export const rowStatus = (r: BudgetRow) =>
  r.isGoal ? (rowMet(r) ? 'Goal met' : 'Behind') : rowOver(r) ? 'Over budget' : 'OK';

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
  income: number;
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
): MonthSummary {
  const rows: BudgetRow[] = [];
  let spending = 0;
  for (const c of cats) {
    const planned = c.isUni ? uniMonthly(b) : b.plans[String(c.id)] ?? 0;
    const actual = expenses
      .filter((e) => e.categoryId === c.id && inMonth(e.date, b.month, startDay))
      .reduce((s, e) => s + e.amount, 0);
    spending += actual;
    rows.push({ catId: c.id, name: c.name, planned, actual, isGoal: false });
  }
  const net = netSaved(goalEntries, b.month, undefined, startDay);
  const rep = loans
    .filter((l) => l.borrowed && l.repayment && inMonth(l.date, b.month, startDay))
    .reduce((s, l) => s + l.amount, 0);
  rows.push({ catId: null, name: 'Savings', planned: b.savePlan, actual: net, isGoal: true });
  rows.push({ catId: null, name: 'Loan repayments', planned: b.loanPlan, actual: rep, isGoal: true });
  const plannedTotal = rows.reduce((s, r) => s + r.planned, 0);
  const actualTotal = rows.reduce((s, r) => s + r.actual, 0);
  return {
    budget: b,
    rows,
    spending,
    netSaved: net,
    repaid: rep,
    plannedTotal,
    actualTotal,
    income: b.income,
    unallocated: b.income - plannedTotal,
    moneyLeft: b.income - actualTotal,
  };
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

export const outstanding = (all: LoanEntry[], borrowed: boolean) =>
  balances(all, borrowed).reduce((s, p) => s + p.owed, 0);

/** Planned monthly contribution for a goal (own value, else an even share of the Savings plan). */
export const goalMonthly = (g: Goal, goals: Goal[], savePlan: number) =>
  g.monthly > 0 ? g.monthly : goals.length === 0 ? 0 : Math.floor(savePlan / goals.length);
