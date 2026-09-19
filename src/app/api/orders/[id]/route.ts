import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { getOrder } from '@/server/services/orders.service';
import { ownsRecord } from '@/services/base';
import { withErrorHandling } from '@/server/errors';

/** An order's owner (buyer company or fulfilling supplier) isn't known until it's fetched, so -
 *  like the purchase order/RFQ routes - ownership is checked against the fetched record. */
export const GET = withErrorHandling("/api/orders/[id]", async (request: NextRequest, ctx: RouteContext<'/api/orders/[id]'>) => {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const { id } = await ctx.params;
  const result = await getOrder(id);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  if (!ownsRecord(auth.tenant, result.data.companyId, result.data.supplierId)) {
    return NextResponse.json({ error: 'That order could not be found.' }, { status: 404 });
  }

  const { auditCrossCompanyRead } = await import('@/server/services/audit.service');
  await auditCrossCompanyRead(auth, 'Order', id, result.data.companyId);

  return NextResponse.json(result.data);
});
