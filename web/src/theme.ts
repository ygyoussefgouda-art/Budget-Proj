/** Light / dark mode, remembered per device. Default: dark (Emerald night). */
export type ThemePref = 'dark' | 'light' | 'system';

const KEY = 'sb-theme';
const media = () => window.matchMedia?.('(prefers-color-scheme: light)');

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage blocked: fall back to default */
  }
  return 'dark';
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  const light = pref === 'light' || (pref === 'system' && !!media()?.matches);
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#edf0ee' : '#0b0f0d');
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* still applies for this visit */
  }
  applyTheme(pref);
}

/**
 * 2.6.0: accent colour, saved on the account (owner's choice of five). The server is the source of truth;
 * this device keeps a copy only so the splash and sign-in screen open in the right colour before /auth/me answers.
 * The colours themselves are CSS (`:root[data-accent=…]` in styles.css); lime needs no attribute.
 */
export const ACCENTS = ['lime', 'sky', 'violet', 'pink', 'lemon'] as const;
export type Accent = (typeof ACCENTS)[number];
/** Labels for the picker (translated where shown) and the swatch colour (the bright, dark-theme value). */
export const ACCENT_INFO: Record<Accent, { label: string; swatch: string }> = {
  lime: { label: 'Lime', swatch: '#b8f25c' },
  sky: { label: 'Sky', swatch: '#6cc8ff' },
  violet: { label: 'Violet', swatch: '#c69cff' },
  pink: { label: 'Pink', swatch: '#ff8fcb' },
  lemon: { label: 'Lemon', swatch: '#f2e85c' },
};
const ACCENT_KEY = 'sb-accent';
export const isAccent = (v: unknown): v is Accent => typeof v === 'string' && (ACCENTS as readonly string[]).includes(v);

export function applyAccent(accent?: string | null) {
  let a: Accent = 'lime';
  if (isAccent(accent)) a = accent;
  else if (accent === undefined) {
    try {
      const saved = localStorage.getItem(ACCENT_KEY);
      if (isAccent(saved)) a = saved;
    } catch {
      /* storage blocked: lime */
    }
  }
  if (a === 'lime') document.documentElement.removeAttribute('data-accent');
  else document.documentElement.setAttribute('data-accent', a);
  try {
    localStorage.setItem(ACCENT_KEY, a);
  } catch {
    /* still applies for this visit */
  }
}

/** Follow the phone's setting live while "System" is chosen. */
export function watchSystemTheme() {
  media()?.addEventListener?.('change', () => {
    if (getThemePref() === 'system') applyTheme('system');
  });
}
