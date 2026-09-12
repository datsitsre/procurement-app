import { catalogService } from '@/services/catalog.service';
import { cartService } from '@/services/cart.service';
import { availableStock, resolveTierPrice } from '@/types/catalog';
import type { Order } from '@/types/orders';

export interface ReorderOutcome {
  addedCount: number;
  warnings: string[];
}

export interface ReorderLine {
  productId: string;
  productName: string;
  quantity: number;
  /** The price this line was recorded at previously, if known - used only to warn that today's
   *  price differs, never trusted as what actually gets charged. */
  previousUnitPrice?: number;
}

/**
 * Adds a list of {productId, quantity} lines to the current cart, re-fetching each one from the
 * live catalog first (section 11.0/11.1) - the one rule that matters here is never silently
 * reusing a stale price or assuming stock is still there: every line is checked for current
 * moderation status, current stock, and current MOQ before it's added, and anything that's
 * changed for the worse is reported back as a warning rather than added anyway.
 * `cartService.setQuantity` recomputes the bulk-pricing tier itself, so the price actually
 * added is always today's price. Shared by both "Reorder" (from a past order) and "Load
 * template" (from a saved purchase template), so the same honesty rules apply to both.
 */
export async function addLinesToCart(lines: ReorderLine[], companyId: string): Promise<ReorderOutcome> {
  const warnings: string[] = [];
  let addedCount = 0;

  for (const line of lines) {
    const productResult = await catalogService.getProductById(line.productId);
    if (!productResult.ok) {
      warnings.push(`${line.productName} is no longer available and was not added.`);
      continue;
    }
    const product = productResult.data;
    if (product.moderationStatus !== 'PUBLISHED') {
      warnings.push(`${line.productName} is no longer listed for sale and was not added.`);
      continue;
    }

    const stock = availableStock(product);
    if (stock <= 0) {
      warnings.push(`${line.productName} is out of stock and was not added.`);
      continue;
    }

    const quantity = Math.min(line.quantity, stock);
    if (quantity < line.quantity) {
      warnings.push(`Only ${stock} of ${line.productName} are available - added ${quantity} instead of ${line.quantity}.`);
    }
    if (quantity < product.moq) {
      warnings.push(`${line.productName}'s minimum order quantity is now ${product.moq} - not added at ${quantity}.`);
      continue;
    }

    const currentUnitPrice = resolveTierPrice(product, quantity).unitPrice;
    const result = await cartService.setQuantity(companyId, product.id, quantity);
    if (!result.ok) {
      warnings.push(`${line.productName} could not be added: ${result.error.message}`);
      continue;
    }
    if (line.previousUnitPrice !== undefined && currentUnitPrice !== line.previousUnitPrice) {
      warnings.push(`${line.productName}'s price has changed since this was last ordered - the cart shows today's price.`);
    }
    addedCount += 1;
  }

  return { addedCount, warnings };
}

/** Rebuilds a cart from a past order (section 11.1's "Reorder" button). */
export async function reorderOrder(order: Order, companyId: string): Promise<ReorderOutcome> {
  return addLinesToCart(
    order.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      previousUnitPrice: item.unitPrice,
    })),
    companyId,
  );
}
