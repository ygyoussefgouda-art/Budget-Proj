import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, GraduationCap, Languages, LogOut, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import MonthStartPicker from '../components/MonthStartPicker';
import { useOverlay } from '../components/Overlays';
import { restartTutorial } from '../components/Tutorial';
import { Card, Field, IconButton, PageHeader, SectionTitle, Segmented } from '../components/ui';
import { langOptions, t, useI18n, type LangPref } from '../i18n';
import { CURRENCIES, useApp } from '../state';
import { getThemePref, setThemePref, type ThemePref } from '../theme';
import { APP_NAME, APP_VERSION, STAGE } from '../version';

export default function Settings() {
  const { user, refresh } = useApp();
  const { pref: langPref, setPref: setLangPref } = useI18n();
  const [themePref, setThemePrefState] = useState<ThemePref>(getThemePref);
  const { confirm, toast } = useOverlay();
  const qc = useQueryClient();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

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
      if (!(await confirm(t('Restore backup?'), t('This replaces ALL current data with the backup. This cannot be undone.'), t('Restore')))) return;
      await api('/backup/restore', 'POST', json);
      await refresh();
      toast(t('Backup restored.'));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const erase = async () => {
    if (!(await confirm(t('Erase everything?'), t('All expenses, receipts, loans, savings and budgets are deleted. Export a backup first if unsure.'), t('Erase')))) return;
    try {
      await api('/reset', 'POST');
      await refresh();
      toast(t('All data erased.'));
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const logout = async () => {
    await api('/auth/logout', 'POST').catch(() => undefined);
    // Update the observed ['me'] query first (shows the login screen), then drop cached data.
    qc.setQueryData(['me'], null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
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

      <Card>
        <SectionTitle>{t('Account')}</SectionTitle>
        <p className="small" style={{ marginBottom: 12 }}>
          {t('Signed in as')} <strong dir="ltr">{user.username}</strong>
        </p>
        <button className="btn tonal block" onClick={logout}>
          <LogOut size={18} className="flip-rtl" /> {t('Sign out')}
        </button>
      </Card>

      <Card>
        <SectionTitle>{t('Danger zone')}</SectionTitle>
        <button className="btn outline danger-text block" onClick={erase}>
          <Trash2 size={18} /> {t('Erase all data')}
        </button>
      </Card>

      <Card>
        <SectionTitle trailing={<span className="stage-badge">{t(STAGE)}</span>}>{t('About')}</SectionTitle>
        <p className="small">
          {APP_NAME} <span className="mute">{t('version {v}', { v: APP_VERSION })}</span>
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
