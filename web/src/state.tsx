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
  type Income,
  type LoanEntry,
  type MonthBudget,
  type MonthSummary,
  type Txn,
} from './domain/calc';
import { fmtMoney } from './domain/money';
import { isRtl, locale, t } from './i18n';

export interface User {
  id: number;
  username: string;
  currency: string;
  monthStartDay: number;
  isAdmin?: boolean;
  email?: string | null;
  twoFactor?: boolean;
  /** Unspent category budget carries into the next month. */
  rollover?: boolean;
  /** The same expense added again within 5 minutes is added to the last one. */
  mergeRepeats?: boolean;
}

export interface ServerState {
  month: string;
  budget: MonthBudget;
  categories: Category[];
  expenses: Expense[]; // this month only
  /** 2.2.0: extra income this month (missing from an older server). */
  incomes?: Income[];
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
  /** Budget rollover on: unspent budget per category carried in from earlier months. */
  carry?: Record<string, number>;
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
    return tidyDate(new Date(y, m - 1, d).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }));
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

/**
 * 2.1.2: British English writes September "Sept" but every other month in three letters: use "Sep".
 * No-break spaces keep a date on one line ("30 Nov 2026" never leaves "2026" alone).
 */
export const tidyDate = (s: string) => s.replace(/\bSept\b/g, 'Sep').replace(/ /g, ' ');

export const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return tidyDate(new Date(y, m - 1, d).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }));
};

/** 2.2.0: the phone's clock now, "HH:MM" (24-hour, as stored). */
export const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** "14:05" → "2:05 PM" (or "٢:٠٥ م" in Arabic), in the app's language. */
export const fmtTime = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  // 12-hour with AM/PM (ص/م in Arabic), as people in Egypt read times; British English would say 21:05.
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/ /g, ' ');
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
  /** When this month's data was last loaded from the server (ms), for "Last updated" offline. */
  updatedAt: number;
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
      data
        ? monthSummary(
            data.budget,
            data.categories,
            data.expenses,
            data.goalEntries,
            data.loans,
            startDay,
            data.carry ?? {},
            (data.incomes ?? []).reduce((s, i) => s + i.amount, 0),
          )
        : undefined,
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
    (id: number) => data?.categories.find((c) => c.id === id)?.name ?? t('Unknown'),
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
    updatedAt: q.dataUpdatedAt,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The app state when inside the signed-in app, else null (e.g. the offline entry screen). */
export function useAppOptional() {
  return useContext(Ctx);
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}
