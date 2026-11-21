import { describe, expect, it } from 'vitest';
import {
  alertLevel,
  balances,
  budgetAlerts,
  changePct,
  convert,
  parseTags,
  splitShares,
  dailyAllowance,
  goalForecast,
  goalBalance,
  goalProgress,
  inMonth,
  monthOf,
  monthSummary,
  periodRange,
  monthsToGoal,
  outstanding,
  remaining,
  rowStatus,
  uniMonthly,
  type Category,
  type Expense,
  type Goal,
  type LoanEntry,
  type MonthBudget,
} from './calc';
import { fmtMoney, parseMoney, parseRate } from './money';

// Mirrors the workbook (Nov 2026) + the agreed starting data.
const cats: Category[] = [
  { id: 1, name: 'Uni Transport & Food', isUni: true, sort: 0 },
  { id: 2, name: 'Transportation', isUni: false, sort: 1 },
  { id: 3, name: 'ETC', isUni: false, sort: 2 },
  { id: 4, name: 'Hangouts', isUni: false, sort: 3 },
];
const budget: MonthBudget = {
  month: '2026-11', income: 250000, uniDays: 3, uniWeeks: 4, uniCost: 10000, savePlan: 50000, loanPlan: 50000, plans: {},
};
const expenses: Expense[] = [
  { id: 1, date: '2026-06-11', categoryId: 3, description: 'Guitar strings', amount: 35000 },
  { id: 2, date: '2026-06-11', categoryId: 2, description: '', amount: 2000 },
];
const loans: LoanEntry[] = [
  { id: 1, date: '2026-10-28', person: 'Yaso', borrowed: true, repayment: false, amount: 30000, note: '' },
  { id: 2, date: '2026-11-05', person: 'Dad', borrowed: true, repayment: false, amount: 20000, note: '' },
  { id: 3, date: '2026-11-06', person: 'Yaso', borrowed: true, repayment: true, amount: 5000, note: '' },
];
const guitar: Goal = { id: 1, name: 'Guitar', target: 1000000, start: 152600, monthly: 0, sort: 0 };

