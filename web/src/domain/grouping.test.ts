import { describe, expect, it } from 'vitest';
import { groupThousands, parseMoney, ungroupThousands } from './money';

describe('2.3.0: thousands separators in amount fields', () => {
  it('shows commas for 4+ whole digits only', () => {
    expect(groupThousands('1000')).toBe('1,000');
    expect(groupThousands('10000')).toBe('10,000');
    expect(groupThousands('100000')).toBe('100,000');
    expect(groupThousands('1234567.5')).toBe('1,234,567.5');
    expect(groupThousands('2500,5')).toBe('2,500.5'); // a decimal comma is shown as a dot
    for (const same of ['', '999', '12,50', '45+30', '٥٠٠٠', '0123', '1000,500']) expect(groupThousands(same)).toBe(same);
  });

  it('typing into a grouped field gives the plain text back, the same amount the app reads', () => {
    expect(ungroupThousands('1,0005', true)).toBe('10005'); // a digit typed at the end
    expect(ungroupThousands('1,000,', true)).toBe('1000.'); // a phone keyboard comma = the decimal point
    expect(ungroupThousands('1,000.5', true)).toBe('1000.5');
    expect(ungroupThousands('12,50', false)).toBe('12,50'); // not grouped: the user's own comma stays
    for (const raw of ['1000', '250000', '1234567.89']) {
      const shown = groupThousands(raw);
      expect(parseMoney(shown)).toBe(parseMoney(raw)); // what is shown means the same amount
      expect(ungroupThousands(shown, shown !== raw)).toBe(raw);
    }
  });
});
