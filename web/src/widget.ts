import { t } from './i18n';
import { BudgetNative, isNative } from './native';

export interface WidgetText {
  title: string;
  value: string;
  sub: string;
  /** Label of the + button (it opens Quick add). */
  add: string;
}

/**
 * What the Android home-screen widget shows (pure, unit-tested). With App lock on, or signed out,
 * it never shows amounts: anyone can see a home screen.
 */
export function widgetText(
  x: { perDay: number; days: number; left: number; fmt: (minor: number) => string } | null,
  locked: boolean,
): WidgetText {
  const add = t('Add expense');
  if (!x || locked) return { title: t('Masrofy'), value: '', sub: locked ? t('Open Masrofy to see your month.') : t('Open Masrofy to sign in.'), add };
  if (x.perDay < 0) return { title: t('Over budget'), value: x.fmt(-x.left), sub: t('over this month'), add };
  return {
    title: t('Left today'),
    value: x.fmt(x.perDay),
    sub: x.days === 1 ? t('{amount} left · last day', { amount: x.fmt(x.left) }) : t('{amount} left · {n} days to go', { amount: x.fmt(x.left), n: x.days }),
    add,
  };
}

let lastSent = '';
/** Sends new widget text to the app (only when it changed). Does nothing in the browser. */
export function sendWidget(w: WidgetText) {
  if (!isNative()) return;
  const key = JSON.stringify(w);
  if (key === lastSent) return;
  lastSent = key;
  void BudgetNative.updateWidget(w).catch(() => undefined); // an older app without the widget
}
