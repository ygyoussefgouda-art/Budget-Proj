import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, KeyRound, Lock, Shield, ShieldOff } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Bars } from '../components/charts';
import { Sheet, useOverlay } from '../components/Overlays';
import { Card, COLORS, DeleteButton, Empty, Field, FormError, IconButton, PageHeader, Pill, SaveButton, SectionTitle, Segmented } from '../components/ui';
import { locale, t } from '../i18n';
import { useApp } from '../state';

interface AdminUser { id: number; username: string; createdAt: string; lastActiveAt: string | null; receiptBytes: number; items: number; isAdmin: boolean; twoFactor?: boolean }
interface AuditEntry { id: number; actor: string; action: string; target: string | null; details: Record<string, unknown>; at: string }
interface ResetCode { code: string; username: string; expiresAt: string }

const when = (iso: string) =>
  new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
const size = (bytes: number) =>
  bytes < 1024 * 1024 ? t('{n} KB', { n: Math.round(bytes / 1024) }) : t('{n} MB', { n: (bytes / (1024 * 1024)).toFixed(1) });


/** What an audit entry means, in words. */
function auditText(e: AuditEntry) {
  switch (e.action) {
    case 'user_deleted':
      return t('{actor} removed the account "{target}"', { actor: e.actor, target: e.target ?? '' });
    case 'reset_code_created':
      return t('{actor} made a password reset code for "{target}"', { actor: e.actor, target: e.target ?? '' });
    case 'password_reset':
      return t('"{target}" chose a new password with a reset code', { target: e.target ?? '' });
    case 'signup_settings_changed': {
      const open = e.details.allowSignup ? t('sign-ups open') : t('sign-ups closed');
      return t('{actor} changed sign-up settings: {what}', { actor: e.actor, what: open });
    }
    default:
      return `${e.actor}: ${e.action}`;
  }
}

interface AdminStatus { gated: boolean; twoFactor: boolean; unlockedUntil: string | null }
interface UsageStats {
  accounts: { total: number; twoFactor: number; new7: number; new30: number };
  active: { today: number; d7: number; d30: number };
  signupsByMonth: { month: string; count: number }[];
  dailyActive: { day: string; users: number; android: number; web: number }[];
  clients30d: { androidOnly: number; webOnly: number; both: number };
  trackedSince: string | null;
}

export default function Admin() {
  const { user } = useApp();
  const nav = useNavigate();
  // Only the admin account ever sees this page; for everyone else it doesn't exist (the server says 404 too).
  if (!user.isAdmin) return <Navigate to="/" replace />;
  return (
    <div className="page">
      <PageHeader title={t('Admin')} left={<IconButton icon={ArrowLeft} label={t('Back')} onClick={() => nav('/more')} flip />} />
      <AdminGate />
    </div>
  );
}

/**
 * 2.3.0: the admin area opens only with two-step sign-in on, after the password and a current code, for
 * 15 minutes on this device. When the time is up it locks itself again.
 */
function AdminGate() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const status = useQuery({ queryKey: ['admin-status'], queryFn: () => api<AdminStatus>('/admin/status'), refetchInterval: 60_000 });
  const until = status.data?.unlockedUntil ? Date.parse(status.data.unlockedUntil) : 0;
  const open = !!status.data && (!status.data.gated || until > Date.now());
  // Lock the screen the moment the time is up.
  useEffect(() => {
    if (!until) return;
    const ms = until - Date.now();
    if (ms <= 0) return;
    const timer = setTimeout(() => void qc.invalidateQueries({ queryKey: ['admin-status'] }), ms + 500);
    return () => clearTimeout(timer);
  }, [until, qc]);
  // Leaving the admin area: nothing admin stays in memory.
  useEffect(() => () => qc.removeQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('admin-') && q.queryKey[0] !== 'admin-status' }), [qc]);

  if (status.isLoading) return <p className="tiny mute">{t('Loading')}…</p>;
  if (status.isError) return <FormError text={(status.error as Error).message} />;
  const s = status.data!;
  if (s.gated && !s.twoFactor) {
    return (
      <Card className="warn-card">
        <p className="small">{t('The admin area needs two-step sign-in. Turn it on in Settings, then come back.')}</p>
        <button type="button" className="btn tonal block" style={{ marginTop: 10 }} onClick={() => nav('/settings')}>
          {t('Open Settings')}
        </button>
      </Card>
    );
  }
  if (!open) return <UnlockForm />;
  return (
    <>
      {s.gated && (
        <div className="admin-lockbar">
          <Lock size={16} aria-hidden="true" />
          <span className="grow small">
            {t('Unlocked until {time}', { time: new Date(until).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', hour12: true }) })}
          </span>
          <button
            type="button"
            className="btn text small"
            onClick={async () => {
              await api('/admin/lock', 'POST');
              qc.removeQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('admin-') && q.queryKey[0] !== 'admin-status' });
              await qc.invalidateQueries({ queryKey: ['admin-status'] });
            }}
          >
            {t('Lock now')}
          </button>
        </div>
      )}
      <StatsCard />
      <SignupCard />
      <UsersCard />
      <AuditCard />
    </>
  );
}

