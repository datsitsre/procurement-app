import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { getOrder } from '@/server/services/orders.service';
import { ownsRecord } from '@/services/base';

/** An order's owner (buyer company or fulfilling supplier) isn't known until it's fetched, so -
 *  like the purchase order/RFQ routes - ownership is checked against the fetched record. */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/orders/[id]'>) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const { id } = await ctx.params;
  const result = await getOrder(id);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  if (!ownsRecord(auth.tenant, result.data.companyId, result.data.supplierId)) {
    return NextResponse.json({ error: 'That order could not be found.' }, { status: 404 });
  }

  return NextResponse.json(result.data);
}
