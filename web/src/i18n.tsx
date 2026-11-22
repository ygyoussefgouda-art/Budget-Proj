/**
 * Tiny translation layer. English text is the key; Arabic lives in ./i18n-ar.ts.
 * The chosen language is saved per device (like the theme) and applied before
 * the first paint by public/theme-init.js, so Arabic never flashes left-to-right.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AR } from './i18n-ar';

export type Lang = 'en' | 'ar';
/** What the user picked. 'system' (the default) follows the phone/browser language. */
export type LangPref = 'system' | Lang;

const KEY = 'bm-lang';

/** Arabic if the device's preferred language is Arabic, else English. */
export function systemLang(): Lang {
  const prefs = (navigator.languages?.length ? navigator.languages : [navigator.language]) ?? [];
  for (const l of prefs) {
    const base = (l || '').toLowerCase().split('-')[0];
    if (base === 'ar') return 'ar';
    if (base === 'en') return 'en';
  }
  return 'en';
}

export function readLangPref(): LangPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'ar' || v === 'en' ? v : 'system';
  } catch {
    return 'system';
  }
}

const resolve = (p: LangPref): Lang => (p === 'system' ? systemLang() : p);

/** Options for language selectors (the System label is translated where it is shown). */
/** Order (owner's choice): English, عربي, then System last (like the Appearance switch below it). */
export const langOptions = (): { value: LangPref; label: string }[] => [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'عربي' },
  { value: 'system', label: t('System') },
];

let current: Lang = resolve(readLangPref());

export const getLang = () => current;
export const isRtl = () => current === 'ar';

/** Locale for dates and numbers. Arabic month names, Western digits (matches the money format). */
export const locale = () => (current === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');

/**
 * Translate `text`. `{name}` placeholders are filled from `vars` (after translating),
 * e.g. t('Remove "{name}"?', { name: 'Food' }).
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  let out = current === 'ar' ? AR[text] ?? text : text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** Messages that come from the server (English) shown in the user's language. */
export function tServer(msg: string): string {
  if (current !== 'ar') return msg;
  if (AR[msg]) return AR[msg];
  for (const [re, ar] of SERVER_PATTERNS) {
    const m = msg.match(re);
    // A captured part can itself be a known message ("Restore failed...: This is not a Masrofy backup.").
    if (m) return ar.replace(/\$(\d)/g, (_, i) => AR[m[Number(i)] ?? ''] ?? m[Number(i)] ?? '');
  }
  return msg;
}

const SERVER_PATTERNS: [RegExp, string][] = [
  [/^This category has (\d+) expense\(s\)\. Move or delete them first\.$/, 'الفئة دي فيها $1 مصروف. انقلهم أو امسحهم الأول.'],
  [/^You cannot withdraw more than the balance \((.+)\)\.$/, 'مينفعش تسحب أكتر من الرصيد ($1).'],
  [/^This is more than the outstanding (.+) for (.+)\. Save anyway\?$/, 'ده أكتر من الـ $1 اللي فاضلين لـ $2. تحفظ برضه؟'],
  [/^Restore failed, nothing was changed: (.+)$/, 'الاسترجاع فشل ومفيش حاجة اتغيرت: $1'],
  [/^This category is used by (\d+) recurring expense\(s\)\. Change or delete them first\.$/, 'الفئة دي مستخدمة في $1 مصروف متكرر. غيّرهم أو امسحهم الأول.'],
  // Field checks ("amount: Too small...") come in English from the validator: say it plainly instead.
  [/^[\w.]+: .+$/, 'في قيمة مش مظبوطة. راجع اللي كتبته وجرّب تاني.'],
];

function apply(lang: Lang) {
  current = lang;
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  document.title = lang === 'ar' ? 'مصروفي' : 'Masrofy'; // the tab / recent-apps name follows the language
}

interface I18nCtx {
  /** Language in use right now. */
  lang: Lang;
  /** What the user chose: 'system', 'en' or 'ar'. */
  pref: LangPref;
  setPref: (p: LangPref) => void;
}
const Ctx = createContext<I18nCtx>({ lang: current, pref: 'system', setPref: () => undefined });

/** Re-mounts the app when the language changes so every t() call re-runs. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<LangPref>(readLangPref);
  const [lang, setLangState] = useState<Lang>(current);
  useEffect(() => apply(lang), [lang]);

  // While on "System", follow the device if its language changes.
  useEffect(() => {
    if (pref !== 'system') return;
    const onChange = () => {
      const l = systemLang();
      apply(l);
      setLangState(l);
    };
    window.addEventListener('languagechange', onChange);
    return () => window.removeEventListener('languagechange', onChange);
  }, [pref]);

  const setPref = useCallback((p: LangPref) => {
    try {
      if (p === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, p);
    } catch {
      /* still applies for this visit */
    }
    const l = resolve(p);
    apply(l);
    setPrefState(p);
    setLangState(l);
  }, []);
  return (
    <Ctx.Provider value={{ lang, pref, setPref }}>
      <div key={lang} style={{ display: 'contents' }}>
        {children}
      </div>
    </Ctx.Provider>
  );
}

export const useI18n = () => useContext(Ctx);
