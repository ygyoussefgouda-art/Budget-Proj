import { CloudOff, RefreshCw } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { fmtMoney } from '../domain/money';
import { locale, t } from '../i18n';
import { listQueued, queueExpense, removeQueued, syncQueued, type Queued, type QueuedBody } from '../offline';
import { shortDate } from '../state';
import { useOverlay } from './Overlays';
import { Card, COLORS, DeleteButton, Pill, SectionTitle, tint } from './ui';

interface OfflineCtx {
  online: boolean;
  queued: Queued[];
  queue: (body: QueuedBody) => Promise<void>;
  remove: (clientId: string) => Promise<void>;
  syncNow: () => Promise<void>;
}
const Ctx = createContext<OfflineCtx | null>(null);

/** Null when offline entry isn't available (outside the signed-in app). */
export const useOffline = () => useContext(Ctx);

export function OfflineProvider({ userId, onSynced, children }: { userId: number; onSynced: () => Promise<unknown> | void; children: ReactNode }) {
  const { toast } = useOverlay();
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [queued, setQueued] = useState<Queued[]>([]);
  const syncing = useRef(false);

  const reload = useCallback(async () => setQueued(await listQueued(userId)), [userId]);

  const syncNow = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const r = await syncQueued(userId);
      await reload();
      if (r.offline) setOnline(false);
      if (r.synced > 0) {
        await onSynced();
        toast(r.synced === 1 ? t('1 offline expense synced.') : t('{n} offline expenses synced.', { n: r.synced }));
      }
    } finally {
      syncing.current = false;
    }
  }, [userId, reload, onSynced, toast]);

  useEffect(() => {
    void reload().then(() => (navigator.onLine ? syncNow() : undefined));
    const up = () => {
      setOnline(true);
      void syncNow();
    };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [reload, syncNow]);

  // While something waits, try again every 30 seconds (the "online" event isn't always reliable).
  const waiting = queued.some((q) => !q.error);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void syncNow(), 30_000);
    return () => clearInterval(timer);
  }, [waiting, syncNow]);

  const value: OfflineCtx = {
    online,
    queued,
    queue: async (body) => {
      await queueExpense(userId, body);
      setOnline(navigator.onLine);
      await reload();
    },
    remove: async (clientId) => {
      await removeQueued(clientId);
      await reload();
    },
    syncNow,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Thin bar while there is no connection. */
export function OfflineBar({ updatedAt }: { updatedAt?: number }) {
  const o = useOffline();
  if (!o || o.online) return null;
  const when = updatedAt
    ? new Date(updatedAt).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  return (
    <div className="offline-bar" role="status">
      <CloudOff size={16} aria-hidden="true" />
      <span>
        {t("You're offline. New expenses are saved on this phone and sync later.")}
        {when && (
          <>
            {' '}
            <span className="offline-updated">{t('Showing data from {time}; other changes wait until you are back online.', { time: when })}</span>
          </>
        )}
      </span>
    </div>
  );
}

/** Expenses typed in offline, waiting to be sent. Hidden when there are none. */
export function QueuedList({ categories, currency }: { categories: { id: number; name: string }[]; currency: string }) {
  const o = useOffline();
  if (!o || o.queued.length === 0) return null;
  const catName = (id: number) => categories.find((c) => c.id === id)?.name ?? '';
  return (
    <Card className="queued-card">
      <SectionTitle
        trailing={
          o.online ? (
            <button type="button" className="btn text small" onClick={() => void o.syncNow()}>
              <RefreshCw size={14} /> {t('Sync now')}
            </button>
          ) : undefined
        }
      >
        {t('Waiting to sync')}
      </SectionTitle>
      {o.queued.map((q) => (
        <div key={q.clientId} className="list-item queued-item">
          <div className="list-main" style={{ cursor: 'default' }}>
            <span className="avatar" style={{ color: COLORS.amber, background: tint(COLORS.amber, 14) }} aria-hidden="true">
              <CloudOff size={17} />
            </span>
            <span className="grow">
              <span className="txn-title">{q.body.description || catName(q.body.categoryId)}</span>
              <span className="tiny block" style={{ color: q.error ? COLORS.red : 'var(--mute)' }}>
                {q.error ? t('Could not sync: {error}', { error: q.error }) : `${catName(q.body.categoryId)} · ${shortDate(q.body.date)}`}
              </span>
            </span>
            <span className="stack-end">
              <span className="txn-amount">{fmtMoney(q.body.amount, currency)}</span>
              {!q.error && <Pill color={COLORS.amber}>{t('Waiting to sync')}</Pill>}
            </span>
          </div>
          <DeleteButton label={t('Remove from this phone')} onClick={() => void o.remove(q.clientId)} />
        </div>
      ))}
    </Card>
  );
}
