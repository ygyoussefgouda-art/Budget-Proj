import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Languages, Wallet } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { COLORS, FormError, Segmented } from '../components/ui';
import { langOptions, t, useI18n, type LangPref } from '../i18n';
import { APP_VERSION, STAGE } from '../version';

type Mode = 'signin' | 'signup';
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

export default function Login() {
  const qc = useQueryClient();
  const { pref: langPref, setPref: setLangPref } = useI18n();
  const config = useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api<{ signupEnabled: boolean }>('/auth/config'),
    staleTime: Infinity,
  });
  const signupEnabled = config.data?.signupEnabled ?? true;

  const [mode, setMode] = useState<Mode>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      if (password.length < 8) return setErr(t('Use a password of at least 8 characters.'));
      if (password !== confirm) return setErr(t('The two passwords do not match.'));
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api(signup ? '/auth/signup' : '/auth/login', 'POST', { username: name, password });
      qc.setQueryData(['me'], r);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

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
        <h1 dir="ltr" style={{ textAlign: 'start' }}>
          Budget <span style={{ color: COLORS.accent }}>me</span>
          <span className="stage-badge">{t(STAGE)}</span>
        </h1>
        <p className="tiny mute">{t('Early test version {v}. Things may change between updates.', { v: APP_VERSION })}</p>

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
          {signup && <span className="field-hint">{t('At least 8 characters.')}</span>}
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

        <FormError text={err} />
        <button className="btn primary block" disabled={busy}>
          {busy ? (signup ? t('Creating account…') : t('Signing in…')) : signup ? t('Create account') : t('Sign in')}
        </button>
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
