import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Languages, Wallet } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import { GetAndroidAppLink } from '../components/AndroidApp';
import { newPasswordError, PasswordRules } from '../components/PasswordRules';
import { COLORS, FormError, Segmented } from '../components/ui';
import { langOptions, t, useI18n, type LangPref } from '../i18n';
import { APP_VERSION, STAGE, VERSION_KEY } from '../version';

type Mode = 'signin' | 'signup';
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AuthConfig {
  signupEnabled: boolean;
  inviteRequired?: boolean;
  emailRequired?: boolean;
  strongPasswords?: boolean;
  /** "Forgot password?" can email a code. */
  emailReset?: boolean;
}

/** Password input with a "Show" button in the label row (like the sign-up design). */
function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  describedBy,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  describedBy?: string;
  children?: ReactNode;
}) {
  const [show, setShow] = useState(false);
  const id = `pw-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="field">
      <div className="field-label-row">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        <button type="button" className="show-btn" aria-controls={id} aria-pressed={show} onClick={() => setShow((s) => !s)}>
          {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          {show ? t('Hide') : t('Show')}
        </button>
      </div>
      <input
        id={id}
        className="input"
        dir="ltr"
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
      {children}
    </div>
  );
}

export default function Login() {
  const qc = useQueryClient();
  const { pref: langPref, setPref: setLangPref } = useI18n();
  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => api<AuthConfig>('/auth/config'), staleTime: Infinity });
  const cfg = config.data;
  const signupEnabled = cfg?.signupEnabled ?? true;
  const inviteRequired = cfg?.inviteRequired ?? false;
  const emailRequired = cfg?.emailRequired ?? true;
  const strong = cfg?.strongPasswords ?? true;

  const [mode, setMode] = useState<Mode>('signin');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const signup = mode === 'signup' && signupEnabled;

  const switchMode = (m: Mode) => {
    setMode(m);
    setErr(null);
    setNotice(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = username.trim().toLowerCase();
    const mail = email.trim().toLowerCase();
    if (signup) {
      if (emailRequired && !mail) return setErr(t('Enter your email address.'));
      if (mail && !EMAIL_RE.test(mail)) return setErr(t('That email address does not look right.'));
    }
    if (!name) return setErr(signup ? t('Enter your username.') : t('Enter your username or email.'));
    if (!password) return setErr(t('Enter your password.'));
    if (signup) {
      if (!USERNAME_RE.test(name)) {
        return setErr(t('Usernames are 3–30 characters: letters, numbers, dots, dashes or underscores.'));
      }
      const pwErr = newPasswordError(password, name, strong);
      if (pwErr) return setErr(pwErr);
      if (inviteRequired && !invite.trim()) return setErr(t('Enter the invite code.'));
    }
    setBusy(true);
    setErr(null);
    try {
      const body = signup
        ? { username: name, password, ...(mail ? { email: mail } : {}), ...(inviteRequired ? { inviteCode: invite.trim() } : {}) }
        : { username: name, password };
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
          initial={username || email}
          byEmail={cfg?.emailReset ?? false}
          strong={strong}
          onCancel={() => setResetting(false)}
          onDone={(login) => {
            setResetting(false);
            setMode('signin');
            setUsername(login);
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

        {signup && (
          <label className="field">
            <span className="field-label">{t('Email')}</span>
            <input
              className="input"
              dir="ltr"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              autoFocus
              maxLength={254}
              onChange={(e) => setEmail(e.target.value)}
            />
            <span className="field-hint">{t('Used only to send you a code if you forget your password.')}</span>
          </label>
        )}

        <label className="field">
          <span className="field-label">{signup ? t('Username') : t('Username or email')}</span>
          <input
            className="input"
            dir="ltr"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            autoFocus={!signup}
            maxLength={signup ? 30 : 254}
            onChange={(e) => setUsername(e.target.value)}
          />
          {signup && <span className="field-hint">{t('3–30 characters: letters, numbers, dots, dashes or underscores.')}</span>}
        </label>

        <PasswordField
          label={t('Password')}
          value={password}
          onChange={setPassword}
          autoComplete={signup ? 'new-password' : 'current-password'}
          describedBy={signup ? 'signup-pw-rules' : undefined}
        >
          {signup && (strong ? <PasswordRules password={password} id="signup-pw-rules" /> : <span className="field-hint">{t('At least 10 characters.')}</span>)}
        </PasswordField>

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
        <GetAndroidAppLink />
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

/**
 * "Forgot password?". With email set up on the server: enter your email, get a code by email.
 * Otherwise (or for accounts without an email): a one-time code from the person who runs the app.
 */
function ResetPassword({
  initial,
  byEmail,
  strong,
  onCancel,
  onDone,
}: {
  initial: string;
  byEmail: boolean;
  strong: boolean;
  onCancel: () => void;
  onDone: (login: string) => void;
}) {
  const [step, setStep] = useState<'ask' | 'code'>(byEmail ? 'ask' : 'code');
  const [login, setLogin] = useState(initial);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    const mail = login.trim().toLowerCase();
    if (!EMAIL_RE.test(mail)) return setErr(t('Enter the email address of your account.'));
    setBusy(true);
    setErr(null);
    try {
      await api('/auth/forgot', 'POST', { email: mail });
      setLogin(mail);
      setStep('code');
      setInfo(t('If an account uses {email}, a code is on its way. Check your inbox (and spam).', { email: mail }));
    } catch (x) {
      setErr((x as Error).message);
    }
    setBusy(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const who = login.trim().toLowerCase();
    if (!who) return setErr(byEmail ? t('Enter your username or email.') : t('Enter your username.'));
    if (!code.trim()) return setErr(t('Enter the reset code.'));
    const pwErr = newPasswordError(password, who.includes('@') ? '' : who, strong);
    if (pwErr) return setErr(pwErr);
    setBusy(true);
    setErr(null);
    try {
      await api('/auth/reset', 'POST', { username: who, code: code.trim(), password });
      onDone(who);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  if (step === 'ask') {
    return (
      <form className="login-card" onSubmit={sendCode} noValidate>
        <h1>{t('Reset your password')}</h1>
        <p className="small mute">{t('Enter the email you signed up with. We send you a code that works once, for 30 minutes.')}</p>
        <label className="field">
          <span className="field-label">{t('Email')}</span>
          <input
            className="input"
            dir="ltr"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={login}
            autoFocus
            maxLength={254}
            onChange={(e) => setLogin(e.target.value)}
          />
        </label>
        <FormError text={err} />
        <button className="btn primary block" disabled={busy}>
          {busy ? t('Sending…') : t('Email me a code')}
        </button>
        <button type="button" className="link-btn tiny center-self" onClick={() => { setErr(null); setStep('code'); }}>
          {t('I already have a code')}
        </button>
        <p className="tiny mute">{t('No email on your account? Ask the person who runs this app for a reset code.')}</p>
        <button type="button" className="btn ghost block" onClick={onCancel}>
          {t('Back to sign in')}
        </button>
      </form>
    );
  }

  return (
    <form className="login-card" onSubmit={submit} noValidate>
      <h1>{t('Reset your password')}</h1>
      {info ? (
        <p className="small notice">{info}</p>
      ) : (
        <p className="small mute">
          {byEmail
            ? t('Enter the code from your email (or from the person who runs this app) and choose a new password.')
            : t('Ask the person who runs this app for a reset code. It works once, for 1 hour.')}
        </p>
      )}
      <label className="field">
        <span className="field-label">{byEmail ? t('Username or email') : t('Username')}</span>
        <input className="input" dir="ltr" autoComplete="username" autoCapitalize="none" value={login} onChange={(e) => setLogin(e.target.value)} maxLength={254} />
      </label>
      <label className="field">
        <span className="field-label">{t('Reset code')}</span>
        <input className="input" dir="ltr" autoComplete="one-time-code" autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXXX-XXXXX" maxLength={40} />
      </label>
      <PasswordField label={t('New password')} value={password} onChange={setPassword} autoComplete="new-password" describedBy="reset-pw-rules">
        {strong ? <PasswordRules password={password} id="reset-pw-rules" /> : <span className="field-hint">{t('At least 10 characters.')}</span>}
      </PasswordField>
      <p className="tiny mute">{t('All phones and computers signed in to this account will be signed out.')}</p>
      <FormError text={err} />
      <button className="btn primary block" disabled={busy}>
        {t('Set new password')}
      </button>
      {byEmail && (
        <button type="button" className="link-btn tiny center-self" onClick={() => { setErr(null); setInfo(null); setStep('ask'); }}>
          {t("Didn't get a code? Send a new one")}
        </button>
      )}
      <button type="button" className="btn ghost block" onClick={onCancel}>
        {t('Back to sign in')}
      </button>
    </form>
  );
}
