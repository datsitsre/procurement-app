import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { toCartDto } from '@/server/dto/orders';
import { getProductById } from './catalog.service';
import { resolveTierPrice } from '@/types/catalog';
import type { ServiceResult, UUID } from '@/types/common';
import type { Cart } from '@/types/cart';
import type { Prisma } from '@prisma/client';

/**
 * The real, database-backed counterpart to src/services/cart.service.ts's mock (Phase 14, Stage
 * 7) - one Cart row per company (`@@unique([companyId])` in the schema), created on first read
 * rather than at company signup, the same lazy-creation pattern the mock's `readCart` used.
 */

const CART_INCLUDE = { items: true } satisfies Prisma.CartInclude;

async function getOrCreateCart(companyId: UUID) {
  return db.cart.upsert({
    where: { companyId },
    update: {},
    create: { companyId },
    include: CART_INCLUDE,
  });
}

export async function getCart(companyId: UUID): Promise<ServiceResult<Cart>> {
  const cart = await getOrCreateCart(companyId);
  return ok(toCartDto(cart));
}

/** Re-resolves the product's tier price server-side from `quantity`, the same as the mock did -
 *  never trusts a client-supplied unit price. `quantity <= 0` removes the line entirely. */
export async function setQuantity(companyId: UUID, productId: UUID, quantity: number): Promise<ServiceResult<Cart>> {
  const productResult = await getProductById(productId);
  if (!productResult.ok) return fail('NOT_FOUND', 'That product could not be found.');
  const product = productResult.data;

  if (quantity > 0 && quantity < product.moq) {
    return fail('BELOW_MOQ', `${product.name} has a minimum order quantity of ${product.moq} units.`);
  }

  const cart = await getOrCreateCart(companyId);

  if (quantity <= 0) {
    await db.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
  } else {
    const { unitPrice } = resolveTierPrice(product, quantity);
    await db.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId } },
      update: { quantity, unitPrice },
      create: { cartId: cart.id, productId, supplierId: product.supplierId, quantity, unitPrice },
    });
  }

  const updated = await db.cart.findUniqueOrThrow({ where: { id: cart.id }, include: CART_INCLUDE });
  return ok(toCartDto(updated));
}

export async function removeItem(companyId: UUID, productId: UUID): Promise<ServiceResult<Cart>> {
  return setQuantity(companyId, productId, 0);
}

export async function clear(companyId: UUID): Promise<ServiceResult<Cart>> {
  const cart = await getOrCreateCart(companyId);
  await db.cartItem.deleteMany({ where: { cartId: cart.id } });
  return ok({ id: cart.id, companyId, items: [] });
}
