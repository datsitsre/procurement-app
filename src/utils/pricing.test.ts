import { describe, expect, it } from 'vitest';
import { VAT_RATE, FLAT_DELIVERY_FEE, calculateTax } from './pricing';

describe('calculateTax', () => {
  it('applies the flat VAT rate and rounds to the nearest whole unit', () => {
    expect(calculateTax(1000)).toBe(Math.round(1000 * VAT_RATE));
    expect(calculateTax(0)).toBe(0);
  });

  it('matches a hand-computed example (the cart/PO totals must agree with this)', () => {
    // 18,600 subtotal -> the exact figure verified live against the cart page during Phase 3.
    expect(calculateTax(18600)).toBe(2325);
  });

  it('never returns a fractional amount', () => {
    expect(Number.isInteger(calculateTax(333))).toBe(true);
  });
});

describe('FLAT_DELIVERY_FEE', () => {
  it('is a fixed, positive placeholder fee', () => {
    expect(FLAT_DELIVERY_FEE).toBeGreaterThan(0);
  });
});
