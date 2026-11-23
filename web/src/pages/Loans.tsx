import { ArrowDownLeft, ArrowUpRight, HandCoins, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, saveWithConfirm } from '../api';
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
  MoneyInput,
  PageHeader,
  Pill,
  SaveButton,
  SectionTitle,
  Segmented,
  tint,
} from '../components/ui';
import { balances, outstanding, type LoanEntry } from '../domain/calc';
import { parseMoney, plain } from '../domain/money';
import { t } from '../i18n';
import { defaultDate, shortDate, useApp } from '../state';

export default function Loans() {
  const { data, fmt } = useApp();
  const { toast } = useOverlay();
  const undoDelete = useUndoDelete();
  const [borrowed, setBorrowed] = useState(true); // true = money I owe
  const [form, setForm] = useState<{ edit?: LoanEntry; person?: string } | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  if (!data) return null;

  const people = balances(data.loans, borrowed);
  const principal = people.reduce((s, p) => s + p.principal, 0);
  const repaid = people.reduce((s, p) => s + p.repaid, 0);
  const owed = outstanding(data.loans, borrowed); // overpaid people don't lower the total
  const accent = borrowed ? COLORS.amber : COLORS.accent; // owing is "watch this", not "over budget"
  const history = data.loans
    .filter((l) => l.borrowed === borrowed)
    .sort((x, y) => y.date.localeCompare(x.date) || y.id - x.id);

  // A person with all their entries, or one entry: deleted at once, with Undo in the toast.
  const removePerson = (name: string) =>
    undoDelete(`/loan-people?borrowed=${borrowed}&name=${encodeURIComponent(name)}`, t('{name} removed.', { name }));
  const del = (l: LoanEntry, _label: string) => undoDelete(`/loans/${l.id}`);

  return (
    <div className="page">
      <PageHeader title={t('Loans')} />
      <Segmented
        value={borrowed ? 'owe' : 'owed'}
        onChange={(v) => setBorrowed(v === 'owe')}
        options={[
          { value: 'owe', label: t('I owe') },
          { value: 'owed', label: t('Owed to me') },
        ]}
      />

      <Card className="hero">
        <div className="mute small">{borrowed ? t('Still owed by you') : t('Still owed to you')}</div>
        <div className="hero-value" style={{ color: owed > 0 ? accent : COLORS.accent }}>
          {fmt(Math.max(0, owed))}
        </div>
        <div style={{ margin: '12px 0 8px' }}>
          <Bar value={principal === 0 ? 0 : repaid / principal} />
        </div>
        <div className="tiny mute">
          {borrowed
            ? t('Borrowed {a} · repaid {b}', { a: fmt(principal), b: fmt(repaid) })
            : t('Lent {a} · received back {b}', { a: fmt(principal), b: fmt(repaid) })}
        </div>
      </Card>

      <SectionTitle
        trailing={<AddButton onClick={() => setForm({})} title={borrowed ? t('Add money you borrowed') : t('Add money you lent')} />}
      >
        {t('People')}
      </SectionTitle>
      {people.length === 0 && (
        <Empty text={borrowed ? t('You have not borrowed anything.') : t('You have not lent anything.')} icon={HandCoins} />
      )}
      <div className="list">
        {people.map((p) => (
          <div key={p.name.toLowerCase()} className="list-item">
            <button type="button" className="list-row grow" onClick={() => setPerson(p.name)}>
              <div className="row between">
                <strong className="big-name">{p.name}</strong>
                <Pill color={p.settled ? COLORS.accent : accent}>
                  {p.settled ? t('Paid off') : borrowed ? t('Owing') : t('Owed to you')}
                </Pill>
              </div>
              <div style={{ margin: '10px 0 6px' }}>
                <Bar value={p.principal === 0 ? 0 : p.repaid / p.principal} />
              </div>
              <div className="tiny mute">
                {borrowed
                  ? t('Borrowed {a}, repaid {b}, still owed {c}', { a: fmt(p.principal), b: fmt(p.repaid), c: fmt(Math.max(0, p.owed)) })
                  : t('Lent {a}, received {b}, still to receive {c}', { a: fmt(p.principal), b: fmt(p.repaid), c: fmt(Math.max(0, p.owed)) })}
              </div>
            </button>
            <DeleteButton label={t('Remove {name}', { name: p.name })} onClick={() => removePerson(p.name)} />
          </div>
        ))}
        {people.length > 0 && <p className="tiny mute">{t('Tap a person to rename them or add an entry for them.')}</p>}
      </div>
      <SectionTitle trailing={<AddButton onClick={() => setForm({})} title={t('Add a loan entry')} />}>{t('History')}</SectionTitle>
      {history.length === 0 && <Empty text={t('Nothing logged yet.')} />}
      <div className="list">
        {history.map((l) => {
          const inflow = l.borrowed ? !l.repayment : l.repayment;
          // Green = a debt getting smaller (paid back / received back); a new loan is neutral. The sign still shows cash in or out.
          const color = l.repayment ? COLORS.accent : COLORS.text;
          const label = l.borrowed ? (l.repayment ? t('Paid back') : t('Borrowed')) : l.repayment ? t('Received back') : t('Lent');
          const Icon = inflow ? ArrowDownLeft : ArrowUpRight;
          // An entry made by splitting an expense is changed on that expense (Expenses tab), not here.
          const locked = !!l.expenseId;
          const lockedTip = () => toast(t('This entry comes from a split expense. Edit or delete the expense instead.'));
          const edit = locked ? lockedTip : () => setForm({ edit: l });
          return (
            <SwipeRow key={l.id} className="list-item" onDelete={locked ? lockedTip : () => del(l, label)} onEdit={edit}>
              <button className="list-main" onClick={edit}>
                <span className="avatar" style={{ background: tint(color, 14), color }}>
                  <Icon size={19} className="flip-rtl" />
                </span>
                <span className="grow">
                  <span className="txn-title">
                    {label} · {l.person}
                  </span>
                  <span className="tiny mute block">
                    {shortDate(l.date)}
                    {l.note ? ` · ${l.note}` : ''}
                    {l.expenseId ? ` · ${t('From a split expense')}` : ''}
                  </span>
                </span>
                <span className="txn-amount" style={{ color }}>
                  {inflow ? '+' : '−'}
                  {fmt(l.amount)}
                </span>
              </button>
              {!locked && <DeleteButton label={t('Delete entry')} onClick={() => del(l, label)} />}
            </SwipeRow>
          );
        })}
      </div>

      <Sheet open={!!form} onClose={() => setForm(null)} title={form?.edit ? t('Edit loan entry') : t('Add loan entry')}>
        {form && (
          <LoanForm borrowedDefault={borrowed} personDefault={form.person} edit={form.edit} onDone={() => setForm(null)} />
        )}
      </Sheet>
      <Sheet open={!!person} onClose={() => setPerson(null)} title={person ?? ''}>
        {person && (
          <PersonForm
            name={person}
            borrowed={borrowed}
            onAddEntry={() => {
              setForm({ person });
              setPerson(null);
            }}
            onDone={() => setPerson(null)}
          />
        )}
      </Sheet>
    </div>
  );
}

