import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { uniMonthly, type Category, type MonthBudget } from '../domain/calc';
import { num2, parseMoneyOrZero, parseNumOrZero, plainOrEmpty } from '../domain/money';
import { t } from '../i18n';
import { monthLabel, useApp } from '../state';
import { CategoryLookPicker } from './CategoryIcon';
import { useOverlay } from './Overlays';
import { Field, FormError, MoneyInput, SaveButton } from './ui';

/** Confirm, then remove a spending category (refused by the server if it still has expenses). */
export function useRemoveCategory() {
  const { refresh } = useApp();
  const { confirm, toast } = useOverlay();
  return async (c: Category) => {
    const ok = await confirm(t('Remove category?'), t('Remove "{name}"? Its budget for every month is removed.', { name: c.name }), t('Remove'));
    if (!ok) return;
    try {
      await api(`/categories/${c.id}`, 'DELETE');
      await refresh();
      toast(t('"{name}" removed.', { name: c.name }));
    } catch (e) {
      toast((e as Error).message); // e.g. it still has expenses
    }
  };
}

/** Monthly income and the savings / loan-repayment plans for the selected month. */
export function SettingsForm({ onDone }: { onDone: () => void }) {
  const { data, month, refresh, user } = useApp();
  const b = data!.budget;
  const [income, setIncome] = useState(plainOrEmpty(b.income));
  const [save, setSave] = useState(plainOrEmpty(b.savePlan));
  const [loan, setLoan] = useState(plainOrEmpty(b.loanPlan));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const i = parseMoneyOrZero(income), s = parseMoneyOrZero(save), l = parseMoneyOrZero(loan);
    if (i === null || s === null || l === null) return setErr(t('Use numbers only (leave a field empty for 0).'));
    setBusy(true);
    try {
      await saveBudget(month, b, { income: i, savePlan: s, loanPlan: l });
      await refresh();
      onDone();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="form">
      <Field label={t('Income for {month}', { month: monthLabel(month) })}>
        <MoneyInput value={income} onChange={setIncome} suffix={user.currency} autoFocus />
      </Field>
      <Field label={t('Monthly saving plan')}>
        <MoneyInput value={save} onChange={setSave} suffix={user.currency} />
      </Field>
      <Field label={t('Monthly loan repayment plan')}>
        <MoneyInput value={loan} onChange={setLoan} suffix={user.currency} />
      </Field>
      <p className="tiny mute">
        {t('Changes apply to {month}. New months start as a copy of the month before.', { month: monthLabel(month) })}
      </p>
      <FormError text={err} />
      <SaveButton label={t('Save')} busy={busy} />
    </form>
  );
}

/** Saves the month's budget settings, keeping any field not given. */
function saveBudget(month: string, b: MonthBudget, patch: Partial<Omit<MonthBudget, 'month' | 'plans'>>) {
  const next = { ...b, ...patch };
  return api(`/budget/${month}`, 'PUT', {
    income: next.income,
    uniDays: next.uniDays,
    uniWeeks: next.uniWeeks,
    uniCost: next.uniCost,
    savePlan: next.savePlan,
    loanPlan: next.loanPlan,
  });
}

