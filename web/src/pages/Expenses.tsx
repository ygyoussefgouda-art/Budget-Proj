import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Camera, ChevronDown, CopyPlus, Download, FileText, Image as ImageIcon, Paperclip, Repeat, Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, receiptUrl, saveWithConfirm, uploadReceipt } from '../api';
import { Sheet, useOverlay } from '../components/Overlays';
import { SwipeRow } from '../components/SwipeRow';
import { ExportLinks } from '../components/ExportLinks';
import { QueuedList, useOffline } from '../components/OfflineQueue';
import { DueList, RecurringManager } from '../components/Recurring';
import { useUndoDelete } from '../components/useUndoDelete';
import { MonthBar } from '../components/rows';
import {
  AddButton,
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
  SaveButton,
  SectionTitle,
  Segmented,
} from '../components/ui';
import { convert, inMonth, parseTags, periodRange, splitShares, type Expense } from '../domain/calc';
import { haptic, isNative, nativeReceiptPhoto } from '../native';
import { CategoryIcon } from '../components/CategoryIcon';
import { fmtMoney, parseMoney, parseRate, plain } from '../domain/money';
import { t } from '../i18n';
import { isNetworkError } from '../offline';
import { prepareReceipt, RECEIPT_ACCEPT } from '../receipt';
import { CURRENCIES, defaultDate, fmtTime, monthLabel, nowTime, shortDate, todayIso, useApp, type User } from '../state';

type Scope = 'month' | 'all' | 'range';

interface Filters { scope: Scope; from: string; to: string; search: string; catId: number | null; tag: string | null }
/**
 * Filters survive leaving the tab and coming back while the app stays open. Kept per account and in
 * memory only: nothing is saved on the phone, and they are gone once the app is closed.
 */
const rememberedFilters = new Map<number, Filters>();

/** Expenses (already newest first) split into [date, rows] groups, keeping the order. */
function groupByDay(items: Expense[]): [string, Expense[]][] {
  const out: [string, Expense[]][] = [];
  for (const e of items) {
    const last = out[out.length - 1];
    if (last && last[0] === e.date) last[1].push(e);
    else out.push([e.date, [e]]);
  }
  return out;
}

const yesterdayIso = () => {
  const [y, m, d] = todayIso().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
};

/** "Today", "Yesterday" or the short date. */
function dayLabel(iso: string) {
  return iso === todayIso() ? t('Today') : iso === yesterdayIso() ? t('Yesterday') : shortDate(iso);
}

/**
 * 2.1.0: the expense date as Today / Yesterday / another day. The phone's own date picker opens from the
 * third chip, and the chosen day is shown the app's way ("22 Nov"), never as 11/22/2026.
 */
export function DateChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const today = todayIso();
  const yd = yesterdayIso();
  const other = value !== today && value !== yd;
  return (
    <div className="field">
      <span className="field-label">{t('Date')}</span>
      <div className="chips wrap date-chips">
        <button type="button" className={`chip ${value === today ? 'on' : ''}`} aria-pressed={value === today} onClick={() => onChange(today)}>
          {t('Today')}
        </button>
        <button type="button" className={`chip ${value === yd ? 'on' : ''}`} aria-pressed={value === yd} onClick={() => onChange(yd)}>
          {t('Yesterday')}
        </button>
        <label className={`chip date-pick ${other ? 'on' : ''}`}>
          <CalendarDays size={15} aria-hidden="true" />
          <span>{other && value ? shortDate(value) : t('Another day')}</span>
          <input
            type="date"
            className="date-overlay"
            aria-label={t('Date')}
            value={value}
            onChange={(e) => e.target.value && onChange(e.target.value)}
            onClick={(e) => {
              try {
                e.currentTarget.showPicker?.();
              } catch {
                /* older browsers open it themselves */
              }
            }}
            required
          />
        </label>
      </div>
    </div>
  );
}

