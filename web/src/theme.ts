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

/** Follow the phone's setting live while "System" is chosen. */
export function watchSystemTheme() {
  media()?.addEventListener?.('change', () => {
    if (getThemePref() === 'system') applyTheme('system');
  });
}