/** Create, edit or delete a spending category. Any one category can use the per-day formula. */
export function CategoryForm({ edit, onDone }: { edit?: Category; onDone: () => void }) {
  const { data, month, refresh, fmt, user } = useApp();
  const { confirm } = useOverlay();
  const b = data!.budget;
  const otherPerDay = data!.categories.find((c) => c.isUni && c.id !== edit?.id);
  const [name, setName] = useState(edit?.name ?? '');
  const [perDay, setPerDay] = useState(edit?.isUni ?? false);
  const [icon, setIcon] = useState<string | null>(edit?.icon ?? null);
  const [color, setColor] = useState<string | null>(edit?.color ?? null);
  const [plan, setPlan] = useState(edit && !edit.isUni ? plainOrEmpty(b.plans[String(edit.id)] ?? 0) : '');
  const [days, setDays] = useState(b.uniDays ? num2(b.uniDays) : '');
  const [weeks, setWeeks] = useState(num2(b.uniWeeks || 4));
  const [cost, setCost] = useState(plainOrEmpty(b.uniCost));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set once the category exists: if the next step fails, Save again updates it instead of adding a copy.
  const [createdId, setCreatedId] = useState<number | null>(null);

  const d = parseNumOrZero(days), w = parseNumOrZero(weeks), c = parseMoneyOrZero(cost);
  const preview = d !== null && w !== null && c !== null ? uniMonthly({ ...b, uniDays: d, uniWeeks: w, uniCost: c }) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setErr(t('Enter a category name.'));
    let planned: number | null = 0;
    if (perDay) {
      if (d === null || w === null || c === null) return setErr(t('Fill days, weeks and cost with valid numbers.'));
      if (d > 7) return setErr(t('Days per week cannot be more than 7.'));
      if (w > 6) return setErr(t('Weeks per month cannot be more than 6.'));
    } else {
      planned = parseMoneyOrZero(plan);
      if (planned === null) return setErr(t('Enter a valid budget amount.'));
    }
    setBusy(true);
    try {
      const body = { name: n, month, perDay, icon, color, ...(perDay ? {} : { planned }) };
      const id = edit?.id ?? createdId;
      if (id) await api(`/categories/${id}`, 'PUT', body);
      else setCreatedId((await api<{ id: number }>('/categories', 'POST', body)).id);
      if (perDay) await saveBudget(month, b, { uniDays: d!, uniWeeks: w!, uniCost: c! });
      await refresh();
      onDone();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  const del = async () => {
    if (!edit) return;
    const ok = await confirm(t('Remove category?'), t('Remove "{name}"? Its budget for every month is removed.', { name: edit.name }), t('Remove'));
    if (!ok) return;
    try {
      await api(`/categories/${edit.id}`, 'DELETE');
      await refresh();
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    }
  };

  return (
    <form onSubmit={submit} className="form">
      <Field label={t('Name')}>
        <input className="input" value={name} autoFocus={!edit} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </Field>
      <CategoryLookPicker icon={icon} color={color} onIcon={setIcon} onColor={setColor} />

      <label className="check">
        <input type="checkbox" checked={perDay} onChange={(e) => setPerDay(e.target.checked)} />
        <span>
          {t('Budget per day')}
          <span className="tiny mute block">{t('Days per week × weeks per month × cost per day (e.g. uni, work, gym).')}</span>
        </span>
      </label>
      {perDay && otherPerDay && (
        <p className="tiny mute">{t('"{name}" uses this now; it will switch to a fixed budget.', { name: otherPerDay.name })}</p>
      )}

      {perDay ? (
        <>
          <div className="grid3">
            <Field label={t('Days / week')}>
              <input className="input" inputMode="decimal" placeholder="0" value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
            <Field label={t('Weeks / month')}>
              <input className="input" inputMode="decimal" placeholder="4" value={weeks} onChange={(e) => setWeeks(e.target.value)} />
            </Field>
            <Field label={t('Cost / day')}>
              <input className="input" inputMode="decimal" placeholder="0" value={cost} onChange={(e) => setCost(e.target.value)} />
            </Field>
          </div>
          <p className="small mute">
            {t('Monthly budget:')} <strong style={{ color: 'var(--text)' }}>{preview === null ? '—' : fmt(preview)}</strong>
          </p>
        </>
      ) : (
        <Field label={t('Monthly budget for {month}', { month: monthLabel(month) })}>
          <MoneyInput value={plan} onChange={setPlan} suffix={user.currency} />
        </Field>
      )}
      <FormError text={err} />
      <SaveButton label={t('Save')} busy={busy} />
      {edit && (
        <button type="button" className="btn text danger-text block" onClick={del}>
          {t('Remove category')}
        </button>
      )}
    </form>
  );
}
