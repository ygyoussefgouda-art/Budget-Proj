import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileSpreadsheet, GraduationCap, ShieldCheck, KeyRound, Languages, LogOut, MonitorSmartphone, Trash2, Upload, UserX } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ExportCardBody } from '../components/ExportLinks';
import MonthStartPicker from '../components/MonthStartPicker';
import { Sheet, useOverlay } from '../components/Overlays';
import { restartTutorial } from '../components/Tutorial';
import { Card, Field, FormError, IconButton, PageHeader, SaveButton, SectionTitle, Segmented } from '../components/ui';
import { langOptions, t, useI18n, type LangPref } from '../i18n';
import { clearKit, clearQueue } from '../offline';
import { removeLock } from '../pin';
import AppLockSettings from '../components/AppLockSettings';
import ContactCard from '../components/ContactCard';
import { CURRENCIES, useApp } from '../state';
import { getThemePref, setThemePref, type ThemePref } from '../theme';
import { APP_NAME, APP_VERSION, STAGE, VERSION_KEY } from '../version';

export default function Settings() {
  const { user, refresh } = useApp();
  const { pref: langPref, setPref: setLangPref } = useI18n();
  const [themePref, setThemePrefState] = useState<ThemePref>(getThemePref);
  const { confirm, confirmPassword, toast } = useOverlay();
  const qc = useQueryClient();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<'password' | 'delete' | null>(null);

  const setCurrency = async (currency: string) => {
    try {
      const r = await api<{ user: typeof user }>('/settings', 'PUT', { currency });
      qc.setQueryData(['me'], r);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const exportBackup = async () => {
    try {
      const data = await api('/backup');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `budget-me-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast(t('Export failed: {error}', { error: (e as Error).message }));
    }
  };

  const restore = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        toast(t('This file is not a valid backup.'));
        return;
      }
      const password = await confirmPassword(t('Restore backup?'), t('This replaces ALL current data with the backup, and removes all receipt photos. This cannot be undone.'), t('Restore'));
      if (password === null) return;
      await api('/backup/restore', 'POST', { password, backup: json });
      await refresh();
      toast(t('Backup restored.'));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const erase = async () => {
    const password = await confirmPassword(t('Erase everything?'), t('All expenses, receipts, loans, savings and budgets are deleted. Export a backup first if unsure.'), t('Erase'));
    if (password === null) return;
    try {
      await api('/reset', 'POST', { password });
      await refresh();
      toast(t('All data erased.'));
    } catch (e) {
      toast((e as Error).message);
    }
  };

  /** Back to the sign-in screen and forget all cached data. */
  const signedOut = () => {
    clearKit(); // the offline kit (name, categories) leaves the phone too
    removeLock(user.id); // and the app lock: signing in again starts without one
    // Update the observed ['me'] query first (shows the login screen), then drop cached data.
    qc.setQueryData(['me'], null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  };
  const logout = async () => {
    await api('/auth/logout', 'POST').catch(() => undefined);
    signedOut();
  };
  const logoutAll = async () => {
    if (!(await confirm(t('Sign out everywhere?'), t('Every phone and computer signed in to this account will be signed out, this one too.'), t('Sign out')))) return;
    await api('/auth/logout-all', 'POST').catch(() => undefined);
    signedOut();
  };

  return (
    <div className="page">
      <PageHeader
        title={t('Settings')}
        left={<IconButton icon={ArrowLeft} label={t('Back')} onClick={() => nav('/')} flip />}
      />

      <Card>
        <SectionTitle trailing={<Languages size={18} className="mute" />}>{t('Language')}</SectionTitle>
        <Segmented value={langPref} onChange={(v: LangPref) => setLangPref(v)} options={langOptions()} />
        <p className="tiny mute">
          {t("System uses your phone's language. Arabic shows the app right-to-left. Saved on this device.")}
        </p>
      </Card>

      <Card>
        <SectionTitle>{t('Appearance')}</SectionTitle>
        <Segmented
          value={themePref}
          onChange={(v) => {
            setThemePrefState(v);
            setThemePref(v);
          }}
          options={[
            { value: 'dark', label: t('Dark') },
            { value: 'light', label: t('Light') },
            { value: 'system', label: t('System') },
          ]}
        />
        <p className="tiny mute">{t("System follows your phone's light or dark setting. Saved on this device.")}</p>
      </Card>

      <Card>
        <SectionTitle>{t('Month start')}</SectionTitle>
        <MonthStartPicker />
      </Card>

      <Card>
        <SectionTitle>{t('Currency')}</SectionTitle>
        <Field label={t('Displayed currency')} hint={t('Only the label changes. Amounts are not converted.')}>
          <select className="input" value={user.currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </Card>

      <Card>
        <SectionTitle trailing={<FileSpreadsheet size={18} className="mute" />}>{t('Export to a spreadsheet')}</SectionTitle>
        <ExportCardBody />
      </Card>

      <Card>
        <SectionTitle>{t('Backup & restore')}</SectionTitle>
        <p className="small mute">
          {t('Your data is stored on your server. Download a backup now and then; you can also restore a backup made by the old phone app.')}
        </p>
        <p className="tiny mute" style={{ marginTop: 6 }}>
          {t('Receipt photos are not included in the downloaded file; they stay on the server.')}
        </p>
        <div className="stack">
          <button className="btn tonal block" onClick={exportBackup}>
            <Download size={18} /> {t('Download backup')}
          </button>
          <button className="btn tonal block" onClick={() => fileRef.current?.click()}>
            <Upload size={18} /> {t('Restore from backup')}
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => restore(e.target.files?.[0])} />
        </div>
      </Card>

      <AppLockSettings />

      <Card>
        <SectionTitle>{t('Account')}</SectionTitle>
        <p className="small" style={{ marginBottom: 12 }}>
          {t('Signed in as')} <strong dir="ltr">{user.username}</strong>
        </p>
        <div className="stack">
          <button className="btn tonal block" onClick={() => setSheet('password')}>
            <KeyRound size={18} /> {t('Change password')}
          </button>
          <button className="btn tonal block" onClick={logout}>
            <LogOut size={18} className="flip-rtl" /> {t('Sign out')}
          </button>
          <button className="btn outline block" onClick={logoutAll}>
            <MonitorSmartphone size={18} /> {t('Sign out everywhere')}
          </button>
          <button className="btn text danger-text block" onClick={() => setSheet('delete')}>
            <UserX size={18} /> {t('Delete my account')}
          </button>
        </div>
      </Card>

      <Sheet open={sheet === 'password'} onClose={() => setSheet(null)} title={t('Change password')}>
        {sheet === 'password' && (
          <ChangePasswordForm
            onDone={() => {
              setSheet(null);
              toast(t('Password changed. Other devices were signed out.'));
            }}
          />
        )}
      </Sheet>
      <Sheet open={sheet === 'delete'} onClose={() => setSheet(null)} title={t('Delete my account')}>
        {sheet === 'delete' && <DeleteAccountForm onDeleted={signedOut} />}
      </Sheet>

      <Card>
        <SectionTitle>{t('Danger zone')}</SectionTitle>
        <button className="btn outline danger-text block" onClick={erase}>
          <Trash2 size={18} /> {t('Erase all data')}
        </button>
      </Card>

      {user.isAdmin && (
        <Card>
          <SectionTitle trailing={<ShieldCheck size={18} className="mute" />}>{t('Admin')}</SectionTitle>
          <p className="small mute">{t('Manage accounts, sign-ups and password resets.')}</p>
          <div className="stack" style={{ marginTop: 10 }}>
            <button className="btn tonal block" onClick={() => nav('/admin')}>
              <ShieldCheck size={18} /> {t('Open the admin page')}
            </button>
          </div>
        </Card>
      )}

      <ContactCard />

      <Card>
        <SectionTitle trailing={<span className="stage-badge">{t(STAGE)}</span>}>{t('About')}</SectionTitle>
        <p className="small">
          {APP_NAME} <span className="mute">{t(VERSION_KEY, { v: APP_VERSION })}</span>
        </p>
        <p className="small mute" style={{ marginTop: 6 }}>
          {t('This is an alpha: an early test version. Screens and features may still change, and you might find bugs. Download a backup now and then so your data is safe.')}
        </p>
        <div className="stack">
          <button className="btn tonal block" onClick={() => restartTutorial()}>
            <GraduationCap size={18} /> {t('Show the tutorial again')}
          </button>
        </div>
      </Card>
    </div>
  );
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const { user } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!current) return setErr(t('Enter your current password.'));
    if (next.length < 10) return setErr(t('Use a password of at least 10 characters.'));
    if (next.toLowerCase() === user.username) return setErr(t('Your password must not be the same as your username.'));
    if (next !== repeat) return setErr(t('The two passwords do not match.'));
    setBusy(true);
    try {
      await api('/auth/password', 'POST', { current, next });
      onDone();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="form">
      <Field label={t('Current password')}>
        <input className="input" dir="ltr" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label={t('New password')} hint={t('At least 10 characters.')}>
        <input className="input" dir="ltr" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label={t('Repeat new password')}>
        <input className="input" dir="ltr" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </Field>
      <p className="tiny mute">{t('Other phones and computers signed in to this account will be signed out.')}</p>
      <FormError text={err} />
      <SaveButton label={t('Change password')} busy={busy} />
    </form>
  );
}

function DeleteAccountForm({ onDeleted }: { onDeleted: () => void }) {
  const { user } = useApp();
  const { confirm } = useOverlay();
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return setErr(t('Enter your password.'));
    const ok = await confirm(
      t('Delete "{name}" for good?', { name: user.username }),
      t('Your account and everything in it (expenses, receipts, savings, loans, budgets) are deleted. This cannot be undone.'),
      t('Delete'),
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api('/auth/delete-account', 'POST', { password });
      await clearQueue(user.id).catch(() => undefined); // expenses waiting offline go too
      onDeleted();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="form">
      <p className="small">{t('Download a backup first if you might want your data later.')}</p>
      <Field label={t('Your password')}>
        <input className="input" dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <FormError text={err} />
      <button type="submit" className="btn danger block" disabled={busy}>
        {busy ? t('Deleting…') : t('Delete my account')}
      </button>
    </form>
  );
}
