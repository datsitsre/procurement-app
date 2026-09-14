import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { getPurchaseOrder } from '@/server/services/purchase-order.service';
import { createFromPurchaseOrder } from '@/server/services/orders.service';
import { CheckoutSchema } from '@/server/validation/orders';

/** Only the purchase order's own buyer company may check it out. Builds the real Order (and
 *  marks the PurchaseOrder converted) in one transaction (Phase 14, Stage 7) - payment itself is
 *  still charged client-side via the mock payment.service.ts before this is called (Stage 8's
 *  job); `paymentStatus` here is derived from `method`, never trusted from the client. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/purchase-orders/[id]/checkout'>) {
  const { id } = await ctx.params;

  const po = await getPurchaseOrder(id);
  if (!po.ok) return NextResponse.json({ error: 'That purchase order could not be found.' }, { status: 404 });

  const access = await requireCompanyAccess(request, po.data.companyId, Permission.ORDERS_CREATE);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = CheckoutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const result = await createFromPurchaseOrder(po.data, parsed.data.method);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
}
