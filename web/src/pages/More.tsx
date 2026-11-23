import { ChevronRight, HandCoins, LineChart, PiggyBank, Settings, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { t } from '../i18n';
import { useApp } from '../state';
import { PageHeader } from '../components/ui';

/** 2.0.0: the "More" tab: the screens that left the bottom bar to make room for the centre +. */
export default function More() {
  const { totals, fmt, user } = useApp();
  const items: { to: string; icon: LucideIcon; label: string; sub: string; tone: string }[] = [
    { to: '/savings', icon: PiggyBank, label: t('Savings'), sub: t('{amount} saved in your goals', { amount: fmt(totals.totalSavings) }), tone: 'sky' },
    {
      to: '/loans',
      icon: HandCoins,
      label: t('Loans'),
      sub: totals.owedByMe > 0 || totals.owedToMe > 0
        ? t('You owe {a} · owed to you {b}', { a: fmt(totals.owedByMe), b: fmt(totals.owedToMe) })
        : t('Money you borrowed or lent'),
      tone: 'lavender',
    },
    { to: '/reports', icon: LineChart, label: t('Reports'), sub: t('Compare with last month, see your year'), tone: 'mint' },
    { to: '/settings', icon: Settings, label: t('Settings'), sub: t('Account, language, theme, backups'), tone: 'sand' },
  ];
  if (user.isAdmin) items.push({ to: '/admin', icon: ShieldCheck, label: t('Admin'), sub: t('Manage accounts, sign-ups and password resets.'), tone: 'coral' });
  return (
    <div className="page">
      <PageHeader title={t('More')} />
      <nav className="more-list" aria-label={t('More')}>
        {items.map(({ to, icon: Icon, label, sub, tone }) => (
          <Link key={to} to={to} className="more-item">
            <span className={`more-icon tone-${tone}`} aria-hidden="true">
              <Icon size={22} />
            </span>
            <span className="grow">
              <strong className="block">{label}</strong>
              <span className="small mute">{sub}</span>
            </span>
            <ChevronRight size={18} className="flip-rtl mute" aria-hidden="true" />
          </Link>
        ))}
      </nav>
    </div>
  );
}
