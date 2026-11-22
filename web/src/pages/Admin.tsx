import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, KeyRound, Shield, ShieldOff, Shuffle } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api';
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

/** A random invite code that's easy to share (no 0/O or 1/I). */
const randomInvite = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => abc[b % abc.length]).join('');
};

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
      const code =
        e.details.inviteCode === 'set' ? t('invite code changed') : e.details.inviteCode === 'cleared' ? t('invite code removed') : '';
      return t('{actor} changed sign-up settings: {what}', { actor: e.actor, what: [open, code].filter(Boolean).join(', ') });
    }
    default:
      return `${e.actor}: ${e.action}`;
  }
}

export default function Admin() {
  const { user } = useApp();
  const nav = useNavigate();
  if (!user.isAdmin) return <Navigate to="/settings" replace />;
  return (
    <div className="page">
      <PageHeader title={t('Admin')} left={<IconButton icon={ArrowLeft} label={t('Back')} onClick={() => nav('/settings')} flip />} />
      {!user.twoFactor && (
        <Card className="warn-card">
          <p className="small">{t('Admin accounts should use two-step sign-in. Turn it on in Settings → Two-step sign-in.')}</p>
        </Card>
      )}
      <SignupCard />
      <UsersCard />
      <AuditCard />
    </div>
  );
}

function SignupCard() {
  const { toast } = useOverlay();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: () => api<{ allowSignup: boolean; inviteCode: string }>('/admin/settings') });
  const [open, setOpen] = useState(true);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) {
      setOpen(q.data.allowSignup);
      setCode(q.data.inviteCode);
    }
  }, [q.data]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/admin/settings', 'PUT', { allowSignup: open, inviteCode: code.trim() || null });
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
      {/* No form until the real settings are loaded: saving the defaults would open sign-ups and drop the code. */}
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
        <p className="tiny mute">{open ? t('Anyone who can open the app can create an account (with the invite code, if set).') : t('Nobody can create a new account. Existing accounts still sign in.')}</p>
        {open && (
          <Field label={t('Invite code (optional)')} hint={t('Leave empty to let anyone sign up.')}>
            <div className="row gap">
              <input className="input grow" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} maxLength={100} autoComplete="off" />
              <IconButton icon={Shuffle} label={t('Make a random code')} onClick={() => setCode(randomInvite())} />
            </div>
          </Field>
        )}
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
