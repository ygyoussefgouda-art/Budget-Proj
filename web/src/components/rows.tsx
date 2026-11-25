import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  HandCoins,
  PiggyBank,
  Undo2,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { alertLevel, budgetAlerts, rowBar, rowLeft, rowMet, rowStatus, rowUnplanned, type BudgetAlert, type BudgetRow, type Txn } from '../domain/calc';
import { t } from '../i18n';
import { fmtTime, monthLabel, periodLabel, shiftMonth, shortDate, useApp } from '../state';
import { CategoryIcon } from './CategoryIcon';
import { Bar, COLORS, Pill } from './ui';

export function MonthBar() {
  const { month, setMonth, startDay } = useApp();
  return (
    <div className="month-bar">
      <button type="button" className="icon-btn" aria-label={t('Previous month')} onClick={() => setMonth(shiftMonth(month, -1))}>
        <ChevronLeft size={22} className="flip-rtl" />
      </button>
      <label className="month-pick">
        <CalendarDays size={17} className="mute" />
        <span className="month-pick-text">
          <span>{monthLabel(month)}</span>
          {startDay !== 1 && <span className="month-range">{periodLabel(month, startDay)}</span>}
        </span>
        <input
          type="month"
          value={month}
          aria-label={t('Pick a month')}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </label>
      <button type="button" className="icon-btn" aria-label={t('Next month')} onClick={() => setMonth(shiftMonth(month, 1))}>
        <ChevronRight size={22} className="flip-rtl" />
      </button>
    </div>
  );
}

export function BudgetRowTile({ r, onClick }: { r: BudgetRow; onClick?: () => void }) {
  const { fmt, data } = useApp();
  const cat = r.catId === null ? undefined : data?.categories.find((c) => c.id === r.catId);
  // Spending rows: amber from 80% of the budget, red at 100% and over (same colours as the alert banner).
  const alert = alertLevel(r);
  const color =
    alert === 'over' || alert === 'full'
      ? COLORS.red
      : alert === 'warn'
        ? COLORS.amber
        : rowUnplanned(r)
          ? COLORS.mute
          : r.isGoal && r.planned > 0 && !rowMet(r)
            ? COLORS.amber
            : COLORS.accent;
  const left = rowLeft(r);
  const body = (
    <>
      <div className="row between">
        <span className="row-name">
          {cat && (cat.icon || cat.color) && <CategoryIcon cat={cat} fallbackColor={COLORS.accent} size={15} />}
          {/* "Savings" / "Loan repayments" are built-in rows: translate; category names are the user's own */}
          <strong>{r.catId === null ? t(r.name) : r.name}</strong>
        </span>
        <Pill color={color}>{t(rowStatus(r))}</Pill>
      </div>
      <Bar value={rowBar(r)} color={color} />
      <div className="row between tiny">
        <span className="mute">
          {t('{a} of {b}', { a: fmt(r.actual), b: fmt(r.planned) })}
          {r.carried ? ` · ${t('{amount} carried over', { amount: fmt(r.carried) })}` : ''}
        </span>
        <span style={{ color: left >= 0 ? 'var(--mute)' : COLORS.red }}>
          {left >= 0 ? t('{amount} left', { amount: fmt(left) }) : t('{amount} over', { amount: fmt(-left) })}
        </span>
      </div>
    </>
  );
  return onClick ? (
    <button type="button" className="budget-row clickable" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="budget-row">{body}</div>
  );
}

/**
 * Banner on Home and Budget: categories that used 80% of their budget or more (red at 100%).
 * Hidden when everything is fine. 2.2.0: each line is a button that opens what caused it: that
 * category's expenses this month. "And N more" opens Budget, where every category is listed.
 */
