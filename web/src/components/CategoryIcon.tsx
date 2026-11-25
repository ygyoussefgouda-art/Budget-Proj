import {
  Baby,
  BookOpen,
  Bus,
  Car,
  Clapperboard,
  Coffee,
  Dumbbell,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  PawPrint,
  Plane,
  Shirt,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Tag,
  Utensils,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { t } from '../i18n';
import { useAppOptional } from '../state';
import { tint } from './ui';

/** Same keys as CATEGORY_ICONS / CATEGORY_COLORS in server/src/validation.ts. */
export const CATEGORY_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  food: { icon: Utensils, label: 'Food' },
  coffee: { icon: Coffee, label: 'Coffee' },
  groceries: { icon: ShoppingCart, label: 'Groceries' },
  transport: { icon: Bus, label: 'Transport' },
  car: { icon: Car, label: 'Car' },
  fuel: { icon: Fuel, label: 'Fuel' },
  home: { icon: House, label: 'House' },
  bills: { icon: Zap, label: 'Bills' },
  phone: { icon: Smartphone, label: 'Phone' },
  internet: { icon: Wifi, label: 'Internet' },
  uni: { icon: GraduationCap, label: 'Uni' },
  books: { icon: BookOpen, label: 'Books' },
  health: { icon: HeartPulse, label: 'Health' },
  clothes: { icon: Shirt, label: 'Clothes' },
  gifts: { icon: Gift, label: 'Gifts' },
  games: { icon: Gamepad2, label: 'Games' },
  movies: { icon: Clapperboard, label: 'Going out' },
  travel: { icon: Plane, label: 'Travel' },
  sport: { icon: Dumbbell, label: 'Sport' },
  kids: { icon: Baby, label: 'Kids' },
  pets: { icon: PawPrint, label: 'Pets' },
  beauty: { icon: Sparkles, label: 'Beauty' },
  repairs: { icon: Wrench, label: 'Repairs' },
  other: { icon: Tag, label: 'Other' },
};

/** Readable on light and dark cards. */
export const CATEGORY_COLORS: Record<string, { hex: string; label: string }> = {
  green: { hex: '#3f9c63', label: 'Green' },
  gold: { hex: '#c98d4f', label: 'Gold' },
  red: { hex: '#d9655a', label: 'Red' },
  blue: { hex: '#5b8def', label: 'Blue' },
  purple: { hex: '#9b7be0', label: 'Purple' },
  teal: { hex: '#2fa598', label: 'Teal' },
  pink: { hex: '#d9739f', label: 'Pink' },
  gray: { hex: '#8a8ca8', label: 'Grey' },
};

export interface CategoryLook {
  id?: number;
  name?: string | null;
  icon?: string | null;
  color?: string | null;
}

/**
 * 2.0.0 pastels (from the dark fintech kit): categories without a colour of their own get one of these.
 * Dark ink on them (all ≥ 9:1).
 */
export const PASTELS = ['#7edddb', '#b9a6f5', '#f5d76e', '#f4a28c', '#8ec8f5', '#f2a7c9', '#a8e38a'];
const pastelFor = (name: string) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return PASTELS[h % PASTELS.length];
};

/**
 * 2.4.0 (critique: 4 of 6 starter categories got the same blue from the name hash, and Home's legend used yet
 * another order): ONE colour per category, used everywhere (list badges, Home legend, the Reports ring).
 * Its own colour when set; otherwise the pastel for its place in the list, so the first seven always differ.
 */
export function categoryColor(cat: CategoryLook | undefined, cats: CategoryLook[] = []): { hex: string; pastel: boolean } {
  const own = cat?.color ? CATEGORY_COLORS[cat.color]?.hex : undefined;
  if (own) return { hex: own, pastel: false };
  const i = cats.findIndex((c) => (cat?.id !== undefined ? c.id === cat.id : c.name === cat?.name));
  return { hex: i >= 0 ? PASTELS[i % PASTELS.length] : pastelFor(cat?.name ?? '?'), pastel: true };
}

/** The colour of one category of the signed-in account (by id or name), for dots and charts. */
export function useCategoryColor() {
  const cats = useAppOptional()?.data?.categories ?? [];
  return (cat: CategoryLook | undefined) => categoryColor(cat, cats).hex;
}

/** The round badge in lists: the category's icon in its colour, or (no colour set) a pastel circle. */
export function CategoryIcon({ cat, fallbackColor, size = 18 }: { cat: CategoryLook | undefined; fallbackColor: string; size?: number }) {
  const cats = useAppOptional()?.data?.categories ?? [];
  const Icon = cat?.icon ? CATEGORY_ICONS[cat.icon]?.icon : undefined;
  const glyph = Icon ? <Icon size={size} /> : (cat?.name ?? '?').slice(0, 1).toUpperCase();
  const tone = cat?.name || cat?.color ? categoryColor(cat, cats) : null;
  if (tone?.pastel) {
    return (
      <span className="avatar is-pastel" style={{ color: '#0b0f0d', background: tone.hex }} aria-hidden="true">
        {glyph}
      </span>
    );
  }
  const own = tone?.hex;
  const color = own || fallbackColor;
  return (
    <span className="avatar" style={{ color, background: tint(color, 16) }} aria-hidden="true">
      {glyph}
    </span>
  );
}

/** Icon and colour picker for the category form. `null` = none (first letter, default colour). */
export function CategoryLookPicker({
  icon,
  color,
  onIcon,
  onColor,
}: {
  icon: string | null;
  color: string | null;
  onIcon: (v: string | null) => void;
  onColor: (v: string | null) => void;
}) {
  const shown = (color && CATEGORY_COLORS[color]?.hex) || 'var(--accent-text)';
  return (
    <div className="field">
      <span className="field-label">{t('Icon')}</span>
      <div className="look-grid" role="radiogroup" aria-label={t('Icon')}>
        <button type="button" role="radio" aria-checked={icon === null} className={`look-btn ${icon === null ? 'on' : ''}`} onClick={() => onIcon(null)} title={t('No icon')}>
          <span className="tiny">Aa</span>
        </button>
        {Object.entries(CATEGORY_ICONS).map(([key, { icon: Icon, label }]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={icon === key}
            aria-label={t(label)}
            title={t(label)}
            className={`look-btn ${icon === key ? 'on' : ''}`}
            style={icon === key ? { color: shown } : undefined}
            onClick={() => onIcon(key)}
          >
            <Icon size={18} />
          </button>
        ))}
      </div>
      <span className="field-label">{t('Colour')}</span>
      <div className="look-colors" role="radiogroup" aria-label={t('Colour')}>
        <button type="button" role="radio" aria-checked={color === null} aria-label={t('Default colour')} title={t('Default colour')} className={`swatch none ${color === null ? 'on' : ''}`} onClick={() => onColor(null)} />
        {Object.entries(CATEGORY_COLORS).map(([key, { hex, label }]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={color === key}
            aria-label={t(label)}
            title={t(label)}
            className={`swatch ${color === key ? 'on' : ''}`}
            style={{ background: hex }}
            onClick={() => onColor(key)}
          />
        ))}
      </div>
    </div>
  );
}
