import { useQuery } from '@tanstack/react-query';
import { Home, PieChart, PiggyBank, ReceiptText, HandCoins } from 'lucide-react';
import { useLayoutEffect } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, ApiError } from './api';
import Tutorial from './components/Tutorial';
import Budget from './pages/Budget';
import Dashboard from './pages/Dashboard';
import Expenses from './pages/Expenses';
import Loans from './pages/Loans';
import Login from './pages/Login';
import Reports from './pages/Reports';
import Savings, { GoalDetail } from './pages/Savings';
import Settings from './pages/Settings';
import { t } from './i18n';
import { AppStateProvider, useApp, type User } from './state';

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
  if (me.isError) return <Splash text={(me.error as Error).message} retry={() => me.refetch()} />;
  if (!me.data) return <Login />;

  return (
    <AppStateProvider user={me.data.user}>
      <Shell />
    </AppStateProvider>
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
  const { data, error, loading } = useApp();
  if (loading && !data) return <Splash />;
  if (error && !data) return <Splash text={error.message} />;
  return (
    <div className="shell">
      <ScrollToTop />
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Tutorial />
      <nav className="bottom-nav" aria-label={t('Main')}>
        <Tab to="/" icon={Home} label={t('Home')} end />
        <Tab to="/budget" icon={PieChart} label={t('Budget')} />
        <Tab to="/expenses" icon={ReceiptText} label={t('Expenses')} />
        <Tab to="/loans" icon={HandCoins} label={t('Loans')} />
        <Tab to="/savings" icon={PiggyBank} label={t('Savings')} />
      </nav>
    </div>
  );
}

function Tab({ to, icon: Icon, label, end }: { to: string; icon: typeof Home; label: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
      <span className="tab-icon">
        <Icon size={22} />
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
