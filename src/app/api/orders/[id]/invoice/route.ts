import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { getOrder } from '@/server/services/orders.service';
import { getInvoiceForOrder } from '@/server/services/invoices.service';
import { ownsRecord } from '@/services/base';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/orders/[id]/invoice'>) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const { id } = await ctx.params;
  const order = await getOrder(id);
  if (!order.ok || !ownsRecord(auth.tenant, order.data.companyId, order.data.supplierId)) {
    return NextResponse.json({ error: 'That order could not be found.' }, { status: 404 });
  }

  const result = await getInvoiceForOrder(id);
  return NextResponse.json(result.ok ? result.data : null);
}
