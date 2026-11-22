import { isRtl } from '../i18n';
import { COLORS } from './ui';

/**
 * The app's name as a logo: "Masrof" + a green "y" in English, "مصروف" + a green "ي" in Arabic
 * (the final letter is "my": مصروفي = "my spending"). Same two-tone idea as the old logo.
 */
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