function UnlockForm() {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return setErr(t('Enter your password.'));
    if (!/^\s*[\dA-Za-z-]{6,}\s*$/.test(code)) return setErr(t('Enter the 6-digit code from your app.'));
    setBusy(true);
    setErr(null);
    try {
      await api('/admin/unlock', 'POST', { password, code: code.trim() });
      setPassword('');
      setCode('');
      await qc.invalidateQueries({ queryKey: ['admin-status'] });
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };
  return (
    <Card>
      <form onSubmit={submit} className="form">
        <div className="row gap">
          <Lock size={20} aria-hidden="true" />
          <strong>{t('Unlock the admin area')}</strong>
        </div>
        <p className="small mute">{t('Type your password and the code from your authenticator app. It stays open for 15 minutes on this device.')}</p>
        <Field label={t('Your password')}>
          <input className="input" dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label={t('6-digit code')}>
          <input className="input" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <FormError text={err} />
        <SaveButton label={t('Unlock')} busy={busy} />
      </form>
    </Card>
  );
}

/** How many people use the app. Counts only: nobody's budget, names or entries. */
function StatsCard() {
  const q = useQuery({ queryKey: ['admin-stats'], queryFn: () => api<UsageStats>('/admin/stats') });
  const n = (v: number) => v.toLocaleString(locale());
  if (q.isLoading) return <p className="tiny mute">{t('Loading')}…</p>;
  if (q.isError) return <FormError text={(q.error as Error).message} />;
  const s = q.data!;
  const days = s.dailyActive;
  const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(locale(), { month: 'short', timeZone: 'UTC' });
  const c = s.clients30d;
  const clientTotal = c.androidOnly + c.webOnly + c.both;
  return (
    <>
      <Card>
        <SectionTitle>{t('People using Masrofy')}</SectionTitle>
        <div className="stat-grid">
          <Stat label={t('Active today')} value={n(s.active.today)} />
          <Stat label={t('Last 7 days')} value={n(s.active.d7)} />
          <Stat label={t('Last 30 days')} value={n(s.active.d30)} />
        </div>
        <div className="stat-grid">
          <Stat label={t('Accounts')} value={n(s.accounts.total)} />
          <Stat label={t('New this week')} value={n(s.accounts.new7)} />
          <Stat label={t('New this month')} value={n(s.accounts.new30)} />
        </div>
        <p className="tiny mute">
          {s.accounts.twoFactor === 1 ? t('1 account uses two-step sign-in.') : t('{n} accounts use two-step sign-in.', { n: n(s.accounts.twoFactor) })}
        </p>
      </Card>

      <Card>
        <SectionTitle>{t('Active people per day')}</SectionTitle>
        <Bars
          values={days.map((d) => d.users)}
          // A date every 7 days, ending on today (labels at the very edge would be cut off or overlap)
          labels={days.map((d, i) => ((days.length - 1 - i) % 7 === 0 && i > 0 ? dayLabel(d.day) : ''))}
          color={COLORS.accent}
          ariaLabel={t('Active people per day, last 30 days')}
        />
        <p className="tiny mute">
          {s.trackedSince
            ? t('Last 30 days. Daily numbers start on {date}.', { date: day(`${s.trackedSince}T00:00:00Z`) })
            : t('Daily numbers start from today.')}
        </p>
      </Card>

      <Card>
        <SectionTitle>{t('Android app or browser (last 30 days)')}</SectionTitle>
        {clientTotal === 0 ? (
          <p className="small mute">{t('No numbers yet.')}</p>
        ) : (
          <div className="stat-grid">
            <Stat label={t('Android app')} value={n(c.androidOnly)} />
            <Stat label={t('Browser')} value={n(c.webOnly)} />
            <Stat label={t('Both')} value={n(c.both)} />
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>{t('New accounts per month')}</SectionTitle>
        <Bars
          values={s.signupsByMonth.map((m) => m.count)}
          labels={s.signupsByMonth.map((m) => monthLabel(m.month))}
          color={COLORS.blue}
          ariaLabel={t('New accounts per month, last 12 months')}
        />
      </Card>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <strong className="stat-value">{value}</strong>
      <span className="tiny mute">{label}</span>
    </div>
  );
}

function SignupCard() {
  const { toast } = useOverlay();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: () => api<{ allowSignup: boolean }>('/admin/settings') });
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setOpen(q.data.allowSignup);
  }, [q.data]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/admin/settings', 'PUT', { allowSignup: open });
      await qc.invalidateQueries({ queryKey: ['admin-settings'] });
      await qc.invalidateQueries({ queryKey: ['admin-audit'] });
      toast(t('Sign-up settings saved.'));
    } catch (x) {
      setErr((x as Error).message);
    }
    setBusy(false);
  };

  return (
    <Card>
      <SectionTitle>{t('Sign-ups')}</SectionTitle>
      {/* No form until the real settings are loaded: saving the default would open sign-ups. */}
      {q.isLoading && <p className="tiny mute">{t('Loading')}…</p>}
      {q.isError && <FormError text={(q.error as Error).message} />}
      {q.data && (
      <form onSubmit={save} className="form">
        <Segmented
          value={open}
          onChange={setOpen}
          options={[
            { value: true, label: t('Open') },
            { value: false, label: t('Closed') },
          ]}
        />
        <p className="tiny mute">{open ? t('Anyone who can open the app can create an account.') : t('Nobody can create a new account. Existing accounts still sign in.')}</p>
        <FormError text={err} />
        <SaveButton label={t('Save')} busy={busy} />
      </form>
      )}
    </Card>
  );
}

