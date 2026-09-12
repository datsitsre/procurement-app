import { describe, expect, it } from 'vitest';
import { formatMoney, formatDate } from './format';

describe('formatMoney', () => {
  it('formats a whole-number amount with no decimal places', () => {
    expect(formatMoney(1000, 'GHS')).not.toMatch(/\.\d/);
  });

  it('formats a fractional amount with decimal places', () => {
    expect(formatMoney(1000.5, 'GHS')).toMatch(/\.\d/);
  });

  it('defaults to GHS when no currency is given', () => {
    expect(formatMoney(100)).toBe(formatMoney(100, 'GHS'));
  });
});

describe('formatDate', () => {
  it('renders a day, short month, and year', () => {
    expect(formatDate('2026-09-12T10:00:00Z')).toBe('12 Sept 2026');
  });
});
