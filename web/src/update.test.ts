import { describe, expect, it } from 'vitest';
import { CHECK_EVERY_MS, dueForCheck, updateNeed, type AndroidRelease } from './update';

const rel = (p: Partial<AndroidRelease> = {}): AndroidRelease => ({
  versionCode: 5,
  versionName: '0.7.0',
  minVersionCode: 0,
  mandatory: false,
  size: 100,
  sha256: 'a'.repeat(64),
  notes: { en: [], ar: [] },
  downloadUrl: '/api/app/android/apk/budget-me-0.7.0.apk',
  ...p,
});

describe('Android self-update decisions', () => {
  it('nothing newer: no update', () => {
    expect(updateNeed(5, rel())).toBe('none');
    expect(updateNeed(6, rel())).toBe('none');
    expect(updateNeed(5, null)).toBe('none');
  });
  it('newer and not mandatory: optional', () => {
    expect(updateNeed(4, rel())).toBe('optional');
  });
  it('mandatory, below minVersionCode, or below the server minimum: required', () => {
    expect(updateNeed(4, rel({ mandatory: true }))).toBe('required');
    expect(updateNeed(2, rel({ minVersionCode: 3 }))).toBe('required');
    expect(updateNeed(4, rel(), 5)).toBe('required');
    // The server needs a newer app but none is published yet: still blocked (shown as "required").
    expect(updateNeed(4, null, 5)).toBe('required');
  });
  it('checks at most every 6 hours', () => {
    const now = 1_000_000_000_000;
    expect(dueForCheck(0, now)).toBe(true);
    expect(dueForCheck(now - CHECK_EVERY_MS + 1, now)).toBe(false);
    expect(dueForCheck(now - CHECK_EVERY_MS, now)).toBe(true);
    expect(dueForCheck(now + 60_000, now)).toBe(true); // clock moved back
  });
});
