import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { getRfq } from '@/server/services/procurement.service';
import { ownsRecord } from '@/services/base';

/** An RFQ has two different kinds of legitimate owner - the buyer company that created it, or
 *  any supplier it invited - so, like the product PATCH route, ownership can't be checked
 *  against a path segment; it's only known once the record itself is fetched. */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/rfqs/[rfqId]'>) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const { rfqId } = await ctx.params;
  const result = await getRfq(rfqId);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });

  const isInvitedSupplier = result.data.suppliers.some((s) => s.supplierId === auth.tenant.supplierId);
  if (!ownsRecord(auth.tenant, result.data.companyId) && !isInvitedSupplier) {
    return NextResponse.json({ error: 'That RFQ could not be found.' }, { status: 404 });
  }

  return NextResponse.json(result.data);
}
