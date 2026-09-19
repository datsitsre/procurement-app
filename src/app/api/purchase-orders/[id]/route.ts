import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { getPurchaseOrder } from '@/server/services/purchase-order.service';
import { ownsRecord } from '@/services/base';
import { withErrorHandling } from '@/server/errors';

/** A purchase order's owner (buyer company or fulfilling supplier) isn't known until it's
 *  fetched, so - like the RFQ/product routes - ownership is checked against the fetched record,
 *  not a path segment. */
export const GET = withErrorHandling("/api/purchase-orders/[id]", async (request: NextRequest, ctx: RouteContext<'/api/purchase-orders/[id]'>) => {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const { id } = await ctx.params;
  const result = await getPurchaseOrder(id);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  if (!ownsRecord(auth.tenant, result.data.companyId, result.data.supplierId)) {
    return NextResponse.json({ error: 'That purchase order could not be found.' }, { status: 404 });
  }

  const { auditCrossCompanyRead } = await import('@/server/services/audit.service');
  await auditCrossCompanyRead(auth, 'PurchaseOrder', id, result.data.companyId);

  return NextResponse.json(result.data);
});
