import { NextResponse, type NextRequest } from 'next/server';
import { Permission, hasPermission } from '@/config/rbac';
import { getAuthContext, unauthorized, forbidden } from '@/server/auth/context';
import { isSameOrigin } from '@/server/auth/csrf';
import { getProductById, updateProduct } from '@/server/services/catalog.service';
import { ProductPatchSchema } from '@/server/validation/catalog';
import { ownsRecord } from '@/services/base';
import { withErrorHandling } from '@/server/errors';

/** Public read - product detail pages are buyer-facing and unauthenticated. */
export const GET = withErrorHandling("/api/products/[productId]", async (request: NextRequest, ctx: RouteContext<'/api/products/[productId]'>) => {
  const { productId } = await ctx.params;
  const result = await getProductById(productId);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json(result.data);
});

/** `caller` must own the product being edited (its supplierId) or be a platform admin -
 *  PRODUCTS_MANAGE alone only proves the role can manage *some* supplier's products, not that
 *  this one is theirs (section 9.2/9.3's "supplier modifying another supplier's product"). The
 *  product's own supplierId isn't known until it's fetched, so - unlike requireCompanyAccess/
 *  requireSupplierAccess, which check a path-segment id - this route checks ownership against
 *  the fetched record itself. */
export const PATCH = withErrorHandling("/api/products/[productId]", async (request: NextRequest, ctx: RouteContext<'/api/products/[productId]'>) => {
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
  const parsed = ProductPatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const result = await updateProduct(productId, existing.data.supplierId, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json(result.data);
});
