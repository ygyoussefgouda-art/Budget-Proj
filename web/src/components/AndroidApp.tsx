import { useQuery } from '@tanstack/react-query';
import { Download, RefreshCw, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getLang, locale, t } from '../i18n';
import { App, BudgetNative, isNative } from '../native';
import { cancelUpdate, checkForUpdate, continueAfterPermission, startUpdate, useUpdateState, type AndroidRelease } from '../update';
import { APP_VERSION } from '../version';
import { Card, SectionTitle } from './ui';

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const notesFor = (r: AndroidRelease) => (getLang() === 'ar' && r.notes.ar.length ? r.notes.ar : r.notes.en);

const ERRORS: Record<string, string> = {
  offline: 'No connection. Try again when you are online.',
  network: 'Download failed. Check your connection and storage, then try again.',
  checksum: 'The download was damaged. Try again.',
  size: 'The download was damaged. Try again.',
  package: 'This file is not a Masrofy update.',
  version: 'This version is already installed.',
  install: 'Could not open the installer.',
  http: 'The server could not send the update. Try again later.',
};
const errorText = (code: string | null) => (code ? t(ERRORS[code] ?? ERRORS.network) : null);

/**
 * Native-only glue, mounted once: Android back button, the "Add expense" shortcut, update checks on
 * launch and when the app comes back, and finishing an update after "Install unknown apps" was allowed.
 */
export function NativeLayer() {
  const nav = useNavigate();
  useEffect(() => {
    if (!isNative()) return;
    void BudgetNative.cleanup().catch(() => undefined);
    void checkForUpdate();
    const subs = [
      App.addListener('backButton', ({ canGoBack }) => {
        // An open sheet or dialog closes first (the same as pressing Escape).
        if (document.querySelector('[aria-modal="true"]')) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        } else if (canGoBack && window.location.pathname !== '/') {
          window.history.back();
        } else {
          void App.minimizeApp();
        }
      }),
      App.addListener('appUrlOpen', ({ url }) => {
        if (url.startsWith('budgetme://add-expense')) nav('/?add=expense');
      }),
      App.addListener('resume', () => {
        void continueAfterPermission();
        void checkForUpdate();
      }),
    ];
    return () => subs.forEach((s) => void s.then((h) => h.remove()));
  }, [nav]);
  return null;
}

