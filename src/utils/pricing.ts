/**
 * Flat placeholder rates shared by the cart and purchase-order totals. A real tax engine
 * (per-country VAT rules, section 55) and a real delivery-fee calculation (by weight/distance/
 * warehouse) are future work; these keep the numbers honest about what they are - an
 * illustrative estimate, not a quote - while guaranteeing the cart total and the resulting
 * purchase order's total are computed identically.
 */
export const VAT_RATE = 0.125;
export const FLAT_DELIVERY_FEE = 2000;

export function calculateTax(subtotal: number): number {
  return Math.round(subtotal * VAT_RATE);
}
