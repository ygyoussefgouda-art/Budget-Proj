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

/** An exchange rate ("49.5", "49,5", "٤٩٫٥"). Rates never use thousands separators, so a comma is a decimal point. */
export function parseRate(s: string): number | null {
  let t = digits(s);
  if (!t.includes('.')) t = t.replace(',', '.');
  if (!t || !/^\d*\.?\d*$/.test(t) || t === '.') return null;
  const v = Math.round(Number(t) * 1e6) / 1e6;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Minor units, or null when the text is empty / invalid / negative. Accepts Arabic digits. */
export function parseMoney(s: string): number | null {
  const t = norm(s);
  if (!t || !/^\d*\.?\d*$/.test(t) || t === '.') return null;
  const v = Number(t);
  if (!Number.isFinite(v) || v < 0 || v > 1e11) return null;
  return Math.round(v * 100);
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
  return `${neg ? '−' : ''}${s}${cur ? ` ${cur}` : ''}`;
}

export const num2 = (v: number) => (Number.isInteger(v) ? String(v) : String(v));