describe('workbook formulas', () => {
  it('uni cost = days x weeks x cost', () => expect(uniMonthly(budget)).toBe(120000));

  it('budget totals (Nov 2026)', () => {
    const s = monthSummary(budget, cats, expenses, [], loans);
    expect(s.plannedTotal).toBe(220000); // 1200 + 0 + 0 + 0 + 500 + 500
    expect(s.unallocated).toBe(30000);
    expect(s.spending).toBe(0); // sample expenses are in June
    expect(s.repaid).toBe(5000);
    expect(s.moneyLeft).toBe(245000);
    expect(rowStatus(s.rows[s.rows.length - 1])).toBe('Behind');
    expect(rowStatus(s.rows[0])).toBe('OK');
  });

  it('over budget and goal met statuses', () => {
    const e = [...expenses, { id: 9, date: '2026-11-02', categoryId: 4, description: '', amount: 100 }];
    const s = monthSummary(budget, cats, e, [
      { id: 1, goalId: 1, date: '2026-11-03', deposit: true, amount: 60000, note: '' },
      { id: 2, goalId: 1, date: '2026-11-04', deposit: false, amount: 10000, note: '' },
    ], loans);
    expect(rowStatus(s.rows[3])).toBe('Over budget'); // planned 0, spent 1
    expect(s.netSaved).toBe(50000);
    expect(rowStatus(s.rows[4])).toBe('Goal met');
  });

  it('savings goal maths', () => {
    const bal = goalBalance(guitar, []);
    expect(bal).toBe(152600);
    expect(remaining(guitar, bal)).toBe(847400);
    expect(goalProgress(guitar, bal)).toBeCloseTo(0.1526, 9);
    expect(monthsToGoal(847400, 50000)).toBe(17);
    expect(monthsToGoal(0, 0)).toBe(0);
    expect(monthsToGoal(10, 0)).toBe(-1);
  });

  it('loan balances', () => {
    const b = balances(loans, true);
    expect(b.find((p) => p.name === 'Yaso')!.owed).toBe(25000);
    expect(b.find((p) => p.name === 'Dad')!.owed).toBe(20000);
    expect(outstanding(loans, true)).toBe(45000);
    expect(outstanding(loans, false)).toBe(0);
  });

  it('months can start on any day (the day you get your money)', () => {
    expect(periodRange('2026-11', 25)).toEqual({ from: '2026-11-25', to: '2026-12-25', last: '2026-12-24' });
    expect(periodRange('2026-12', 10)).toEqual({ from: '2026-12-10', to: '2027-01-10', last: '2027-01-09' });
    expect(periodRange('2026-02', 1).last).toBe('2026-02-28');
    expect(monthOf('2026-11-21', 25)).toBe('2026-10');
    expect(monthOf('2026-11-25', 25)).toBe('2026-11');
    expect(monthOf('2027-01-05', 10)).toBe('2026-12');
    expect(inMonth('2026-12-24', '2026-11', 25)).toBe(true);
    expect(inMonth('2026-11-24', '2026-11', 25)).toBe(false);
    // with a start day of 25, a 24 Dec expense counts in the "November" budget
    const e = [{ id: 1, date: '2026-12-24', categoryId: 4, description: '', amount: 900 }];
    expect(monthSummary(budget, cats, e, [], [], 25).spending).toBe(900);
    expect(monthSummary(budget, cats, e, [], [], 1).spending).toBe(0);
  });

  it('money parsing and formatting', () => {
    expect(parseMoney('1,200.50')).toBe(120050);
    // A comma before 1-2 final digits is a decimal comma (phone keyboards); otherwise thousands.
    expect(parseMoney('12,50')).toBe(1250);
    expect(parseMoney('12,5')).toBe(1250);
    expect(parseMoney('1,250')).toBe(125000);
    expect(parseMoney('1,250,000')).toBe(125000000);
    expect(parseMoney('٣٥٠٫٧٥')).toBe(35075);
    expect(parseMoney('٣٥٠،٧٥')).toBe(35075);
    expect(parseRate('49,5')).toBe(49.5);
    expect(parseRate('٤٩٫٥')).toBe(49.5);
    expect(parseRate('0.0212')).toBe(0.0212);
    expect(parseRate('0')).toBeNull();
    expect(parseRate('abc')).toBeNull();
    expect(parseMoney('٣٥٠')).toBe(35000);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('-5')).toBeNull();
    expect(fmtMoney(120000, 'EGP')).toBe('1,200 EGP');
    expect(fmtMoney(-5050, 'EGP')).toBe('−50.50 EGP');
  });
});

describe('daily allowance', () => {
  it('divides what is left by the days remaining, today included', () => {
    // November (1st–30th), today the 21st: 21..30 = 10 days
    expect(dailyAllowance(100_000, '2026-11-21', '2026-11')).toEqual({ perDay: 10_000, days: 10, until: '2026-11-30' });
    // last day of the month: 1 day
    expect(dailyAllowance(5_000, '2026-11-30', '2026-11')?.days).toBe(1);
  });
  it('follows the month start day', () => {
    // months start on the 25th: the "November" period runs 25 Nov – 24 Dec
    const r = dailyAllowance(33_000, '2026-12-14', '2026-11', 25); // 14..24 Dec = 11 days
    expect(r).toEqual({ perDay: 3_000, days: 11, until: '2026-12-24' });
  });
  it('is negative when over budget, and null outside the month', () => {
    expect(dailyAllowance(-1_000, '2026-11-28', '2026-11')?.perDay).toBe(-333);
    expect(dailyAllowance(10_000, '2026-12-01', '2026-11')).toBeNull();
  });
});

describe('budget alerts', () => {
  const row = (catId: number | null, planned: number, actual: number, isGoal = false) => ({ catId, name: `c${catId}`, planned, actual, isGoal });
  it('amber from 80%, "used up" at exactly 100%, red above it', () => {
    expect(alertLevel(row(1, 1000, 799))).toBeNull();
    expect(alertLevel(row(1, 1000, 800))).toBe('warn');
    expect(alertLevel(row(1, 1000, 1000))).toBe('full');
    expect(alertLevel(row(1, 1000, 1001))).toBe('over');
    expect(alertLevel(row(1, 0, 5))).toBe('over'); // spending with no budget
    expect(alertLevel(row(1, 0, 0))).toBeNull();
    expect(alertLevel(row(null, 1000, 5000, true))).toBeNull(); // savings / loan rows never alert
    expect(rowStatus(row(1, 1000, 850))).toBe('Almost used up');
    expect(rowStatus(row(1, 1000, 1000))).toBe('Used up');
    expect(rowStatus(row(1, 1000, 1200))).toBe('Over budget');
  });
  it('lists the worst first: over budget (by how much), used up, then almost used up', () => {
    const a = budgetAlerts([row(1, 1000, 850), row(2, 1000, 1500), row(3, 500, 500), row(4, 1000, 1100), row(5, 1000, 100), row(null, 10, 99, true)]);
    expect(a.map((x) => [x.catId, x.level])).toEqual([
      [2, 'over'],
      [4, 'over'],
      [3, 'full'],
      [1, 'warn'],
    ]);
    expect(a[0]).toMatchObject({ pct: 150, over: 500 });
  });
});

