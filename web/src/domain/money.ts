/** Money is handled as integer minor units (piastres/cents) to avoid rounding drift. */

const AR: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '٫': '.', '٬': '',
};

function digits(s: string): string {
  let t = s.trim();
  for (const [k, v] of Object.entries(AR)) t = t.split(k).join(v);
  return t.replace(/\s/g, '').replace(/\u060C/g, ','); // Arabic comma counts as a comma
}

/**
 * Commas: "1,200.50" and "1,250" use them for thousands, but many phone keyboards type a comma
 * for the decimal point ("12,50"). With no dot, one comma followed by 1-2 digits is a decimal comma.
 */
function norm(s: string): string {
  const t = digits(s);
  if (!t.includes('.')) {
    const m = /^(\d*),(\d{1,2})$/.exec(t);
    if (m) return `${m[1]}.${m[2]}`;
  }
  return t.replace(/,/g, '');
}

/**
 * 2.3.0 (owner): what an amount field shows while typing: "1000" → "1,000", "250000.5" → "250,000.5".
 * Only plain amounts of 4+ whole digits (no maths, no Arabic digits, no leading zero); a decimal comma is
 * shown as a dot then. Anything else is shown exactly as typed. The stored text never has these commas.
 */
export function groupThousands(raw: string): string {
  const m = /^(\d+)(?:([.,])(\d{0,2}))?$/.exec(raw);
  if (!m || m[1].length < 4 || m[1].startsWith('0')) return raw;
  return m[1].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (m[2] ? `.${m[3]}` : '');
}

/**
 * Back from what was typed into a grouped field to the plain text: our commas go. A comma typed at the end
 * of a grouped amount ("1,000," on a phone keyboard) is the decimal point. Fields that weren't grouped keep
 * the user's own commas ("12,50" stays a decimal comma; "1,250" typed by hand still means 1250).
 */
export function ungroupThousands(typed: string, wasGrouped: boolean): string {
  if (!wasGrouped) return typed;
  if (typed.endsWith(',') && !typed.includes('.')) return `${typed.slice(0, -1).replace(/,/g, '')}.`;
  return typed.replace(/,/g, '');
}

/** An exchange rate ("49.5", "49,5", "٤٩٫٥"). Rates never use thousands separators, so a comma is a decimal point. */
export function parseRate(s: string): number | null {
  let t = digits(s);
  if (!t.includes('.')) t = t.replace(',', '.');
  if (!t || !/^\d*\.?\d*$/.test(t) || t === '.') return null;
  const v = Math.round(Number(t) * 1e6) / 1e6;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Minor units of one plain amount ("12.50", "1,200", "٤٥"), or null. */
function parsePlainMoney(s: string): number | null {
  const t = norm(s);
  if (!t || !/^\d*\.?\d*$/.test(t) || t === '.') return null;
  const v = Number(t);
  if (!Number.isFinite(v) || v < 0 || v > 1e11) return null;
  return Math.round(v * 100);
}

/** Maths signs people type: + − - × x * ÷ / (and the Arabic-keyboard ones). */
const OP = /([+−\-×xX*÷/])/;
export const hasMaths = (s: string) => OP.test(digits(s).replace(/^[+]/, ''));

/** A plain number as a fraction (num / den) so × and ÷ need no floating point: "1.5" → 15 / 10. */
function fraction(s: string): { num: number; den: number } | null {
  let t = digits(s);
  if (!t.includes('.')) t = t.replace(',', '.');
  const m = /^(\d*)(?:\.(\d{0,6}))?$/.exec(t);
  if (!m || (!m[1] && !m[2])) return null;
  const dec = m[2] ?? '';
  return { num: Number(`${m[1] || '0'}${dec}`), den: 10 ** dec.length };
}

/**
 * Maths in an amount field: "45+30", "120/3", "3×45", "100-20+5". × and ÷ go before + and −.
 * Each +/− part starts with an amount; × / ÷ by plain numbers, rounded once to whole minor units.
 * Null for anything else (unknown signs, ÷ 0, a negative or too-large result).
 */
export function evalMoney(s: string): number | null {
  const parts = digits(s).split(OP).filter((p) => p !== '');
  if (!parts.length || OP.test(parts[0]) || OP.test(parts[parts.length - 1])) return null;
  let total = 0;
  let sign = 1;
  let i = 0;
  while (i < parts.length) {
    const base = parsePlainMoney(parts[i]);
    if (base === null) return null;
    let num = base;
    let den = 1;
    i++;
    while (i < parts.length && /^[×xX*÷/]$/.test(parts[i])) {
      const f = fraction(parts[i + 1] ?? '');
      if (!f) return null;
      if (/^[÷/]$/.test(parts[i])) {
        if (f.num === 0) return null;
        num *= f.den;
        den *= f.num;
      } else {
        num *= f.num;
        den *= f.den;
      }
      i += 2;
    }
    total += sign * Math.round(num / den);
    if (i < parts.length) {
      if (!/^[+−-]$/.test(parts[i])) return null;
      sign = parts[i] === '+' ? 1 : -1;
      i++;
      if (i >= parts.length) return null;
    }
  }
  return Number.isFinite(total) && total >= 0 && total <= 1e13 ? total : null;
}

/** Minor units, or null when the text is empty / invalid / negative. Accepts Arabic digits and maths ("45+30"). */
export function parseMoney(s: string): number | null {
  return hasMaths(s) ? evalMoney(s) : parsePlainMoney(s);
}

export function parseNum(s: string): number | null {
  const t = norm(s);
  if (!t || !/^\d*\.?\d*$/.test(t) || t === '.') return null;
  const v = Number(t);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

/** Plain text for editing fields. */
export const plain = (minor: number) => (minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2));

/** Like `plain`, but 0 becomes an empty field (the field shows a faded "0" placeholder instead). */
export const plainOrEmpty = (minor: number) => (minor === 0 ? '' : plain(minor));

/** Parse a money field where empty means 0. Null only for invalid text. */
export const parseMoneyOrZero = (s: string) => (s.trim() === '' ? 0 : parseMoney(s));

/** Parse a number field where empty means 0. Null only for invalid text. */
export const parseNumOrZero = (s: string) => (s.trim() === '' ? 0 : parseNum(s));

const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtMoney(minor: number, cur: string): string {
  const neg = minor < 0;
  const a = Math.abs(minor);
  const s = a % 100 === 0 ? whole.format(a / 100) : cents.format(a / 100);
  // A no-break space: "EGP" never wraps onto a line of its own (2.1.2).
  const out = `${neg ? '−' : ''}${s}${cur ? ` ${cur}` : ''}`;
  // 2.1.0: in Arabic (right-to-left) the browser drew "6,000 EGP" as "EGP 6,000" in some places and not
  // in others. A left-to-right isolate keeps it "6,000 EGP" everywhere. English text is unchanged.
  return rtlPage() ? `⁦${out}⁩` : out;
}

const rtlPage = () => typeof document !== 'undefined' && document.documentElement.dir === 'rtl';

/**
 * Whole units for computed figures (averages, paces, per-day amounts): "2,167 EGP" reads better than
 * "2,166.67 EGP" and nobody plans to the piastre. Rounds towards zero, so it never promises more than there is.
 */
export const wholeUnits = (minor: number) => Math.trunc(minor / 100) * 100;

export const num2 =(v: number) => (Number.isInteger(v) ? String(v) : String(v));
