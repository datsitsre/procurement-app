import { PriceDisplay } from '@/components/ui/PriceDisplay';
import type { CurrencyCode } from '@/types/common';
import type { PriceTier } from '@/types/catalog';

export interface BulkPricingTableProps {
  tiers: PriceTier[];
  currency: CurrencyCode;
  activeQuantity?: number;
}

/** Renders a product's bulk-pricing tiers (section 13), highlighting whichever tier the
 *  currently-selected quantity falls into. */
export function BulkPricingTable({ tiers, currency, activeQuantity }: BulkPricingTableProps) {
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-metadata">
          <th className="pb-2 text-left font-medium">Quantity</th>
          <th className="pb-2 text-right font-medium">Unit price</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((tier) => {
          const isActive = activeQuantity !== undefined && activeQuantity >= tier.minQty && (tier.maxQty === undefined || activeQuantity <= tier.maxQty);
          return (
            <tr key={tier.minQty} className={isActive ? 'bg-info-bg' : undefined}>
              <td className="border-t border-border py-2 pl-2">
                {tier.maxQty ? `${tier.minQty}–${tier.maxQty}` : `${tier.minQty}+`}
              </td>
              <td className="border-t border-border py-2 pr-2 text-right">
                <PriceDisplay amount={tier.unitPrice} currency={currency} size="sm" />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
