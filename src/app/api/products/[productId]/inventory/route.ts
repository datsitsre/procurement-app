import { NextResponse, type NextRequest } from 'next/server';
import { Permission, hasPermission } from '@/config/rbac';
import { getAuthContext, unauthorized, forbidden } from '@/server/auth/context';
import { isSameOrigin } from '@/server/auth/csrf';
import { getProductById, updateInventory } from '@/server/services/catalog.service';
import { InventoryPatchSchema } from '@/server/validation/catalog';
import { ownsRecord } from '@/services/base';
import { withErrorHandling } from '@/server/errors';

/** Adjusts stock/threshold at one warehouse (section 35) - adds the warehouse's inventory
 *  record if the product isn't stocked there yet. Same ownership rule as PATCH /products/
 *  [productId]: the product's own supplierId (not a path segment) decides who may touch it. */
export const PATCH = withErrorHandling("/api/products/[productId]/inventory", async (request: NextRequest, ctx: RouteContext<'/api/products/[productId]/inventory'>) => {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });

  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();
  if (!auth.role || !hasPermission(auth.role, Permission.PRODUCTS_MANAGE)) return forbidden();

  const { productId } = await ctx.params;
  const existing = await getProductById(productId);
  if (!existing.ok || !ownsRecord(auth.tenant, undefined, existing.data.supplierId)) {
    return NextResponse.json({ error: 'That product could not be found.' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = InventoryPatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const result = await updateInventory(productId, existing.data.supplierId, parsed.data.warehouseId, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json(result.data);
});
