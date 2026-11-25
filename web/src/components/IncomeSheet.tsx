import { Plus, Wallet } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { saveWithConfirm } from '../api';
import type { Income } from '../domain/calc';
import { parseMoney, plain } from '../domain/money';
import { t } from '../i18n';
import { DateChips } from '../pages/Expenses';
import { defaultDate, monthLabel, shortDate, useApp } from '../state';
import { useOverlay } from './Overlays';
import { COLORS, DeleteButton, Field, FormError, MoneyInput, SaveButton, SectionTitle } from './ui';
import { useUndoDelete } from './useUndoDelete';

/**
 * 2.2.0: everything coming in this month, in one place (Home's "Income" quick action and the band's
 * Income line): the fixed monthly income (set on the Budget form) and extra income entries on top
 * (freelance work, a gift, a bonus). Extra income counts in the month its date falls in.
 */
export function IncomePanel({ onEditMonthly }: { onEditMonthly: () => void }) {
  const { data, summary: s, fmt, month } = useApp();
  const undoDelete = useUndoDelete();
  const [form, setForm] = useState<{ edit?: Income } | null>(null);
  if (!data || !s) return null;
  const extras = data.incomes ?? [];

  if (form) {
    return <IncomeForm edit={form.edit} onDone={() => setForm(null)} />;
  }

  return (
    <div className="form">
      <div className="income-total">
        <span className="mute small">{t('Coming in this month')}</span>
        <strong className="big-value">{fmt(s.income)}</strong>
      </div>

      <button type="button" className="income-line" onClick={onEditMonthly}>
        <span className="income-icon" aria-hidden="true">
          <Wallet size={18} />
        </span>
        <span className="grow">
          <span className="block">{t('Monthly income')}</span>
          <span className="tiny mute">{t('Your salary or allowance, the same every month')}</span>
        </span>
        <span className="income-right">
          <span className="income-amount">{fmt(s.fixedIncome)}</span>
          <span className="sum-hint">{t('Change')}</span>
        </span>
      </button>

      <SectionTitle>{t('Extra income in {month}', { month: monthLabel(month) })}</SectionTitle>
      {extras.length === 0 ? (
        <p className="small mute">{t('Got money on top of your usual income, like freelance work or a gift? Add it here and it counts in this month.')}</p>
      ) : (
        <div className="list">
          {extras.map((i) => (
            <div key={i.id} className="list-item">
              <button type="button" className="list-main" onClick={() => setForm({ edit: i })}>
                <span className="grow">
                  <span className="txn-title">{i.description || t('Extra income')}</span>
                  <span className="tiny mute block">{shortDate(i.date)}</span>
                </span>
                <span className="txn-amount" style={{ color: COLORS.accent }}>
                  +{fmt(i.amount)}
                </span>
              </button>
              <DeleteButton label={t('Delete extra income')} onClick={() => void undoDelete(`/incomes/${i.id}`)} />
            </div>
          ))}
        </div>
      )}
      <button type="button" className="btn tonal block" onClick={() => setForm({})}>
        <Plus size={18} aria-hidden="true" /> {t('Add extra income')}
      </button>
    </div>
  );
}

/** Add or edit one extra income entry: amount, what it was, and the day it came in. */
export function IncomeForm({ edit, onDone }: { edit?: Income; onDone: () => void }) {
  const { month, startDay, refresh, user } = useApp();
  const { confirm } = useOverlay();
  const [amount, setAmount] = useState(edit ? plain(edit.amount) : '');
  const [desc, setDesc] = useState(edit?.description ?? '');
  const [date, setDate] = useState(edit?.date ?? defaultDate(month, startDay));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const v = parseMoney(amount);
    if (v === null || v <= 0) return setErr(t('Enter an amount greater than 0.'));
    if (!date) return setErr(t('Pick a date.'));
    setBusy(true);
    setErr(null);
    try {
      const body = { date, amount: v, description: desc.trim() };
      const saved = await saveWithConfirm(edit ? `/incomes/${edit.id}` : '/incomes', edit ? 'PUT' : 'POST', body, confirm);
      if (saved === false) return setBusy(false);
      await refresh();
      onDone();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="form">
      <Field label={t('Amount')}>
        <MoneyInput value={amount} onChange={setAmount} suffix={user.currency} autoFocus={!edit} calc />
      </Field>
      <Field label={t('What was it? (optional)')}>
        <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} placeholder={t('Freelance, gift, bonus…')} />
      </Field>
      <DateChips value={date} onChange={setDate} />
      <FormError text={err} />
      <SaveButton label={edit ? t('Save changes') : t('Add extra income')} busy={busy} />
      <button type="button" className="btn ghost block" onClick={onDone}>
        {t('Back')}
      </button>
    </form>
  );
}