/** Rename a person (fixes typos, merges duplicates) or remove them with every entry. */
function PersonForm({ name, borrowed, onAddEntry, onDone }: { name: string; borrowed: boolean; onAddEntry: () => void; onDone: () => void }) {
  const { refresh } = useApp();
  const undoDelete = useUndoDelete();
  const [newName, setNewName] = useState(name);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const to = newName.trim();
    if (!to) return setErr(t('Enter a name.'));
    if (to === name) return onDone();
    setBusy(true);
    try {
      await api('/loan-people', 'PUT', { borrowed, from: name, to });
      await refresh();
      onDone();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (await undoDelete(`/loan-people?borrowed=${borrowed}&name=${encodeURIComponent(name)}`, t('{name} removed.', { name }))) onDone();
  };

  return (
    <form onSubmit={submit} className="form">
      <Field label={t('Name')} hint={t('Renaming changes every entry for this person. Use an existing name to merge two people.')}>
        <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} />
      </Field>
      <FormError text={err} />
      <SaveButton label={t('Save name')} busy={busy} />
      <button type="button" className="btn tonal block" onClick={onAddEntry}>
        <Plus size={18} /> {t('Add entry for {name}', { name })}
      </button>
      <button type="button" className="btn text danger-text block" onClick={remove}>
        {t('Remove {name}', { name })}
      </button>
    </form>
  );
}

function LoanForm({ borrowedDefault, personDefault, edit, onDone }: { borrowedDefault: boolean; personDefault?: string; edit?: LoanEntry; onDone: () => void }) {
  const { data, month, refresh, user, startDay } = useApp();
  const { confirm } = useOverlay();
  const [borrowed, setBorrowed] = useState(edit?.borrowed ?? borrowedDefault);
  const [repayment, setRepayment] = useState(edit?.repayment ?? false);
  const [person, setPerson] = useState(edit?.person ?? personDefault ?? '');
  const [amount, setAmount] = useState(edit ? plain(edit.amount) : '');
  const [note, setNote] = useState(edit?.note ?? '');
  const [date, setDate] = useState(edit?.date ?? defaultDate(month, startDay));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const names = [...new Set((data?.loans ?? []).filter((l) => l.borrowed === borrowed).map((l) => l.person.trim()))];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const name = person.trim();
    const v = parseMoney(amount);
    if (!name) return setErr(t("Enter the person's name."));
    if (v === null || v <= 0) return setErr(t('Enter an amount greater than 0.'));
    setBusy(true);
    try {
      const body = { date, person: name, borrowed, repayment, amount: v, note: note.trim() };
      const ok = await saveWithConfirm(edit ? `/loans/${edit.id}` : '/loans', edit ? 'PUT' : 'POST', body, confirm);
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
        value={borrowed ? 'owe' : 'owed'}
        onChange={(v) => setBorrowed(v === 'owe')}
        options={[
          { value: 'owe', label: t('I owe') },
          { value: 'owed', label: t('Owed to me') },
        ]}
      />
      <Segmented
        value={repayment ? 'back' : 'out'}
        onChange={(v) => setRepayment(v === 'back')}
        options={[
          { value: 'out', label: borrowed ? t('I borrowed') : t('I lent') },
          { value: 'back', label: borrowed ? t('I paid back') : t('They paid me') },
        ]}
      />
      <Field label={borrowed ? t('Lender') : t('Borrower')}>
        <input className="input" value={person} onChange={(e) => setPerson(e.target.value)} maxLength={60} />
      </Field>
      {names.length > 0 && (
        <div className="chips wrap">
          {names.map((n) => (
            <button type="button" key={n} className="chip" onClick={() => setPerson(n)}>
              {n}
            </button>
          ))}
        </div>
      )}
      <Field label={t('Amount')}>
        <MoneyInput value={amount} onChange={setAmount} suffix={user.currency} />
      </Field>
      <Field label={t('Note (optional)')}>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </Field>
      <Field label={t('Date')}>
        <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      <FormError text={err} />
      <SaveButton label={edit ? t('Save changes') : t('Add')} busy={busy} />
    </form>
  );
}
