import { CalendarClock, HandCoins, Home, PieChart, PiggyBank, ReceiptText, Settings, Sparkles, type LucideIcon } from 'lucide-react';
import MonthStartPicker from './MonthStartPicker';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { useApp } from '../state';
import { APP_NAME } from '../version';

const KEY = 'bm-tutorial-done'; // + ':<user id>'
const EVENT = 'bm-show-tutorial';

interface Step {
  icon: LucideIcon;
  title: string;
  text: string;
  tips: string[];
  route: string;
  /** Show the "month starts on" picker inside this step. */
  picker?: boolean;
}

const STEPS: Step[] = [
  {
    icon: Sparkles,
    title: 'Welcome to {app}',
    text: 'Plan your month, log what you spend, save for goals and keep track of money you owe or lent.',
    tips: [
      'This is an alpha (early test) version, so screens may change between updates.',
      'Everything you see can be edited, renamed or removed. Nothing is fixed.',
    ],
    route: '/',
  },
  {
    icon: CalendarClock,
    title: 'When do you get your money?',
    text: 'Tap the day your salary or allowance usually arrives. Your budget month will start on that day.',
    tips: ['You can change this later in Settings → Month start.'],
    route: '/',
    picker: true,
  },
  {
    icon: Home,
    title: 'Your month at a glance',
    text: 'Home shows how much money is left this month, your income and expenses, savings and debts.',
    tips: ['Use the arrows at the top to move between months.', 'Tap Income or any Budget usage row to edit it.'],
    route: '/',
  },
  {
    icon: PieChart,
    title: 'Set up your budget',
    text: 'Start here: tap "Income & plans" to enter your monthly income and how much to save and repay.',
    tips: [
      'Add spending categories with "+ Add", tap one to rename it or change its budget, use the bin to remove it.',
      'Tick "Budget per day" for costs like uni or work days (days × weeks × cost per day).',
    ],
    route: '/budget',
  },
  {
    icon: ReceiptText,
    title: 'Log your expenses',
    text: 'Tap "+ Add" every time you spend money. It counts in that month\'s budget straight away.',
    tips: [
      'You can attach a photo or PDF of the receipt (optional). Tap the clip to see it later.',
      'Search, or filter by month, date range or category. Tap an expense to edit it, or the bin to delete it.',
    ],
    route: '/expenses',
  },
  {
    icon: PiggyBank,
    title: 'Save for goals',
    text: 'Create a goal (a laptop, a trip...), then add deposits or withdrawals as you save.',
    tips: ['See your progress and about how many months are left.', 'Open a goal to edit or delete it.'],
    route: '/savings',
  },
  {
    icon: HandCoins,
    title: 'Keep track of loans',
    text: '"I owe" is money you borrowed. "Owed to me" is money you lent. Add an entry when money changes hands.',
    tips: ['Repayments lower what is still owed.', 'Tap a person to rename, merge or remove them.'],
    route: '/loans',
  },
  {
    icon: Settings,
    title: 'Make it yours',
    text: 'In Settings you can switch the language (English or Arabic), change your month start day, pick light or dark mode and your currency, and download backups.',
    tips: ['You can replay this tutorial from Settings at any time.'],
    route: '/settings',
  },
];

/** Shows the tutorial again (used by Settings). */
export function restartTutorial() {
  window.dispatchEvent(new Event(EVENT));
}

/** Remembered per account on this device, so every new account sees it once. */
const keyFor = (userId: number) => `${KEY}:${userId}`;

function alreadyDone(userId: number) {
  try {
    return localStorage.getItem(keyFor(userId)) === '1';
  } catch {
    return false;
  }
}

/** First-run walkthrough: a card at the bottom while the app shows each tab behind it. */
export default function Tutorial() {
  const { user } = useApp();
  const [open, setOpen] = useState(() => !alreadyDone(user.id));
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    const show = () => {
      setI(0);
      setOpen(true);
    };
    window.addEventListener(EVENT, show);
    return () => window.removeEventListener(EVENT, show);
  }, []);

  // Show the matching tab behind the card.
  const route = STEPS[i].route;
  useEffect(() => {
    if (open && loc.pathname !== route) nav(route);
  }, [open, route, loc.pathname, nav]);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(keyFor(user.id), '1');
    } catch {
      /* ignore */
    }
    setOpen(false);
    nav('/budget'); // the natural first thing to do: set income and categories
  }, [nav, user.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'SELECT' || tag === 'INPUT') return; // arrows belong to the day picker
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight') setI((v) => Math.min(STEPS.length - 1, v + 1));
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, finish]);

  if (!open) return null;
  const s = STEPS[i];
  const last = i === STEPS.length - 1;
  const Icon = s.icon;

  return createPortal(
    <div className="tutorial-backdrop">
      <div className="tutorial" role="dialog" aria-modal="true" aria-labelledby="tut-title">
        <div className="row between">
          <span className="tutorial-icon">
            <Icon size={24} />
          </span>
          <button className="btn text small" onClick={finish}>
            {t('Skip')}
          </button>
        </div>
        <div className="tiny mute" style={{ marginTop: 12 }}>
          {t('Step {n} of {total}', { n: i + 1, total: STEPS.length })}
        </div>
        <h2 id="tut-title" className="tutorial-title">
          {t(s.title, { app: APP_NAME })}
        </h2>
        <p>{t(s.text)}</p>
        {s.picker && (
          <div style={{ marginTop: 12 }}>
            <MonthStartPicker compact />
          </div>
        )}
        <ul className="tutorial-tips">
          {s.tips.map((tip) => (
            <li key={tip}>{t(tip)}</li>
          ))}
        </ul>
        <div className="tutorial-dots" aria-hidden="true">
          {STEPS.map((_, n) => (
            <span key={n} className={n === i ? 'on' : ''} />
          ))}
        </div>
        <div className="tutorial-actions">
          <button className="btn ghost" onClick={() => setI(i - 1)} disabled={i === 0}>
            {t('Back')}
          </button>
          <button className="btn primary" onClick={() => (last ? finish() : setI(i + 1))} autoFocus>
            {last ? t('Get started') : t('Next')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
