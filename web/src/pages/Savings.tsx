import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Minus, Pencil, PiggyBank, Plus, Trash2, TrendingUp } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, saveWithConfirm } from '../api';
import { LineArea } from '../components/charts';
import { Sheet, useOverlay } from '../components/Overlays';
import { SwipeRow } from '../components/SwipeRow';
import { useUndoDelete } from '../components/useUndoDelete';
import {
  AddButton,
  Bar,
  Card,
  COLORS,
  DeleteButton,
  Empty,
  Field,
  FormError,
  IconButton,
  MoneyInput,
  PageHeader,
  Pill,
  RingIcon,
  SaveButton,
  SectionTitle,
  Segmented,
  tint,
} from '../components/ui';
import { goalForecast, goalMonthly, goalProgress, monthsToGoal, netSaved, remaining, type Goal, type GoalEntry } from '../domain/calc';
import { parseMoney, plain, plainOrEmpty, wholeUnits } from '../domain/money';
import { t } from '../i18n';
import { defaultDate, monthLabel, shortDate, thisMonth, useApp } from '../state';

function monthsText(m: number, monthly: string) {
  if (m === 0) return t('Goal reached');
  if (m < 0) return t('Set a monthly saving to see a date');
  return m === 1
    ? t('About 1 month at {amount} a month', { amount: monthly })
    : t('About {n} months at {amount} a month', { n: m, amount: monthly });
}

/**
 * 2.1.0: a goal shows one timeline. Once there are deposits with a real pace, the forecast below says when;
 * the "About N months at <plan> a month" line only shows before that (it disagreed with the forecast).
 */
function hasPace(g: Goal, balance: number, entries: GoalEntry[], startDay: number, planned: number) {
  const fc = goalForecast(g, balance, entries, thisMonth(startDay), planned, startDay);
  return !!fc && !fc.reached && fc.pace > 0;
}

/** "At this pace you'll reach Laptop in March 2027" + a "behind plan" hint, from the last 3 budget periods. */
function ForecastLines({ g, balance, planned, compact = false }: { g: Goal; balance: number; planned: number; compact?: boolean }) {
  const { data, fmt, startDay } = useApp();
  if (!data) return null;
  const fc = goalForecast(g, balance, data.goalEntries, thisMonth(startDay), planned, startDay);
  if (!fc || fc.reached) return null;
  return (
    <div className={`forecast ${compact ? 'tiny' : 'small'}`}>
      <div className="row gap">
        <TrendingUp size={compact ? 13 : 15} aria-hidden="true" style={{ color: COLORS.accent, flex: 'none' }} />
        <span>
          {fc.reach
            ? t("At this pace you'll reach {goal} in {month}", { goal: g.name, month: monthLabel(fc.reach) })
            : t('At this pace you won’t reach it: nothing saved lately.')}
        </span>
      </div>
      {!compact && fc.pace > 0 && (
        <div className="tiny mute">
          {fc.periods === 1
            ? t('Based on {amount} saved this month.', { amount: fmt(wholeUnits(fc.pace)) })
            : t('Based on {amount} a month, the average of the last {n} months.', { amount: fmt(wholeUnits(fc.pace)), n: fc.periods })}
        </div>
      )}
      {fc.behind && (
        <div className="behind" style={{ color: COLORS.highlight }}>
          {t('Behind plan: saving about {pace} a month, planned {planned}.', { pace: fmt(wholeUnits(Math.max(0, fc.pace))), planned: fmt(planned) })}
        </div>
      )}
    </div>
  );
}

/** 2.0.0: each goal is a pastel card (Financy-style); same order of tones as the cards on Home. */
const GOAL_TONES = ['sky', 'lavender', 'mint', 'sand', 'coral', 'pink'];

