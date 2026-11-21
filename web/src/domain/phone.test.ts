import { describe, expect, it } from 'vitest';
import { lockoutMs, makeLock, pinMatches } from '../pin';
import { swipeAction, SWIPE_TRIGGER } from './gestures';

describe('swipe gestures', () => {
  it('left deletes and right edits; mirrored right-to-left; short swipes do nothing', () => {
    expect(swipeAction(-SWIPE_TRIGGER, false)).toBe('delete');
    expect(swipeAction(SWIPE_TRIGGER + 20, false)).toBe('edit');
    expect(swipeAction(SWIPE_TRIGGER, true)).toBe('delete');
    expect(swipeAction(-120, true)).toBe('edit');
    expect(swipeAction(SWIPE_TRIGGER - 1, false)).toBeNull();
    expect(swipeAction(-30, true)).toBeNull();
  });
});

describe('app lock PIN', () => {
  it('is stored as a salted hash, never as the PIN', async () => {
    const a = await makeLock('1234', 5);
    const b = await makeLock('1234', 5);
    expect(JSON.stringify(a)).not.toContain('1234');
    expect(a.salt).not.toBe(b.salt); // a new salt each time…
    expect(a.hash).not.toBe(b.hash); // …so the same PIN never gives the same hash
    expect(a).toMatchObject({ length: 4, minutes: 5 });
    expect(await pinMatches('1234', a)).toBe(true);
    expect(await pinMatches('1235', a)).toBe(false);
    expect(await pinMatches('12345', a)).toBe(false);
  });
  it('waits longer and longer after wrong PINs', () => {
    expect([1, 2, 3, 4].map(lockoutMs)).toEqual([0, 0, 0, 0]);
    expect(lockoutMs(5)).toBe(30_000);
    expect(lockoutMs(6)).toBe(60_000);
    expect(lockoutMs(30)).toBe(15 * 60_000);
  });
});
