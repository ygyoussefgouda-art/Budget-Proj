import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Home, LayoutGrid, PieChart, Plus, ReceiptText } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import PullToRefresh from './components/PullToRefresh';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, ApiError } from './api';
import { AppLock } from './components/AppLock';
import OfflineApp from './components/OfflineApp';
import Splash, { SplashExit } from './components/Splash';
import { OfflineBar, OfflineProvider } from './components/OfflineQueue';
import Tutorial from './components/Tutorial';
import { AddExpenseProvider, useAddExpense } from './components/AddExpense';
import { useReminders } from './notify';
import { FirstRunPermissions } from './pages/Permissions';
import { budgetAlerts, dailyAllowance, periodRange } from './domain/calc';
import { useSeenAlerts } from './alertsSeen';
import { fmtMoney } from './domain/money';
import { readLock } from './pin';
import { sendWidget, widgetText } from './widget';
import Admin from './pages/Admin';
import Budget from './pages/Budget';
import Dashboard from './pages/Dashboard';
import Expenses from './pages/Expenses';
import Loans from './pages/Loans';
import More from './pages/More';
import Login from './pages/Login';
import Reports from './pages/Reports';
import Savings, { GoalDetail } from './pages/Savings';
import Settings from './pages/Settings';
import { t } from './i18n';
import { clearKit, isNetworkError, readKit, saveKit } from './offline';
import { clearOfflineCache, readCacheOwner, writeCacheOwner } from './persist';
import { AppStateProvider, thisMonth, todayIso, useApp, type User } from './state';
import type { DueItem } from './domain/calc';

const NO_DUE: DueItem[] = [];

export default function App() {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<{ user: User }>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: Infinity,
    // Always ask the server once on start: a saved offline copy must never stand in for a real session.
    // (Offline, the check fails and the app shows the saved copy read-only.)
    refetchOnMount: 'always',
    retry: false,
  });

  // 2.3.0 (security): the offline copy belongs to one account. Signed out, or someone else signed in on
  // this phone: drop it before anything is shown, so nobody ever sees another account's budget.
  const qc = useQueryClient();
  const uid = me.data === undefined ? undefined : (me.data?.user.id ?? null);
  const checked = useRef<number | null | undefined>(undefined);
  if (uid !== undefined && checked.current !== uid) {
    checked.current = uid;
    if (readCacheOwner() !== uid) {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      void clearOfflineCache();
      if (uid === null) void clearKit();
      writeCacheOwner(uid);
    }
  }

  if (me.isLoading) return <Splash />;
  // Offline with a saved copy: show the app from it (read-only), not the offline entry screen.
  if (me.isError && !me.data) {
    // Opened with no connection: still let the user log expenses (they sync later).
    const kit = isNetworkError(me.error) ? readKit() : null;
    if (kit)
      return (
        <AppLock userId={kit.user.id}>
          <OfflineApp kit={kit} retry={() => void me.refetch()} />
        </AppLock>
      );
    return <Splash text={(me.error as Error).message} retry={() => me.refetch()} />;
  }
  if (!me.data) return <Login />;

  return (
    <AppStateProvider user={me.data.user}>
      <OfflineLayer>
        <AppLock userId={me.data.user.id}>
          <Shell />
        </AppLock>
      </OfflineLayer>
    </AppStateProvider>
  );
}

/** Offline expense queue for the signed-in user; keeps the small offline kit up to date. */
function OfflineLayer({ children }: { children: ReactNode }) {
  const { user, data, refresh } = useApp();
  const categories = data?.categories;
  useEffect(() => {
    if (categories) saveKit({ user, categories: categories.map((c) => ({ id: c.id, name: c.name })) });
  }, [user, categories]);
  return (
    <OfflineProvider userId={user.id} onSynced={refresh}>
      {children}
    </OfflineProvider>
  );
}

