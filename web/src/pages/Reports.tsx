import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { PairBars } from '../components/charts';
import { MonthCompare, TagSpending, WeekdaySpending } from '../components/ReportCards';
import { Card, COLORS, IconButton, KV, PageHeader, SectionTitle } from '../components/ui';
import { isRtl, locale, t } from '../i18n';
import { wholeUnits } from '../domain/money';
import { useApp } from '../state';

interface MonthTotals { month: string; hasBudget: boolean; income: number; spent: number; saved: number; repaid: number }

/** Short month names in the current language ("Jan" / "يناير"). */
const shortMonths = () => Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(locale(), { month: 'short' }));

export default function Reports() {
  const { fmt, startDay } = useApp();
  const nav = useNavigate();
  const [year, setYear] = useState(new Date().getFullYear());
  const q = useQuery({
    queryKey: ['reports', year],
    queryFn: () => api<{ months: MonthTotals[] }>(`/reports/year?y=${year}`),
    placeholderData: (p) => p,
  });
  const months = q.data?.months ?? [];
  const spent = months.reduce((s, m) => s + m.spent, 0);
  const saved = months.reduce((s, m) => s + m.saved, 0);
  const repaid = months.reduce((s, m) => s + m.repaid, 0);
  const active = months.filter((m) => m.spent > 0).length;
  const names = shortMonths();
  // Chart labels: initials in English, month numbers in Arabic (initials repeat there).
  const chartLabels = isRtl() ? names.map((_, i) => String(i + 1)) : names.map((s) => s[0]);

  return (
    <div className="page">
      <PageHeader title={t('Reports')} left={<IconButton icon={ArrowLeft} label={t('Back')} onClick={() => nav('/')} flip />} />
      {/* A new month start day starts the comparison again from this month. */}
      <MonthCompare key={startDay} />
      <WeekdaySpending year={year} />
      <TagSpending year={year} />

      <SectionTitle>{t('Year overview')}</SectionTitle>
      {q.isLoading && <p className="tiny mute">{t('Loading')}…</p>}
      {q.isError && (
        <p className="form-error">
          {(q.error as Error).message}{' '}
          <button type="button" className="btn text small" onClick={() => q.refetch()}>
            {t('Try again')}
          </button>
        </p>
      )}
      <div className="month-bar">
        <button className="icon-btn" aria-label={t('Previous year')} onClick={() => setYear(year - 1)}>
          <ChevronLeft size={22} className="flip-rtl" />
        </button>
        <strong className="year">{year}</strong>
        <button className="icon-btn" aria-label={t('Next year')} onClick={() => setYear(year + 1)}>
          <ChevronRight size={22} className="flip-rtl" />
        </button>
      </div>

      <Card>
        <KV k={t('Spent on expenses')} v={fmt(spent)} bold />
        <KV k={t('Net saved')} v={fmt(saved)} color={COLORS.accent} bold />
        <KV k={t('Loans repaid')} v={fmt(repaid)} color={COLORS.amber} bold />
        <KV k={t('Average monthly spending')} v={fmt(active === 0 ? 0 : wholeUnits(Math.floor(spent / active)))} bold />
      </Card>

      <Card>
        <SectionTitle
          trailing={
            <span className="tiny mute row gap">
              <span className="dot" style={{ background: COLORS.mute }} /> {t('Spent')}
              <span className="dot" style={{ background: COLORS.accent, marginInlineStart: 8 }} /> {t('Saved')}
            </span>
          }
        >
          {t('Spending vs savings')}
        </SectionTitle>
        {months.length > 0 && (
          <div className="chart-ltr">
            <PairBars
              a={months.map((m) => m.spent)}
              b={months.map((m) => m.saved)}
              labels={chartLabels}
              colorA={COLORS.mute}
              colorB={COLORS.accent}
            />
          </div>
        )}
      </Card>

      <Card className="table-card">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Month')}</th>
                <th>{t('Income')}</th>
                <th>{t('Spent')}</th>
                <th>{t('Saved')}</th>
                <th>{t('Repaid')}</th>
                <th>{t('Left')}</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => {
                const left = m.income - m.spent - m.saved - m.repaid;
                return (
                  <tr key={m.month}>
                    <td>{names[i]}</td>
                    <td>{m.hasBudget ? fmt(m.income) : '—'}</td>
                    <td>{fmt(m.spent)}</td>
                    <td>{fmt(m.saved)}</td>
                    <td>{fmt(m.repaid)}</td>
                    <td style={{ color: m.hasBudget && left < 0 ? COLORS.red : undefined }}>{m.hasBudget ? fmt(left) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="tiny mute">{t('Income comes from the budget of each month. Months you never opened show a dash.')}</p>
    </div>
  );
}