export default function Expenses() {
  const { data, fmt, month, startDay, user } = useApp();
  const undoDelete = useUndoDelete();
  const saved = rememberedFilters.get(user.id);
  // Home's "Upcoming payments → See all" opens /expenses?recurring=1: the recurring list straight away.
  // 2.2.0: a budget alert opens /expenses?cat=<id>: this month's expenses in that category, nothing else filtered.
  const [urlParams, setUrlParams] = useSearchParams();
  const urlCat = Number(urlParams.get('cat')) || null;
  const [recurringOpen, setRecurringOpen] = useState(() => urlParams.get('recurring') === '1');
  const [scope, setScope] = useState<Scope>(urlCat ? 'month' : (saved?.scope ?? 'month'));
  const [from, setFrom] = useState(urlCat ? '' : (saved?.from ?? ''));
  const [to, setTo] = useState(urlCat ? '' : (saved?.to ?? ''));
  const [search, setSearch] = useState(urlCat ? '' : (saved?.search ?? ''));
  const [q, setQ] = useState(urlCat ? '' : (saved?.search ?? '').trim());
  const [catId, setCatId] = useState<number | null>(urlCat ?? saved?.catId ?? null);
  const [tag, setTag] = useState<string | null>(urlCat ? null : (saved?.tag ?? null));
  // Also when the page is already open (the links work from anywhere), then the address is tidied up.
  useEffect(() => {
    if (urlParams.get('recurring') === '1') setRecurringOpen(true);
    const c = Number(urlParams.get('cat')) || null;
    if (c) {
      setScope('month');
      setFrom('');
      setTo('');
      setSearch('');
      setQ('');
      setTag(null);
      setCatId(c);
    }
    if (urlParams.has('recurring') || urlParams.has('cat')) setUrlParams({}, { replace: true });
  }, [urlParams, setUrlParams]);
  const [exportOpen, setExportOpen] = useState(false);
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api<{ tag: string; count: number }[]>('/tags'), staleTime: 60_000 });
  const [form, setForm] = useState<{ edit?: Expense; copy?: Expense } | null>(null);
  const [viewing, setViewing] = useState<Expense | null>(null);

  useEffect(() => {
    rememberedFilters.set(user.id, { scope, from, to, search, catId, tag });
  }, [user.id, scope, from, to, search, catId, tag]);
  const filtered = scope !== 'month' || !!search || catId !== null || tag !== null;
  const clearFilters = () => {
    setScope('month');
    setFrom('');
    setTo('');
    setSearch('');
    setCatId(null);
    setTag(null);
  };

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
  if (tag) params.set('tag', tag);

  const list = useQuery({
    queryKey: ['expenses', params.toString()],
    queryFn: () => api<{ items: Expense[]; count: number; total: number }>(`/expenses?${params}`),
    placeholderData: (p) => p,
  });

  // Deletes at once (receipt included); the toast offers Undo for a few seconds.
  const del = (e: Expense) => undoDelete(`/expenses/${e.id}`);

  const items = list.data?.items ?? [];
  const count = list.data?.count ?? 0;

  return (
    <div className="page">
      <PageHeader
        title={t('Expenses')}
        right={<IconButton icon={Repeat} label={t('Recurring expenses')} onClick={() => setRecurringOpen(true)} />}
      />
      {scope === 'month' && <MonthBar />}

      <div className="search">
        <Search size={18} className="mute" />
        <input
          className="input bare"
          placeholder={t('Search description, category or tag')}
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
        {filtered && (
          <button type="button" className="chip clear-chip" onClick={clearFilters}>
            <X size={13} /> {t('Clear filters')}
          </button>
        )}
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
      {(tags.data?.length ?? 0) > 0 && (
        <div className="chips" role="group" aria-label={t('Tags')}>
          <Chip on={tag === null} onClick={() => setTag(null)}>{t('All tags')}</Chip>
          {tags.data!.slice(0, 20).map((x) => (
            <Chip key={x.tag} on={tag === x.tag} onClick={() => setTag(tag === x.tag ? null : x.tag)}>
              #{x.tag}
            </Chip>
          ))}
        </div>
      )}

      <Card>
        <div className="row between">
          <div>
            <div className="tiny mute">
              {scope === 'month' ? t('Spent in {month}', { month: monthLabel(month) }) : t('Total for this filter')}
            </div>
            <div className="big-value">{fmt(list.data?.total ?? 0)}</div>
          </div>
          <div className="stack-end">
            <Pill color={COLORS.blue}>{count === 1 ? t('1 expense') : t('{n} expenses', { n: count })}</Pill>
            <button type="button" className="btn text small" onClick={() => setExportOpen(true)} disabled={count === 0}>
              <Download size={15} /> {t('Export')}
            </button>
          </div>
        </div>
      </Card>

      <DueList />
      <QueuedList categories={data?.categories ?? []} currency={user.currency} />

      <SectionTitle trailing={<AddButton label={t('Add')} onClick={() => setForm({})} title={t('Add an expense')} />}>
        {scope === 'month' ? t('This month') : t('Results')}
      </SectionTitle>
      {list.isLoading && <div className="spinner small" role="status" aria-label={t('Loading')} />}
      {list.isError && <p className="form-error">{(list.error as Error).message}</p>}
      {!list.isLoading && items.length === 0 && (
        <Empty text={filtered || q ? t('No expenses match. Tap "+ Add" to log one.') : t('No expenses yet. Tap "+ Add" to log your first one.')} />
      )}
      {/* 2.1.0: these used to be tutorial tips; they now sit where they apply */}
      {items.length > 0 && items.length <= 5 && !filtered && (
        <p className="tiny mute">{t('Tip: swipe a row left to delete it or right to edit it. Open one to log it again today.')}</p>
      )}
      {/* Grouped by day (newest first): the date is said once in the heading instead of on every row */}
      {groupByDay(items).map(([day, rows]) => (
      <section key={day} className="day-group" aria-label={dayLabel(day)}>
      <h3 className="day-head">
        <span>{dayLabel(day)}</span>
        <span>{fmt(rows.reduce((s, e) => s + e.amount, 0))}</span>
      </h3>
      <div className="list">
        {rows.map((e) => (
          <SwipeRow key={e.id} className="list-item" onDelete={() => del(e)} onEdit={() => setForm({ edit: e })}>
            <button className="list-main" onClick={() => setForm({ edit: e })}>
              <CategoryIcon cat={data?.categories.find((c) => c.id === e.categoryId) ?? { name: e.categoryName }} fallbackColor={COLORS.text} />
              <span className="grow">
                <span className="txn-title">{e.description || e.categoryName}</span>
                <span className="tiny mute block">
                  {e.time ? `${fmtTime(e.time)} · ` : ''}
                  {e.categoryName}
                  {e.split ? ` · ${t('Split with {name}', { name: e.split.person })}` : ''}
                  {e.foreign ? ` · ${fmtMoney(e.foreign.amount, e.foreign.currency)}` : ''}
                </span>
                {(e.tags?.length ?? 0) > 0 && (
                  <span className="row-tags">
                    {e.tags!.map((x) => (
                      <span key={x} className="tag">#{x}</span>
                    ))}
                  </span>
                )}
              </span>
              <span className="txn-amount">−{fmt(e.amount)}</span>
            </button>
            {/* The slot is kept on every row of a day with a receipt, so the amounts line up (2.1.2) */}
            {e.hasReceipt ? (
              <button type="button" className="receipt-btn" aria-label={t('View receipt')} title={t('View receipt')} onClick={() => setViewing(e)}>
                <Paperclip size={16} />
              </button>
            ) : (
              rows.some((x) => x.hasReceipt) && <span className="receipt-btn receipt-slot" aria-hidden="true" />
            )}
            <DeleteButton label={t('Delete expense')} onClick={() => del(e)} />
          </SwipeRow>
        ))}
      </div>
      </section>
      ))}
      {count > items.length && (
        <p className="tiny mute center">
          {t('Showing the newest {shown} of {count}. Narrow the filter to see others.', { shown: items.length, count })}
        </p>
      )}

      <Sheet open={!!form} onClose={() => setForm(null)} title={form?.edit ? t('Edit expense') : t('Add expense')}>
        {form && (
          <ExpenseForm
            key={form.edit ? `e${form.edit.id}` : form.copy ? `c${form.copy.id}` : 'new'}
            edit={form.edit}
            copy={form.copy}
            onDone={() => setForm(null)}
            onLogAgain={(e) => setForm({ copy: e })}
          />
        )}
      </Sheet>
      <Sheet open={exportOpen} onClose={() => setExportOpen(false)} title={t('Export these expenses')}>
        {exportOpen && (
          <>
            <p className="small mute" style={{ marginBottom: 12 }}>
              {count === 1 ? t('1 expense, with the filters you picked.') : t('{n} expenses, with the filters you picked.', { n: count })}
            </p>
            <ExportLinks
              kind="expenses"
              filters={{ from: params.get('from') ?? undefined, to: params.get('to') ?? undefined, q: q || undefined, categoryId: catId ? String(catId) : undefined, tag: tag ?? undefined }}
            />
          </>
        )}
      </Sheet>
      <Sheet open={recurringOpen} onClose={() => setRecurringOpen(false)} title={t('Recurring expenses')}>
        {recurringOpen && <RecurringManager />}
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

/** The category used for the last new expense on this device (per account). */
const lastCatKey = (u: User) => `bm-last-category:${u.id}`;
function lastCategory(u: User, ids: number[]): number | undefined {
  try {
    const v = Number(localStorage.getItem(lastCatKey(u)));
    return ids.includes(v) ? v : undefined;
  } catch {
    return undefined;
  }
}
function rememberCategory(u: User, id: number) {
  try {
    localStorage.setItem(lastCatKey(u), String(id));
  } catch {
    /* private mode: just don't remember */
  }
}

interface Suggestion { description: string; categoryId: number; count: number }

/**
 * "New category" inside Add expense (2.1.0): a name, then it is picked. No budget asked here; the
 * category shows on Budget with "No plan" until one is set.
 */
function NewCategory({ month, open: startOpen = false, onCreated }: { month: string; open?: boolean; onCreated: (id: number) => void }) {
  const { refresh } = useApp();
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set at once (state only changes on the next render), so a quick double Enter sends one request.
  const sending = useRef(false);
  if (!open) {
    return (
      <button type="button" className="link-btn new-cat-btn" onClick={() => setOpen(true)}>
        {t('+ New category')}
      </button>
    );
  }
  const add = async () => {
    const n = name.trim();
    if (!n) return setErr(t('Enter a name.'));
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ id: number }>('/categories', 'POST', { name: n, month });
      await refresh();
      onCreated(r.id);
      setName('');
      if (!startOpen) setOpen(false);
    } catch (x) {
      setErr((x as Error).message);
    }
    sending.current = false;
    setBusy(false);
  };
  return (
    <div className="new-cat">
      <Field label={t('New category name')}>
        <div className="row">
          <input
            className="input grow"
            value={name}
            maxLength={60}
            autoFocus={!startOpen}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void add();
              }
            }}
          />
          <button type="button" className="btn primary" disabled={busy} onClick={() => void add()}>
            {t('Add')}
          </button>
        </div>
      </Field>
      <FormError text={err} />
    </div>
  );
}

