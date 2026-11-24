import {
  CalendarDays,
  ChevronRight,
  HandCoins,
  LineChart,
  PiggyBank,
  ReceiptText,
  Settings,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { SettingsForm } from '../components/BudgetForms';
import { CategoryIcon } from '../components/CategoryIcon';
import Illustration from '../components/Illustration';
import Brand, { BrandMark } from '../components/Brand';
import { Sheet } from '../components/Overlays';
import { QueuedList } from '../components/OfflineQueue';
import { DueList } from '../components/Recurring';
import { ExpenseForm } from './Expenses';
import { dailyAllowance, goalProgress, type Expense, type RecurringRule } from '../domain/calc';
import { wholeUnits } from '../domain/money';
import { locale, t } from '../i18n';
import { BudgetAlerts, MonthBar, TxnTile } from '../components/rows';
import { Card, COLORS, Empty, HeroAmount, IconButton, PageHeader, PALETTE, SectionTitle } from '../components/ui';
import { monthLabel, shortDate, thisMonth, todayIso, useApp } from '../state';


export default function Dashboard() {
  const { data, summary: s, fmt, month, startDay, user } = useApp();
  const nav = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  // Home-screen shortcut "Add expense" opens /?add=expense: show the quick-add sheet right away.
  const [quickAdd, setQuickAdd] = useState(() => params.get('add') === 'expense');
  useEffect(() => {
    // Also when already on Home: the centre + in the bottom bar opens /?add=expense
    if (params.get('add') === 'expense') setQuickAdd(true);
    if (params.has('add')) setParams({}, { replace: true });
  }, [params, setParams]);
  if (!data || !s) return null;

  const left = s.moneyLeft;
  const usageIncome = s.income === 0 ? (s.actualTotal > 0 ? 1 : 0) : s.actualTotal / s.income;
  // Biggest first: "Where it went" shows the top three.
  const slices = s.rows.filter((r) => r.catId !== null && r.actual > 0).sort((a, b) => b.actual - a.actual);
  const sliceTotal = slices.reduce((sum, r) => sum + r.actual, 0);
  // Only for the budget month we're in: what's left ÷ days remaining (today included).
  const allowance = dailyAllowance(left, todayIso(), month, startDay);
  // A month with no income and nothing logged: show the first step instead of a wall of zeros.
  const fresh = s.income === 0 && s.actualTotal === 0 && s.plannedTotal === 0;

  return (
    <div className="page">
      <PageHeader
        title={
          <span className="brand brand-row">
            <BrandMark />
            <Brand />
          </span>
        }
        right={
          <>
            <IconButton icon={LineChart} label={t('Reports')} onClick={() => nav('/reports')} />
            <IconButton icon={Settings} label={t('Settings')} onClick={() => nav('/settings')} />
          </>
        }
      />
      <MonthBar />
      <p className="greeting">{t(greeting(), { name: user.username })}</p>

      {fresh ? (
        <Card className="first-step">
          <Illustration name="wallet" />
          <h2 className="first-step-title">{t("Start with this month's income")}</h2>
          <p className="mute small">
            {t('Enter what you get for {month}. Masrofy then shows what is left and how much you can spend each day.', { month: monthLabel(month) })}
          </p>
          <button type="button" className="btn primary block" onClick={() => setSettingsOpen(true)}>
            {t('Set your income')}
          </button>
        </Card>
      ) : (
        <section className="hero home-band" aria-label={t('Your budget left')}>
          {/* 2.0.0: a full-width Lime band (Coinpay-style) with the number as the hero, currency small */}
          <div className="hero-label">{t('Your budget left')}</div>
          <div className={`hero-value ${left < 0 ? 'is-over' : ''}`}>
            <HeroAmount text={fmt(left)} />
          </div>
          <div className="hero-sub">
            {t('{used} used of {income}', { used: fmt(s.actualTotal), income: fmt(s.income) })}
            {allowance && ` · ${allowance.days} ${allowance.days === 1 ? t('day left') : t('days left')}`}
          </div>
          <Bar2 value={usageIncome} over={s.actualTotal > s.income} />
          {/* The sum behind "budget left": income minus everything spent or set aside this month. */}
          <div className="hero-sum">
            <SumRow label={t('Income')} value={fmt(s.income)} hint={t('Change')} onClick={() => setSettingsOpen(true)} />
            {/* 2.1.0: no minus signs here. These are what the income went to; saving isn't a loss. */}
            <SumRow label={t('Spent')} value={fmt(s.spending)} onClick={() => nav('/expenses')} />
            {s.netSaved !== 0 && <SumRow label={t('Saved')} value={fmt(s.netSaved)} onClick={() => nav('/savings')} />}
            {s.repaid !== 0 && <SumRow label={t('Repaid')} value={fmt(s.repaid)} onClick={() => nav('/loans')} />}
          </div>
          {allowance && (s.income > 0 || s.actualTotal > 0) && (
            <div className={`allowance small ${allowance.perDay < 0 ? 'is-over' : ''}`}>
              <CalendarDays size={15} aria-hidden="true" />
              <span>
                {t('You can spend {amount} a day until {date}', { amount: fmt(wholeUnits(allowance.perDay)), date: shortDate(allowance.until) })}
              </span>
            </div>
          )}
          {s.unallocated !== 0 && s.income > 0 && (
            <div className={`tiny ${s.unallocated < 0 ? 'over-note is-over' : ''}`} style={{ marginTop: 8 }}>
              {s.unallocated < 0
                ? t('Your plan is {amount} over your income. Lower a category.', { amount: fmt(-s.unallocated) })
                : t('{amount} of income is not planned yet.', { amount: fmt(s.unallocated) })}
            </div>
          )}
        </section>
      )}

      {/* Quick actions (Fintech-style): the four everyday entries, one tap each */}
      <div className="quick-actions" role="group" aria-label={t('Quick actions')}>
        <QuickAction icon={ReceiptText} label={t('Expense')} tone="mint" onClick={() => setQuickAdd(true)} />
        <QuickAction icon={Wallet} label={t('Income')} tone="sand" onClick={() => setSettingsOpen(true)} />
        <QuickAction icon={PiggyBank} label={t('Save')} tone="sky" onClick={() => nav('/savings')} />
        <QuickAction icon={HandCoins} label={t('Pay back')} tone="lavender" onClick={() => nav('/loans')} />
      </div>

      {!fresh && month === thisMonth(startDay) && <WeekChart expenses={data.expenses} />}
      <BudgetAlerts rows={s.rows} onOpen={() => nav('/budget')} />
      <DueList />
      <QueuedList categories={data.categories} currency={user.currency} />

      {/* 2.1.0: Home is a glance. The four number tiles (they repeated the band above), the big ring and
          "Budget usage" (the alert above says the same) are gone; the ring lives on Reports. */}
      <GoalStrip />
      <Upcoming />

      {slices.length > 0 && (
        <Card className="where">
          <SectionTitle trailing={<Link to="/reports" className="link">{t('See all')}</Link>}>{t('Where it went')}</SectionTitle>
          <ul className="legend">
            {slices.slice(0, 3).map((x, i) => (
              <li key={x.catId}>
                <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="grow ellipsis">{x.name}</span>
                <span className="legend-pct">{Math.round((x.actual / sliceTotal) * 100)}%</span>
                <strong className="legend-amount">{fmt(x.actual)}</strong>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <SectionTitle
          trailing={
            <Link to="/expenses" className="link">
              {t('See all')}
            </Link>
          }
        >
          {t('Recent transactions')}
        </SectionTitle>
        {data.recent.length === 0 ? <Empty text={t('Nothing logged yet.')} /> : data.recent.map((x) => <TxnTile key={`${x.kind}-${x.id}`} t={x} />)}
      </Card>

      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title={`${t('Income & plans')} · ${monthLabel(month)}`}>
        {settingsOpen && <SettingsForm onDone={() => setSettingsOpen(false)} />}
      </Sheet>


      <Sheet open={quickAdd} onClose={() => setQuickAdd(false)} title={t('Quick add')}>
        {quickAdd && <ExpenseForm quick onDone={() => setQuickAdd(false)} />}
      </Sheet>
    </div>
  );
}

/** Option E's "This week": spending per day, Saturday to Friday (the Egyptian week), today in lime. */
function WeekChart({ expenses }: { expenses: Expense[] }) {
  const { fmt } = useApp();
  const today = todayIso();
  const [y, m, d] = today.split('-').map(Number);
  const now = new Date(Date.UTC(y, m - 1, d));
  const back = (now.getUTCDay() + 1) % 7; // days since Saturday
  const days = Array.from({ length: 7 }, (_, k) => new Date(Date.UTC(y, m - 1, d - back + k)).toISOString().slice(0, 10));
  const sums = days.map((iso) => expenses.filter((e) => e.date === iso).reduce((s, e) => s + e.amount, 0));
  const total = sums.reduce((s, v) => s + v, 0);
  const max = Math.max(1, ...sums);
  const label = (iso: string) => new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
  return (
    <Card className="week">
      <div className="week-head">
        <span>{t('This week')}</span>
        <span className="num">{fmt(total)}</span>
      </div>
      <div className="week-bars" role="img" aria-label={t('Spending per day this week: {amount} in total', { amount: fmt(total) })}>
        {days.map((iso, k) => (
          <div key={iso} className={`week-day ${iso === today ? 'today' : ''}`}>
            <span className="week-bar" style={{ height: `${Math.max(6, (sums[k] / max) * 70)}px` }} />
            {label(iso)}
          </div>
        ))}
      </div>
    </Card>
  );
}

/** 2.1.0: the bar under "Your budget left" fills with what is left (it used to fill with what was used). */
function Bar2({ value, over }: { value: number; over: boolean }) {
  const v = over ? 1 : 1 - Math.max(0, Math.min(1, value));
  return (
    <div className="bar" style={{ margin: '16px 0 10px' }}>
      {/* Over budget: the whole bar turns red ("nothing left"), never a full dark bar that reads as "all left". */}
      <div className={`bar-fill ${over ? 'is-over' : ''}`} style={{ width: `${v * 100}%`, background: over ? COLORS.red : COLORS.accent }} />
    </div>
  );
}

/** One line of the top card's sum ("Spent − 11,900 EGP"); tapping it opens where that number comes from. */
function SumRow({ label, value, hint, onClick }: { label: string; value: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" className="sum-row" onClick={onClick}>
      <span className="mute">{label}</span>
      {hint && <span className="sum-hint">{hint}</span>}
      <span className="sum-value">{value}</span>
      <ChevronRight size={15} className="flip-rtl mute" aria-hidden="true" />
    </button>
  );
}

/** "Good morning, {name}" by the phone's clock. */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning, {name}' : h < 17 ? 'Good afternoon, {name}' : 'Good evening, {name}';
}

/** One round quick-action button with a pastel icon and its label underneath. */
function QuickAction({ icon: Icon, label, tone, onClick }: { icon: LucideIcon; label: string; tone: string; onClick: () => void }) {
  return (
    <button type="button" className="quick-action" onClick={onClick}>
      <span className={`qa-icon tone-${tone}`} aria-hidden="true">
        <Icon size={22} />
      </span>
      <span className="qa-label">{label}</span>
    </button>
  );
}

const GOAL_TONES = ['sky', 'lavender', 'mint', 'sand', 'coral', 'pink'];

/** Savings goals as pastel cards in a sideways row (Financy-style). Hidden when there are none. */
function GoalStrip() {
  const { data, fmt } = useApp();
  const goals = data?.goals ?? [];
  if (!goals.length) return null;
  return (
    <section className="goal-strip-wrap" aria-label={t('Savings goals')}>
      <SectionTitle trailing={<Link to="/savings" className="link">{t('See all')}</Link>}>{t('Savings goals')}</SectionTitle>
      <div className="goal-strip">
        {goals.map((g, i) => {
          const bal = g.balance ?? 0;
          const p = goalProgress(g, bal);
          return (
            <Link key={g.id} to={`/savings/${g.id}`} className={`goal-card tone-${GOAL_TONES[i % GOAL_TONES.length]}`}>
              <strong className="goal-name">{g.name}</strong>
              <span className="goal-amount">{fmt(bal)}</span>
              <span className="goal-of">{t('of {amount}', { amount: fmt(g.target) })}</span>
              <span className="goal-bar" aria-hidden="true">
                <span style={{ width: `${Math.round(p * 100)}%` }} />
              </span>
              <span className="goal-pct">{Math.round(p * 100)}%</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/** Fintech's "Scheduled payments": the next recurring expenses with their dates. Hidden when there are none. */
function Upcoming() {
  const { data, fmt } = useApp();
  const q = useQuery({ queryKey: ['recurring'], queryFn: () => api<{ rules: RecurringRule[] }>('/recurring') });
  const next = (q.data?.rules ?? [])
    .filter((r) => !r.paused && r.nextDate)
    .sort((a, b) => (a.nextDate! < b.nextDate! ? -1 : 1))
    .slice(0, 3);
  if (!next.length) return null;
  return (
    <Card className="upcoming">
      <SectionTitle trailing={<Link to="/expenses?recurring=1" className="link">{t('See all')}</Link>}>{t('Upcoming payments')}</SectionTitle>
      {next.map((r) => {
        const cat = data?.categories.find((c) => c.id === r.categoryId);
        return (
          <div key={r.id} className="txn">
            <CategoryIcon cat={cat ?? { name: r.description }} fallbackColor={COLORS.text} />
            <div className="txn-main">
              <div className="txn-title">{r.description || cat?.name}</div>
              <div className="tiny mute">{t('Next: {date}', { date: shortDate(r.nextDate!) })}</div>
            </div>
            <span className="txn-amount">{fmt(r.amount)}</span>
          </div>
        );
      })}
    </Card>
  );
}