import { isRtl } from '../i18n';
import { COLORS } from './ui';

/**
 * The app's name as a logo: "Masrof" + a green "y" in English, "مصروف" + a green "ي" in Arabic
 * (the final letter is "my": مصروفي = "my spending"). Same two-tone idea as the old logo.
 */
/**
 * The Masrofy mark (mark 11 "Budget line M", owner's pick for now): one stroke drawn like a progress bar,
 * the brand colour is what's spent, the quiet part is what's left. Decorative next to the wordmark.
 */
export function BrandMark({ size = 26 }: { size?: number }) {
  const d = 'M16 84V20L50 60L84 20V84';
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="var(--mark-track)" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} pathLength={100} strokeDasharray="64 100" fill="none" stroke="var(--accent-text)" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Brand({ accent = COLORS.accent, className }: { accent?: string; className?: string }) {
  return isRtl() ? (
    <span dir="rtl" lang="ar" className={className}>
      مصروف<span style={{ color: accent }}>ي</span>
    </span>
  ) : (
    <span dir="ltr" className={className}>
      Masrof<span style={{ color: accent }}>y</span>
    </span>
  );
}
