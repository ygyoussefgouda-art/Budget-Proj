import { BellRing, ShieldCheck } from 'lucide-react';
import { t } from '../i18n';
import { isNative } from '../native';
import { useReminderPrefs } from '../notify';
import { openPermissions } from '../pages/Permissions';
import { useApp } from '../state';
import { Card, SectionTitle } from './ui';

/** Settings (Android app only): which notifications to get, and the permissions screen again. */
export default function RemindersCard() {
  const { user } = useApp();
  const [prefs, update] = useReminderPrefs(user.id);
  if (!isNative()) return null;
  const row = (id: string, label: string, checked: boolean, on: (v: boolean) => void) => (
    <div className="toggle-row">
      <label className="grow small" htmlFor={id}>
        {label}
      </label>
      <input id={id} type="checkbox" className="switch" checked={checked} onChange={(e) => on(e.target.checked)} />
    </div>
  );
  return (
    <Card>
      <SectionTitle trailing={<BellRing size={18} className="mute" />}>{t('Reminders')}</SectionTitle>
      <p className="small mute">{t('Notifications on this phone. Nothing is sent from the server.')}</p>
      {row('rem-budget', t('A category reaches 80% or 100% of its budget'), prefs.budget, (v) => void update({ budget: v }))}
      {row('rem-recurring', t('A recurring expense is due'), prefs.recurring, (v) => void update({ recurring: v }))}
      {row('rem-fortnight', t('Every 2 weeks: how much money is left'), prefs.fortnight, (v) => void update({ fortnight: v }))}
      {row('rem-month-end', t('Last evening of the month: a summary'), prefs.monthEnd, (v) => void update({ monthEnd: v }))}
      {row('rem-daily', t("Every day: log today's expenses"), prefs.daily, (v) => void update({ daily: v }))}
      {prefs.daily && (
        <div className="toggle-row">
          <label className="grow small" htmlFor="rem-time">
            {t('Time')}
          </label>
          <input id="rem-time" type="time" className="input" style={{ maxWidth: 130 }} value={prefs.dailyTime} onChange={(e) => e.target.value && void update({ dailyTime: e.target.value })} />
        </div>
      )}
      <div className="stack" style={{ marginTop: 10 }}>
        <button className="btn tonal block" onClick={openPermissions}>
          <ShieldCheck size={18} /> {t('App permissions')}
        </button>
      </div>
    </Card>
  );
}
