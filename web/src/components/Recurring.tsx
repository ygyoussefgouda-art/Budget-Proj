import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Plus, Repeat } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type { DueItem, RecurringRule } from '../domain/calc';
import { parseMoney, plain } from '../domain/money';
import { t } from '../i18n';
import { ordinal, shortDate, todayIso, useApp } from '../state';
import { useOverlay } from './Overlays';
import { AddButton, Card, COLORS, DeleteButton, Empty, Field, FormError, MoneyInput, Pill, SaveButton, SectionTitle, tint } from './ui';

/** "Due" recurring expenses with one-tap Add / Skip. Shown on Home and on Expenses; hidden when nothing is due. */
export function DueList() {
  const { data, fmt, catName, refresh } = useApp();
  const { toast } = useOverlay();
  const [busy, setBusy] = useState<string | null>(null);
  const due = data?.recurringDue ?? [];
  if (!due.length) return null;

  const act = async (d: DueItem, action: 'add' | 'skip') => {
    setBusy(`${d.ruleId}:${d.date}`);
    try {
      await api(`/recurring/${d.ruleId}/${action}`, 'POST', { date: d.date });
      toast(action === 'add' ? t('Added to your expenses.') : t('Skipped.'));
    } catch (e) {
      toast((e as Error).message);
    }
    await refresh();
    setBusy(null);
  };

  return (
    <Card className="due-card">
      <SectionTitle trailing={<Pill color={COLORS.highlight}>{due.length === 1 ? t('1 due') : t('{n} due', { n: due.length })}</Pill>}>
        {t('Recurring expenses')}
      </SectionTitle>
      {due.map((d) => {
        const name = d.description || catName(d.categoryId);
        const key = `${d.ruleId}:${d.date}`;
        return (
          <div key={key} className="due-row">
            <span className="avatar" style={{ color: COLORS.highlight, background: tint(COLORS.highlight, 14) }} aria-hidden="true">
              <Repeat size={17} />
            </span>
            <span className="grow due-text">
              <span className="txn-title">{name}</span>
              <span className="tiny mute block">
                {t('Due {date}', { date: shortDate(d.date) })} · {catName(d.categoryId)}
              </span>
            </span>
            <span className="txn-amount">{fmt(d.amount)}</span>
            <span className="due-actions">
              <button
                type="button"
                className="btn text small"
                disabled={busy === key}
                aria-label={t('Skip {name} on {date}', { name, date: shortDate(d.date) })}
                onClick={() => act(d, 'skip')}
              >
                {t('Skip')}
              </button>
              <button
                type="button"
                className="add-btn"
                disabled={busy === key}
                aria-label={t('Add {name} on {date}', { name, date: shortDate(d.date) })}
                onClick={() => act(d, 'add')}
              >
                <Plus size={15} strokeWidth={2.6} />
                <span>{t('Add')}</span>
              </button>
            </span>
          </div>
        );
      })}
    </Card>
  );
}

