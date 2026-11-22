import type { CSSProperties, ReactNode } from 'react';
import { Plus, Trash2, type LucideIcon } from 'lucide-react';
import { t } from '../i18n';

/** Theme colours as CSS variables, so they follow light/dark mode (see styles.css). */
export const COLORS = {
  /** The main colour where it is text, a line or a tint (solid buttons use the CSS classes). */
  accent: 'var(--accent-text)',
  highlight: 'var(--highlight)',
  red: 'var(--red)',
  amber: 'var(--amber)',
  blue: 'var(--blue)',
  purple: 'var(--purple)',
  text: 'var(--text)',
  mute: 'var(--mute)',
};

/** Translucent version of any colour (works with CSS variables too). */
export const tint = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

/** Chart colours (readable on both light and dark cards). */
export const PALETTE = ['#d29a5c', '#6fbf8a', '#8a8ff0', '#e07a6f', '#5bb0c9', '#c9a0dc', '#b9c96b', '#94a3b8'];

export function Card({ children, onClick, className = '', style }: { children: ReactNode; onClick?: () => void; className?: string; style?: CSSProperties }) {
  if (onClick) {
    return (
      <button type="button" className={`card clickable ${className}`} onClick={onClick} style={style}>
        {children}
      </button>
    );
  }
  return (
    <section className={`card ${className}`} style={style}>
      {children}
    </section>
  );
}

export function Bar({ value, color = COLORS.accent }: { value: number; color?: string }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div className="bar" role="progressbar" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="bar-fill" style={{ width: `${v * 100}%`, background: color }} />
    </div>
  );
}

export function Pill({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span className="pill" style={{ color, background: tint(color, 15) }}>
      {children}
    </span>
  );
}

export function SectionTitle({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="section-title">
      <h3>{children}</h3>
      {trailing}
    </div>
  );
}

export function Empty({ text, icon: Icon }: { text: string; icon?: LucideIcon }) {
  return (
    <div className="empty">
      {Icon && <Icon size={36} strokeWidth={1.5} />}
      <p>{text}</p>
    </div>
  );
}

export function KV({ k, v, color, bold }: { k: string; v: ReactNode; color?: string; bold?: boolean }) {
  return (
    <div className="kv">
      <span className="mute">{k}</span>
      <span style={{ color, fontWeight: bold ? 800 : 600 }}>{v}</span>
    </div>
  );
}

/** Icon inside a progress ring (reference design 2). */
export function RingIcon({ icon: Icon, color, progress, size = 48 }: { icon: LucideIcon; color: string; progress?: number; size?: number }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = progress === undefined ? 1 : Math.max(0, Math.min(1, progress));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg className="ring-track" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: 'var(--card2)' }} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          style={{ stroke: color }}
          strokeOpacity={progress === undefined ? 0.4 : 1}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * p} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <Icon size={size * 0.42} className="ring-icon" />
    </div>
  );
}

export function IconBadge({ icon: Icon, color, size = 40, round = false }: { icon: LucideIcon; color: string; size?: number; round?: boolean }) {
  return (
    <span className="badge" style={{ width: size, height: size, background: color, borderRadius: round ? '50%' : size * 0.3 }}>
      <Icon size={size * 0.5} color="#fff" />
    </span>
  );
}

export function StatTile({ label, value, color, icon, progress, sub }: { label: string; value: string; color: string; icon: LucideIcon; progress?: number; sub?: string }) {
  return (
    <div className="card stat-tile">
      <div className="row between start">
        <RingIcon icon={icon} color={color} progress={progress} />
        {progress !== undefined && <span style={{ color, fontWeight: 700, fontSize: 13 }}>{Math.round(progress * 100)}%</span>}
      </div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="tiny mute">{sub}</div>}
    </div>
  );
}

// ---------- form controls ----------

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function MoneyInput({ value, onChange, suffix, autoFocus }: { value: string; onChange: (v: string) => void; suffix: string; autoFocus?: boolean }) {
  return (
    <div className="input-wrap">
      <input
        className="input"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
      />
      <span className="input-suffix">{suffix}</span>
    </div>
  );
}

export function Segmented<T extends string | boolean>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function FormError({ text }: { text: string | null }) {
  return text ? <p className="form-error">{text}</p> : null;
}

export function SaveButton({ label, busy }: { label: string; busy: boolean }) {
  return (
    <button type="submit" className="btn primary block" disabled={busy}>
      {busy ? t('Saving…') : label}
    </button>
  );
}

export function PageHeader({ title, left, right }: { title: ReactNode; left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="ph-side">{left}</div>
      <h1>{title}</h1>
      <div className="ph-side right">{right}</div>
    </header>
  );
}

export function IconButton({ icon: Icon, label, onClick, color, flip }: { icon: LucideIcon; label: string; onClick: () => void; color?: string; flip?: boolean }) {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} onClick={onClick} style={{ color }}>
      <Icon size={21} className={flip ? 'flip-rtl' : undefined} />
    </button>
  );
}

/** Small coloured "+ Add" button used in section headers on every tab. */
export function AddButton({ label = t('Add'), onClick, title }: { label?: string; onClick: () => void; title?: string }) {
  return (
    <button type="button" className="add-btn" onClick={onClick} title={title} aria-label={title}>
      <Plus size={15} strokeWidth={2.6} />
      <span>{label}</span>
    </button>
  );
}

/** Coloured bin button for removing a row. */
export function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="del-btn" aria-label={label} title={label} onClick={onClick}>
      <Trash2 size={17} />
    </button>
  );
}

/** Floating round button above the bottom bar (e.g. quick add). `title` is the spoken / tooltip name. */
export function Fab({ label, title, onClick, icon: Icon }: { label: string; title: string; onClick: () => void; icon: LucideIcon }) {
  return (
    <button type="button" className="fab" onClick={onClick} aria-label={title} title={title}>
      <Icon size={20} strokeWidth={2.5} />
      <span>{label}</span>
    </button>
  );
}