/**
 * 2.4.0 (critique: a big expense saved with no warning): what this expense does before it is saved.
 * "After this: Food has 115 EGP left" or "…is 12,385 EGP over budget", and what is left of the month.
 * Only for the budget month on screen; an edit counts without its old amount.
 */
function ImpactLine({ catId, amount, date, edit }: { catId: number; amount: number | null; date: string; edit?: Expense }) {
  const { summary: s, month, startDay, fmt, data } = useApp();
  if (!s || !amount || amount <= 0 || !inMonth(date, month, startDay)) return null;
  const before = edit && inMonth(edit.date, month, startDay) ? edit : undefined;
  const row = s.rows.find((r) => r.catId === catId);
  const name = data?.categories.find((c) => c.id === catId)?.name ?? '';
  const catLeft = row ? row.planned - row.actual + (before?.categoryId === catId ? before.amount : 0) - amount : null;
  const monthLeft = s.moneyLeft + (before?.amount ?? 0) - amount;
  const parts: string[] = [];
  if (row && row.planned > 0 && catLeft !== null) {
    parts.push(catLeft >= 0 ? t('{name} has {amount} left', { name, amount: fmt(catLeft) }) : t('{name} is {amount} over budget', { name, amount: fmt(-catLeft) }));
  }
  if (s.income > 0) parts.push(monthLeft >= 0 ? t('{amount} left this month', { amount: fmt(monthLeft) }) : t('{amount} over for the month', { amount: fmt(-monthLeft) }));
  if (!parts.length) return null;
  const over = (catLeft !== null && row && row.planned > 0 && catLeft < 0) || monthLeft < 0;
  return (
    <p className={`impact-line ${over ? 'is-over' : ''}`} aria-live="polite">
      <span className="impact-label">{t('After this:')}</span> {parts.join(' · ')}
    </p>
  );
}