/** Sheet content: the list of recurring expenses, with add / edit / pause / delete. */
export function RecurringManager() {
  const { fmt, catName, refresh } = useApp();
  const { confirm, toast } = useOverlay();
  const list = useQuery({ queryKey: ['recurring'], queryFn: () => api<{ rules: RecurringRule[] }>('/recurring') });
  const [form, setForm] = useState<{ edit?: RecurringRule } | null>(null);

  if (form) return <RuleForm edit={form.edit} onDone={() => setForm(null)} />;

  const rules = list.data?.rules ?? [];
  const del = async (r: RecurringRule) => {
    const name = r.description || catName(r.categoryId);
    if (!(await confirm(t('Delete "{name}"?', { name }), t('It stops coming back every month. Expenses it already added stay.')))) return;
    try {
      await api(`/recurring/${r.id}`, 'DELETE');
      await refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const status = (r: RecurringRule) => {
    if (r.paused) return t('Paused');
    if (!r.nextDate) return t('Ended');
    const next = t('Next: {date}', { date: shortDate(r.nextDate) });
    return r.autoAdd ? `${next} · ${t('Adds itself')}` : next;
  };

  return (
    <div className="form">
      <SectionTitle trailing={<AddButton onClick={() => setForm({})} title={t('Add a recurring expense')} />}>
        {t('Every month')}
      </SectionTitle>
      <p className="tiny mute">{t('Rent, subscriptions, transport cards… When one is due it shows on Home and Expenses with Add or Skip.')}</p>
      {list.isError && <p className="form-error">{(list.error as Error).message}</p>}
      {!list.isLoading && rules.length === 0 && <Empty text={t('No recurring expenses yet.')} icon={Repeat} />}
      <div className="list">
        {rules.map((r) => {
          const name = r.description || catName(r.categoryId);
          return (
            <div key={r.id} className={`list-item ${r.paused ? 'is-paused' : ''}`}>
              <button type="button" className="list-main" onClick={() => setForm({ edit: r })}>
                <span className="avatar" style={{ color: COLORS.accent, background: tint(COLORS.accent, 14) }} aria-hidden="true">
                  <Repeat size={17} />
                </span>
                <span className="grow">
                  <span className="txn-title">{name}</span>
                  <span className="tiny mute block">
                    {t('Every month on the {day}', { day: ordinal(r.day) })} · {catName(r.categoryId)}
                  </span>
                  <span className="tiny block" style={{ color: r.paused ? 'var(--mute)' : COLORS.accent }}>
                    {status(r)}
                  </span>
                </span>
                <span className="txn-amount">{fmt(r.amount)}</span>
              </button>
              <DeleteButton label={t('Delete {name}', { name })} onClick={() => del(r)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RuleForm({ edit, onDone }: { edit?: RecurringRule; onDone: () => void }) {
  const { data, user, refresh } = useApp();
  const { toast } = useOverlay();
  const cats = data?.categories ?? [];
  const [amount, setAmount] = useState(edit ? plain(edit.amount) : '');
  const [catId, setCatId] = useState<number>(edit?.categoryId ?? cats[0]?.id ?? 0);
  const [desc, setDesc] = useState(edit?.description ?? '');
  const [day, setDay] = useState<number>(edit?.day ?? Number(todayIso().slice(8, 10)));
  const [end, setEnd] = useState(edit?.endDate ?? '');
  const [autoAdd, setAutoAdd] = useState(edit?.autoAdd ?? false);
  const [paused, setPaused] = useState(edit?.paused ?? false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = parseMoney(amount);
    if (v === null || v <= 0) return setErr(t('Enter an amount greater than 0.'));
    if (!catId) return setErr(t('Pick a valid category.'));
    setBusy(true);
    try {
      const body = { categoryId: catId, amount: v, description: desc.trim(), day, endDate: end || null, autoAdd, paused };
      await api(edit ? `/recurring/${edit.id}` : '/recurring', edit ? 'PUT' : 'POST', body);
      await refresh();
      toast(t('Saved.'));
      onDone();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  if (cats.length === 0) {
    return <p className="mute">{t('You have no spending categories yet. Add one on the Budget screen first.')}</p>;
  }

  return (
    <form onSubmit={submit} className="form">
      <button type="button" className="btn text small back-link" onClick={onDone}>
        <ArrowLeft size={16} className="flip-rtl" /> {t('All recurring expenses')}
      </button>
      <h3>{edit ? t('Edit recurring expense') : t('New recurring expense')}</h3>
      <Field label={t('Amount')}>
        <MoneyInput value={amount} onChange={setAmount} suffix={user.currency} autoFocus={!edit} />
      </Field>
      <Field label={t('Category')}>
        <select className="input" value={catId} onChange={(e) => setCatId(Number(e.target.value))}>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('What for? (optional)')}>
        <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} placeholder={t('e.g. Rent, Internet')} />
      </Field>
      <Field label={t('Every month on day')} hint={t('29, 30 or 31: in shorter months it uses the last day.')}>
        <select className="input" value={day} onChange={(e) => setDay(Number(e.target.value))}>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {ordinal(d)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('Ends on (optional)')} hint={t('Leave empty to keep it going.')}>
        <div className="row gap">
          <input type="date" className="input grow" value={end} onChange={(e) => setEnd(e.target.value)} />
          {end && (
            <button type="button" className="btn text small" onClick={() => setEnd('')}>
              {t('Clear')}
            </button>
          )}
        </div>
      </Field>
      <label className="check">
        <input type="checkbox" checked={autoAdd} onChange={(e) => setAutoAdd(e.target.checked)} />
        <span>
          {t('Add it automatically')}
          <span className="tiny mute block">{t('Otherwise it shows as Due, and you tap Add or Skip.')}</span>
        </span>
      </label>
      {edit && (
        <label className="check">
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
          <span>
            {t('Paused')}
            <span className="tiny mute block">{t('Nothing comes due while paused. When you resume, it continues from today.')}</span>
          </span>
        </label>
      )}
      <FormError text={err} />
      <SaveButton label={edit ? t('Save changes') : t('Add recurring expense')} busy={busy} />
    </form>
  );
}
