import { describe, expect, it } from 'vitest';
import { addMonths, fmtDate, money, moneySigned, nextCode, r2 } from '../src/format';

describe('format', () => {
  it('formats RD$ with en-US grouping', () => {
    expect(money(1234.5)).toBe('RD$ 1,234.50');
    expect(money(0)).toBe('RD$ 0.00');
    expect(moneySigned(-6250)).toBe('− RD$ 6,250.00');
  });
  it('formats dates like the designs', () => {
    expect(fmtDate('2026-11-03')).toBe('3 nov 2026');
    expect(fmtDate('2026-09-21')).toMatch(/^21 sept? 2026$/);
    expect(fmtDate(null)).toBe('—');
  });
  it('rounds to cents', () => {
    expect(r2(0.1 + 0.2)).toBe(0.3);
    expect(r2(7320.5 - 3000)).toBe(4320.5);
  });
  it('steps months across years', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
  it('makes the next zero-padded code from the max, ignoring other formats', () => {
    expect(nextCode('F', [])).toBe('F-001');
    expect(nextCode('F', ['F-001', 'F-009', 'E-0093381', 'F-004'])).toBe('F-010');
    expect(nextCode('P', ['P-099'])).toBe('P-100');
    expect(nextCode('F', ['F-1200'])).toBe('F-1201');
  });
});
