import { useQueryClient } from '@tanstack/react-query';
import { Delete, Fingerprint, Lock } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { clearKit } from '../offline';
import { BudgetNative, isNative } from '../native';
import { bioEnabled, clearFailures, markActive, pauseLockForPicker, pinMatches, readFailures, readLock, recordFailure, removeLock, shouldLock } from '../pin';
import { COLORS } from './ui';

/**
 * Covers the app with a PIN pad when it comes back after the chosen time in the background
 * (or is opened again). While locked, the app itself isn't rendered at all.
 * Also wraps the offline app, so no connection doesn't mean no lock.
 */
export function AppLock({ userId, children }: { userId: number; children: ReactNode }) {
  const user = { id: userId };
  const [locked, setLocked] = useState(() => shouldLock(user.id));

  useEffect(() => {
    if (!locked) markActive();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (!locked) markActive();
      } else if (shouldLock(user.id)) {
        setLocked(true);
      }
    };
    const onHide = () => !locked && markActive();
    // Opening the camera / file picker leaves the app for a moment: don't lock when it comes back.
    const onPick = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input[type="file"]')) pauseLockForPicker();
    };
    document.addEventListener('click', onPick, true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    // Keep "last used" fresh while the app is open, so a quick reload doesn't lock it.
    const timer = setInterval(() => document.visibilityState === 'visible' && !locked && markActive(), 15_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('click', onPick, true);
      clearInterval(timer);
    };
  }, [locked, user.id]);

  if (locked) {
    return (
      <LockScreen
        userId={userId}
        onUnlock={() => {
          markActive();
          setLocked(false);
        }}
      />
    );
  }
  return <>{children}</>;
}

function LockScreen({ userId, onUnlock }: { userId: number; onUnlock: () => void }) {
  const user = { id: userId };
  const qc = useQueryClient();
  const cfg = readLock(user.id);
  const length = cfg?.length ?? 4;
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [now, setNow] = useState(Date.now());
  const waitUntil = readFailures(user.id).until;
  const waiting = waitUntil > now;

  // Fingerprint / face first (Android app, if turned on); cancelling or failing shows the PIN pad.
  const askBio = useCallback(async () => {
    if (!isNative() || !bioEnabled(user.id)) return;
    try {
      const r = await BudgetNative.biometricVerify({ title: t('Unlock Budget me'), cancel: t('Use PIN') });
      if (r.verified) {
        clearFailures(user.id);
        onUnlock();
      }
    } catch {
      /* not available right now: the PIN pad is there */
    }
  }, [onUnlock, userId]);
  useEffect(() => {
    if (!waiting) void askBio();
    // only once, when the lock screen opens
  }, []);

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  const check = useCallback(
    async (value: string) => {
      if (!cfg) return onUnlock();
      setChecking(true);
      const ok = await pinMatches(value, cfg);
      setChecking(false);
      if (ok) {
        clearFailures(user.id);
        onUnlock();
        return;
      }
      const f = recordFailure(user.id);
      setNow(Date.now());
      setPin('');
      setErr(f.until > Date.now() ? t('Too many wrong tries. Wait a moment and try again.') : t('Wrong PIN. Try again.'));
    },
    [cfg, onUnlock, user.id],
  );

  const press = useCallback(
    (d: string) => {
      if (checking || waiting) return;
      setErr(null);
      // Check outside the state updater (StrictMode runs updaters twice: one wrong PIN would count twice).
      const next = (pin + d).slice(0, length);
      setPin(next);
      if (next.length === length) void check(next);
    },
    [check, checking, length, pin, waiting],
  );
  const back = () => setPin((p) => p.slice(0, -1));

  // Keyboard: digits, Backspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  const forgot = async () => {
    // Forgot the PIN: sign out; signing in again with the password starts without a lock.
    removeLock(user.id);
    clearKit();
    await api('/auth/logout', 'POST').catch(() => undefined);
    qc.setQueryData(['me'], null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  };

  const secs = Math.ceil((waitUntil - now) / 1000);
  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label={t('App locked')}>
      <span className="lock-icon" aria-hidden="true">
        <Lock size={28} />
      </span>
      <h1 className="lock-title">{t('Enter your PIN')}</h1>
      <div className="pin-dots" aria-label={t('{n} of {m} digits entered', { n: pin.length, m: length })} role="status">
        {Array.from({ length }, (_, i) => (
          <span key={i} className={`pin-dot ${i < pin.length ? 'on' : ''}`} />
        ))}
      </div>
      <p className="lock-msg" role="alert" style={{ color: err ? COLORS.red : undefined }}>
        {waiting ? t('Try again in {s} seconds.', { s: secs }) : (err ?? ' ')}
      </p>
      <div className="pin-pad" dir="ltr">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className="pin-key" onClick={() => press(d)} disabled={waiting || checking}>
            {d}
          </button>
        ))}
        <span />
        <button type="button" className="pin-key" onClick={() => press('0')} disabled={waiting || checking}>
          0
        </button>
        <button type="button" className="pin-key pin-back" onClick={back} aria-label={t('Delete last digit')}>
          <Delete size={22} />
        </button>
      </div>
      {isNative() && bioEnabled(user.id) && !waiting && (
        <button type="button" className="btn tonal small" onClick={() => void askBio()}>
          <Fingerprint size={18} aria-hidden="true" /> {t('Use fingerprint')}
        </button>
      )}
      <button type="button" className="btn text small" onClick={forgot}>
        {t('Forgot your PIN? Sign out')}
      </button>
    </div>
  );
}
