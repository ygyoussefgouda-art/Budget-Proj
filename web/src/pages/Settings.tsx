import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, Check, ChevronRight, Download, FileSpreadsheet, GraduationCap, ShieldCheck, KeyRound, Languages, LogOut, Mail, MonitorSmartphone, Trash2, Upload, UserX } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ExportCardBody } from '../components/ExportLinks';
import MonthStartPicker from '../components/MonthStartPicker';
import { Sheet, useOverlay } from '../components/Overlays';
import { newPasswordError, PasswordRules } from '../components/PasswordRules';
import { restartTutorial } from '../components/Tutorial';
import { Card, Field, FormError, IconButton, PageHeader, SaveButton, SectionTitle, Segmented } from '../components/ui';
import { langOptions, t, useI18n, type LangPref } from '../i18n';
import { clearKit, clearQueue } from '../offline';
import { saveFile } from '../native';
import { removeLock } from '../pin';
import AppLockSettings from '../components/AppLockSettings';
import { GetAndroidAppCard, UpdateCard } from '../components/AndroidApp';
import RemindersCard from '../components/RemindersCard';
import TwoFactorCard from '../components/TwoFactorCard';
import ContactCard from '../components/ContactCard';
import { CURRENCIES, ordinal, periodLabel, thisMonth, useApp } from '../state';
import { ACCENT_INFO, ACCENTS, applyAccent, getThemePref, isAccent, setThemePref, type Accent, type ThemePref } from '../theme';
import { APP_NAME, APP_VERSION, DEVELOPER, MARK, VERSION_KEY } from '../version';

