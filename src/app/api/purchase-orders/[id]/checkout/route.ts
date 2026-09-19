import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { getPurchaseOrder } from '@/server/services/purchase-order.service';
import { createFromPurchaseOrder } from '@/server/services/orders.service';
import { CheckoutSchema } from '@/server/validation/orders';
import { withErrorHandling } from '@/server/errors';

/** Only the purchase order's own buyer company may check it out. Charges payment (section 26's
 *  real provider abstraction), then builds the Order, its Invoice, and marks the PurchaseOrder
 *  converted, all in one transaction (Phase 14, Stage 8) - a checkout can genuinely fail now (an
 *  invalid card, insufficient credit, ...), and nothing is left half-done either way. */
export const POST = withErrorHandling("/api/purchase-orders/[id]/checkout", async (request: NextRequest, ctx: RouteContext<'/api/purchase-orders/[id]/checkout'>) => {
  const { id } = await ctx.params;

  const po = await getPurchaseOrder(id);
  if (!po.ok) return NextResponse.json({ error: 'That purchase order could not be found.' }, { status: 404 });

  const access = await requireCompanyAccess(request, po.data.companyId, Permission.ORDERS_CREATE);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = CheckoutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const result = await createFromPurchaseOrder(po.data, parsed.data.method, parsed.data.details, parsed.data.idempotencyKey);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
});
