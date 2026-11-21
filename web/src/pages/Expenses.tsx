import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Paperclip, Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, receiptUrl, saveWithConfirm, uploadReceipt } from '../api';
import { Sheet, useOverlay } from '../components/Overlays';
import { MonthBar } from '../components/rows';
import {
  AddButton,
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
  tint,
} from '../components/ui';
import { periodRange, type Expense } from '../domain/calc';
import { parseMoney, plain } from '../domain/money';
import { t } from '../i18n';
import { prepareReceipt, RECEIPT_ACCEPT } from '../receipt';
import { defaultDate, monthLabel, shortDate, useApp } from '../state';

type Scope = 'month' | 'all' | 'range';

export default function Expenses() {
  const { data, fmt, month, refresh, startDay } = useApp();
  const { confirm, toast } = useOverlay();
  const [scope, setScope] = useState<Scope>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [catId, setCatId] = useState<number | null>(null);
  const [form, setForm] = useState<{ edit?: Expense } | null>(null);
  const [viewing, setViewing] = useState<Expense | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const params = new URLSearchParams({ limit: '300' });
  if (scope === 'month') {
    const r = periodRange(month, startDay);
    params.set('from', r.from);
    params.set('to', r.last);
  } else if (scope === 'range') {
    if (from) params.set('from', from);
    if (to) params.set('to', to);
  }
  if (q) params.set('q', q);
  if (catId) params.set('categoryId', String(catId));

  const list = useQuery({
    queryKey: ['expenses', params.toString()],
    queryFn: () => api<{ items: Expense[]; count: number; total: number }>(`/expenses?${params}`),
    placeholderData: (p) => p,
  });

  const del = async (e: Expense) => {
    const msg = t('{amount} on {date} will be removed.', { amount: fmt(e.amount), date: shortDate(e.date) });
    if (!(await confirm(t('Delete expense?'), e.hasReceipt ? `${msg} ${t('Its receipt is deleted too.')}` : msg))) return;
    try {
      await api(`/expenses/${e.id}`, 'DELETE');
      await refresh();
    } catch (x) {
      toast((x as Error).message);
    }
  };

  const items = list.data?.items ?? [];
  const count = list.data?.count ?? 0;

  return (
    <div className="page">
      <PageHeader title={t('Expenses')} />
      {scope === 'month' && <MonthBar />}

      <div className="search">
        <Search size={18} className="mute" />
        <input
          className="input bare"
          placeholder={t('Search description or category')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t('Search expenses')}
        />
        {search && (
          <button className="icon-btn small" aria-label={t('Clear search')} onClick={() => setSearch('')}>
            <X size={16} />
          </button>
        )}
      </div>

      <div className="chips">
        <Chip on={scope === 'month'} onClick={() => setScope('month')}>{t('This month')}</Chip>
        <Chip on={scope === 'all'} onClick={() => setScope('all')}>{t('All time')}</Chip>
        <Chip on={scope === 'range'} onClick={() => setScope('range')}>{t('Date range')}</Chip>
      </div>
      {scope === 'range' && (
        <div className="grid2">
          <Field label={t('From')}>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('To')}>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      )}
      <div className="chips">
        <Chip on={catId === null} onClick={() => setCatId(null)}>{t('All categories')}</Chip>
        {data?.categories.map((c) => (
          <Chip key={c.id} on={catId === c.id} onClick={() => setCatId(c.id)}>
            {c.name}
          </Chip>
        ))}
      </div>

      <Card>
        <div className="row between">
          <div>
            <div className="tiny mute">
              {scope === 'month' ? t('Spent in {month}', { month: monthLabel(month) }) : t('Total for this filter')}
            </div>
            <div className="big-value" style={{ color: COLORS.red }}>{fmt(list.data?.total ?? 0)}</div>
          </div>
          <Pill color={COLORS.blue}>{count === 1 ? t('1 expense') : t('{n} expenses', { n: count })}</Pill>
        </div>
      </Card>

      <SectionTitle trailing={<AddButton label={t('Add')} onClick={() => setForm({})} title={t('Add an expense')} />}>
        {t('Expenses')}
      </SectionTitle>
      {list.isError && <p className="form-error">{(list.error as Error).message}</p>}
      {!list.isLoading && items.length === 0 && <Empty text={t('No expenses match. Tap "+ Add" to log one.')} />}
      <div className="list">
        {items.map((e) => (
          <div key={e.id} className="list-item">
            <button className="list-main" onClick={() => setForm({ edit: e })}>
              <span className="avatar" style={{ color: COLORS.red, background: tint(COLORS.red, 14) }}>
                {(e.categoryName ?? '?').slice(0, 1).toUpperCase()}
              </span>
              <span className="grow">
                <span className="txn-title">{e.description || e.categoryName}</span>
                <span className="tiny mute block">
                  {e.categoryName} · {shortDate(e.date)}
                </span>
              </span>
              <span className="txn-amount" style={{ color: COLORS.red }}>−{fmt(e.amount)}</span>
            </button>
            {e.hasReceipt && (
              <button type="button" className="receipt-btn" aria-label={t('View receipt')} title={t('View receipt')} onClick={() => setViewing(e)}>
                <Paperclip size={16} />
              </button>
            )}
            <DeleteButton label={t('Delete expense')} onClick={() => del(e)} />
          </div>
        ))}
        {count > items.length && (
          <p className="tiny mute center">
            {t('Showing the newest {shown} of {count}. Narrow the filter to see others.', { shown: items.length, count })}
          </p>
        )}
      </div>

      <Sheet open={!!form} onClose={() => setForm(null)} title={form?.edit ? t('Edit expense') : t('Add expense')}>
        {form && <ExpenseForm edit={form.edit} onDone={() => setForm(null)} />}
      </Sheet>
      <Sheet open={!!viewing} onClose={() => setViewing(null)} title={t('Receipt')}>
        {viewing && <ReceiptView expense={viewing} />}
      </Sheet>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`chip ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on}>
      {children}
    </button>
  );
}

/** Shows an attached receipt: the photo itself, or a button to open the PDF. */
function ReceiptView({ expense, version = '' }: { expense: Expense; version?: string }) {
  const { fmt } = useApp();
  const [kind, setKind] = useState<'loading' | 'image' | 'pdf' | 'error'>('loading');
  const url = receiptUrl(expense.id, version);
  return (
    <div className="form">
      <p className="small mute">
        {expense.description || expense.categoryName} · {fmt(expense.amount)} · {shortDate(expense.date)}
      </p>
      {kind !== 'pdf' && kind !== 'error' && (
        <img
          className="receipt-img"
          src={url}
          alt={t('Receipt')}
          onLoad={() => setKind('image')}
          onError={() => setKind((k) => (k === 'loading' ? 'pdf' : 'error'))}
        />
      )}
      {kind === 'pdf' && (
        <a className="btn tonal block" href={url} target="_blank" rel="noreferrer">
          <FileText size={18} /> {t('Open PDF receipt')}
        </a>
      )}
      {kind === 'error' && <p className="form-error">{t('The receipt could not be loaded.')}</p>}
      <a className="btn ghost block" href={url} target="_blank" rel="noreferrer">
        {t('Open full size')}
      </a>
    </div>
  );
}

export function ExpenseForm({ edit, onDone }: { edit?: Expense; onDone: () => void }) {
  const { data, month, refresh, user, startDay } = useApp();
  const { confirm, toast } = useOverlay();
  const qc = useQueryClient();
  const cats = data?.categories ?? [];
  const [amount, setAmount] = useState(edit ? plain(edit.amount) : '');
  const [catId, setCatId] = useState<number>(edit?.categoryId ?? cats[0]?.id ?? 0);
  const [desc, setDesc] = useState(edit?.description ?? '');
  const [date, setDate] = useState(edit?.date ?? defaultDate(month, startDay));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Receipt: keep the existing one, replace it with a new file, or remove it.
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeExisting, setRemoveExisting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const hasExisting = !!edit?.hasReceipt && !removeExisting && !file;

  useEffect(() => {
    if (!file || file.type === 'application/pdf') {
      setPreview(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!(f.type.startsWith('image/') || f.type === 'application/pdf')) {
      setErr(t('Receipts must be a photo or a PDF.'));
      return;
    }
    setErr(null);
    setFile(f);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const v = parseMoney(amount);
    if (v === null || v <= 0) return setErr(t('Enter an amount greater than 0.'));
    if (!date) return setErr(t('Pick a date.'));
    setBusy(true);
    try {
      const body = { date, categoryId: catId, description: desc.trim(), amount: v };
      const saved = await saveWithConfirm<Expense>(edit ? `/expenses/${edit.id}` : '/expenses', edit ? 'PUT' : 'POST', body, confirm);
      if (saved === false) return setBusy(false);
      try {
        if (file) await uploadReceipt(saved.id, await prepareReceipt(file));
        else if (edit?.hasReceipt && removeExisting) await api(`/expenses/${edit.id}/receipt`, 'DELETE');
      } catch (x) {
        toast(t('The expense was saved, but the receipt was not: {error}', { error: (x as Error).message }));
      }
      await refresh();
      await qc.invalidateQueries({ queryKey: ['expenses'] });
      onDone();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  if (cats.length === 0) {
    return (
      <div className="form">
        <p className="mute">{t('You have no spending categories yet. Add one on the Budget screen first.')}</p>
        <Link to="/budget" className="btn primary block" onClick={onDone}>
          {t('Go to Budget')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="form">
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
        <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} />
      </Field>
      <Field label={t('Date')}>
        <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
      </Field>

      <div className="field">
        <span className="field-label">{t('Receipt (optional)')}</span>
        <input
          ref={fileInput}
          type="file"
          accept={RECEIPT_ACCEPT}
          hidden
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {file ? (
          <div className="receipt-chip">
            {preview ? <img src={preview} alt="" /> : <FileText size={22} />}
            <span className="grow ellipsis">{file.name}</span>
            <button type="button" className="btn text small" onClick={() => setFile(null)}>
              {t('Remove')}
            </button>
          </div>
        ) : hasExisting ? (
          <div className="receipt-chip">
            <img src={receiptUrl(edit!.id)} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
            <Paperclip size={18} />
            <a className="grow ellipsis link" href={receiptUrl(edit!.id)} target="_blank" rel="noreferrer">
              {t('Receipt attached')}
            </a>
            <button type="button" className="btn text small" onClick={() => fileInput.current?.click()}>
              {t('Replace')}
            </button>
            <button type="button" className="btn text small danger-text" onClick={() => setRemoveExisting(true)}>
              {t('Remove')}
            </button>
          </div>
        ) : (
          <button type="button" className="attach-btn" onClick={() => fileInput.current?.click()}>
            <Paperclip size={18} /> {t('Attach a photo or PDF')}
          </button>
        )}
        {removeExisting && !file && <span className="field-hint">{t('The receipt will be removed when you save.')}</span>}
      </div>

      <FormError text={err} />
      <SaveButton label={edit ? t('Save changes') : t('Add expense')} busy={busy} />
    </form>
  );
}