export default function Settings() {
  const { user, refresh, startDay } = useApp();
  const { pref: langPref, setPref: setLangPref } = useI18n();
  const [themePref, setThemePrefState] = useState<ThemePref>(getThemePref);
  const { confirm, confirmPassword, toast } = useOverlay();
  const qc = useQueryClient();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<'password' | 'email' | 'delete' | 'month' | null>(null);

  /** Saves one setting; false when it failed (the message is shown). */
  const saveSetting = async (change: { currency?: string; rollover?: boolean; mergeRepeats?: boolean; accent?: Accent }) => {
    try {
      const r = await api<{ user: typeof user }>('/settings', 'PUT', change);
      qc.setQueryData(['me'], r);
      if (change.rollover !== undefined) await refresh(); // the budget amounts change
      return true;
    } catch (e) {
      toast((e as Error).message);
      return false;
    }
  };
  const setCurrency = (currency: string) => saveSetting({ currency });
  /** 2.6.0: the new colour shows at once; if saving fails it goes back to the account's colour. */
  const accent: Accent = isAccent(user.accent) ? user.accent : 'lime';
  const pickAccent = async (a: Accent) => {
    if (a === accent) return;
    applyAccent(a);
    if (!(await saveSetting({ accent: a }))) applyAccent(accent);
  };

  const exportBackup = async () => {
    try {
      const data = await api('/backup');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      // Browser: a download. Android app: the share sheet (save to Files, Drive...).
      await saveFile(blob, `budget-me-backup-${new Date().toISOString().slice(0, 10)}.json`);
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
      const password = await confirmPassword(
        t('Restore backup?'),
        t('This replaces ALL current data with the backup, and removes all receipt photos. This cannot be undone.'),
        t('Restore'),
        { label: t('Download backup first'), icon: <Download size={18} />, run: exportBackup },
      );
      if (password === null) return;
      await api('/backup/restore', 'POST', { password, backup: json });
      await refresh();
      toast(t('Backup restored.'));
    } catch (e) {
      // Nothing was changed when a restore fails (it runs in one transaction): say so, then why.
      toast(t('Nothing was restored: {error}', { error: (e as Error).message }));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const erase = async () => {
    const password = await confirmPassword(
      t('Erase everything?'),
      t('All expenses, receipts, loans, savings and budgets are deleted. Export a backup first if unsure.'),
      t('Erase'),
      { label: t('Download backup first'), icon: <Download size={18} />, run: exportBackup },
    );
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
  const signedOut = async () => {
    removeLock(user.id); // the app lock: signing in again starts without one
    // Update the observed ['me'] query first (shows the login screen), then drop cached data.
    qc.setQueryData(['me'], null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    // Then the offline kit and the saved copy leave the phone (after the cache is already signed out,
    // so a late save can't write the old account back).
    await clearKit();
  };
  const logout = async () => {
    await api('/auth/logout', 'POST').catch(() => undefined);
    await signedOut();
  };
  const logoutAll = async () => {
    if (!(await confirm(t('Sign out everywhere?'), t('Every phone and computer signed in to this account will be signed out, this one too.'), t('Sign out')))) return;
    await api('/auth/logout-all', 'POST').catch(() => undefined);
    await signedOut();
  };

  const range = periodLabel(thisMonth(startDay), startDay);

  return (
    <div className="page settings-page">
      <PageHeader
        title={t('Settings')}
        left={<IconButton icon={ArrowLeft} label={t('Back')} onClick={() => nav('/')} flip />}
      />

      {/* 2.6.0 (critique): who you are opens the page; the email is changed right here */}
      <section className="card identity" aria-label={t('Account')}>
        <span className="identity-avatar" aria-hidden="true">
          {user.username.slice(0, 1).toUpperCase()}
        </span>
        <span className="identity-text">
          <strong className="identity-name" dir="ltr">
            {user.username}
          </strong>
          {user.email ? (
            <span className="identity-email" dir="ltr">
              {user.email}
            </span>
          ) : (
            <span className="identity-email">{t('No email yet: add one so you can reset your password yourself.')}</span>
          )}
        </span>
        <button type="button" className="btn tonal small identity-btn" onClick={() => setSheet('email')}>
          <Mail size={16} aria-hidden="true" /> {user.email ? t('Change email') : t('Add email')}
        </button>
      </section>

      <h2 className="settings-group">{t('Account and security')}</h2>
      <Card>
        <div className="stack" style={{ marginTop: 0 }}>
          <button className="btn tonal block" onClick={() => setSheet('password')}>
            <KeyRound size={18} /> {t('Change password')}
          </button>
          <button className="btn tonal block" onClick={logout}>
            <LogOut size={18} className="flip-rtl" /> {t('Sign out')}
          </button>
          <button className="btn outline block" onClick={logoutAll}>
            <MonitorSmartphone size={18} /> {t('Sign out everywhere')}
          </button>
        </div>
      </Card>
      <TwoFactorCard />
      <AppLockSettings />

      <h2 className="settings-group">{t('Your month')}</h2>
      <Card>
        {/* 2.6.0 (critique): changed about once a year, so one row that opens the calendar */}
        <button type="button" className="settings-row" onClick={() => setSheet('month')}>
          <CalendarDays size={18} className="mute" aria-hidden="true" />
          <span className="grow">
            <span className="settings-row-label">
              {t('I get my money on day')} <strong>{ordinal(startDay)}</strong>
            </span>
            <span className="tiny mute block">
              {startDay === 1 ? t('Months run from the 1st to the last day of the month.') : t('Each month starts on the {day}. Right now that is {range}.', { day: ordinal(startDay), range })}
            </span>
          </span>
          <ChevronRight size={18} className="flip-rtl mute" aria-hidden="true" />
        </button>
        <SettingSwitch
          value={!!user.rollover}
          save={(v) => saveSetting({ rollover: v })}
          label={t('Carry over unspent budget')}
          hint={t('What a category does not spend is added to its budget next month. Going over does not lower next month.')}
        />
        <SettingSwitch
          value={!!user.mergeRepeats}
          save={(v) => saveSetting({ mergeRepeats: v })}
          label={t('Add quick repeats together')}
          hint={t('The same expense (category, date and description) added again within 5 minutes goes into the last one: Transport 10 + Transport 10 = Transport 20.')}
        />
        <div className="settings-block">
          <Field label={t('Displayed currency')} hint={t('Only the label changes. Amounts are not converted.')}>
            <select className="input" value={user.currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>
      </Card>
      <RemindersCard />

      <h2 className="settings-group">{t('Look and language')}</h2>
      <Card>
        <SectionTitle trailing={<Languages size={18} className="mute" />}>{t('Language')}</SectionTitle>
        <Segmented value={langPref} onChange={(v: LangPref) => setLangPref(v)} options={langOptions()} />
        <p className="tiny mute">
          {t("System uses your phone's language. Arabic shows the app right-to-left. Saved on this device.")}
        </p>
        <div className="settings-block">
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
        </div>
        <div className="settings-block">
          <SectionTitle>{t('Accent colour')}</SectionTitle>
          <div className="accent-picker" role="group" aria-label={t('Accent colour')}>
            {ACCENTS.map((a) => (
              <button key={a} type="button" className={`accent-swatch ${accent === a ? 'on' : ''}`} aria-pressed={accent === a} onClick={() => void pickAccent(a)}>
                <span className="accent-dot" style={{ background: ACCENT_INFO[a].swatch }} aria-hidden="true">
                  {accent === a && <Check size={18} strokeWidth={3} />}
                </span>
                <span className="accent-name">{t(ACCENT_INFO[a].label)}</span>
              </button>
            ))}
          </div>
          <p className="tiny mute">{t('Saved on your account, so every phone and computer you sign in on uses it.')}</p>
        </div>
      </Card>

      <h2 className="settings-group">{t('Your data')}</h2>
      <Card>
        <SectionTitle trailing={<FileSpreadsheet size={18} className="mute" />}>{t('Export to a spreadsheet')}</SectionTitle>
        <ExportCardBody />
      </Card>
      <Card>
        <SectionTitle>{t('Backup & restore')}</SectionTitle>
        <p className="small mute">{t("Your data is kept on Masrofy's server. Download a backup now and then to keep your own copy.")}</p>
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

      <h2 className="settings-group">{t('Help and about')}</h2>
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
      <UpdateCard />
      <GetAndroidAppCard />
      <ContactCard />
      <Card>
        <SectionTitle trailing={<span className="stage-badge">{MARK}</span>}>{t('About')}</SectionTitle>
        <div className="stack" style={{ marginTop: 0 }}>
          <button className="btn tonal block" onClick={() => restartTutorial()}>
            <GraduationCap size={18} /> {t('Show the tutorial again')}
          </button>
        </div>
      </Card>

      {/* Last on the page (2.6.0 critique): nothing everyday sits below it. Both can't be undone, so each says
          what it removes, offers the backup first, and asks for the password. */}
      <Card className="danger-card">
        <SectionTitle>{t('Danger zone')}</SectionTitle>
        <div className="danger-item">
          <button className="btn outline danger-text block" onClick={erase}>
            <Trash2 size={18} /> {t('Erase all data')}
          </button>
          <p className="tiny mute">{t('Keeps your account and settings. Removes every expense, budget, saving and loan.')}</p>
        </div>
        <div className="danger-item">
          <button className="btn danger block" onClick={() => setSheet('delete')}>
            <UserX size={18} /> {t('Delete my account')}
          </button>
          <p className="tiny mute">{t('Removes your account and everything in it, then signs you out.')}</p>
        </div>
      </Card>

      <Sheet open={sheet === 'month'} onClose={() => setSheet(null)} title={t('Month start')}>
        {sheet === 'month' && <MonthStartPicker />}
      </Sheet>
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
      <Sheet open={sheet === 'email'} onClose={() => setSheet(null)} title={user.email ? t('Change email') : t('Add email')}>
        {sheet === 'email' && (
          <EmailForm
            current={user.email ?? ''}
            onDone={(r) => {
              qc.setQueryData(['me'], r);
              setSheet(null);
              toast(t('Email saved.'));
            }}
          />
        )}
      </Sheet>
      <Sheet open={sheet === 'delete'} onClose={() => setSheet(null)} title={t('Delete my account')}>
        {sheet === 'delete' && <DeleteAccountForm onDeleted={signedOut} downloadBackup={exportBackup} />}
      </Sheet>

      <footer className="app-footer">
        <p>{t('Developed by {name}', { name: DEVELOPER })}</p>
        <p className="mute">
          {t(APP_NAME)} {t(VERSION_KEY, { mark: MARK, v: APP_VERSION })}
        </p>
      </footer>
    </div>
  );
}

/** Add or change the account email (for "Forgot password?" codes). Needs the password. */
function EmailForm({ current, onDone }: { current: string; onDone: (r: { user: unknown }) => void }) {
  const [email, setEmail] = useState(current);
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const mail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return setErr(t('That email address does not look right.'));
    if (!password) return setErr(t('Enter your password.'));
    setBusy(true);
    try {
      onDone(await api<{ user: unknown }>('/auth/email', 'PUT', { email: mail, password }));
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="form">
      <Field label={t('Email')} hint={t('Used only to send you a code if you forget your password.')}>
        <input className="input" dir="ltr" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
      </Field>
      <Field label={t('Your password')}>
        <input className="input" dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <FormError text={err} />
      <SaveButton label={t('Save')} busy={busy} />
    </form>
  );
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const { user } = useApp();
  const strong = useQuery({ queryKey: ['auth-config'], queryFn: () => api<{ strongPasswords?: boolean }>('/auth/config'), staleTime: Infinity }).data?.strongPasswords ?? true;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!current) return setErr(t('Enter your current password.'));
    const pwErr = newPasswordError(next, user.username, strong);
    if (pwErr) return setErr(pwErr);
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
      <Field label={t('New password')} hint={strong ? undefined : t('At least 10 characters.')}>
        <input className="input" dir="ltr" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-describedby="change-pw-rules" />
      </Field>
      {strong && <PasswordRules password={next} id="change-pw-rules" />}
      <Field label={t('Repeat new password')}>
        <input className="input" dir="ltr" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </Field>
      <p className="tiny mute">{t('Other phones and computers signed in to this account will be signed out.')}</p>
      <FormError text={err} />
      <SaveButton label={t('Change password')} busy={busy} />
    </form>
  );
}

function DeleteAccountForm({ onDeleted, downloadBackup }: { onDeleted: () => void; downloadBackup: () => Promise<void> }) {
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
      <button type="button" className="btn tonal block" onClick={() => void downloadBackup()}>
        <Download size={18} /> {t('Download backup first')}
      </button>
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

/** An account setting as a sliding switch: flips at once, and flips back if saving fails. */
function SettingSwitch({ value, save, label, hint }: { value: boolean; save: (v: boolean) => Promise<boolean>; label: string; hint: string }) {
  const [on, setOn] = useState(value);
  useEffect(() => setOn(value), [value]);
  return (
    <label className="setting-switch">
      <span className="grow">
        <span className="setting-switch-label">{label}</span>
        <span className="tiny mute block">{hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={on}
        onChange={async (e) => {
          const v = e.target.checked;
          setOn(v);
          if (!(await save(v))) setOn(!v);
        }}
      />
    </label>
  );
}