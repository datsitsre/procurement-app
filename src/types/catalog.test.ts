import { describe, expect, it } from 'vitest';
import { resolveTierPrice, availableStock } from './catalog';
import type { PriceTier, InventoryRecord } from './catalog';

const tiers: PriceTier[] = [
  { minQty: 1, maxQty: 4, unitPrice: 100 },
  { minQty: 5, maxQty: 19, unitPrice: 90 },
  { minQty: 20, unitPrice: 80 },
];

describe('resolveTierPrice', () => {
  it('falls back to basePrice below the first tier', () => {
    const { unitPrice, savingsPerUnit, tier } = resolveTierPrice({ basePrice: 110, priceTiers: [] }, 3);
    expect(unitPrice).toBe(110);
    expect(savingsPerUnit).toBe(0);
    expect(tier).toBeNull();
  });

  it('picks the matching tier for a quantity in range', () => {
    const result = resolveTierPrice({ basePrice: 100, priceTiers: tiers }, 10);
    expect(result.unitPrice).toBe(90);
    expect(result.tier?.minQty).toBe(5);
  });

  it('resolves the open-ended top tier (no maxQty) for a large quantity', () => {
    const result = resolveTierPrice({ basePrice: 100, priceTiers: tiers }, 500);
    expect(result.unitPrice).toBe(80);
    expect(result.tier?.maxQty).toBeUndefined();
  });

  it('computes savings relative to the lowest (first) tier, never a negative number', () => {
    const result = resolveTierPrice({ basePrice: 100, priceTiers: tiers }, 20);
    expect(result.savingsPerUnit).toBe(20); // 100 (first tier) - 80
    expect(result.savingsPerUnit).toBeGreaterThanOrEqual(0);
  });

  it('is unaffected by the order price tiers are given in', () => {
    const shuffled = [...tiers].reverse();
    const a = resolveTierPrice({ basePrice: 100, priceTiers: tiers }, 10);
    const b = resolveTierPrice({ basePrice: 100, priceTiers: shuffled }, 10);
    expect(a).toEqual(b);
  });
});

describe('availableStock', () => {
  it('sums stock minus reserved across every warehouse', () => {
    const inventory: InventoryRecord[] = [
      { warehouseId: 'wh-1', stock: 50, reserved: 10, lowStockThreshold: 5 },
      { warehouseId: 'wh-2', stock: 20, reserved: 0, lowStockThreshold: 5 },
    ];
    expect(availableStock({ inventory })).toBe(60);
  });

  it('returns 0 for a product with no inventory records', () => {
    expect(availableStock({ inventory: [] })).toBe(0);
  });
});
