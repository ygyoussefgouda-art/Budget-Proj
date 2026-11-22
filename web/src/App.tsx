import { useQuery } from '@tanstack/react-query';
import { Home, PieChart, PiggyBank, ReceiptText, HandCoins } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, ApiError } from './api';
import { AppLock } from './components/AppLock';
import OfflineApp from './components/OfflineApp';
import { OfflineBar, OfflineProvider } from './components/OfflineQueue';
import Tutorial from './components/Tutorial';
import { useReminders } from './notify';
import { FirstRunPermissions } from './pages/Permissions';
import { budgetAlerts } from './domain/calc';
import Admin from './pages/Admin';
import Budget from './pages/Budget';
import Dashboard from './pages/Dashboard';
import Expenses from './pages/Expenses';
import Loans from './pages/Loans';
import Login from './pages/Login';
import Reports from './pages/Reports';
import Savings, { GoalDetail } from './pages/Savings';
import Settings from './pages/Settings';
import { t } from './i18n';
import { isNetworkError, readKit, saveKit } from './offline';
import { AppStateProvider, useApp, type User } from './state';
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
    retry: false,
  });

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
  // Badge on the Budget tab: categories at 80%+ of their budget (red when one is at 100% or over).
  const alerts = useMemo(() => (summary ? budgetAlerts(summary.rows) : []), [summary]);
  // Android app: the same alerts (and due recurring expenses) as notifications on the phone.
  useReminders(user.id, alerts, data?.recurringDue ?? NO_DUE, month, catName);
  const alertBadge = alerts.length ? { n: alerts.length, red: alerts.some((a) => a.level !== 'warn') } : undefined;
  if (loading && !data) return <Splash />;
  if (error && !data) return <Splash text={error.message} retry={() => void refresh()} />;
  return (
    <div className="shell">
      <ScrollToTop />
      <OfflineBar updatedAt={updatedAt} />
      <main className="content">
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Tutorial />
      <FirstRunPermissions userId={user.id} />
      <nav className="bottom-nav" aria-label={t('Main')}>
        <Tab to="/" icon={Home} label={t('Home')} end />
        <Tab to="/budget" icon={PieChart} label={t('Budget')} badge={alertBadge} />
        <Tab to="/expenses" icon={ReceiptText} label={t('Expenses')} />
        <Tab to="/loans" icon={HandCoins} label={t('Loans')} />
        <Tab to="/savings" icon={PiggyBank} label={t('Savings')} />
      </nav>
    </div>
  );
}

function Tab({ to, icon: Icon, label, end, badge }: { to: string; icon: typeof Home; label: string; end?: boolean; badge?: { n: number; red: boolean } }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}
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

function Splash({ text, retry }: { text?: string; retry?: () => void }) {
  return (
    <div className="splash">
      {text ? (
        <>
          <p>{text}</p>
          {retry && (
            <button className="btn primary" onClick={retry}>
              {t('Try again')}
            </button>
          )}
        </>
      ) : (
        <div className="spinner" aria-label={t('Loading')} />
      )}
    </div>
  );
}