function UsersCard() {
  const { user } = useApp();
  const { toast } = useOverlay();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-users'], queryFn: () => api<AdminUser[]>('/admin/users') });
  const [asking, setAsking] = useState<AdminUser | null>(null);
  const [reset, setReset] = useState<ResetCode | null>(null);
  const [removing, setRemoving] = useState<AdminUser | null>(null);
  const [twoFactorOff, setTwoFactorOff] = useState<AdminUser | null>(null);
  const closeReset = () => {
    setAsking(null);
    setReset(null);
  };

  const users = q.data ?? [];
  // Only the built-in owner may act on another admin; nobody resets the owner (its password is APP_PASSWORD).
  const canTouch = (u: AdminUser) => u.id !== user.id && (!u.isAdmin || user.username === 'owner');
  return (
    <Card>
      <SectionTitle trailing={<Pill color={COLORS.blue}>{users.length}</Pill>}>{t('Users')}</SectionTitle>
      {q.isLoading && <p className="tiny mute">{t('Loading')}…</p>}
      {q.isError && <p className="form-error">{(q.error as Error).message}</p>}
      {users.map((u) => (
        <div key={u.id} className="admin-user">
          <div className="grow">
            <div className="row gap">
              <strong dir="ltr">{u.username}</strong>
              {u.isAdmin && <Pill color={COLORS.accent}>{t('admin')}</Pill>}
              {u.twoFactor && <Pill color={COLORS.blue}>{t('2-step')}</Pill>}
              {u.id === user.id && <span className="tiny mute">{t('(you)')}</span>}
            </div>
            <div className="tiny mute">
              {t('Joined {date}', { date: day(u.createdAt) })} · {u.lastActiveAt ? t('Last active {date}', { date: day(u.lastActiveAt) }) : t('Never active')}
            </div>
            <div className="tiny mute">{t('{n} items · receipts {size}', { n: u.items.toLocaleString(locale()), size: size(u.receiptBytes) })}</div>
          </div>
          {canTouch(u) && (
            <div className="admin-actions">
              {u.username !== 'owner' && (
                <IconButton icon={KeyRound} label={t('Password reset code for {name}', { name: u.username })} onClick={() => setAsking(u)} />
              )}
              {u.twoFactor && (
                <IconButton icon={ShieldOff} label={t('Turn off two-step sign-in for {name}', { name: u.username })} onClick={() => setTwoFactorOff(u)} />
              )}
              {u.username !== 'owner' && <DeleteButton label={t('Remove {name}', { name: u.username })} onClick={() => setRemoving(u)} />}
            </div>
          )}
        </div>
      ))}

      <Sheet open={!!asking} onClose={closeReset} title={t('Password reset code')}>
        {reset ? (
          <ResetCodeView r={reset} />
        ) : (
          asking && (
            <ResetCodeForm
              u={asking}
              onDone={async (r) => {
                setReset(r);
                await qc.invalidateQueries({ queryKey: ['admin-audit'] });
              }}
            />
          )
        )}
      </Sheet>
      <Sheet open={!!twoFactorOff} onClose={() => setTwoFactorOff(null)} title={t('Turn off two-step sign-in')}>
        {twoFactorOff && (
          <PasswordAction
            text={t('For a lost phone: "{name}" can then sign in with the password only (and is signed out everywhere now).', { name: twoFactorOff.username })}
            action={t('Turn off')}
            run={(password) => api(`/admin/users/${twoFactorOff.id}/disable-2fa`, 'POST', { password })}
            onDone={async () => {
              setTwoFactorOff(null);
              await qc.invalidateQueries({ queryKey: ['admin-users'] });
              await qc.invalidateQueries({ queryKey: ['admin-audit'] });
              toast(t('Two-step sign-in is off for "{name}".', { name: twoFactorOff.username }));
            }}
          />
        )}
      </Sheet>
      <Sheet open={!!removing} onClose={() => setRemoving(null)} title={t('Remove an account')}>
        {removing && (
          <RemoveUserForm
            u={removing}
            onDone={async () => {
              setRemoving(null);
              await qc.invalidateQueries({ queryKey: ['admin-users'] });
              await qc.invalidateQueries({ queryKey: ['admin-audit'] });
              toast(t('"{name}" was removed.', { name: removing.username }));
            }}
          />
        )}
      </Sheet>
    </Card>
  );
}