export default function Savings() {
  const { data, summary, fmt, totals, month, startDay } = useApp();
  const nav = useNavigate();
  const [form, setForm] = useState(false);
  const undoDelete = useUndoDelete();
  if (!data || !summary) return null;

  // Deletes the goal and its entries at once; Undo in the toast brings all of it back.
  const deleteGoal = (g: Goal) => undoDelete(`/goals/${g.id}`, t('"{name}" deleted.', { name: g.name }));

  return (
    <div className="page">
      <PageHeader title={t('Savings')} />
      <Card className="hero">
        <div className="mute small">{t('Total savings')}</div>
        <div className="hero-value" style={{ color: COLORS.accent }}>{fmt(totals.totalSavings)}</div>
        <div className="tiny mute">
          {t('{amount} net saved in {month}', { amount: fmt(summary.netSaved), month: monthLabel(month) })}
        </div>
      </Card>

      <SectionTitle trailing={<AddButton onClick={() => setForm(true)} title={t('Add a savings goal')} />}>{t('Goals')}</SectionTitle>
      {data.goals.length === 0 && <Empty text={t('No savings goals yet. Tap "+ Add" to create one.')} art="goal" />}
      <div className="list">
        {data.goals.map((g, i) => {
          const bal = g.balance ?? 0;
          const rem = remaining(g, bal);
          const prog = goalProgress(g, bal);
          const monthly = goalMonthly(g, data.goals, data.budget.savePlan);
          const months = monthsToGoal(rem, monthly);
          return (
            <div key={g.id} className={`list-item goal-card-row tone-${GOAL_TONES[i % GOAL_TONES.length]}`}>
              <button type="button" className="list-row grow" onClick={() => nav(`/savings/${g.id}`)}>
                <div className="row gap">
                  <RingIcon icon={PiggyBank} color={COLORS.highlight} progress={prog} size={52} />
                  <div className="grow">
                    <div className="row between">
                      <strong className="big-name">{g.name}</strong>
                      <Pill color={COLORS.accent}>{Math.round(prog * 100)}%</Pill>
                    </div>
                    <div className="small" style={{ fontWeight: 600, marginTop: 4 }}>
                      {t('{a} of {b}', { a: fmt(bal), b: fmt(g.target) })}
                    </div>
                    <div className="tiny mute">
                      {t('{amount} to go', { amount: fmt(rem) })}
                      {!hasPace(g, bal, data.goalEntries, startDay, monthly) && <> · {monthsText(months, fmt(monthly))}</>}
                    </div>
                    <ForecastLines g={g} balance={bal} planned={monthly} compact />
                  </div>
                </div>
              </button>
              <DeleteButton label={t('Delete {name}', { name: g.name })} onClick={() => deleteGoal(g)} />
            </div>
          );
        })}
      </div>

      <Sheet open={form} onClose={() => setForm(false)} title={t('New savings goal')}>
        {form && <GoalForm onDone={() => setForm(false)} />}
      </Sheet>
    </div>
  );
}