function Progress({ value }: { value: number }) {
  return (
    <div className="bar thin" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label={t('Downloading the update')}>
      <span style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

/** The Update button and what happens after it (permission, progress, errors). */
function UpdateActions({ allowLater, onLater }: { allowLater: boolean; onLater?: () => void }) {
  const s = useUpdateState();
  const busy = s.status === 'downloading' || s.status === 'installing';
  return (
    <div className="stack">
      {s.status === 'needs-permission' && (
        <p className="small">{t('Allow Masrofy to install updates: turn on "Allow from this source", then come back.')}</p>
      )}
      {s.status === 'downloading' && (
        <>
          <Progress value={s.progress} />
          <p className="tiny mute">{t('Downloading… {pct}%', { pct: Math.round(s.progress * 100) })}</p>
        </>
      )}
      {s.status === 'installing' && <p className="small">{t('Android will now ask: "Do you want to update this app?" Tap Update.')}</p>}
      {s.status === 'error' && s.error && <p className="form-error">{errorText(s.error)}</p>}
      <button className="btn primary block" disabled={busy} onClick={() => void startUpdate()}>
        <Download size={18} /> {s.status === 'error' ? t('Try again') : t('Update')}
      </button>
      {s.status === 'downloading' && allowLater && (
        <button className="btn ghost block" onClick={cancelUpdate}>
          {t('Cancel')}
        </button>
      )}
      {allowLater && onLater && !busy && (
        <button className="btn ghost block" onClick={onLater}>
          {t('Later')}
        </button>
      )}
    </div>
  );
}

/** A required update (or this app is too old for the server): nothing else can be used until it's installed. */
export function UpdateGate() {
  const s = useUpdateState();
  if (!isNative() || s.need !== 'required') return null;
  return (
    <div className="update-gate" role="alertdialog" aria-modal="true" aria-labelledby="gate-title">
      <div className="update-gate-card">
        <Smartphone size={36} aria-hidden="true" />
        <h1 id="gate-title">{t('Update the app to continue')}</h1>
        {s.release ? (
          <>
            <p className="small">{t('Version {v} is needed to keep using Masrofy.', { v: s.release.versionName })}</p>
            <ul className="small notes">{notesFor(s.release).map((n) => <li key={n}>{n}</li>)}</ul>
            <UpdateActions allowLater={false} />
          </>
        ) : (
          <p className="small">{t('A newer app is needed, but it is not ready to download yet. Try again later.')}</p>
        )}
      </div>
    </div>
  );
}

/** An optional update: a small offer at the bottom (Update / Later), once per app start. */
export function UpdateOffer() {
  const s = useUpdateState();
  const [hidden, setHidden] = useState(false);
  if (!isNative() || s.need !== 'optional' || !s.release || hidden) return null;
  return (
    <div className="update-bar update-offer" role="status">
      <div className="grow">
        <strong>{t('Version {v} is available', { v: s.release.versionName })}</strong>
        {notesFor(s.release)[0] && <div className="tiny mute">{notesFor(s.release)[0]}</div>}
        {s.status === 'downloading' && <Progress value={s.progress} />}
      </div>
      {s.status === 'downloading' || s.status === 'installing' ? null : (
        <>
          <button className="btn ghost small" onClick={() => setHidden(true)}>
            {t('Later')}
          </button>
          <button className="btn primary small" onClick={() => void startUpdate()}>
            {t('Update')}
          </button>
        </>
      )}
    </div>
  );
}

/** Settings → About in the Android app: versions, last check, "Check for updates". */
export function UpdateCard() {
  const s = useUpdateState();
  if (!isNative()) return null;
  return (
    <Card>
      <SectionTitle trailing={<Smartphone size={18} className="mute" />}>{t('App updates')}</SectionTitle>
      <p className="small">
        {t('App {native} · screens {web}', { native: s.installed?.versionName ?? '…', web: APP_VERSION })}
      </p>
      <p className="tiny mute">
        {s.lastCheck
          ? t('Last checked {time}', { time: new Date(s.lastCheck).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })
          : t('Not checked yet')}
      </p>
      {s.need !== 'none' && s.release ? (
        <>
          <p className="small notice">{t('Version {v} is available', { v: s.release.versionName })}</p>
          <ul className="small notes">{notesFor(s.release).map((n) => <li key={n}>{n}</li>)}</ul>
          <UpdateActions allowLater={false} />
        </>
      ) : (
        <>
          {s.status === 'error' && s.error && <p className="form-error">{errorText(s.error)}</p>}
          <button className="btn tonal block" disabled={s.status === 'checking'} onClick={() => void checkForUpdate(true)}>
            <RefreshCw size={18} /> {s.status === 'checking' ? t('Checking…') : t('Check for updates')}
          </button>
          {s.status === 'idle' && s.release && s.need === 'none' && <p className="tiny mute">{t('You have the newest version.')}</p>}
        </>
      )}
    </Card>
  );
}

/** Newest APK on this server, or null (nothing published yet). */
function useAndroidRelease() {
  return useQuery({
    queryKey: ['android-release'],
    queryFn: async () => {
      const r = await fetch('/api/app/android/latest', { credentials: 'same-origin' });
      return r.ok ? ((await r.json()) as AndroidRelease) : null;
    },
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/** Browser only: "Get the Android app" with the download link and a 3-step guide. */
export function GetAndroidAppCard() {
  const q = useAndroidRelease();
  const r = q.data;
  if (isNative() || !r) return null;
  return (
    <Card>
      <SectionTitle trailing={<Smartphone size={18} className="mute" />}>{t('Get the Android app')}</SectionTitle>
      <p className="small mute">{t('Version {v} · {size} MB · {date}', { v: r.versionName, size: mb(r.size), date: day(r.releasedAt) })}</p>
      <ol className="small steps">
        <li>{t('Tap Download.')}</li>
        <li>{t('Open the file. If Android asks, allow your browser to install unknown apps.')}</li>
        <li>{t('Open Masrofy and sign in. The app then asks for the permissions it needs.')}</li>
      </ol>
      <a className="btn primary block" href={r.downloadUrl} download>
        <Download size={18} /> {t('Download')}
      </a>
      <p className="tiny mute">{t('Not on Google Play: this app is installed straight from this server. It updates itself.')}</p>
    </Card>
  );
}

const OFFER_KEY = 'masrofy.appOffer';
const isAndroidBrowser = () => !isNative() && /Android/i.test(navigator.userAgent);
const offerAnswered = () => {
  try {
    return !!localStorage.getItem(OFFER_KEY);
  } catch {
    return false;
  }
};
const answerOffer = (v: 'app' | 'web') => {
  try {
    localStorage.setItem(OFFER_KEY, v);
  } catch {
    /* private mode: ask again next time */
  }
};

/**
 * Asked once before the sign-in screen, in an Android phone's browser (owner's request):
 * download the app, or carry on in the browser. Returns 'loading' while checking for a release.
 */
export function useAppOffer() {
  const ask = isAndroidBrowser() && !offerAnswered();
  const q = useAndroidRelease();
  const [answered, setAnswered] = useState(false);
  if (!ask || answered) return { show: false as const };
  if (q.isLoading) return { show: 'loading' as const };
  if (!q.data) return { show: false as const };
  return { show: true as const, release: q.data, done: () => setAnswered(true) };
}

export function AppOffer({ release, onContinue }: { release: AndroidRelease; onContinue: () => void }) {
  const [downloaded, setDownloaded] = useState(false);
  const finish = () => {
    answerOffer(downloaded ? 'app' : 'web');
    onContinue();
  };
  return (
    <main className="login">
      <section className="login-card app-offer" aria-labelledby="app-offer-title">
        <img className="boot-logo center-self" src="/icon.svg" alt="" width={80} height={80} />
        <h1 id="app-offer-title" className="center">{t('Do you want to download the Masrofy app for a better experience?')}</h1>
        <p className="small mute center">{t('Opens faster, works offline, reminds you of payments and locks with your fingerprint.')}</p>
        <a className="btn primary block" href={release.downloadUrl} download onClick={() => setDownloaded(true)}>
          <Download size={18} aria-hidden="true" /> {t('Download the app')}
        </a>
        <p className="tiny mute center">{t('Version {v} · {size} MB · Not on Google Play', { v: release.versionName, size: mb(release.size) })}</p>
        {downloaded && (
          <ol className="small steps">
            <li>{t('Open the file. If Android asks, allow your browser to install unknown apps.')}</li>
            <li>{t('Open Masrofy and sign in. The app then asks for the permissions it needs.')}</li>
          </ol>
        )}
        <button type="button" className="btn ghost block" onClick={finish}>
          {t('Continue on the website')}
        </button>
      </section>
    </main>
  );
}

/** Small link on the sign-in screen (browser only, when an APK is published). */
export function GetAndroidAppLink() {
  const q = useAndroidRelease();
  if (isNative() || !q.data) return null;
  return (
    <a className="link-btn tiny center-self" href={q.data.downloadUrl} download>
      {t('Get the Android app')}
    </a>
  );
}
