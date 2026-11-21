/**
 * Optional app lock with a 4–6 digit PIN, kept only on this phone (never sent to the server).
 * Stored as a salted PBKDF2-SHA-256 hash. It is a privacy lock for the app on this device,
 * separate from the account password: forgetting it means signing out and back in.
 */

export const PIN_RE = /^\d{4,6}$/;
const ITERATIONS = 150_000;

export interface LockConfig {
  salt: string; // base64
  hash: string; // base64
  iterations: number;
  length: number; // digits, so the lock screen knows when the PIN is complete
  minutes: number; // lock after this long in the background (0 = right away)
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function hashPin(pin: string, salt: string, iterations = ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations }, key, 256);
  return b64(new Uint8Array(bits));
}

export async function makeLock(pin: string, minutes: number): Promise<LockConfig> {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await hashPin(pin, salt), iterations: ITERATIONS, length: pin.length, minutes };
}

/** Same length check first, then a comparison that doesn't stop at the first different character. */
export async function pinMatches(pin: string, cfg: LockConfig): Promise<boolean> {
  const h = await hashPin(pin, cfg.salt, cfg.iterations);
  if (h.length !== cfg.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ cfg.hash.charCodeAt(i);
  return diff === 0;
}

/** Wait after wrong PINs: none for the first 4, then 30 s, doubling (max 15 min). */
export function lockoutMs(failures: number) {
  if (failures < 5) return 0;
  return Math.min(15 * 60_000, 30_000 * 2 ** (failures - 5));
}

// ---------- stored on this device ----------
const key = (uid: number) => `bm-lock:${uid}`;
const failKey = (uid: number) => `bm-lock-fails:${uid}`;
const ACTIVE = 'bm-last-active';

const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* blocked storage: the lock simply can't be turned on */
  }
};

export function readLock(uid: number): LockConfig | null {
  try {
    const v = JSON.parse(get(key(uid)) ?? 'null');
    return v && v.salt && v.hash ? (v as LockConfig) : null;
  } catch {
    return null;
  }
}
export const saveLock = (uid: number, cfg: LockConfig) => set(key(uid), JSON.stringify(cfg));
export function removeLock(uid: number) {
  set(key(uid), null);
  set(failKey(uid), null);
}

export function readFailures(uid: number): { count: number; until: number } {
  try {
    return JSON.parse(get(failKey(uid)) ?? 'null') ?? { count: 0, until: 0 };
  } catch {
    return { count: 0, until: 0 };
  }
}
export function recordFailure(uid: number) {
  const f = readFailures(uid);
  const count = f.count + 1;
  const next = { count, until: Date.now() + lockoutMs(count) };
  set(failKey(uid), JSON.stringify(next));
  return next;
}
export const clearFailures = (uid: number) => set(failKey(uid), null);

/** Remember when the app was last in use (on hide, and now and then while open). */
export const markActive = () => set(ACTIVE, String(Date.now()));

/** Locked if a PIN is set and the app has been away at least `minutes`. */
/**
 * Leaving the app to take a photo or pick a file isn't "leaving the app": the next return within
 * 5 minutes doesn't lock (otherwise "Lock right away" would throw away the form being filled in).
 */
let pausedUntil = 0;
export const pauseLockForPicker = () => {
  pausedUntil = Date.now() + 5 * 60_000;
};

export function shouldLock(uid: number): boolean {
  const cfg = readLock(uid);
  if (!cfg) return false;
  if (pausedUntil > Date.now()) {
    pausedUntil = 0; // one return only
    return false;
  }
  const last = Number(get(ACTIVE) ?? 0);
  return Date.now() - last >= cfg.minutes * 60_000;
}
