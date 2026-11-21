import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import {
  inMonth,
  monthOf,
  monthSummary,
  outstanding,
  periodRange,
  type Category,
  type DueItem,
  type Expense,
  type Goal,
  type GoalEntry,
  type LoanEntry,
  type MonthBudget,
  type MonthSummary,
  type Txn,
} from './domain/calc';
import { fmtMoney } from './domain/money';
import { isRtl, locale } from './i18n';

export interface User { id: number; username: string; currency: string; monthStartDay: number; isAdmin?: boolean }

export interface ServerState {
  month: string;
  budget: MonthBudget;
  categories: Category[];
  expenses: Expense[]; // this month only
  goals: Goal[]; // with balance
  goalEntries: GoalEntry[];
  loans: LoanEntry[];
  recent: Txn[];
  hasEarlierMonth: boolean;
  /** This month is empty and an earlier month has a budget: offer "Same as last month". */
  canCopyPrevious: boolean;
  /** The month that would be copied ('YYYY-MM'). */
  copyFrom: string | null;
  /** Recurring expenses waiting for Add / Skip. */
  recurringDue: DueItem[];
}

export const CURRENCIES = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR', 'JOD'];

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The budget month today belongs to (before the start day it is still last month). */
export const thisMonth = (startDay = 1) => monthOf(todayIso(), startDay);

/** Today if inside budget month `month`, else the month's first day. */
export const defaultDate = (month: string, startDay = 1) => {
  const t = todayIso();
  return inMonth(t, month, startDay) ? t : periodRange(month, startDay).from;
};

/** "25 Nov – 24 Dec" when months don't start on the 1st, else ''. */
export const periodLabel = (month: string, startDay: number) => {
  if (startDay === 1) return '';
  const r = periodRange(month, startDay);
  const f = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  };
  return `${f(r.from)} – ${f(r.last)}`;
};

/** "1st", "2nd", "25th"... */
export const ordinal = (n: number) => {
  if (isRtl()) return String(n);
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
};

export const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
};

export const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
};

interface AppCtx {
  user: User;
  month: string;
  setMonth: (m: string) => void;
  data: ServerState | undefined;
  summary: MonthSummary | undefined;
  loading: boolean;
  error: Error | null;
  fmt: (minor: number) => string;
  /** Day of the month the budget month starts. */
  startDay: number;
  totals: { totalSavings: number; owedByMe: number; owedToMe: number };
  catName: (id: number) => string;
  /** Re-fetch everything after a change. */
  refresh: () => Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppStateProvider({ user, children }: { user: User; children: ReactNode }) {
  const startDay = user.monthStartDay || 1;
  const [month, setMonth] = useState(() => thisMonth(startDay));
  // When the start day changes, jump to the budget month that contains today.
  useEffect(() => {
    setMonth(thisMonth(startDay));
  }, [startDay]);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['state', month],
    queryFn: () => api<ServerState>(`/state?month=${month}`),
    placeholderData: (prev) => prev,
  });
  const data = q.data;

  const summary = useMemo(
    () =>
      data ? monthSummary(data.budget, data.categories, data.expenses, data.goalEntries, data.loans, startDay) : undefined,
    [data, startDay],
  );
  const totals = useMemo(
    () => ({
      totalSavings: data?.goals.reduce((s, g) => s + (g.balance ?? 0), 0) ?? 0,
      owedByMe: data ? outstanding(data.loans, true) : 0,
      owedToMe: data ? outstanding(data.loans, false) : 0,
    }),
    [data],
  );
  const fmt = useCallback((minor: number) => fmtMoney(minor, user.currency), [user.currency]);
  const catName = useCallback(
    (id: number) => data?.categories.find((c) => c.id === id)?.name ?? 'Unknown',
    [data],
  );
  const refresh = useCallback(async () => {
    await qc.invalidateQueries();
  }, [qc]);

  const value: AppCtx = {
    user,
    month,
    setMonth,
    data,
    summary,
    loading: q.isLoading,
    error: q.error,
    fmt,
    startDay,
    totals,
    catName,
    refresh,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}
