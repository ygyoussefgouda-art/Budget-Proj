import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Two-step sign-in codes (TOTP, RFC 6238): the 6-digit codes of Google Authenticator, Aegis, 2FAS,
 * Microsoft Authenticator... HMAC-SHA1, 30-second steps, one step of clock drift allowed either way.
 * Built on node:crypto only.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('bad base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits, the size the RFC recommends), as base32. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

/** The code for one 30-second step. */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

/**
 * Checks a typed code. Returns the matching step (to store, so the same code can't be used twice),
 * or null. `lastStep` = the step used last time: that one and older are refused.
 */
export function verifyTotp(secretB32: string, code: string, nowMs: number, lastStep: number | null = null): number | null {
  const typed = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const secret = base32Decode(secretB32);
  const now = stepAt(nowMs);
  for (const step of [now, now - 1, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const want = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(want, Buffer.from(typed))) return step;
  }
  return null;
}

/** The link authenticator apps understand (also what a QR code would contain). */
export const otpauthUri = (account: string, secretB32: string, issuer = 'Budget me') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;

/** One-time backup codes for a lost phone: 8 codes like K7M2-QX9P. */
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newBackupCodes(n = 8): string[] {
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const c = Array.from(b, (x) => BACKUP_ALPHABET[x % BACKUP_ALPHABET.length]).join('');
    return `${c.slice(0, 4)}-${c.slice(4)}`;
  });
}
export const normalizeBackupCode = (s: string) => s.toUpperCase().replace(/[\s-]/g, '');
