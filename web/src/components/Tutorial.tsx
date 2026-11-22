import {
  BarChart3,
  CalendarClock,
  HandCoins,
  Home,
  PieChart,
  PiggyBank,
  ReceiptText,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
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
    tips: [
      'Use the arrows at the top to move between months.',
      'Tap Income or any Budget usage row to edit it.',
      'Tap "+ Expense" at the bottom to log something quickly. Under your balance you see how much you can spend per day.',
      'The chart icon at the top opens Reports.',
    ],
    route: '/',
  },
  {
    icon: PieChart,
    title: 'Set up your budget',
    text: 'Start here: tap "Income & plans" to enter your monthly income and how much to save and repay.',
    tips: [
      'Add spending categories with "+ Add", tap one to rename it or change its budget, use the bin to remove it.',
      'Tick "Budget per day" for costs like uni or work days (days × weeks × cost per day).',
      'An empty month? Tap "Same as last month" to copy your budget over.',
      'A category turns amber at 80% of its budget and red at 100%; a banner on Home tells you which.',
    ],
    route: '/budget',
  },
  {
    icon: ReceiptText,
    title: 'Log your expenses',
    text: 'Tap "+ Add" every time you spend money. It counts in that month\'s budget straight away.',
    tips: [
      'You can attach a photo or PDF of the receipt (optional). Tap the clip to see it later.',
      'Search, or filter by month, date range or category. Tap an expense to edit it. The bin deletes it at once; tap Undo if that was a mistake.',
      'Rent or a subscription every month? Tap the repeat icon at the top to add a recurring expense.',
      'An expense can have #tags, be split with a friend (their share goes to "Owed to me"), or be paid in another currency.',
      'Swipe a row left to delete it or right to edit it. No connection? New expenses wait on your phone and sync later.',
      'The Export button saves the expenses you are looking at as Excel or CSV.',
    ],
    route: '/expenses',
  },
  {
    icon: PiggyBank,
    title: 'Save for goals',
    text: 'Create a goal (a laptop, a trip...), then add deposits or withdrawals as you save.',
    tips: [
      'See your progress and about how many months are left.',
      'Each goal shows when you\'ll reach it at your current pace, and warns you when you\'re behind plan.',
      'Open a goal to edit or delete it.',
    ],
    route: '/savings',
  },
  {
    icon: HandCoins,
    title: 'Keep track of loans',
    text: '"I owe" is money you borrowed. "Owed to me" is money you lent. Add an entry when money changes hands.',
    tips: [
      'Repayments lower what is still owed.',
      'Tap a person to rename, merge or remove them.',
      'Split an expense with a friend and their share shows up here by itself.',
    ],
    route: '/loans',
  },
  {
    icon: BarChart3,
    title: 'See where your money goes',
    text: 'Reports show your whole year month by month: what came in, what you spent, saved and repaid.',
    tips: [
      'Open Reports from the chart icon at the top of Home.',
      'Compare this month with last month, and see which weekday you spend the most on.',
      'Tag expenses with #tags (like #trip) to see how much each tag cost you.',
    ],
    route: '/reports',
  },
  {
    icon: Settings,
    title: 'Make it yours',
    text: 'In Settings you can switch the language (English or Arabic), change your month start day, pick light or dark mode and your currency, and download backups.',
    tips: [
      'Export your expenses, loans or savings to Excel or CSV from Settings.',
      'Download a backup now and then, and keep it somewhere safe.',
      'Found a bug or have an idea? Use "Contact us" at the bottom of Settings.',
      'Running the app for others? Admins see an Admin page in Settings for accounts, sign-ups and reset codes.',
      'You can replay this tutorial from Settings at any time.',
    ],
    route: '/settings',
  },
  {
    icon: ShieldCheck,
    title: 'Keep your account safe',
    text: 'Your data is private to your account. A few switches in Settings make it even safer.',
    tips: [
      'Add your email under Account, so you can reset your password yourself.',
      'Forgot your password? Tap "Forgot password?" on the sign-in screen and we email you a code.',
      'Turn on Two-step sign-in: you then also enter a code from an authenticator app. Keep the backup codes safe.',
      'Turn on App lock to ask for a PIN when the app is opened again. In the Android app you can unlock it with your fingerprint.',
      'Under Account you can change your password, sign out on every device, or delete your account.',
    ],
    route: '/settings',
  },
  {
    icon: Smartphone,
    title: 'On your phone',
    text: 'Budget me works in the browser and as an Android app, even when the connection drops.',
    tips: [
      'No internet? You can still look at your budget, and new expenses wait on your phone until you are back online.',
      'Turn on Reminders in Settings to get a nudge to log your spending. Nothing is sent from the server.',
      'The Android app updates itself: you get a message when a new version is ready. You can also tap "Check for updates" in Settings.',
      'In the Android app, exports and backups open the share sheet, so you can save them to Files or Drive.',
      'Added the app to your home screen? Long-press its icon for an "Add expense" shortcut.',
    ],
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
