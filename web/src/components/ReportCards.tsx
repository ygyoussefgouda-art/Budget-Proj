import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, TrendingDown, TrendingUp } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { changePct, periodRange } from '../domain/calc';
import { wholeUnits } from '../domain/money';
import { locale, t } from '../i18n';
import { monthLabel, shiftMonth, thisMonth, useApp } from '../state';
import { Bars, Donut } from './charts';
import { Card, COLORS, Empty, PALETTE, SectionTitle } from './ui';

/** The ring of this budget month's spending by category (moved here from Home in 2.1.0). */
export function WhereItWent() {
  const { summary, fmt, month } = useApp();
  if (!summary) return null;
  const slices = summary.rows.filter((r) => r.catId !== null && r.actual > 0).sort((a, b) => b.actual - a.actual);
  const total = slices.reduce((s, r) => s + r.actual, 0);
  return (
    <Card className="where">
      <SectionTitle trailing={<span className="mute small">{monthLabel(month)}</span>}>{t('Where it went')}</SectionTitle>
      {slices.length === 0 ? (
        <Empty text={t('No expenses logged in this month.')} />
      ) : (
        <>
          <div className="ring-wrap">
            <Donut values={slices.map((x) => x.actual)} colors={PALETTE} size={176} thickness={26}>
              <strong className="donut-total">{fmt(total)}</strong>
              <span className="tiny mute">{t('Spent')}</span>
            </Donut>
          </div>
          <ul className="legend">
            {slices.map((x, i) => (
              <li key={x.catId}>
                <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="grow ellipsis">{x.name}</span>
                <span className="legend-pct">{Math.round((x.actual / total) * 100)}%</span>
                <strong className="legend-amount">{fmt(x.actual)}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

interface CompareRow { categoryId: number; name: string; current: number; previous: number }
interface Compare { month: string; previous: string; categories: CompareRow[]; total: { current: number; previous: number } }

/** "+20%", "−15%", "0%", or "new" when there was nothing before. Shown left-to-right in Arabic too. */
export function changeText(current: number, previous: number): string {
  const pct = changePct(current, previous);
  if (pct === null) return t('new');
  return pct === 0 ? '0%' : `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`;
}

/** Spending more is shown in red, spending less in teal. */
const changeColor = (current: number, previous: number) =>
  current > previous ? COLORS.red : current < previous ? COLORS.accent : 'var(--mute)';

function Change({ current, previous }: { current: number; previous: number }) {
  return (
    <span className="change" dir="ltr" style={{ color: changeColor(current, previous) }}>
      {changeText(current, previous)}
    </span>
  );
}

function MiniMonthNav({ month, setMonth, children }: { month: string; setMonth: (m: string) => void; children?: ReactNode }) {
  return (
    <div className="mini-month-nav">
      <button type="button" className="icon-btn small" aria-label={t('Previous month')} onClick={() => setMonth(shiftMonth(month, -1))}>
        <ChevronLeft size={18} className="flip-rtl" />
      </button>
      <span className="small">{children ?? monthLabel(month)}</span>
      <button type="button" className="icon-btn small" aria-label={t('Next month')} onClick={() => setMonth(shiftMonth(month, 1))}>
        <ChevronRight size={18} className="flip-rtl" />
      </button>
    </div>
  );
}

/** Spending per category: this month against the month before ("Food +20%"), with the biggest changes first. */
export function MonthCompare() {
  const { fmt, startDay } = useApp();
  const [month, setMonth] = useState(() => thisMonth(startDay));
  const q = useQuery({
    queryKey: ['reports-compare', month],
    queryFn: () => api<Compare>(`/reports/compare?month=${month}`),
    placeholderData: (p) => p,
  });
  const d = q.data;
  const rows = (d?.categories ?? []).filter((c) => c.current > 0 || c.previous > 0);
  const biggest = [...rows]
    .filter((c) => c.current !== c.previous)
    .sort((a, b) => Math.abs(b.current - b.previous) - Math.abs(a.current - a.previous))
    .slice(0, 3);
  const prevName = d ? monthLabel(d.previous) : '';

  return (
    <Card className="compare-card">
      <SectionTitle>{t('Compared with last month')}</SectionTitle>
      <MiniMonthNav month={month} setMonth={setMonth} />
      {q.isError && <p className="form-error">{(q.error as Error).message}</p>}
      {d && rows.length === 0 && <Empty text={t('No spending in {a} or {b}.', { a: monthLabel(d.month), b: prevName })} />}
      {d && rows.length > 0 && (
        <>
          <div className="row between compare-total">
            <span className="small">{t('Total spent')}</span>
            <span className="row gap">
              <strong>{fmt(d.total.current)}</strong>
              <Change current={d.total.current} previous={d.total.previous} />
            </span>
          </div>
          <p className="tiny mute">{t('{month}: {amount}', { month: prevName, amount: fmt(d.total.previous) })}</p>

          {biggest.length > 0 && (
            <div className="biggest">
              <div className="tiny mute">{t('Biggest changes')}</div>
              <ul>
                {biggest.map((c) => {
                  const diff = c.current - c.previous;
                  const Icon = diff > 0 ? TrendingUp : TrendingDown;
                  return (
                    <li key={c.categoryId} style={{ color: changeColor(c.current, c.previous) }}>
                      <Icon size={15} aria-hidden="true" />
                      <span className="grow" style={{ color: 'var(--text)' }}>
                        {c.name}
                      </span>
                      <Change current={c.current} previous={c.previous} />
                      <span className="tiny" dir="ltr">
                        ({diff > 0 ? '+' : '−'}
                        {fmt(Math.abs(diff))})
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="compare-list">
            {rows.map((c) => (
              <div key={c.categoryId} className="compare-row">
                <span className="grow ellipsis">{c.name}</span>
                <span className="tiny mute">{fmt(c.previous)} →</span>
                <strong className="small">{fmt(c.current)}</strong>
                <Change current={c.current} previous={c.previous} />
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

type Range = 'month' | 'quarter' | 'year';
/** Saturday first, like the Egyptian week. JS day numbers: 0 = Sunday … 6 = Saturday. */
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];
/** Short weekday name; 3 Jan 2026 is a Saturday. */
const weekdayName = (dow: number, style: 'short' | 'long') =>
  new Date(2026, 0, 3 + WEEK_ORDER.indexOf(dow)).toLocaleDateString(locale(), { weekday: style });

interface Weekdays { from: string; to: string; days: { dow: number; total: number; days: number; average: number }[] }

/** Date range picked with chips: this budget month, the last 3, or the year shown in Reports. */
function useRange(year: number) {
  const { startDay } = useApp();
  const [range, setRange] = useState<Range>('month');
  const cur = thisMonth(startDay);
  const dates =
    range === 'month'
      ? { from: periodRange(cur, startDay).from, to: periodRange(cur, startDay).last }
      : range === 'quarter'
        ? { from: periodRange(shiftMonth(cur, -2), startDay).from, to: periodRange(cur, startDay).last }
        : { from: `${year}-01-01`, to: `${year}-12-31` };
  const chips = (
    <div className="chips">
      {(
        [
          ['month', t('This month')],
          ['quarter', t('Last 3 months')],
          ['year', String(year)],
        ] as [Range, string][]
      ).map(([v, label]) => (
        <button key={v} type="button" className={`chip ${range === v ? 'on' : ''}`} aria-pressed={range === v} onClick={() => setRange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
  return { ...dates, chips };
}

/** Average spending per weekday (Sat–Fri) for this month, the last 3 months, or the year shown in Reports. */
export function WeekdaySpending({ year }: { year: number }) {
  const { fmt } = useApp();
  const { from, to, chips } = useRange(year);
  const q = useQuery({
    queryKey: ['reports-weekdays', from, to],
    queryFn: () => api<Weekdays>(`/reports/weekdays?from=${from}&to=${to}`),
    placeholderData: (p) => p,
  });
  const byDow = new Map((q.data?.days ?? []).map((x) => [x.dow, x]));
  const values = WEEK_ORDER.map((d) => byDow.get(d)?.average ?? 0);
  const top = Math.max(0, ...values);
  const topDow = top > 0 ? WEEK_ORDER[values.indexOf(top)] : null;

  return (
    <Card className="weekday-card">
      <SectionTitle>{t('Spending by weekday')}</SectionTitle>
      {chips}
      {q.isError && <p className="form-error">{(q.error as Error).message}</p>}
      {q.data && top === 0 && <Empty text={t('No spending in this range.')} />}
      {q.data && top > 0 && (
        <>
          <div className="chart-ltr">
            <Bars
              values={values}
              labels={WEEK_ORDER.map((d) => weekdayName(d, 'short'))}
              color={`color-mix(in srgb, ${COLORS.accent} 55%, transparent)`}
              highlightColor={COLORS.highlight}
              ariaLabel={t('Average spending per weekday')}
            />
          </div>
          {topDow !== null && (
            <p className="small">
              {t('You spend the most on {day}: {amount} on average.', { day: weekdayName(topDow, 'long'), amount: fmt(wholeUnits(top)) })}
            </p>
          )}
          <p className="tiny mute">{t('Average = everything spent on that weekday ÷ how many of that weekday the range has (up to today).')}</p>
        </>
      )}
    </Card>
  );
}

interface TagReport { tags: { tag: string; total: number; count: number }[]; total: number; untagged: number }

/** Spending per #tag (an expense with two tags counts under both). */
export function TagSpending({ year }: { year: number }) {
  const { fmt } = useApp();
  const { from, to, chips } = useRange(year);
  const q = useQuery({
    queryKey: ['reports-tags', from, to],
    queryFn: () => api<TagReport>(`/reports/tags?from=${from}&to=${to}`),
    placeholderData: (p) => p,
  });
  const rows = q.data?.tags ?? [];
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <Card className="tags-card">
      <SectionTitle>{t('Spending by tag')}</SectionTitle>
      {chips}
      {q.isError && <p className="form-error">{(q.error as Error).message}</p>}
      {q.data && rows.length === 0 && <Empty text={t('No tagged spending in this range. Add #tags to expenses to see them here.')} />}
      {rows.map((r) => (
        <div key={r.tag} className="tag-row">
          <div className="row between small">
            <span className="tag">#{r.tag}</span>
            <span>
              <strong>{fmt(r.total)}</strong> <span className="tiny mute">· {r.count === 1 ? t('1 expense') : t('{n} expenses', { n: r.count })}</span>
            </span>
          </div>
          <div className="bar thin">
            <div className="bar-fill" style={{ width: `${(r.total / max) * 100}%`, background: COLORS.accent }} />
          </div>
        </div>
      ))}
      {q.data && rows.length > 0 && (
        <p className="tiny mute">
          {t('Without a tag: {amount}. An expense with two tags counts under both.', { amount: fmt(q.data.untagged) })}
        </p>
      )}
    </Card>
  );
}