/** Every new screen (tab, goal, settings...) opens at the top instead of where the last one was scrolled. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

function Shell() {
  const { data, error, loading, summary, refresh, updatedAt, user, month, catName } = useApp();
  const qc = useQueryClient();
  // Pull to refresh: this month, every list on screen and the account itself.
  const reloadAll = useCallback(() => Promise.all([refresh(), qc.invalidateQueries()]), [refresh, qc]);
  // Badge on the Budget tab: categories at 80%+ of their budget (red when one is at 100% or over).
  const alerts = useMemo(() => (summary ? budgetAlerts(summary.rows) : []), [summary]);
  // This budget month's numbers (null while looking at another month): month-end summary + widget.
  const current = month === thisMonth(user.monthStartDay || 1);
  const monthEnd = useMemo(
    () =>
      current && summary
        ? {
            month,
            from: periodRange(month, user.monthStartDay || 1).from,
            last: periodRange(month, user.monthStartDay || 1).last,
            locked: !!readLock(user.id),
            spent: summary.spending,
            saved: summary.netSaved,
            left: summary.moneyLeft,
            fmt: (m: number) => fmtMoney(m, user.currency),
          }
        : undefined,
    [current, summary, month, user.monthStartDay, user.currency],
  );
  // Android app: the same alerts (and due recurring expenses) as notifications on the phone.
  useReminders(user.id, alerts, data?.recurringDue ?? NO_DUE, month, catName, monthEnd);
  useEffect(() => {
    if (!monthEnd) return;
    const a = dailyAllowance(monthEnd.left, todayIso(), month, user.monthStartDay || 1);
    sendWidget(widgetText(a ? { ...a, left: monthEnd.left, fmt: monthEnd.fmt } : null, monthEnd.locked));
  }, [monthEnd, month, user.id, user.monthStartDay]);
  // 2.2.1: only alerts not read yet (tapped, marked as read, or seen on the Budget tab) count on the badge.
  const { isSeen } = useSeenAlerts(user.id, month);
  const unread = alerts.filter((a) => !isSeen(a));
  const alertBadge = unread.length ? { n: unread.length, red: unread.some((a) => a.level !== 'warn') } : undefined;
  if (loading && !data) return <Splash />;
  if (error && !data) return <Splash text={error.message} retry={() => void refresh()} />;
  return (
    <AddExpenseProvider>
    <div className="shell">
      <ScrollToTop />
      <SplashExit />
      <PullToRefresh onRefresh={reloadAll} />
      <OfflineBar updatedAt={updatedAt} />
      <main className="content enter">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/budget" element={<Budget />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/loans" element={<Loans />} />
          <Route path="/savings" element={<Savings />} />
          <Route path="/savings/:id" element={<GoalDetail />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/more" element={<More />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Tutorial />
      <FirstRunPermissions userId={user.id} />
      <nav className="bottom-nav" aria-label={t('Main')}>
        {/* 2.0.0: four tabs around a centre + (quick add from anywhere); Savings, Loans, Reports and Settings live under More */}
        <Tab to="/" icon={Home} label={t('Home')} end />
        <Tab to="/expenses" icon={ReceiptText} label={t('Expenses')} />
        <CenterAdd />
        <Tab to="/budget" icon={PieChart} label={t('Budget')} badge={alertBadge} />
        <Tab to="/more" icon={LayoutGrid} label={t('More')} also={MORE_PATHS} />
      </nav>
    </div>
    </AddExpenseProvider>
  );
}

/** Pages reached from More: the More tab stays highlighted on them. */
const MORE_PATHS = ['/savings', '/loans', '/reports', '/settings', '/admin'];

/** The raised + in the middle of the bar: add an expense from any tab, right where you are (2.4.0). */
function CenterAdd() {
  const add = useAddExpense();
  return (
    <button type="button" className="tab-add" aria-label={t('New expense')} title={t('New expense')} onClick={add}>
      <Plus size={26} strokeWidth={2.6} aria-hidden="true" />
    </button>
  );
}

function Tab({ to, icon: Icon, label, end, badge, also }: { to: string; icon: typeof Home; label: string; end?: boolean; badge?: { n: number; red: boolean }; also?: string[] }) {
  const { pathname } = useLocation();
  const extra = also?.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ?? false;
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `tab ${isActive || extra ? 'active' : ''}`}
      aria-label={badge ? `${label}, ${badge.n === 1 ? t('1 budget alert') : t('{n} budget alerts', { n: badge.n })}` : undefined}
    >
      <span className="tab-icon">
        <Icon size={22} />
        {badge && (
          <span className={`nav-badge ${badge.red ? '' : 'is-amber'}`} aria-hidden="true">
            {badge.n}
          </span>
        )}
      </span>
      <span>{label}</span>
    </NavLink>
  );
}