export function BudgetAlerts({ rows }: { rows: BudgetRow[] }) {
  const { fmt } = useApp();
  const nav = useNavigate();
  const alerts = budgetAlerts(rows);
  if (!alerts.length) return null;
  const red = alerts.some((a) => a.level !== 'warn');
  const color = red ? COLORS.red : COLORS.amber;
  return (
    <div className={`alert-banner ${red ? 'is-red' : 'is-amber'}`} role="status">
      <AlertTriangle size={18} style={{ color, flex: 'none', marginTop: 2 }} aria-hidden="true" />
      <div className="grow">
        <strong className="small block">
          {alerts.length === 1 ? t('1 category needs a look') : t('{n} categories need a look', { n: alerts.length })}
        </strong>
        <ul className="alert-list">
          {alerts.slice(0, 4).map((a) => (
            <li key={a.catId}>
              <button
                type="button"
                className="alert-item"
                style={{ color: a.level === 'warn' ? COLORS.amber : COLORS.red }}
                onClick={() => nav(`/expenses?cat=${a.catId}`)}
                aria-label={`${alertText(a, fmt)}. ${t('See its expenses')}`}
              >
                <span className="grow">{alertText(a, fmt)}</span>
                <ChevronRight size={16} className="flip-rtl" aria-hidden="true" />
              </button>
            </li>
          ))}
          {alerts.length > 4 && (
            <li>
              <button type="button" className="alert-item mute" onClick={() => nav('/budget')}>
                <span className="grow">{t('and {n} more', { n: alerts.length - 4 })}</span>
                <ChevronRight size={16} className="flip-rtl" aria-hidden="true" />
              </button>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function alertText(a: BudgetAlert, fmt: (n: number) => string) {
  return a.level === 'over'
    ? t('{name}: over budget by {amount}', { name: a.name, amount: fmt(a.over) })
    : a.level === 'full'
      ? t('{name}: budget used up', { name: a.name })
      : t('{name}: {pct}% of the budget used', { name: a.name, pct: a.pct ?? 0 });
}

const TXN: Record<string, { icon: LucideIcon; color: string }> = {
  expense: { icon: ArrowUpRight, color: COLORS.red }, // not drawn: expenses use their category icon
  income: { icon: Wallet, color: COLORS.accent }, // 2.2.0: extra income
  deposit: { icon: PiggyBank, color: COLORS.blue },
  withdrawal: { icon: Undo2, color: COLORS.amber },
  borrow: { icon: ArrowDownLeft, color: COLORS.purple },
  received: { icon: ArrowDownLeft, color: COLORS.purple },
  repay: { icon: HandCoins, color: COLORS.accent }, // a debt getting smaller is good
  lend: { icon: ArrowUpRight, color: COLORS.purple },
};

/** Titles of savings/loan activity come from the server in English: rebuild them in the user's language. */
function txnText(x: Txn) {
  const name = (prefix: string, suffix = '') => x.title.slice(prefix.length, x.title.length - suffix.length);
  switch (x.kind) {
    case 'income':
      return { title: x.title === 'Extra income' ? t('Extra income') : x.title, sub: t('Extra income') };
    case 'deposit':
      return { title: t('Saved'), sub: x.sub };
    case 'withdrawal':
      return { title: t('Withdrawn'), sub: x.sub };
    case 'borrow':
      return { title: t('Borrowed from {name}', { name: name('Borrowed from ') }), sub: t('Loans') };
    case 'repay':
      return { title: t('Paid back {name}', { name: name('Paid back ') }), sub: t('Loans') };
    case 'lend':
      return { title: t('Lent to {name}', { name: name('Lent to ') }), sub: t('Loans') };
    case 'received':
      return { title: t('{name} paid me back', { name: name('', ' paid me back') }), sub: t('Loans') };
    default:
      return { title: x.title, sub: x.sub };
  }
}

export function TxnTile({ t: x }: { t: Txn }) {
  const { fmt, data } = useApp();
  const pos = x.amount > 0;
  const { icon: Icon, color } = TXN[x.kind] ?? TXN.expense;
  const text = txnText(x);
  // Expenses look the same as in the Expenses list: the category's own icon and colour (or its first letter).
  const cat = x.kind === 'expense' ? (data?.categories.find((c) => c.name === x.sub) ?? { name: x.sub }) : null;
  return (
    <div className="txn">
      {cat ? (
        <CategoryIcon cat={cat} fallbackColor={COLORS.text} />
      ) : (
        <span className="badge" style={{ background: color, borderRadius: '50%' }} aria-hidden="true">
          {/* on the brand colour (lime) the icon needs dark ink; other badges are dark enough for white */}
          <Icon size={19} color={color === COLORS.accent ? 'var(--on-accent)' : '#fff'} />
        </span>
      )}
      <div className="txn-main">
        <div className="txn-title">{text.title}</div>
        <div className="tiny mute">
          {text.sub} · {shortDate(x.date)}
          {x.time ? ` · ${fmtTime(x.time)}` : ''}
        </div>
      </div>
      {/* Spending is ordinary, so it's ink, not alarm red; money coming in is green */}
      <span className="txn-amount" style={{ color: pos ? COLORS.accent : COLORS.text }}>
        {pos ? '+' : '−'}
        {fmt(Math.abs(x.amount))}
      </span>
    </div>
  );
}
