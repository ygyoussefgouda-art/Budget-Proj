import {
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  HandCoins,
  Landmark,
  LineChart,
  PieChart,
  PiggyBank,
  Plus,
  Settings,
  Wallet,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SettingsForm } from '../components/BudgetForms';
import Brand, { BrandMark } from '../components/Brand';
import { Sheet } from '../components/Overlays';
import { QueuedList } from '../components/OfflineQueue';
import { DueList } from '../components/Recurring';
import { ExpenseForm } from './Expenses';
import { alertLevel, dailyAllowance, type Expense } from '../domain/calc';
import { wholeUnits } from '../domain/money';
import { locale, t } from '../i18n';
import { BudgetAlerts, MonthBar, TxnTile } from '../components/rows';
import { Card, COLORS, Empty, Fab, IconButton, PageHeader, PALETTE, SectionTitle, StatTile } from '../components/ui';
import { monthLabel, shortDate, thisMonth, todayIso, useApp } from '../state';


export default function Dashboard() {
  const { data, summary: s, fmt, totals, month, startDay, user } = useApp();
  const nav = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  // Home-screen shortcut "Add expense" opens /?add=expense: show the quick-add sheet right away.
  const [quickAdd, setQuickAdd] = useState(() => params.get('add') === 'expense');
  useEffect(() => {
    if (params.has('add')) setParams({}, { replace: true });
  }, [params, setParams]);
  if (!data || !s) return null;

  const left = s.moneyLeft;
  const usageIncome = s.income === 0 ? (s.actualTotal > 0 ? 1 : 0) : s.actualTotal / s.income;
  const usagePlan = s.plannedTotal === 0 ? 0 : s.actualTotal / s.plannedTotal;
  const savePlan = s.budget.savePlan;
  // Biggest first, so the legend reads like a ranking and matches the donut's largest slices.
  const slices = s.rows.filter((r) => r.catId !== null && r.actual > 0).sort((a, b) => b.actual - a.actual);
  const sliceTotal = slices.reduce((sum, r) => sum + r.actual, 0);
  // Only for the budget month we're in: what's left ÷ days remaining (today included).
  const allowance = dailyAllowance(left, todayIso(), month, startDay);
  // A month with no income and nothing logged: show the first step instead of a wall of zeros.
  const fresh = s.income === 0 && s.actualTotal === 0 && s.plannedTotal === 0;
  const nothingElse = fresh && totals.totalSavings === 0 && totals.owedByMe === 0 && totals.owedToMe === 0;
  const spendRows = s.rows.filter((r) => r.catId !== null);
  const atRisk = spendRows.filter((r) => alertLevel(r) !== null).length;

  return (
    <div className="page has-fab">
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

      {fresh ? (
        <Card className="first-step">
          <span className="first-step-icon" aria-hidden="true">
            <Wallet size={22} />
          </span>
          <h2 className="first-step-title">{t("Start with this month's income")}</h2>
          <p className="mute small">
            {t('Enter what you get for {month}. Masrofy then shows what is left and how much you can spend each day.', { month: monthLabel(month) })}
          </p>
          <button type="button" className="btn primary block" onClick={() => setSettingsOpen(true)}>
            {t('Set your income')}
          </button>
        </Card>
      ) : (
        <Card className="hero">
          {/* Option E: the number itself is the hero, currency small in the brand colour */}
          <div className="hero-label">{t('Your budget left')}</div>
          <div className="hero-value" style={{ color: left < 0 ? COLORS.red : undefined }}>
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
            <SumRow label={t('Spent')} value={`− ${fmt(s.spending)}`} onClick={() => nav('/expenses')} />
            {s.netSaved !== 0 && <SumRow label={t('Saved')} value={`− ${fmt(s.netSaved)}`} onClick={() => nav('/savings')} />}
            {s.repaid !== 0 && <SumRow label={t('Repaid')} value={`− ${fmt(s.repaid)}`} onClick={() => nav('/loans')} />}
          </div>
          {allowance && (s.income > 0 || s.actualTotal > 0) && (
            <div className="allowance small" style={{ color: allowance.perDay < 0 ? COLORS.highlight : undefined }}>
              <CalendarDays size={15} aria-hidden="true" />
              <span>
                {t('You can spend {amount} a day until {date}', { amount: fmt(wholeUnits(allowance.perDay)), date: shortDate(allowance.until) })}
              </span>
            </div>
          )}
          {s.unallocated !== 0 && s.income > 0 && (
            <div className={`tiny ${s.unallocated < 0 ? 'over-note' : ''}`} style={{ marginTop: 8 }}>
              {s.unallocated < 0
                ? t('Your plan is {amount} over your income. Lower a category.', { amount: fmt(-s.unallocated) })
                : t('{amount} of income is not planned yet.', { amount: fmt(s.unallocated) })}
            </div>
          )}
        </Card>
      )}

      {!fresh && month === thisMonth(startDay) && <WeekChart expenses={data.expenses} />}
      <BudgetAlerts rows={s.rows} onOpen={() => nav('/budget')} />
      <DueList />
      <QueuedList categories={data.categories} currency={user.currency} />

      {!nothingElse && (
        <div className="grid2 tiles">
          <StatTile
            label={t('Saved this month')}
            value={fmt(s.netSaved)}
            color={COLORS.highlight}
            icon={PiggyBank}
            progress={savePlan > 0 ? Math.max(0, Math.min(1, s.netSaved / savePlan)) : undefined}
            progressLabel={t('of your saving plan')}
          />
          <StatTile
            label={t('Planned spending')}
            value={fmt(s.plannedTotal)}
            color={usagePlan > 1 ? COLORS.red : usagePlan >= 0.8 ? COLORS.amber : COLORS.accent}
            icon={ClipboardCheck}
            progress={s.plannedTotal > 0 ? Math.max(0, Math.min(1, usagePlan)) : undefined}
            progressLabel={t('of the plan used')}
          />
          <StatTile label={t('Total savings')} value={fmt(totals.totalSavings)} color={COLORS.highlight} icon={Landmark} />
          <StatTile
            label={t('Outstanding debts')}
            value={fmt(totals.owedByMe)}
            color={totals.owedByMe > 0 ? COLORS.amber : COLORS.accent}
            icon={HandCoins}
            sub={totals.owedToMe > 0 ? t('Owed to you: {amount}', { amount: fmt(totals.owedToMe) }) : undefined}
          />
        </div>
      )}

      <Card className="where">
        <SectionTitle trailing={slices.length > 0 ? <span className="where-total">{fmt(sliceTotal)}</span> : <span className="mute small">{monthLabel(month)}</span>}>
          {t('Where it went')}
        </SectionTitle>
        {slices.length === 0 ? (
          <Empty text={t('No expenses logged in this month.')} icon={PieChart} />
        ) : (
          <>
            {/* One stacked bar reads faster on a phone than a donut, and lines up with the ranked list under it */}
            <div className="stackbar" role="img" aria-label={t('Spending by category, biggest first')}>
              {slices.map((x, i) => (
                <span key={x.catId} style={{ flexGrow: x.actual, background: PALETTE[i % PALETTE.length] }} />
              ))}
            </div>
            <ul className="legend">
              {slices.map((x, i) => (
                <li key={x.catId}>
                  <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                  <span className="grow ellipsis">{x.name}</span>
                  <span className="legend-pct">{Math.round((x.actual / sliceTotal) * 100)}%</span>
                  <strong className="legend-amount">{fmt(x.actual)}</strong>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {/* Home is the glance: the full list (and editing it) lives on the Budget tab. */}
      {spendRows.length > 0 && !fresh && (
        <Link to="/budget" className="card budget-glance">
          <div className="grow">
            <strong className="block">{t('Budget usage')}</strong>
            <span className="small mute">
              {atRisk === 0
                ? t('All {n} categories are within budget.', { n: spendRows.length })
                : t('{n} of {total} categories need a look.', { n: atRisk, total: spendRows.length })}
              {s.plannedTotal > 0 && ` · ${t('{pct}% of plan', { pct: Math.round(usagePlan * 100) })}`}
            </span>
          </div>
          <span className="glance-link">
            {t('See all')}
            <ChevronRight size={16} className="flip-rtl" aria-hidden="true" />
          </span>
        </Link>
      )}
      {/* Reports was only reachable from the unlabelled chart icon in the header */}
      {!fresh && (
        <Link to="/reports" className="card budget-glance">
          <LineChart size={20} className="mute" aria-hidden="true" />
          <div className="grow">
            <strong className="block">{t('Reports')}</strong>
            <span className="small mute">{t('Compare with last month, see your year')}</span>
          </div>
          <ChevronRight size={16} className="flip-rtl glance-link" aria-hidden="true" />
        </Link>
      )}

      <Card>
        <SectionTitle
          trailing={
            <Link to="/expenses" className="link">
              {t('View all')}
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

      <Fab icon={Plus} label={t('Expense')} title={t('Quick add an expense')} onClick={() => setQuickAdd(true)} />
      <Sheet open={quickAdd} onClose={() => setQuickAdd(false)} title={t('Quick add')}>
        {quickAdd && <ExpenseForm quick onDone={() => setQuickAdd(false)} />}
      </Sheet>
    </div>
  );
}

/** "3,100 EGP" → big number + small currency (kept as text with a space, so it reads and copies as "3,100 EGP"). */
function HeroAmount({ text }: { text: string }) {
  const i = text.lastIndexOf(' ');
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="hero-cur"> {text.slice(i + 1)}</span>
    </>
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
  const label = (iso: string) => new Intl.DateTimeFormat(locale(), { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
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

function Bar2({ value, over }: { value: number; over: boolean }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="bar" style={{ margin: '16px 0 10px' }}>
      <div className="bar-fill" style={{ width: `${v * 100}%`, background: over ? COLORS.red : COLORS.accent }} />
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