describe('month-over-month change', () => {
  it('in whole percent; null for a category that is new this month', () => {
    expect(changePct(1200, 1000)).toBe(20);
    expect(changePct(850, 1000)).toBe(-15);
    expect(changePct(0, 0)).toBe(0);
    expect(changePct(500, 0)).toBeNull();
    expect(changePct(0, 400)).toBe(-100);
  });
});

describe('savings goal forecast', () => {
  const goal = { id: 1, name: 'Laptop', target: 10_000, start: 0, monthly: 0, sort: 0 };
  const dep = (date: string, amount: number, deposit = true) => ({ id: Math.random(), goalId: 1, date, deposit, amount, note: '' });
  it('uses the average of the last 3 budget months', () => {
    const e = [dep('2026-09-05', 1000), dep('2026-10-05', 1000), dep('2026-11-05', 1000)];
    const f = goalForecast(goal, 3000, e, '2026-11', 1500);
    // 7,000 left at 1,000 a month: June 2027; planned 1,500 a month, so behind plan
    expect(f).toEqual({ pace: 1000, periods: 3, reach: '2027-06', reached: false, behind: true });
    expect(goalForecast(goal, 3000, e, '2026-11', 1000)?.behind).toBe(false);
  });
  it('a goal started this month only counts this month; older history beyond 3 months is ignored', () => {
    expect(goalForecast(goal, 2000, [dep('2026-11-02', 2000)], '2026-11', 0)).toMatchObject({ pace: 2000, periods: 1, reach: '2027-03' });
    const old = [dep('2026-01-10', 9000), dep('2026-11-01', 300)];
    expect(goalForecast(goal, 9300, old, '2026-11', 0)).toMatchObject({ pace: 100, periods: 3 });
  });
  it('withdrawals count against the pace; no deposits lately means no date; reached goals have none', () => {
    const e = [dep('2026-11-01', 500), dep('2026-11-02', 500, false)];
    expect(goalForecast(goal, 0, e, '2026-11', 0)).toMatchObject({ pace: 0, reach: null, reached: false });
    expect(goalForecast(goal, 10_000, [dep('2026-11-01', 10_000)], '2026-11', 500)).toMatchObject({ reached: true, reach: null, behind: false });
    expect(goalForecast(goal, 0, [], '2026-11', 500)).toBeNull();
  });
  it('follows the month start day', () => {
    // months start on the 25th: 20 Nov belongs to the "October" period
    const f = goalForecast(goal, 1000, [dep('2026-11-20', 1000)], '2026-10', 0, 25);
    expect(f).toMatchObject({ periods: 1, pace: 1000 });
  });
});

describe('split, currency and tags helpers', () => {
  it('even split: they owe half rounded down, I keep the odd piastre', () => {
    expect(splitShares(30_000, 'even', 0)).toEqual({ mine: 15_000, their: 15_000 });
    expect(splitShares(30_001, 'even', 0)).toEqual({ mine: 15_001, their: 15_000 });
    expect(splitShares(30_000, 'share', 10_000)).toEqual({ mine: 20_000, their: 10_000 });
  });
  it('converts with the same rounding as the server', () => {
    expect(convert(1_000, 49.5)).toBe(49_500);
    expect(convert(333, 1.005)).toBe(335);
  });
  it('reads tags typed with #, commas or spaces, Arabic included', () => {
    expect(parseTags('#Trip, friends  #TRIP #سفر')).toEqual({ tags: ['trip', 'friends', 'سفر'], bad: null });
    expect(parseTags('')).toEqual({ tags: [], bad: null });
    expect(parseTags('ok bad!tag').bad).toBe('bad!tag');
  });
});
