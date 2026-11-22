import { CloudOff } from 'lucide-react';
import Brand from './Brand';
import { useEffect, useState, type FormEvent } from 'react';
import { parseMoney } from '../domain/money';
import { t } from '../i18n';
import type { OfflineKit } from '../offline';
import { todayIso } from '../state';
import { OfflineBar, OfflineProvider, QueuedList, useOffline } from './OfflineQueue';
import { useOverlay } from './Overlays';
import { Card, COLORS, Field, FormError, MoneyInput, PageHeader, SaveButton, SectionTitle } from './ui';

/**
 * Shown when the app is opened with no connection: log expenses now, they sync later.
 * Uses only the small "offline kit" saved on this phone (name, currency, category names).
 */
export default function OfflineApp({ kit, retry }: { kit: OfflineKit; retry: () => void }) {
  // Back online: load the real app (any queued expenses are sent first by the provider).
  useEffect(() => {
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [retry]);
  return (
    <OfflineProvider userId={kit.user.id} onSynced={retry}>
      <div className="shell">
        <main className="content">
          <div className="page">
            <PageHeader
              title={<Brand />}
            />
            <OfflineBar />
            <Card>
              <div className="row gap">
                <CloudOff size={22} style={{ color: COLORS.amber, flex: 'none' }} aria-hidden="true" />
                <p className="small">{t("You're offline. You can still log expenses; they are sent as soon as you're back online.")}</p>
              </div>
              <button type="button" className="btn tonal block" style={{ marginTop: 12 }} onClick={retry}>
                {t('Try again')}
              </button>
            </Card>
            <Card>
              <SectionTitle>{t('Add expense')}</SectionTitle>
              <OfflineExpenseForm kit={kit} />
            </Card>
            <QueuedList categories={kit.categories} currency={kit.user.currency} />
          </div>
        </main>
      </div>
    </OfflineProvider>
  );
}

function OfflineExpenseForm({ kit }: { kit: OfflineKit }) {
  const o = useOffline();
  const { toast } = useOverlay();
  const [amount, setAmount] = useState('');
  const [catId, setCatId] = useState(kit.categories[0]?.id ?? 0);
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState(todayIso());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (kit.categories.length === 0) return <p className="mute small">{t('You have no spending categories yet. Add one on the Budget screen first.')}</p>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = parseMoney(amount);
    if (v === null || v <= 0) return setErr(t('Enter an amount greater than 0.'));
    if (!date) return setErr(t('Pick a date.'));
    setBusy(true);
    setErr(null);
    try {
      await o?.queue({ date, categoryId: catId, description: desc.trim(), amount: v });
      toast(t('Saved on this phone. It will be sent when you are back online.'));
      setAmount('');
      setDesc('');
    } catch (x) {
      setErr((x as Error).message);
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="form">
      <Field label={t('Amount')}>
        <MoneyInput value={amount} onChange={setAmount} suffix={kit.user.currency} autoFocus />
      </Field>
      <Field label={t('Category')}>
        <select className="input" value={catId} onChange={(e) => setCatId(Number(e.target.value))}>
          {kit.categories.map((c) => (
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
      <FormError text={err} />
      <SaveButton label={t('Add expense')} busy={busy} />
    </form>
  );
}
