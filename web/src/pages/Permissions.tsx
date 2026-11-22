import { Bell, Camera as CameraIcon, Download, Image as ImageIcon, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { t } from '../i18n';
import { App, BudgetNative, Camera, isNative, LocalNotifications } from '../native';

type Status = 'granted' | 'denied' | 'prompt' | 'unknown';
const norm = (s: string | undefined): Status => (s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : s ? 'prompt' : 'unknown');

const SEEN = (uid: number) => `bm-permissions-seen:${uid}`;
export const permissionsSeen = (uid: number) => {
  try {
    return localStorage.getItem(SEEN(uid)) === '1';
  } catch {
    return true;
  }
};
const markSeen = (uid: number) => {
  try {
    localStorage.setItem(SEEN(uid), '1');
  } catch {
    /* ignore */
  }
};

interface Row {
  key: 'notifications' | 'camera' | 'install';
  icon: LucideIcon;
  title: string;
  why: string;
}
const ROWS: Row[] = [
  { key: 'notifications', icon: Bell, title: 'Notifications', why: 'Budget alerts at 80% and 100%, recurring expenses that are due, and new app versions.' },
  { key: 'camera', icon: CameraIcon, title: 'Camera', why: 'Take a photo of a receipt and attach it to an expense.' },
  { key: 'install', icon: Download, title: 'Install updates', why: 'Lets Budget me install its own updates (Android calls this "Install unknown apps").' },
];

/**
 * First-run "Set up permissions" (Android app only). Android can't grant these at install time, so the
 * app asks here, all at once with "Allow all" or one by one. Never blocks the app: "Skip for now" is
 * always there, and it can be opened again from Settings → App permissions.
 */
export function PermissionsScreen({ userId, onClose }: { userId: number; onClose: () => void }) {
  const [st, setSt] = useState<Record<Row['key'], Status>>({ notifications: 'unknown', camera: 'unknown', install: 'unknown' });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [n, c, i] = await Promise.all([
      LocalNotifications.checkPermissions().then((r) => norm(r.display)).catch((): Status => 'unknown'),
      Camera.checkPermissions().then((r) => norm(r.camera)).catch((): Status => 'unknown'),
      BudgetNative.canInstall().then((r): Status => (r.value ? 'granted' : 'prompt')).catch((): Status => 'unknown'),
    ]);
    setSt({ notifications: n, camera: c, install: i });
  }, []);

  // Check now and every time the app comes back (e.g. from Android settings).
  useEffect(() => {
    void refresh();
    const sub = App.addListener('resume', () => void refresh());
    return () => void sub.then((h) => h.remove());
  }, [refresh]);

  const ask = async (key: Row['key']) => {
    // Permanently denied: Android won't ask again, only its settings page can change it.
    if (st[key] === 'denied' && key !== 'install') return BudgetNative.openAppSettings();
    if (key === 'notifications') await LocalNotifications.requestPermissions().catch(() => undefined);
    if (key === 'camera') await Camera.requestPermissions({ permissions: ['camera'] }).catch(() => undefined);
    if (key === 'install') await BudgetNative.openInstallSettings().catch(() => undefined); // re-checked on resume
    await refresh();
  };

  const allowAll = async () => {
    setBusy(true);
    for (const r of ROWS) if (st[r.key] !== 'granted') await ask(r.key);
    setBusy(false);
  };

  const close = () => {
    markSeen(userId);
    onClose();
  };
  const allGranted = ROWS.every((r) => st[r.key] === 'granted');

  return (
    <div className="perm-page" role="dialog" aria-modal="true" aria-labelledby="perm-title">
      <ShieldCheck size={34} style={{ color: 'var(--accent)' }} aria-hidden="true" />
      <h1 id="perm-title">{t('Set up permissions')}</h1>
      <p className="small mute">{t('Budget me only asks for what its features use. You can change any of these later in Settings.')}</p>
      <div className="card" style={{ marginTop: 14 }}>
        {ROWS.map((r) => {
          const s = st[r.key];
          const Icon = r.icon;
          return (
            <div key={r.key} className="perm-row">
              <span className="perm-icon" aria-hidden="true">
                <Icon size={20} />
              </span>
              <div className="grow">
                <strong className="small">{t(r.title)}</strong>
                <div className="tiny mute">{t(r.why)}</div>
              </div>
              {s === 'granted' ? (
                <span className="chip ok">{t('Allowed')}</span>
              ) : (
                <button type="button" className="btn tonal small" onClick={() => void ask(r.key)} aria-label={`${t(s === 'denied' ? 'Open settings' : 'Allow')}: ${t(r.title)}`}>
                  {s === 'denied' && r.key !== 'install' ? t('Open settings') : t('Allow')}
                </button>
              )}
            </div>
          );
        })}
        <div className="perm-row">
          <span className="perm-icon" aria-hidden="true">
            <ImageIcon size={20} />
          </span>
          <div className="grow">
            <strong className="small">{t('Photos')}</strong>
            <div className="tiny mute">{t("Receipts from your gallery use Android's photo picker: no permission needed.")}</div>
          </div>
          <span className="chip ok">{t('Not needed')}</span>
        </div>
      </div>
      <div className="stack" style={{ marginTop: 16 }}>
        {!allGranted && (
          <button className="btn primary block" disabled={busy} onClick={() => void allowAll()}>
            {t('Allow all')}
          </button>
        )}
        <button className="btn ghost block" onClick={close}>
          {allGranted ? t('Done') : t('Skip for now')}
        </button>
      </div>
    </div>
  );
}

/** Shown once after the first sign-in in the Android app. */
export function FirstRunPermissions({ userId }: { userId: number }) {
  const [open, setOpen] = useState(() => isNative() && !permissionsSeen(userId));
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('bm-show-permissions', show);
    return () => window.removeEventListener('bm-show-permissions', show);
  }, []);
  if (!open || !isNative()) return null;
  return <PermissionsScreen userId={userId} onClose={() => setOpen(false)} />;
}

/** Settings → "App permissions". */
export const openPermissions = () => window.dispatchEvent(new Event('bm-show-permissions'));
