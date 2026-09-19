import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { getPurchaseRequest } from '@/server/services/procurement.service';
import { listForPurchaseRequest } from '@/server/services/purchase-order.service';
import { ownsRecord } from '@/services/base';
import { withErrorHandling } from '@/server/errors';

export const GET = withErrorHandling("/api/purchase-requests/[id]/purchase-orders", async (request: NextRequest, ctx: RouteContext<'/api/purchase-requests/[id]/purchase-orders'>) => {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const { id } = await ctx.params;
  const pr = await getPurchaseRequest(id);
  if (!pr.ok || !ownsRecord(auth.tenant, pr.data.companyId)) {
    return NextResponse.json({ error: 'That purchase request could not be found.' }, { status: 404 });
  }

  const result = await listForPurchaseRequest(id);
  return NextResponse.json(result.ok ? result.data : []);
});