/**
 * Add or edit an expense: the same form everywhere (2.4.0). `quick` (the centre + and Home) only means
 * it starts on today instead of the month on screen.
 */
export function ExpenseForm({
  edit,
  copy,
  onDone,
  onLogAgain,
  quick = false,
}: {
  edit?: Expense;
  /** "Log again": a new expense filled in from this one, dated today (no receipt). */
  copy?: Expense;
  onDone: () => void;
  /** Shown on an existing expense: opens a copy of it, dated today. */
  onLogAgain?: (e: Expense) => void;
  quick?: boolean;
}) {
  const { data, month, refresh, user, startDay } = useApp();
  const { confirm, toast } = useOverlay();
  const offline = useOffline();
  const qc = useQueryClient();
  const cats = data?.categories ?? [];
  const src = edit ?? copy;
  // "Amount" is the whole bill; with a split, my share is what gets recorded.
  const [amount, setAmount] = useState(src ? plain(src.amount + (src.split?.share ?? 0)) : '');
  const [tagText, setTagText] = useState((src?.tags ?? []).map((x) => `#${x}`).join(' '));
  const [splitOn, setSplitOn] = useState(!!src?.split);
  const [person, setPerson] = useState(src?.split?.person ?? '');
  const [splitMode, setSplitMode] = useState<'even' | 'share'>(src?.split ? 'share' : 'even');
  const [theirShare, setTheirShare] = useState(src?.split ? plain(src.split.share) : '');
  const [fxOn, setFxOn] = useState(!!src?.foreign);
  const [fxAmount, setFxAmount] = useState(src?.foreign ? plain(src.foreign.amount) : '');
  const [fxCurrency, setFxCurrency] = useState(src?.foreign?.currency ?? CURRENCIES.find((c) => c !== user.currency) ?? 'USD');
  const [fxRate, setFxRate] = useState(src?.foreign ? String(src.foreign.rate) : '');
  // 2.4.0: tags, split, receipt and another currency fold under "More details" (open when this expense uses one).
  const [more, setMore] = useState(() => !!(src && ((src.tags?.length ?? 0) > 0 || src.split || src.foreign || edit?.hasReceipt)));
  const knownTags = useQuery({ queryKey: ['tags'], queryFn: () => api<{ tag: string; count: number }[]>('/tags'), enabled: more, staleTime: 60_000 });
  const [catId, setCatId] = useState<number>(
    (src && cats.some((c) => c.id === src.categoryId) ? src.categoryId : undefined) ?? lastCategory(user, cats.map((c) => c.id)) ?? cats[0]?.id ?? 0,
  );
  const [desc, setDesc] = useState(src?.description ?? '');
  const [date, setDate] = useState(edit?.date ?? (quick || copy ? todayIso() : defaultDate(month, startDay)));
  // 2.2.0: the time it was spent; a new expense starts at the phone's clock now (older ones may have none).
  const [time, setTime] = useState(edit ? (edit.time ?? '') : nowTime());
  // Most-used descriptions as tap-to-fill chips (new expenses only).
  const suggestions = useQuery({
    queryKey: ['suggestions'],
    queryFn: () => api<Suggestion[]>('/expenses/suggestions'),
    enabled: !edit,
    staleTime: 60_000,
  });
  const chips = (suggestions.data ?? []).filter((s) => s.description.toLowerCase() !== desc.trim().toLowerCase()).slice(0, 6);
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

  // The bill in my currency: typed in, or converted from the foreign amount at the given rate.
  const rate = parseRate(fxRate) ?? 0;
  const fxMinor = parseMoney(fxAmount);
  const total = fxOn ? (fxMinor && rate > 0 ? convert(fxMinor, rate) : null) : parseMoney(amount);
  const shares = splitOn && total ? splitShares(total, splitMode, parseMoney(theirShare) ?? 0) : null;
  const usedTags = parseTags(tagText).tags;
  const tagChips = (knownTags.data ?? []).filter((x) => !usedTags.includes(x.tag)).slice(0, 8);
  const people = [...new Set((data?.loans ?? []).filter((l) => !l.borrowed).map((l) => l.person.trim()))];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (fxOn && (!fxMinor || !(rate > 0))) return setErr(t('Enter the amount in {currency} and the rate.', { currency: fxCurrency }));
    if (total === null || total <= 0) return setErr(t('Enter an amount greater than 0.'));
    if (!date) return setErr(t('Pick a date.'));
    const tags = parseTags(tagText);
    if (tags.bad) return setErr(t('"{tag}" is not a valid tag. Use letters, numbers, - or _.', { tag: tags.bad }));
    if (tags.tags.length > 5) return setErr(t('Use at most 5 tags.'));
    if (shares) {
      if (!person.trim()) return setErr(t('Who did you split it with?'));
      if (shares.their <= 0 || shares.mine <= 0) return setErr(t('Their share must be more than 0 and less than the total.'));
    }
    setBusy(true);
    const body = {
      date,
      categoryId: catId,
      description: desc.trim(),
      amount: shares ? shares.mine : total,
      tags: tags.tags,
      time: time || null,
      split: shares ? { person: person.trim(), share: shares.their } : null,
      foreign: fxOn ? { amount: fxMinor, currency: fxCurrency, rate } : null,
      // A receipt belongs to this one expense: never add it into the last one ("Add quick repeats together").
      ...(file ? { noMerge: true } : {}),
    };
    // No connection: a new expense waits on this phone and is sent later (edits need a connection).
    const saveOffline = async () => {
      if (file) {
        setErr(t('Receipts need a connection. Remove the photo to save this expense on the phone, or try again online.'));
        return setBusy(false);
      }
      await offline!.queue(body);
      rememberCategory(user, catId);
      haptic();
      toast(t('Saved on this phone. It will be sent when you are back online.'));
      onDone();
    };
    if (!edit && offline && !navigator.onLine) return saveOffline();
    try {
      const saved = await saveWithConfirm<Expense & { merged?: boolean }>(edit ? `/expenses/${edit.id}` : '/expenses', edit ? 'PUT' : 'POST', body, confirm);
      if (saved === false) return setBusy(false);
      haptic(); // a light buzz: it's saved
      if (saved.merged) {
        const name = saved.description || cats.find((c) => c.id === saved.categoryId)?.name || '';
        toast(t('Added to your last {name} expense: now {amount}.', { name, amount: fmtMoney(saved.amount, user.currency) }));
      }
      if (!edit) rememberCategory(user, catId);
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
      if (!edit && offline && isNetworkError(x)) return saveOffline();
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  // No categories yet: make one right here instead of sending the user to Budget first.
  if (cats.length === 0) {
    return (
      <div className="form">
        <p className="mute">{t('Name your first spending category, like Food or Transport. You can set a budget for it later.')}</p>
        <NewCategory month={month} open onCreated={setCatId} />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="form">
      {fxOn ? (
        <div className="fx-box">
          <div className="grid2">
            <Field label={t('Amount in {currency}', { currency: fxCurrency })}>
              <MoneyInput value={fxAmount} onChange={setFxAmount} suffix={fxCurrency} autoFocus={!edit && !copy} calc />
            </Field>
            <Field label={t('Currency')}>
              <select className="input" value={fxCurrency} onChange={(e) => setFxCurrency(e.target.value)}>
                {CURRENCIES.filter((c) => c !== user.currency).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t('Rate: 1 {from} = ? {to}', { from: fxCurrency, to: user.currency })}>
            <input className="input" dir="ltr" inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="49.50" />
          </Field>
          <p className="small" aria-live="polite">
            {total ? t('= {amount} in your currency', { amount: fmtMoney(total, user.currency) }) : t('Type the amount and the rate to see it in your currency.')}
          </p>
        </div>
      ) : (
        <Field label={splitOn ? t('Total paid') : t('Amount')}>
          <MoneyInput value={amount} onChange={setAmount} suffix={user.currency} autoFocus={!edit && !copy} calc />
        </Field>
      )}
      <Field label={t('Category')}>
        <select className="input" value={catId} onChange={(e) => setCatId(Number(e.target.value))}>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <ImpactLine catId={catId} amount={shares ? shares.mine : total} date={date} edit={edit} />
      <NewCategory month={month} onCreated={setCatId} />
      <Field label={t('What for? (optional)')}>
        <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} />
      </Field>
      {chips.length > 0 && (
        <div className="chips wrap suggestion-chips" role="group" aria-label={t('Often used')}>
          {chips.map((s) => (
            <button
              key={s.description}
              type="button"
              className="chip"
              onClick={() => {
                setDesc(s.description);
                if (cats.some((c) => c.id === s.categoryId)) setCatId(s.categoryId);
              }}
            >
              {s.description}
            </button>
          ))}
        </div>
      )}
      <DateChips value={date} onChange={setDate} />
      <Field label={t('Time')} hint={edit && !edit.time ? t('Older expenses have no time. Add one if you like.') : undefined}>
        <input type="time" className="input time-input" dir="ltr" value={time} onChange={(e) => setTime(e.target.value)} />
      </Field>

      {/* 2.4.0 (critique: two different add sheets): one form everywhere; the rarer parts fold away here */}
      {!more ? (
        <button type="button" className="more-details" aria-expanded={false} onClick={() => setMore(true)}>
          <ChevronDown size={18} aria-hidden="true" />
          <span className="grow">
            {t('More details')}
            <span className="tiny mute block">{t('Tags, split with someone, receipt, another currency')}</span>
          </span>
        </button>
      ) : (
        <label className="check">
          <input type="checkbox" checked={fxOn} onChange={(e) => setFxOn(e.target.checked)} />
          <span>{t('Paid in another currency')}</span>
        </label>
      )}

      {more && (
        <>
          <Field label={t('Tags (optional)')} hint={t('Up to 5, like #trip #friends. Tap one below to add it.')}>
            <input className="input" dir="auto" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder={t('#trip #friends')} autoCapitalize="none" />
          </Field>
          {tagChips.length > 0 && (
            <div className="chips wrap suggestion-chips" role="group" aria-label={t('Your tags')}>
              {tagChips.map((x) => (
                <button key={x.tag} type="button" className="chip" onClick={() => setTagText((s) => `${s.trim()} #${x.tag}`.trim())}>
                  #{x.tag}
                </button>
              ))}
            </div>
          )}

          <label className="check">
            <input type="checkbox" checked={splitOn} onChange={(e) => setSplitOn(e.target.checked)} />
            <span>
              {t('Split with someone')}
              <span className="tiny mute block">{t('You record your share; their share goes to "Owed to me" in Loans.')}</span>
            </span>
          </label>
          {splitOn && (
            <div className="split-box">
              <Field label={t('Split with')}>
                <input className="input" value={person} onChange={(e) => setPerson(e.target.value)} maxLength={60} list="split-people" />
                <datalist id="split-people">
                  {people.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </Field>
              <Segmented
                value={splitMode}
                onChange={setSplitMode}
                options={[
                  { value: 'even', label: t('Half each') },
                  { value: 'share', label: t('Their share') },
                ]}
              />
              {splitMode === 'share' && (
                <Field label={t('Their share')}>
                  <MoneyInput value={theirShare} onChange={setTheirShare} suffix={user.currency} calc />
                </Field>
              )}
              {shares && shares.their > 0 && shares.mine > 0 && (
                <p className="small" aria-live="polite">
                  {t('You pay {mine} · {name} owes you {their}', {
                    mine: fmtMoney(shares.mine, user.currency),
                    their: fmtMoney(shares.their, user.currency),
                    name: person.trim() || t('they'),
                  })}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {more && (
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
        ) : isNative() ? (
          // In the Android app: the camera, Android's photo picker (no storage permission), or a file.
          <div className="attach-row">
            <button type="button" className="attach-btn" onClick={async () => pick((await nativeReceiptPhoto('CAMERA')) ?? undefined)}>
              <Camera size={18} /> {t('Take a photo')}
            </button>
            <button type="button" className="attach-btn" onClick={async () => pick((await nativeReceiptPhoto('PHOTOS')) ?? undefined)}>
              <ImageIcon size={18} /> {t('From gallery')}
            </button>
            <button type="button" className="attach-btn" onClick={() => fileInput.current?.click()}>
              <Paperclip size={18} /> {t('PDF or file')}
            </button>
          </div>
        ) : (
          <button type="button" className="attach-btn" onClick={() => fileInput.current?.click()}>
            <Paperclip size={18} /> {t('Attach a photo or PDF')}
          </button>
        )}
        {removeExisting && !file && <span className="field-hint">{t('The receipt will be removed when you save.')}</span>}
      </div>
      )}

      <FormError text={err} />
      <SaveButton label={edit ? t('Save changes') : t('Add expense')} busy={busy} />
      {edit && onLogAgain && (
        <button type="button" className="btn ghost block log-again" onClick={() => onLogAgain(edit)}>
          <CopyPlus size={17} /> {t('Log again today')}
        </button>
      )}
    </form>
  );
}
