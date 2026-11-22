import {
  ArrowUp,
  CalendarDays,
  CheckCircle2,
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
import Brand from '../components/Brand';
import { Donut } from '../components/charts';
import { Sheet } from '../components/Overlays';
import { QueuedList } from '../components/OfflineQueue';
import { DueList } from '../components/Recurring';
import { ExpenseForm } from './Expenses';
import { alertLevel, dailyAllowance } from '../domain/calc';
import { wholeUnits } from '../domain/money';
import { t } from '../i18n';
import { BudgetAlerts, MonthBar, TxnTile } from '../components/rows';
import { Card, COLORS, Empty, Fab, IconButton, PageHeader, PALETTE, SectionTitle, StatTile } from '../components/ui';
import { monthLabel, shortDate, todayIso, useApp } from '../state';


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
        left={<IconButton icon={Settings} label={t('Settings')} onClick={() => nav('/settings')} />}
        title={
          <span className="brand">
            <Brand />
          </span>
        }
        right={<IconButton icon={LineChart} label={t('Reports')} onClick={() => nav('/reports')} />}
      />
      <MonthBar />

      {fresh ? (
        <Card className="hero first-step">
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
          <div className="row between start">
            <div className="grow">
              <div className="mute small">{t('Your budget left')}</div>
              <div className="hero-value" style={{ color: left < 0 ? COLORS.red : undefined }}>
                {fmt(left)}
              </div>
            </div>
            {allowance && (
              <span className="hero-days" aria-label={t('{n} days left in this budget month', { n: allowance.days })}>
                <strong>{allowance.days}</strong>
                <span>{allowance.days === 1 ? t('day left') : t('days left')}</span>
              </span>
            )}
          </div>
          <Bar2 value={usageIncome} over={s.actualTotal > s.income} />
          <div className="row gap small">
            {usageIncome > 1 ? (
              <ArrowUp size={15} style={{ color: COLORS.red }} aria-hidden="true" />
            ) : (
              <CheckCircle2 size={15} style={{ color: COLORS.accent }} aria-hidden="true" />
            )}
            <span className="mute">{t('{pct}% of {income} income used', { pct: Math.round(usageIncome * 100), income: fmt(s.income) })}</span>
          </div>
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
            <div className="tiny" style={{ color: s.unallocated < 0 ? COLORS.red : 'var(--mute)', marginTop: 6 }}>
              {s.unallocated < 0
                ? t('Your plan is {amount} over your income. Lower a category.', { amount: fmt(-s.unallocated) })
                : t('{amount} of income is not planned yet.', { amount: fmt(s.unallocated) })}
            </div>
          )}
        </Card>
      )}

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
            color={usagePlan > 1 ? COLORS.red : COLORS.highlight}
            icon={ClipboardCheck}
            progress={s.plannedTotal > 0 ? Math.max(0, Math.min(1, usagePlan)) : undefined}
            progressLabel={t('of the plan used')}
          />
          <StatTile label={t('Total savings')} value={fmt(totals.totalSavings)} color={COLORS.accent} icon={Landmark} />
          <StatTile
            label={t('Outstanding debts')}
            value={fmt(totals.owedByMe)}
            color={totals.owedByMe > 0 ? COLORS.red : COLORS.highlight}
            icon={HandCoins}
            sub={totals.owedToMe > 0 ? t('Owed to you: {amount}', { amount: fmt(totals.owedToMe) }) : undefined}
          />
        </div>
      )}

      <Card>
        <SectionTitle trailing={<span className="mute small">{monthLabel(month)}</span>}>{t('Expense overview')}</SectionTitle>
        {slices.length === 0 ? (
          <Empty text={t('No expenses logged in this month.')} icon={PieChart} />
        ) : (
          <div className="overview">
            <Donut values={slices.map((x) => x.actual)} colors={PALETTE}>
              <strong className="donut-total">{fmt(sliceTotal)}</strong>
              <span className="tiny mute">{t('Total')}</span>
            </Donut>
            <ul className="legend">
              {slices.map((x, i) => (
                <li key={x.catId}>
                  <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                  <span className="grow ellipsis">{x.name}</span>
                  <span className="legend-amt">
                    <strong>{fmt(x.actual)}</strong>
                    <span className="legend-pct">{Math.round((x.actual / sliceTotal) * 100)}%</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
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
