import { describe, expect, it } from 'vitest';
import { monthSummary, type Category, type MonthBudget } from './calc';
import { evalMoney, hasMaths, parseMoney } from './money';

describe('maths in amount fields', () => {
  it('adds, subtracts, multiplies and divides, × and ÷ first', () => {
    expect(parseMoney('45+30')).toBe(7500);
    expect(parseMoney('120/3')).toBe(4000);
    expect(parseMoney('3×45')).toBe(13500);
    expect(parseMoney('3*45')).toBe(13500);
    expect(parseMoney('3x45')).toBe(13500);
    expect(parseMoney('100-20+5')).toBe(8500);
    expect(parseMoney('100−20')).toBe(8000); // the − key (U+2212)
    expect(parseMoney('10+2×3')).toBe(1600);
    expect(parseMoney('12.50+7.25')).toBe(1975);
    expect(parseMoney('12,50+1')).toBe(1350); // decimal comma
    expect(parseMoney('1,200+300')).toBe(150000); // thousands comma
    expect(parseMoney('٤٥+٣٠')).toBe(7500); // Arabic digits
    expect(parseMoney('100÷3')).toBe(3333); // rounded once, to whole piastres
    expect(parseMoney('10×1.5')).toBe(1500);
  });

  it('refuses anything that is not a clean sum', () => {
    for (const bad of ['45+', '+45+', '-5', '10-20', '5/0', '5÷0', '4++4', 'abc+1', '1+a', '1e5+1', '2^3']) {
      expect(parseMoney(bad), bad).toBeNull();
    }
    expect(hasMaths('45')).toBe(false);
    expect(hasMaths('45+1')).toBe(true);
    expect(evalMoney('7')).toBe(700);
  });

  it('plain amounts still work exactly as before', () => {
    expect(parseMoney('12.5')).toBe(1250);
    expect(parseMoney('12,50')).toBe(1250);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('.')).toBeNull();
  });
});

describe('budget rollover in the month summary', () => {
  const b: MonthBudget = { month: '2026-11', income: 500000, uniDays: 0, uniWeeks: 4, uniCost: 0, savePlan: 0, loanPlan: 0, plans: { '1': 100000, '2': 50000 } };
  const cats: Category[] = [
    { id: 1, name: 'Food', isUni: false, sort: 0 },
    { id: 2, name: 'Bus', isUni: false, sort: 1 },
  ];

  it('adds the carried amount to the category budget, but not to what this month’s income must cover', () => {
    const off = monthSummary(b, cats, [], [], []);
    const on = monthSummary(b, cats, [], [], [], 1, { '1': 30000 });
    expect(on.rows[0]).toMatchObject({ planned: 130000, carried: 30000 });
    expect(on.rows[1].carried).toBeUndefined();
    expect(on.plannedTotal).toBe(off.plannedTotal);
    expect(on.unallocated).toBe(off.unallocated);
    expect(on.moneyLeft).toBe(off.moneyLeft);
  });
});
