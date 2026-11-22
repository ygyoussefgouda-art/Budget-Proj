import { useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../state';
import { Sheet, useOverlay } from './Overlays';
import { Card, Field, FormError, SaveButton, SectionTitle } from './ui';

/** Settings → Two-step sign-in: password + a code from an authenticator app. Recommended for admins. */
export default function TwoFactorCard() {
  const { user } = useApp();
  const [sheet, setSheet] = useState<'on' | 'off' | null>(null);
  const on = !!user.twoFactor;
  return (
    <Card>
      <SectionTitle trailing={<ShieldCheck size={18} className="mute" />}>{t('Two-step sign-in')}</SectionTitle>
      <p className="small mute">
        {on
          ? t('On: signing in needs your password and a code from your authenticator app.')
          : t('Off. Turn it on so a stolen password alone is not enough to sign in (recommended for admins).')}
      </p>
      <div className="stack" style={{ marginTop: 10 }}>
        <button className={`btn ${on ? 'outline' : 'tonal'} block`} onClick={() => setSheet(on ? 'off' : 'on')}>
          <KeyRound size={18} /> {on ? t('Turn off two-step sign-in') : t('Turn on two-step sign-in')}
        </button>
      </div>
      <Sheet open={sheet !== null} onClose={() => setSheet(null)} title={t('Two-step sign-in')}>
        {sheet === 'on' && <TurnOn onDone={() => setSheet(null)} />}
        {sheet === 'off' && <TurnOff onDone={() => setSheet(null)} />}
      </Sheet>
    </Card>
  );
}

function TurnOn({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useOverlay();
  const [step, setStep] = useState<'password' | 'app' | 'codes'>('password');
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return setErr(t('Enter your password.'));
    setBusy(true);
    setErr(null);
    try {
      setSetup(await api<{ secret: string; uri: string }>('/auth/2fa/setup', 'POST', { password }));
      setStep('app');
    } catch (x) {
      setErr((x as Error).message);
    }
    setBusy(false);
  };
  const enable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ backupCodes: string[]; user: unknown }>('/auth/2fa/enable', 'POST', { code: code.trim() });
      qc.setQueryData(['me'], { user: r.user });
      setBackup(r.backupCodes);
      setStep('codes');
    } catch (x) {
      setErr((x as Error).message);
    }
    setBusy(false);
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('Copied.'));
    } catch {
      toast(t('Copy it by hand.'));
    }
  };

  if (step === 'password') {
    return (
      <form onSubmit={start} className="form">
        <p className="small">{t('You need an authenticator app on your phone, for example Google Authenticator, Microsoft Authenticator, Aegis or 2FAS (all free).')}</p>
        <Field label={t('Your password')}>
          <input className="input" dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <FormError text={err} />
        <SaveButton label={t('Continue')} busy={busy} />
      </form>
    );
  }
  if (step === 'app' && setup) {
    return (
      <form onSubmit={enable} className="form">
        <p className="small">{t('1. Add Masrofy to your authenticator app: tap the button on this phone, or type the key in the app.')}</p>
        <a className="btn tonal block" href={setup.uri}>
          <KeyRound size={18} /> {t('Open in authenticator app')}
        </a>
        <div className="reset-code" dir="ltr" aria-label={t('Setup key')} style={{ fontSize: 16, letterSpacing: 1 }}>
          {setup.secret.match(/.{1,4}/g)?.join(' ')}
        </div>
        <button type="button" className="btn text small" onClick={() => void copy(setup.secret)}>
          <Copy size={16} /> {t('Copy key')}
        </button>
        <Field label={t('2. Enter the 6-digit code it shows')}>
          <input className="input" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <FormError text={err} />
        <SaveButton label={t('Turn on')} busy={busy} />
      </form>
    );
  }
  return (
    <div className="form">
      <p className="small">{t('Two-step sign-in is on. Keep these backup codes somewhere safe (a password manager or on paper). Each one works once if you lose your phone.')}</p>
      <div className="reset-code backup-codes" dir="ltr" aria-label={t('Backup codes')}>
        {backup.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <button type="button" className="btn tonal block" onClick={() => void copy(backup.join('\n'))}>
        <Copy size={18} /> {t('Copy backup codes')}
      </button>
      <p className="tiny mute">{t('They are shown only now.')}</p>
      <button type="button" className="btn primary block" onClick={onDone}>
        {t('Done')}
      </button>
    </div>
  );
}

function TurnOff({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useOverlay();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || !code.trim()) return setErr(t('Enter your password and a code.'));
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ user: unknown }>('/auth/2fa/disable', 'POST', { password, code: code.trim() });
      qc.setQueryData(['me'], { user: r.user });
      toast(t('Two-step sign-in is off.'));
      onDone();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="form">
      <Field label={t('Your password')}>
        <input className="input" dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label={t('Code from your app (or a backup code)')}>
        <input className="input" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <FormError text={err} />
      <SaveButton label={t('Turn off')} busy={busy} />
    </form>
  );
}