export function GoalDetail() {
  const { id } = useParams();
  const goalId = Number(id);
  const { data, fmt, month, startDay } = useApp();
  const nav = useNavigate();
  const [editGoal, setEditGoal] = useState(false);
  const [entryForm, setEntryForm] = useState<{ deposit: boolean; edit?: GoalEntry } | null>(null);
  const undoDelete = useUndoDelete();
  if (!data) return null;
  const g = data.goals.find((x) => x.id === goalId);
  if (!g) {
    return (
      <div className="page">
        <PageHeader title={t('Goal')} left={<IconButton icon={ArrowLeft} label={t('Back')} onClick={() => nav('/savings')} flip />} />
        <Empty text={t('This goal no longer exists.')} />
        <button type="button" className="btn tonal block" onClick={() => nav('/savings')}>
          {t('Back to Savings')}
        </button>
      </div>
    );
  }
  const bal = g.balance ?? 0;
  const rem = remaining(g, bal);
  const prog = goalProgress(g, bal);
  const monthly = goalMonthly(g, data.goals, data.budget.savePlan);
  const months = monthsToGoal(rem, monthly);
  const entries = data.goalEntries.filter((e) => e.goalId === goalId); // oldest first
  const points = [g.start];
  for (const e of entries) points.push(points[points.length - 1] + (e.deposit ? e.amount : -e.amount));

  const delGoal = async () => {
    if (await undoDelete(`/goals/${g.id}`, t('"{name}" deleted.', { name: g.name }))) nav('/savings');
  };
  // Deletes at once, with Undo in the toast.
  const delEntry = (e: GoalEntry) => undoDelete(`/goal-entries/${e.id}`);

  return (
    <div className="page">
      <PageHeader
        title={g.name}
        left={<IconButton icon={ArrowLeft} label={t('Back')} onClick={() => nav('/savings')} flip />}
        right={
          <div className="row">
            <IconButton icon={Pencil} label={t('Edit goal')} onClick={() => setEditGoal(true)} />
            <IconButton icon={Trash2} label={t('Delete goal')} onClick={delGoal} />
          </div>
        }
      />
      <Card className="hero">
        <div className="mute small">{t('{pct}% there', { pct: Math.round(prog * 100) })}</div>
        <div className="hero-value" style={{ color: COLORS.accent }}>{fmt(bal)}</div>
        <div style={{ margin: '12px 0 8px' }}>
          <Bar value={prog} />
        </div>
        <div className="tiny mute">{t('Target {a} · {b} remaining', { a: fmt(g.target), b: fmt(rem) })}</div>
        {!hasPace(g, bal, data.goalEntries, startDay, monthly) && <div className="tiny mute">{monthsText(months, fmt(monthly))}</div>}
        <div className="tiny mute">
          {t('{amount} net saved in {month}', { amount: fmt(netSaved(data.goalEntries, month, goalId, startDay)), month: monthLabel(month) })}
        </div>
        <ForecastLines g={g} balance={bal} planned={monthly} />
      </Card>

      <div className="grid2">
        <button className="btn primary pill-btn" onClick={() => setEntryForm({ deposit: true })}>
          <Plus size={18} /> {t('Deposit')}
        </button>
        <button className="btn outline pill-btn" onClick={() => setEntryForm({ deposit: false })}>
          <Minus size={18} /> {t('Withdraw')}
        </button>
      </div>

      {points.length > 1 && (
        <Card>
          <SectionTitle>{t('Progress over time')}</SectionTitle>
          <div className="chart-ltr">
            <LineArea points={points} max={Math.max(g.target, ...points)} color={COLORS.accent} />
          </div>
          <p className="tiny mute">{t('Each point is one deposit or withdrawal. The top of the chart is your target.')}</p>
        </Card>
      )}

      <SectionTitle trailing={<AddButton onClick={() => setEntryForm({ deposit: true })} title={t('Add a deposit or withdrawal')} />}>
        {t('History')}
      </SectionTitle>
      {entries.length === 0 && <Empty text={t('No deposits or withdrawals yet.')} />}
      <div className="list">
        {[...entries].reverse().map((e) => {
          const color = e.deposit ? COLORS.accent : COLORS.text; // same rule as everywhere: "+" green, "−" ink
          const Icon = e.deposit ? ArrowUpRight : ArrowDownLeft;
          return (
            <SwipeRow key={e.id} className="list-item" onDelete={() => delEntry(e)} onEdit={() => setEntryForm({ deposit: e.deposit, edit: e })}>
              <button className="list-main" onClick={() => setEntryForm({ deposit: e.deposit, edit: e })}>
                <span className="avatar" style={{ background: tint(color, 14), color }}>
                  <Icon size={19} className="flip-rtl" />
                </span>
                <span className="grow">
                  <span className="txn-title">{e.deposit ? t('Deposit') : t('Withdrawal')}</span>
                  <span className="tiny mute block">
                    {shortDate(e.date)}
                    {e.note ? ` · ${e.note}` : ''}
                  </span>
                </span>
                <span className="txn-amount" style={{ color }}>
                  {e.deposit ? '+' : '−'}
                  {fmt(e.amount)}
                </span>
              </button>
              <DeleteButton label={t('Delete entry')} onClick={() => delEntry(e)} />
            </SwipeRow>
          );
        })}
      </div>

      <Sheet open={editGoal} onClose={() => setEditGoal(false)} title={t('Edit goal')}>
        {editGoal && <GoalForm edit={g} onDone={() => setEditGoal(false)} />}
      </Sheet>
      <Sheet open={!!entryForm} onClose={() => setEntryForm(null)} title={entryForm?.edit ? t('Edit entry') : t('Add to savings')}>
        {entryForm && (
          <GoalEntryForm goalId={goalId} deposit={entryForm.deposit} edit={entryForm.edit} onDone={() => setEntryForm(null)} />
        )}
      </Sheet>
    </div>
  );
}

