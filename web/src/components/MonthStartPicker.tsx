import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Check } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../api';
import { isRtl, t, tServer } from '../i18n';
import { ordinal, periodLabel, thisMonth, useApp, type User } from '../state';

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const MAX = 28; // every month has a 28th

/**
 * Calendar to choose the day you get your monthly money. Every budget month then
 * runs from that day until the day before it in the next month. Saved to your account.
 */
export default function MonthStartPicker({ compact = false }: { compact?: boolean }) {
  const { startDay } = useApp();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const grid = useRef<HTMLDivElement>(null);

  // Radio group keys: arrows move between days (mirrored in Arabic, up/down by a week), Space/Enter picks.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = { ArrowRight: isRtl() ? -1 : 1, ArrowLeft: isRtl() ? 1 : -1, ArrowDown: 7, ArrowUp: -7 };
    const step = steps[e.key];
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const cur = Number((document.activeElement as HTMLElement | null)?.dataset.day ?? startDay);
    const next = Math.min(MAX, Math.max(1, cur + step));
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus();
  };

  const change = async (day: number) => {
    if (day === startDay || day > MAX) return;
    setErr(null);
    setSaved(false);
    setSaving(day);
    try {
      const r = await api<{ user: User }>('/settings', 'PUT', { monthStartDay: day });
      qc.setQueryData(['me'], r);
      setSaved(true);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['state'] }),
        qc.invalidateQueries({ queryKey: ['expenses'] }),
        // Every report (year, compare, weekdays, tags) depends on where months start.
        qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('reports') }),
      ]);
    } catch (e) {
      setErr(tServer((e as Error).message));
    } finally {
      setSaving(null);
    }
  };

  const range = periodLabel(thisMonth(startDay), startDay);

  return (
    <div className="day-picker">
      <div className="day-picker-head">
        <CalendarDays size={16} />
        <span>{t('I get my money on day')}</span>
        <strong>{ordinal(startDay)}</strong>
        {saved && (
          <span className="saved-tick" role="status">
            <Check size={14} aria-hidden="true" /> {t('Day saved')}
          </span>
        )}
      </div>
      <div className="day-grid" role="radiogroup" aria-label={t('Day your month starts')} ref={grid} onKeyDown={onKey}>
        {DAYS.map((d) => {
          const disabled = d > MAX;
          const on = d === startDay;
          return (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={on}
              data-day={d}
              tabIndex={on ? 0 : -1}
              disabled={disabled}
              title={disabled ? t('Not every month has this day. Choose the 28th.') : t('Month starts on the {day}', { day: ordinal(d) })}
              className={`day${on ? ' on' : ''}${saving === d ? ' saving' : ''}`}
              onClick={() => change(d)}
            >
              {d}
            </button>
          );
        })}
      </div>
      <p className="tiny mute" style={{ marginTop: 10 }}>
        {startDay === 1
          ? t('Months run from the 1st to the last day of the month.')
          : t('Each month starts on the {day}. Right now that is {range}.', { day: ordinal(startDay), range })}
        {!compact && ` ${t('Paid on the 29th–31st? Choose the 28th.')}`}
      </p>
      {err && <p className="form-error">{err}</p>}
    </div>
  );
}
