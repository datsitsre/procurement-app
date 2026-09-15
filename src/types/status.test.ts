import { describe, expect, it } from 'vitest';
import { getStatusTone, getStatusLabel } from './status';

describe('getStatusTone', () => {
  it('maps a known status to its documented semantic tone', () => {
    expect(getStatusTone('order', 'DELIVERED')).toBe('success');
    expect(getStatusTone('order', 'CANCELLED')).toBe('danger');
    expect(getStatusTone('invoice', 'OVERDUE')).toBe('danger');
    expect(getStatusTone('dispute', 'RESOLVED_REFUND')).toBe('success');
  });

  it('falls back to neutral for a status not in the domain map, rather than throwing', () => {
    expect(getStatusTone('order', 'SOME_FUTURE_STATUS')).toBe('neutral');
  });
});

describe('getStatusLabel', () => {
  it('title-cases an ALL_CAPS_SNAKE status into a human label', () => {
    expect(getStatusLabel('PARTIALLY_DELIVERED')).toBe('Partially Delivered');
    expect(getStatusLabel('PENDING')).toBe('Pending');
  });

  it('overrides plain title-casing for a status with an embedded acronym', () => {
    // Plain title-casing would produce "Converted To Po" ("PO" -> "Po") - wrong, and not how
    // the rest of the app refers to a purchase order (never a bare "PO").
    expect(getStatusLabel('CONVERTED_TO_PO')).toBe('Converted to purchase order');
  });
});
