import { CalendarClock, LayoutGrid, Lock, Plus, ShieldCheck, Sparkles, Wallet, type LucideIcon } from 'lucide-react';
import { BiometricToggle } from './AppLockSettings';
import { makeLock, PIN_RE, readLock, saveLock } from '../pin';
import MonthStartPicker from './MonthStartPicker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { saveBudget } from './BudgetForms';
import { Field, MoneyInput } from './ui';
import { parseMoneyOrZero, plainOrEmpty } from '../domain/money';
import { isRtl, t } from '../i18n';
import { isNative } from '../native';
import { monthLabel, useApp } from '../state';
import { APP_NAME } from '../version';

const KEY = 'bm-tutorial-done'; // + ':<user id>'
const EVENT = 'bm-show-tutorial';

type Kind = 'welcome' | 'payday' | 'income' | 'lock' | 'places' | 'first';

interface Step {
  kind: Kind;
  icon: LucideIcon;
  title: string;
  text: string;
}

/**
 * 2.1.0 (critique: 11 steps / 48 tips was a wall of reading, a quarter of it out of date): five short
 * steps where you do something. Advanced features are explained where they live, not here.
 */
const STEPS: Step[] = [
  {
    kind: 'welcome',
    icon: Sparkles,
    title: 'Welcome to {app}',
    text: 'Masrofy shows what is left of your money this month and how much you can spend each day. A few quick steps and you are ready.',
  },
  {
    kind: 'payday',
    icon: CalendarClock,
    title: 'When do you get your money?',
    text: 'Tap the day your salary or allowance usually arrives. Your budget month starts on that day.',
  },
  {
    kind: 'income',
    icon: Wallet,
    title: 'How much do you get a month?',
    text: 'Your allowance or salary. Masrofy uses it to work out what is left and your daily amount.',
  },
  {
    // 2.1.3 (owner's request): offer the app lock in the tour; fingerprint unlock in the Android app.
    kind: 'lock',
    icon: Lock,
    title: 'Lock the app with a PIN',
    text: 'Keep your budget private on this phone: the app asks for the PIN when it is opened again. It stays on this phone and is separate from your password.',
  },
  {
    kind: 'places',
    icon: LayoutGrid,
    title: 'Where things are',
    text: 'Home, Expenses and Budget are in the bar at the bottom. Savings, Loans, Reports and Settings are under More.',
  },
  {
    kind: 'first',
    icon: Plus,
    title: 'Log your first expense',
    text: 'Whenever you spend money, tap the + in the middle of the bar. It takes a few seconds.',
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

/** First-run walkthrough: a card at the bottom over Home, five short steps. */
export default function Tutorial() {
  const { user, data, month, refresh } = useApp();
  const [open, setOpen] = useState(() => !alreadyDone(user.id));
  const [i, setI] = useState(0);
  const [income, setIncome] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [locked, setLocked] = useState(() => !!readLock(user.id));
  const nav = useNavigate();
  const loc = useLocation();
  const card = useRef<HTMLDivElement>(null);
  const s = STEPS[i];
  const last = i === STEPS.length - 1;

  useEffect(() => {
    // Replaying the tour starts clean: no PIN or error left from last time.
    const show = () => {
      setI(0);
      setErr(null);
      setPin('');
      setPin2('');
      setOpen(true);
    };
    window.addEventListener(EVENT, show);
    return () => window.removeEventListener(EVENT, show);
  }, []);

  // The lock may have been turned on or off in Settings since: read it each time the lock step shows.
  useEffect(() => {
    if (open && s.kind === 'lock') setLocked(!!readLock(user.id));
  }, [open, s.kind, user.id]);

  // Every step happens over Home.
  useEffect(() => {
    if (open && loc.pathname !== '/') nav('/');
  }, [open, loc.pathname, nav]);

  // The income step starts from what is already saved for this month.
  useEffect(() => {
    if (open && s.kind === 'income') setIncome(plainOrEmpty(data?.budget.income ?? 0));
  }, [open, s.kind, data?.budget.income]);

  // While open: the app behind can't be reached by Tab or a screen reader; the bottom bar is shown above
  // the dim layer on the two steps that talk about it.
  useEffect(() => {
    if (!open) return;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    const showNav = s.kind === 'places' || s.kind === 'first';
    document.body.classList.toggle('tutorial-nav', showNav);
    document.body.classList.add('no-scroll');
    return () => {
      root?.removeAttribute('inert');
      document.body.classList.remove('tutorial-nav', 'no-scroll');
    };
  }, [open, s.kind]);

  // On close, put focus back where it was (or on the first control of the page) instead of leaving it on
  // <body>. Runs after the effect above has removed `inert`, and never takes focus from a sheet that opened.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    return () => {
      setTimeout(() => {
        const now = document.activeElement;
        if (now && now !== document.body) return;
        const target =
          prev && prev !== document.body && prev.isConnected
            ? prev
            : document.querySelector<HTMLElement>('main button, main a[href]');
        target?.focus({ preventScroll: true });
      }, 0);
    };
  }, [open]);

  // Each new step: focus the card (its live region reads "Step n of 5" and the title).
  useEffect(() => {
    if (open) card.current?.focus({ preventScroll: true });
  }, [open, i]);

  const done = useCallback(() => {
    try {
      localStorage.setItem(keyFor(user.id), '1');
    } catch {
      /* ignore */
    }
    setOpen(false);
  }, [user.id]);

  const finish = useCallback(() => {
    done();
    nav('/');
  }, [done, nav]);

  /** Turns the app lock on from the tour (locks 5 minutes after leaving, as in Settings). False = not valid. */
  const setLock = async () => {
    if (!PIN_RE.test(pin)) return setErr(t('Use 4 to 6 digits.')), false;
    if (pin !== pin2) return setErr(t('The two PINs do not match.')), false;
    setBusy(true);
    saveLock(user.id, await makeLock(pin, 5));
    setBusy(false);
    setPin('');
    setPin2('');
    setLocked(true);
    return true;
  };

  const go = async (to: number) => {
    setErr(null);
    // Leaving the lock step forwards with a PIN typed in turns the lock on (nothing typed = skip it).
    if (s.kind === 'lock' && to > i && !locked && (pin || pin2) && !(await setLock())) return;
    // Leaving the income step forwards saves the amount (empty = leave it as it is).
    if (s.kind === 'income' && to > i && income.trim()) {
      const v = parseMoneyOrZero(income);
      if (v === null) return setErr(t('Use numbers only (leave a field empty for 0).'));
      if (data && v !== data.budget.income) {
        setBusy(true);
        try {
          await saveBudget(month, data.budget, { income: v });
          await refresh();
        } catch (x) {
          setBusy(false);
          return setErr((x as Error).message);
        }
        setBusy(false);
      }
    }
    setI(to);
  };

  // The arrow keys move like Back / Next, so leaving the income or lock step still saves what was typed.
  const stepBy = useRef<(d: number) => void>(() => {});
  stepBy.current = (d) => {
    const to = i + d;
    if (busy || to < 0 || to > STEPS.length - 1) return;
    void go(to);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Keys inside the day picker or a field belong to them.
      if (el?.closest('.day-grid') || el?.tagName === 'INPUT' || el?.tagName === 'SELECT') return;
      // Esc closes the tour for now; it opens again next time until it is finished or skipped.
      if (e.key === 'Escape') setOpen(false);
      const fwd = isRtl() ? 'ArrowLeft' : 'ArrowRight';
      const back = isRtl() ? 'ArrowRight' : 'ArrowLeft';
      if (e.key === fwd && !last) stepBy.current(1);
      if (e.key === back) stepBy.current(-1);
      // Keep Tab inside the card.
      if (e.key === 'Tab' && card.current) {
        const f = [...card.current.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]')];
        if (!f.length) return;
        const first = f[0];
        const lastEl = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === card.current)) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, last]);

  if (!open) return null;
  const Icon = s.icon;
  const stepLabel = t('Step {n} of {total}', { n: i + 1, total: STEPS.length });
  const title = t(s.title, { app: t(APP_NAME) });
  const starters = (data?.categories.length ?? 0) > 0;

  return createPortal(
    <div className="tutorial-backdrop">
      <div className="tutorial" role="dialog" aria-modal="true" aria-labelledby="tut-title" tabIndex={-1} ref={card}>
        <div className="tutorial-head">
          <span className="tutorial-icon" aria-hidden="true">
            <Icon size={24} />
          </span>
          <span className="tiny mute" aria-live="polite">
            {stepLabel}
          </span>
          <button type="button" className="btn text small tutorial-skip" onClick={finish}>
            {t('Skip')}
          </button>
        </div>
        <div className="tutorial-body">
          <h2 id="tut-title" className="tutorial-title">
            {title}
          </h2>
          <p>{t(s.text)}</p>

          {s.kind === 'welcome' && starters && (
            <p className="tutorial-note">{t('We added a few everyday categories, like Food and Transport. Rename or remove them any time on Budget.')}</p>
          )}

          {s.kind === 'payday' && (
            <div style={{ marginTop: 12 }}>
              <MonthStartPicker />
              <p className="tiny mute">{t('You can change this later in Settings → Month start.')}</p>
            </div>
          )}

          {s.kind === 'income' && (
            <div style={{ marginTop: 12 }}>
              <Field label={t('Income for {month}', { month: monthLabel(month) })}>
                <MoneyInput value={income} onChange={setIncome} suffix={user.currency} />
              </Field>
              <p className="tiny mute">{t('Not sure yet? Leave it empty and set it later from Home.')}</p>
            </div>
          )}

          {s.kind === 'lock' &&
            (locked ? (
              <div style={{ marginTop: 12 }} className="stack">
                <p className="tutorial-done">
                  <ShieldCheck size={18} aria-hidden="true" /> {t('App lock is on.')}
                </p>
                {/* Android app only (hidden in a browser or on a phone without fingerprint / face). */}
                <BiometricToggle />
                <p className="tiny mute">{t('Change the PIN or when it locks in Settings → App lock.')}</p>
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <div className="grid2">
                  <Field label={t('PIN (4–6 digits)')}>
                    <input className="input pin-input" type="password" inputMode="numeric" autoComplete="off" maxLength={6} dir="ltr" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
                  </Field>
                  <Field label={t('Repeat the PIN')}>
                    <input className="input pin-input" type="password" inputMode="numeric" autoComplete="off" maxLength={6} dir="ltr" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />
                  </Field>
                </div>
                <button type="button" className="btn tonal block" style={{ marginTop: 10 }} disabled={busy} onClick={() => void (async () => { setErr(null); await setLock(); })()}>
                  <Lock size={18} aria-hidden="true" /> {t('Turn on app lock')}
                </button>
                <p className="tiny mute">
                  {isNative()
                    ? t('Next you can unlock with your fingerprint instead of typing it. Not now? Leave it empty.')
                    : t('Not now? Leave it empty. You can turn it on later in Settings → App lock.')}
                </p>
              </div>
            ))}

          {s.kind === 'places' && (
            <ul className="tutorial-tips">
              <li>{t('Tap any number on Home to see where it comes from.')}</li>
              <li>{t('You can replay this tour from Settings → About.')}</li>
              <li>
                {isNative()
                  ? t('Reminders, fingerprint lock and the home-screen widget are in Settings.')
                  : t('Get the Android app from Settings for reminders, fingerprint lock and a home-screen widget.')}
              </li>
            </ul>
          )}

          {s.kind === 'first' && (
            <p className="tutorial-note">{t('Pick a category, type the amount, done. You can attach a receipt, split it with a friend or add #tags later.')}</p>
          )}
          {err && <p className="form-error">{err}</p>}
        </div>

        <div className="tutorial-dots" aria-hidden="true">
          {STEPS.map((_, n) => (
            <span key={n} className={n === i ? 'on' : ''} />
          ))}
        </div>
        <div className="tutorial-actions">
          {last ? (
            <>
              <button type="button" className="btn ghost" onClick={finish}>
                {t('Later')}
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  done();
                  nav('/?add=expense');
                }}
              >
                {t('Log an expense')}
              </button>
            </>
          ) : (
            <>
              {i > 0 ? (
                <button type="button" className="btn ghost" onClick={() => void go(i - 1)}>
                  {t('Back')}
                </button>
              ) : (
                <span />
              )}
              <button type="button" className="btn primary" disabled={busy} onClick={() => void go(i + 1)}>
                {t('Next')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