/** A reset code lets someone into that account, so the admin confirms with their own password first. */
function ResetCodeForm({ u, onDone }: { u: AdminUser; onDone: (r: ResetCode) => void }) {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return setErr(t('Enter your password.'));
    setBusy(true);
    setErr(null);
    try {
      onDone(await api<ResetCode>(`/admin/users/${u.id}/reset-code`, 'POST', { password }));
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="form">
      <p className="small">{t('Make a one-time code so "{name}" can choose a new password.', { name: u.username })}</p>
      <Field label={t('Your password')}>
        <input className="input" dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <FormError text={err} />
      <SaveButton label={t('Make code')} busy={busy} />
    </form>
  );
}

function ResetCodeView({ r }: { r: ResetCode }) {
  const { toast } = useOverlay();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(r.code);
      toast(t('Copied.'));
    } catch {
      toast(t('Copy it by hand.'));
    }
  };
  return (
    <div className="form">
      <p className="small">{t('Give this code to "{name}". On the sign-in screen they tap "Forgot password?" and enter it with a new password.', { name: r.username })}</p>
      <div className="reset-code" dir="ltr" aria-label={t('Reset code')}>
        {r.code}
      </div>
      <button type="button" className="btn tonal block" onClick={copy}>
        <Copy size={18} /> {t('Copy code')}
      </button>
      <p className="tiny mute">
        {t('Works once, until {time}. It is shown only now; making a new code cancels this one. Using it signs them out everywhere.', { time: when(r.expiresAt) })}
      </p>
    </div>
  );
}

/** An admin action confirmed with the admin's own password. */
function PasswordAction({ text, action, run, onDone }: { text: string; action: string; run: (password: string) => Promise<unknown>; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return setErr(t('Enter your password.'));
    setBusy(true);
    try {
      await run(password);
      onDone();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="form">
      <p className="small">{text}</p>
      <Field label={t('Your password')}>
        <input className="input" dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <FormError text={err} />
      <SaveButton label={action} busy={busy} />
    </form>
  );
}

function RemoveUserForm({ u, onDone }: { u: AdminUser; onDone: () => void }) {
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (typed.trim().toLowerCase() !== u.username) return setErr(t('Type the username exactly to confirm.'));
    if (!password) return setErr(t('Enter your password.'));
    setBusy(true);
    try {
      await api(`/admin/users/${u.id}/delete`, 'POST', { confirmUsername: typed, password });
      onDone();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="form">
      <div className="danger-box">
        <Shield size={18} aria-hidden="true" />
        <p className="small">
          {t('This deletes "{name}" and everything in the account (expenses, receipts, savings, loans). It cannot be undone.', { name: u.username })}
        </p>
      </div>
      <Field label={t('Type "{name}" to confirm', { name: u.username })}>
        <input className="input" dir="ltr" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="none" />
      </Field>
      <Field label={t('Your password')}>
        <input className="input" dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <FormError text={err} />
      <button className="btn danger block" disabled={busy}>
        {t('Remove account')}
      </button>
    </form>
  );
}

function AuditCard() {
  const q = useQuery({ queryKey: ['admin-audit'], queryFn: () => api<AuditEntry[]>('/admin/audit?limit=50') });
  const rows = q.data ?? [];
  return (
    <Card>
      <SectionTitle>{t('Activity log')}</SectionTitle>
      {q.isLoading && <p className="tiny mute">{t('Loading')}…</p>}
      {q.isError && <p className="form-error">{(q.error as Error).message}</p>}
      {q.data && rows.length === 0 && <Empty text={t('No admin actions yet.')} />}
      {rows.map((e) => (
        <div key={e.id} className="audit-row">
          <span className="small">{auditText(e)}</span>
          <span className="tiny mute">{when(e.at)}</span>
        </div>
      ))}
    </Card>
  );
}
