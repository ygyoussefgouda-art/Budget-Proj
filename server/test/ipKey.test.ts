/** Rate-limit key: one key per IPv4 address, one per IPv6 /56 (a home or a VPS). */
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { ipKey } from '../src/app.js';

const key = (ip: string) => ipKey({ ip } as Request);

describe('rate-limit key', () => {
  it('IPv4 addresses are their own key', () => {
    expect(key('203.0.113.7')).toBe('203.0.113.7');
    expect(key('203.0.113.8')).not.toBe(key('203.0.113.7'));
  });

  it('IPv4 written as IPv6 (::ffff:) counts as the same IPv4 address, never as one shared group', () => {
    expect(key('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(key('::ffff:198.51.100.1')).not.toBe(key('::ffff:203.0.113.7'));
  });

  it('IPv6 addresses in the same /56 share a key; other /56 blocks do not', () => {
    const a = key('2001:db8:abcd:1200::1');
    expect(key('2001:db8:abcd:12ff:ffff::9')).toBe(a); // same /56
    expect(key('2001:db8:abcd:1300::1')).not.toBe(a); // next /56
    expect(a).toContain('/56');
  });
});
