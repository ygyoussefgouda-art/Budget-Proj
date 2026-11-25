import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Plus, Trash2, type LucideIcon } from 'lucide-react';
import { evalMoney, fmtMoney, groupThousands, hasMaths, plain, ungroupThousands } from '../domain/money';
import Illustration from './Illustration';
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
export const PALETTE = ['#b8f25c', '#8ec8f5', '#b9a6f5', '#f5d76e', '#f4a28c', '#7edddb', '#f2a7c9', '#8fa39a']; // 2.0.0: lime + pastels

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

/**
 * A hero amount: big number, small currency ("3,100 EGP"). Reads and copies as one amount. Used by every
 * screen's top number (Home, Savings, a goal, Loans) so they all look the same (2.1.2).
 */
export function HeroAmount({ text }: { text: string }) {
  const i = text.lastIndexOf(' ');
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="hero-cur">{' '}{text.slice(i + 1)}</span>
    </>
  );
}

export function SectionTitle({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="section-title">
      <h2>{children}</h2>
      {trailing}
    </div>
  );
}

/** Empty list: a small line illustration and one line of text (2.0.0; `icon` is kept for old call sites). */
export function Empty({ text, art = 'receipt' }: { text: string; icon?: LucideIcon; art?: 'wallet' | 'receipt' | 'goal' }) {
  return (
    <div className="empty">
      <Illustration name={art} size={112} />
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

export function StatTile({
  label,
  value,
  color,
  icon,
  progress,
  progressLabel,
  sub,
}: {
  label: string;
  value: string;
  color: string;
  icon: LucideIcon;
  progress?: number;
  /** What the ring's % is of ("of your saving plan"); shown under the number. */
  progressLabel?: string;
  sub?: string;
}) {
  return (
    <div className="card stat-tile">
      <div className="row between start">
        <RingIcon icon={icon} color={color} progress={progress} />
        {progress !== undefined && (
          <span className="ring-pct">
            <strong style={{ color }}>{Math.round(progress * 100)}%</strong>
            {progressLabel && <span className="ring-pct-label">{progressLabel}</span>}
          </span>
        )}
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

/**
 * Amount field. Every amount field understands maths ("45+30"); with `calc`, + − × ÷ keys appear
 * while it's focused (phone number pads have no + key), and the result shows underneath.
 */
export function MoneyInput({
  value,
  onChange,
  suffix,
  autoFocus,
  calc = false,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  suffix: string;
  autoFocus?: boolean;
  calc?: boolean;
  label?: string;
}) {
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // 2.3.0 (owner): thousands separators while typing ("1,000", "10,000", "100,000"). Only the display
  // has them; `value` stays plain. The caret keeps its place among the digits when commas come and go.
  const shown = groupThousands(value);
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = input.current;
    if (caret.current === null || !el || document.activeElement !== el) return;
    let seen = 0;
    let pos = shown.length;
    for (let i = 0; i < shown.length; i++) {
      if (seen === caret.current) {
        pos = i;
        break;
      }
      if (shown[i] !== ',') seen += 1;
    }
    caret.current = null;
    el.setSelectionRange(pos, pos);
  }, [shown]);
  // Leaving the field (e.g. tapping Save) must not move the page under the finger: the keys and the
  // "= 75" line stay a moment longer, then go.
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maths = hasMaths(value);
  const result = maths ? evalMoney(value) : null;
  const add = (op: string) => {
    const v = value.trim();
    onChange(v === '' || /[+−\-×÷]$/.test(v) ? v : `${v}${op}`);
    input.current?.focus();
  };
  return (
    <>
      <div className="input-wrap">
        <input
          ref={input}
          className="input"
          inputMode="decimal"
          autoComplete="off"
          value={shown}
          autoFocus={autoFocus}
          aria-label={label}
          onChange={(e) => {
            const typed = e.target.value;
            const raw = ungroupThousands(typed, shown !== value);
            // Characters (not counting thousands commas) before the caret, to put it back after re-grouping.
            // Only when the commas change (otherwise the browser already has it right, e.g. "12,5").
            const before = typed.slice(0, e.target.selectionStart ?? typed.length);
            caret.current = groupThousands(raw) === typed ? null : before.replace(/,/g, '').length;
            onChange(raw);
          }}
          onFocus={() => {
            if (leaveTimer.current) clearTimeout(leaveTimer.current);
            setFocused(true);
          }}
          onBlur={() => {
            leaveTimer.current = setTimeout(() => {
              setFocused(false);
              if (maths && result !== null) onChange(plain(result)); // "45+30" becomes "75"
            }, 250);
          }}
          placeholder="0"
        />
        <span className="input-suffix">{suffix}</span>
      </div>
      {maths && (
        <div className="calc-result" aria-live="polite">
          {result === null ? t('Check the sum') : `= ${fmtMoney(result, suffix)}`}
        </div>
      )}
      {calc && focused && (
        <div className="calc-keys" role="group" aria-label={t('Maths')}>
          {[
            ['+', t('Plus')],
            ['−', t('Minus')],
            ['×', t('Times')],
            ['÷', t('Divided by')],
          ].map(([op, name]) => (
            // mousedown would take focus from the field (and hide these keys) before the click
            <button key={op} type="button" aria-label={name} onMouseDown={(e) => e.preventDefault()} onClick={() => add(op)}>
              {op}
            </button>
          ))}
        </div>
      )}
    </>
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
  // Shrinks to a round icon once the page is scrolled, so it covers less of the content under it.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 120);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <button type="button" className={`fab ${compact ? 'is-compact' : ''}`} onClick={onClick} aria-label={title} title={title}>
      <Icon size={20} strokeWidth={2.5} />
      <span>{label}</span>
    </button>
  );
}
