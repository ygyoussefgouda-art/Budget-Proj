import { describe, expect, it } from 'vitest';
import {
  balances,
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
import { fmtMoney, parseMoney } from './money';

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
    expect(parseMoney('٣٥٠')).toBe(35000);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('-5')).toBeNull();
    expect(fmtMoney(120000, 'EGP')).toBe('1,200 EGP');
    expect(fmtMoney(-5050, 'EGP')).toBe('−50.50 EGP');
  });
});
