import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { getInvoice } from '@/server/services/invoices.service';
import { ownsRecord } from '@/services/base';
import { withErrorHandling } from '@/server/errors';

/** An invoice's owner (billed company or issuing supplier) isn't known until it's fetched, so -
 *  like the order/purchase-order routes - ownership is checked against the fetched record. */
export const GET = withErrorHandling("/api/invoices/[id]", async (request: NextRequest, ctx: RouteContext<'/api/invoices/[id]'>) => {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const { id } = await ctx.params;
  const result = await getInvoice(id);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  if (!ownsRecord(auth.tenant, result.data.companyId, result.data.supplierId)) {
    return NextResponse.json({ error: 'That invoice could not be found.' }, { status: 404 });
  }

  return NextResponse.json(result.data);
});
