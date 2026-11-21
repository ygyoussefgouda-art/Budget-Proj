import {
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  HandCoins,
  Landmark,
  LineChart,
  PieChart,
  PiggyBank,
  Plus,
  Settings,
  ShoppingBag,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CategoryForm, SettingsForm, useRemoveCategory } from '../components/BudgetForms';
import { Donut } from '../components/charts';
import { Sheet } from '../components/Overlays';
import { QueuedList } from '../components/OfflineQueue';
import { DueList } from '../components/Recurring';
import { ExpenseForm } from './Expenses';
import { dailyAllowance, type Category } from '../domain/calc';
import { t } from '../i18n';
import { APP_VERSION, STAGE, VERSION_KEY } from '../version';
import { BudgetAlerts, BudgetRowTile, MonthBar, TxnTile } from '../components/rows';
import { AddButton, Card, COLORS, DeleteButton, Empty, Fab, IconBadge, IconButton, PageHeader, PALETTE, SectionTitle, StatTile } from '../components/ui';
import { monthLabel, shortDate, todayIso, useApp } from '../state';

export default function Dashboard() {
  const { data, summary: s, fmt, totals, month, startDay, user } = useApp();
  const nav = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [catEdit, setCatEdit] = useState<Category | 'new' | null>(null);
  const [params, setParams] = useSearchParams();
  // Home-screen shortcut "Add expense" opens /?add=expense: show the quick-add sheet right away.
  const [quickAdd, setQuickAdd] = useState(() => params.get('add') === 'expense');
  useEffect(() => {
    if (params.has('add')) setParams({}, { replace: true });
  }, [params, setParams]);
  const removeCategory = useRemoveCategory();
  if (!data || !s) return null;

  const left = s.moneyLeft;
  const usageIncome = s.income === 0 ? (s.actualTotal > 0 ? 1 : 0) : s.actualTotal / s.income;
  const usagePlan = s.plannedTotal === 0 ? 0 : s.actualTotal / s.plannedTotal;
  const savePlan = s.budget.savePlan;
  const slices = s.rows.filter((r) => r.catId !== null && r.actual > 0);
  const sliceTotal = slices.reduce((sum, r) => sum + r.actual, 0);
  // Only for the budget month we're in: what's left ÷ days remaining (today included).
  const allowance = dailyAllowance(left, todayIso(), month, startDay);

  return (
    <div className="page has-fab">
      <PageHeader
        left={<IconButton icon={Settings} label={t('Settings')} onClick={() => nav('/settings')} />}
        title={
          <span className="brand">
            <span dir="ltr">
              Budget <span style={{ color: COLORS.accent }}>me</span>
            </span>
            <span className="stage-badge" title={t(STAGE)}>
              {t(VERSION_KEY, { v: APP_VERSION })}
            </span>
          </span>
        }
        right={<IconButton icon={LineChart} label={t('Reports')} onClick={() => nav('/reports')} />}
      />
      <MonthBar />

      <Card className="hero">
        <div className="row between start">
          <div className="grow">
            <div className="mute small">{t('Your budget left')}</div>
            <div className="hero-value" style={{ color: left < 0 ? COLORS.red : undefined }}>
              {fmt(left)}
            </div>
          </div>
          <span className="hero-icon">
            <TrendingUp size={22} style={{ color: COLORS.accent }} />
          </span>
        </div>
        <Bar2 value={usageIncome} over={s.actualTotal > s.income} />
        <div className="row gap small">
          {usageIncome > 1 ? (
            <ArrowUp size={15} style={{ color: COLORS.red }} />
          ) : (
            <CheckCircle2 size={15} style={{ color: COLORS.accent }} />
          )}
          <span className="mute">
            {t('{pct}% of {income} income used', { pct: Math.round(usageIncome * 100), income: fmt(s.income) })}
          </span>
        </div>
        {allowance && (s.income > 0 || s.actualTotal > 0) && (
          <div className="allowance small" style={{ color: allowance.perDay < 0 ? COLORS.highlight : undefined }}>
            <CalendarDays size={15} aria-hidden="true" />
            <span>
              {t('You can spend {amount} a day until {date}', { amount: fmt(allowance.perDay), date: shortDate(allowance.until) })}
            </span>
          </div>
        )}
        {s.unallocated !== 0 && (
          <div className="tiny" style={{ color: s.unallocated < 0 ? COLORS.red : 'var(--mute)', marginTop: 4 }}>
            {s.unallocated < 0
              ? t('Your plan is {amount} over your income. Lower a category.', { amount: fmt(-s.unallocated) })
              : t('{amount} of income is not planned yet.', { amount: fmt(s.unallocated) })}
          </div>
        )}
      </Card>

      <BudgetAlerts rows={s.rows} />
      <DueList />
      <QueuedList categories={data.categories} currency={user.currency} />

      <div className="grid2">
        <MiniStat label={t('Income')} value={fmt(s.income)} icon={Wallet} color={COLORS.accent} onClick={() => setSettingsOpen(true)} />
        <MiniStat label={t('Expenses')} value={fmt(s.spending)} icon={ShoppingBag} color={COLORS.red} onClick={() => nav('/expenses')} />
      </div>

      <div className="grid2 tiles">
        <StatTile
          label={t('Saved this month')}
          value={fmt(s.netSaved)}
          color={COLORS.highlight}
          icon={PiggyBank}
          progress={savePlan > 0 ? Math.max(0, Math.min(1, s.netSaved / savePlan)) : undefined}
        />
        <StatTile
          label={t('Planned spending')}
          value={fmt(s.plannedTotal)}
          color={usagePlan > 1 ? COLORS.red : COLORS.highlight}
          icon={ClipboardCheck}
          progress={Math.max(0, Math.min(1, usagePlan))}
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
                  <strong>{fmt(x.actual)}</strong>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle
          trailing={
            <span className="row">
              <span className="mute small">{t('{pct}% of plan', { pct: Math.round(usagePlan * 100) })}</span>
              <AddButton onClick={() => setCatEdit('new')} title={t('Add a spending category')} />
            </span>
          }
        >
          {t('Budget usage')}
        </SectionTitle>
        {s.rows.map((r) => {
          const cat = data.categories.find((c) => c.id === r.catId);
          return (
            <div key={r.catId ?? r.name} className="cat-row">
              <BudgetRowTile
                r={r}
                onClick={() => (cat ? setCatEdit(cat) : setSettingsOpen(true))} // Savings / Loan rows -> plans
              />
              {cat ? (
                <DeleteButton label={t('Remove {name}', { name: cat.name })} onClick={() => removeCategory(cat)} />
              ) : (
                <span className="row-spacer" aria-hidden="true" />
              )}
            </div>
          );
        })}
        <p className="tiny mute">{t('Tap a row to change its budget.')}</p>
      </Card>

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
        {data.recent.length === 0 ? (
          <Empty text={t('Nothing logged yet.')} />
        ) : (
          data.recent.map((x) => <TxnTile key={`${x.kind}-${x.id}`} t={x} />)
        )}
      </Card>

      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title={`${t('Income & plans')} · ${monthLabel(month)}`}>
        {settingsOpen && <SettingsForm onDone={() => setSettingsOpen(false)} />}
      </Sheet>
      <Sheet open={!!catEdit} onClose={() => setCatEdit(null)} title={catEdit === 'new' ? t('New category') : t('Edit category')}>
        {catEdit && <CategoryForm edit={catEdit === 'new' ? undefined : catEdit} onDone={() => setCatEdit(null)} />}
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

function MiniStat({ label, value, icon, color, onClick }: { label: string; value: string; icon: typeof Wallet; color: string; onClick: () => void }) {
  return (
    <button type="button" className="card mini-stat stat-click" onClick={onClick} aria-label={t('{label}: {value}. Tap to edit', { label, value })}>
      <IconBadge icon={icon} color={color} size={40} />
      <div className="grow">
        <div className="tiny mute">{label}</div>
        <div className="mini-value">{value}</div>
      </div>
    </button>
  );
}
