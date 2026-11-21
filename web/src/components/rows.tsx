import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  HandCoins,
  PiggyBank,
  ShoppingBag,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { rowBar, rowLeft, rowMet, rowOver, rowStatus, type BudgetRow, type Txn } from '../domain/calc';
import { t } from '../i18n';
import { monthLabel, periodLabel, shiftMonth, shortDate, useApp } from '../state';
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
  const { fmt } = useApp();
  const color = rowOver(r) ? COLORS.red : r.isGoal ? (rowMet(r) ? COLORS.accent : COLORS.amber) : COLORS.accent;
  const left = rowLeft(r);
  const body = (
    <>
      <div className="row between">
        {/* "Savings" / "Loan repayments" are built-in rows: translate; category names are the user's own */}
        <strong>{r.catId === null ? t(r.name) : r.name}</strong>
        <Pill color={color}>{t(rowStatus(r))}</Pill>
      </div>
      <Bar value={rowBar(r)} color={color} />
      <div className="row between tiny">
        <span className="mute">
          {t('{a} of {b}', { a: fmt(r.actual), b: fmt(r.planned) })}
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

const TXN: Record<string, { icon: LucideIcon; color: string }> = {
  expense: { icon: ShoppingBag, color: COLORS.accent },
  deposit: { icon: PiggyBank, color: COLORS.blue },
  withdrawal: { icon: Undo2, color: COLORS.amber },
  borrow: { icon: ArrowDownLeft, color: COLORS.purple },
  received: { icon: ArrowDownLeft, color: COLORS.purple },
  repay: { icon: HandCoins, color: COLORS.red },
  lend: { icon: ArrowUpRight, color: COLORS.red },
};

/** Titles of savings/loan activity come from the server in English: rebuild them in the user's language. */
function txnText(x: Txn) {
  const name = (prefix: string, suffix = '') => x.title.slice(prefix.length, x.title.length - suffix.length);
  switch (x.kind) {
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
  const { fmt } = useApp();
  const pos = x.amount > 0;
  const { icon: Icon, color } = TXN[x.kind] ?? TXN.expense;
  const text = txnText(x);
  return (
    <div className="txn">
      <span className="badge" style={{ background: color, borderRadius: '50%' }}>
        <Icon size={19} color="#fff" />
      </span>
      <div className="txn-main">
        <div className="txn-title">{text.title}</div>
        <div className="tiny mute">
          {text.sub} · {shortDate(x.date)}
        </div>
      </div>
      <span className="txn-amount" style={{ color: pos ? COLORS.accent : COLORS.red }}>
        {pos ? '+' : '−'}
        {fmt(Math.abs(x.amount))}
      </span>
    </div>
  );
}
