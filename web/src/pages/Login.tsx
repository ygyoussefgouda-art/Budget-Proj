import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Languages, Wallet } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { COLORS, FormError, Segmented } from '../components/ui';
import { langOptions, t, useI18n, type LangPref } from '../i18n';
import { APP_VERSION, STAGE, VERSION_KEY } from '../version';

type Mode = 'signin' | 'signup';
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

export default function Login() {
  const qc = useQueryClient();
  const { pref: langPref, setPref: setLangPref } = useI18n();
  const config = useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api<{ signupEnabled: boolean; inviteRequired?: boolean }>('/auth/config'),
    staleTime: Infinity,
  });
  const signupEnabled = config.data?.signupEnabled ?? true;
  const inviteRequired = config.data?.inviteRequired ?? false;

  const [mode, setMode] = useState<Mode>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [invite, setInvite] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const signup = mode === 'signup' && signupEnabled;

  const switchMode = (m: Mode) => {
    setMode(m);
    setErr(null);
    setConfirm('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = username.trim().toLowerCase();
    if (!name) return setErr(t('Enter your username.'));
    if (!password) return setErr(t('Enter your password.'));
    if (signup) {
      if (!USERNAME_RE.test(name)) {
        return setErr(t('Usernames are 3–30 characters: letters, numbers, dots, dashes or underscores.'));
      }
      if (password.length < 10) return setErr(t('Use a password of at least 10 characters.'));
      if (password.toLowerCase() === name) return setErr(t('Your password must not be the same as your username.'));
      if (password !== confirm) return setErr(t('The two passwords do not match.'));
      if (inviteRequired && !invite.trim()) return setErr(t('Enter the invite code.'));
    }
    setBusy(true);
    setErr(null);
    try {
      const body = signup && inviteRequired ? { username: name, password, inviteCode: invite.trim() } : { username: name, password };
      const r = await api(signup ? '/auth/signup' : '/auth/login', 'POST', body);
      // Start clean: nothing cached from an earlier account on this phone.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      qc.setQueryData(['me'], r);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  if (resetting) {
    return (
      <div className="login">
        <ResetPassword
          initialUsername={username}
          onCancel={() => setResetting(false)}
          onDone={(name) => {
            setResetting(false);
            setMode('signin');
            setUsername(name);
            setPassword('');
            setErr(null);
            setNotice(t('Password changed. Sign in with your new password.'));
          }}
        />
      </div>
    );
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit} noValidate>
        <div className="row between">
          <span className="login-logo">
            <Wallet size={30} style={{ color: 'var(--on-accent)' }} />
          </span>
          <label className="lang-switch" title={t('Language')}>
            <Languages size={15} aria-hidden="true" />
            <select aria-label={t('Language')} value={langPref} onChange={(e) => setLangPref(e.target.value as LangPref)}>
              {langOptions().map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <h1 className="brand">
          <span dir="ltr">
            Budget <span style={{ color: COLORS.accent }}>me</span>
          </span>
          <span className="stage-badge" title={t(STAGE)}>
            {t(VERSION_KEY, { v: APP_VERSION })}
          </span>
        </h1>
        <p className="tiny mute">{t('Early test version: things may change between updates.')}</p>

        {signupEnabled && (
          <Segmented
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'signin', label: t('Sign in') },
              { value: 'signup', label: t('Create account') },
            ]}
          />
        )}
        <p className="mute small">
          {signup ? t('Create your own account. Your budget starts empty and only you can see it.') : t('Sign in to see your budget.')}
        </p>

        <label className="field">
          <span className="field-label">{t('Username')}</span>
          <input
            className="input"
            dir="ltr"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            autoFocus
            maxLength={30}
            onChange={(e) => setUsername(e.target.value)}
          />
          {signup && <span className="field-hint">{t('3–30 characters: letters, numbers, dots, dashes or underscores.')}</span>}
        </label>

        <label className="field">
          <span className="field-label">{t('Password')}</span>
          <div className="input-wrap">
            <input
              className="input"
              dir="ltr"
              type={show ? 'text' : 'password'}
              autoComplete={signup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="input-icon-btn"
              aria-label={show ? t('Hide password') : t('Show password')}
              onClick={() => setShow((s) => !s)}
            >
              {show ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          {signup && <span className="field-hint">{t('At least 10 characters.')}</span>}
        </label>

        {signup && (
          <label className="field">
            <span className="field-label">{t('Repeat password')}</span>
            <input
              className="input"
              dir="ltr"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
        )}

        {signup && inviteRequired && (
          <label className="field">
            <span className="field-label">{t('Invite code')}</span>
            <input className="input" dir="ltr" autoComplete="off" value={invite} onChange={(e) => setInvite(e.target.value)} />
            <span className="field-hint">{t('Ask the person who runs this app for the code.')}</span>
          </label>
        )}

        {notice && !err && <p className="small notice">{notice}</p>}
        <FormError text={err} />
        <button className="btn primary block" disabled={busy}>
          {busy ? (signup ? t('Creating account…') : t('Signing in…')) : signup ? t('Create account') : t('Sign in')}
        </button>
        {!signup && (
          <button type="button" className="link-btn tiny center-self" onClick={() => setResetting(true)}>
            {t('Forgot password?')}
          </button>
        )}
        {signupEnabled && (
          <p className="tiny mute center">
            {signup ? t('Already have an account?') : t('New here?')}{' '}
            <button type="button" className="link-btn" onClick={() => switchMode(signup ? 'signin' : 'signup')}>
              {signup ? t('Sign in') : t('Create an account')}
            </button>
          </p>
        )}
      </form>
    </div>
  );
}

/** "Forgot password?": a one-time code from the person who runs the app, plus a new password. */
function ResetPassword({ initialUsername, onCancel, onDone }: { initialUsername: string; onCancel: () => void; onDone: (username: string) => void }) {
  const [username, setUsername] = useState(initialUsername);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = username.trim().toLowerCase();
    if (!name) return setErr(t('Enter your username.'));
    if (!code.trim()) return setErr(t('Enter the reset code.'));
    if (password.length < 10) return setErr(t('Use a password of at least 10 characters.'));
    if (password.toLowerCase() === name) return setErr(t('Your password must not be the same as your username.'));
    if (password !== confirm) return setErr(t('The two passwords do not match.'));
    setBusy(true);
    setErr(null);
    try {
      await api('/auth/reset', 'POST', { username: name, code: code.trim(), password });
      onDone(name);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  return (
    <form className="login-card" onSubmit={submit} noValidate>
      <h1>{t('Reset your password')}</h1>
      <p className="small mute">{t('Ask the person who runs this app for a reset code. It works once, for 1 hour.')}</p>
      <label className="field">
        <span className="field-label">{t('Username')}</span>
        <input className="input" dir="ltr" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={30} />
      </label>
      <label className="field">
        <span className="field-label">{t('Reset code')}</span>
        <input className="input" dir="ltr" autoComplete="one-time-code" autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXXX-XXXXX" maxLength={40} />
      </label>
      <label className="field">
        <span className="field-label">{t('New password')}</span>
        <input className="input" dir="ltr" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <span className="field-hint">{t('At least 10 characters.')}</span>
      </label>
      <label className="field">
        <span className="field-label">{t('Repeat new password')}</span>
        <input className="input" dir="ltr" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      <p className="tiny mute">{t('All phones and computers signed in to this account will be signed out.')}</p>
      <FormError text={err} />
      <button className="btn primary block" disabled={busy}>
        {t('Set new password')}
      </button>
      <button type="button" className="btn ghost block" onClick={onCancel}>
        {t('Back to sign in')}
      </button>
    </form>
  );
}