function GoalForm({ edit, onDone }: { edit?: Goal; onDone: () => void }) {
  const { refresh, user } = useApp();
  const [name, setName] = useState(edit?.name ?? '');
  const [target, setTarget] = useState(edit ? plain(edit.target) : '');
  const [start, setStart] = useState(edit ? plainOrEmpty(edit.start) : '');
  const [monthly, setMonthly] = useState(edit && edit.monthly > 0 ? plain(edit.monthly) : '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const n = name.trim();
    const tg = parseMoney(target);
    const s = start.trim() === '' ? 0 : parseMoney(start);
    const m = monthly.trim() === '' ? 0 : parseMoney(monthly);
    if (!n) return setErr(t('Enter a goal name.'));
    if (tg === null || tg <= 0) return setErr(t('Enter a target amount greater than 0.'));
    if (s === null || m === null) return setErr(t('Check the amounts you entered.'));
    setBusy(true);
    try {
      const body = { name: n, target: tg, start: s, monthly: m };
      await api(edit ? `/goals/${edit.id}` : '/goals', edit ? 'PUT' : 'POST', body);
      await refresh();
      onDone();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="form">
      <Field label={t('Saving for')}>
        <input className="input" value={name} autoFocus={!edit} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </Field>
      <Field label={t('Target amount')}>
        <MoneyInput value={target} onChange={setTarget} suffix={user.currency} />
      </Field>
      <Field label={t('Already saved at the start')}>
        <MoneyInput value={start} onChange={setStart} suffix={user.currency} />
      </Field>
      <Field label={t('Planned per month (optional)')} hint={t('If empty, the goal gets an even share of your monthly saving plan.')}>
        <MoneyInput value={monthly} onChange={setMonthly} suffix={user.currency} />
      </Field>
      <FormError text={err} />
      <SaveButton label={t('Save')} busy={busy} />
    </form>
  );
}

function GoalEntryForm({ goalId, deposit: dep, edit, onDone }: { goalId: number; deposit: boolean; edit?: GoalEntry; onDone: () => void }) {
  const { month, refresh, user, startDay } = useApp();
  const { confirm } = useOverlay();
  const [deposit, setDeposit] = useState(edit?.deposit ?? dep);
  const [amount, setAmount] = useState(edit ? plain(edit.amount) : '');
  const [note, setNote] = useState(edit?.note ?? '');
  const [date, setDate] = useState(edit?.date ?? defaultDate(month, startDay));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const v = parseMoney(amount);
    if (v === null || v <= 0) return setErr(t('Enter an amount greater than 0.'));
    setBusy(true);
    try {
      const body = { date, deposit, amount: v, note: note.trim() };
      const ok = await saveWithConfirm(edit ? `/goal-entries/${edit.id}` : `/goals/${goalId}/entries`, edit ? 'PUT' : 'POST', body, confirm);
      if (ok === false) return setBusy(false);
      await refresh();
      onDone();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="form">
      <Segmented
        value={deposit ? 'in' : 'out'}
        onChange={(v) => setDeposit(v === 'in')}
        options={[
          { value: 'in', label: t('Deposit') },
          { value: 'out', label: t('Withdrawal') },
        ]}
      />
      <Field label={t('Amount')}>
        <MoneyInput value={amount} onChange={setAmount} suffix={user.currency} autoFocus={!edit} />
      </Field>
      <Field label={t('Note (optional)')}>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </Field>
      <Field label={t('Date')}>
        <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      <FormError text={err} />
      <SaveButton label={edit ? t('Save changes') : t('Save')} busy={busy} />
    </form>
  );
}
