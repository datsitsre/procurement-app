import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { requireSupplierAccess } from '@/server/auth/require';
import { getRfq, listQuotesForRfq, submitQuote } from '@/server/services/procurement.service';
import { SubmitQuoteSchema } from '@/server/validation/procurement';
import { ownsRecord } from '@/services/base';

/** Quotes carry competitor pricing, so - unlike the mock, which never checked - this only
 *  returns them to the RFQ's own buyer company or the invited supplier who submitted, the same
 *  dual-owner check as GET /api/rfqs/[rfqId]. */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/rfqs/[rfqId]/quotes'>) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const { rfqId } = await ctx.params;
  const rfq = await getRfq(rfqId);
  if (!rfq.ok) return NextResponse.json({ error: 'That RFQ could not be found.' }, { status: 404 });

  const isInvitedSupplier = rfq.data.suppliers.some((s) => s.supplierId === auth.tenant.supplierId);
  if (!ownsRecord(auth.tenant, rfq.data.companyId) && !isInvitedSupplier) {
    return NextResponse.json({ error: 'That RFQ could not be found.' }, { status: 404 });
  }

  const result = await listQuotesForRfq(rfqId);
  if (!result.ok) return NextResponse.json([], { status: 200 });

  // An invited supplier that isn't the buyer only ever sees its own quote, never a competitor's.
  const quotes = isInvitedSupplier && !ownsRecord(auth.tenant, rfq.data.companyId)
    ? result.data.filter((q) => q.supplierId === auth.tenant.supplierId)
    : result.data;
  return NextResponse.json(quotes);
}

export async function POST(request: NextRequest, ctx: RouteContext<'/api/rfqs/[rfqId]/quotes'>) {
  const body = await request.json().catch(() => null);
  const supplierId = typeof body?.supplierId === 'string' ? body.supplierId : '';

  const access = await requireSupplierAccess(request, supplierId, Permission.RFQ_RESPOND);
  if (!access.ok) return access.response;

  const parsed = SubmitQuoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const { rfqId } = await ctx.params;
  const result = await submitQuote({ ...parsed.data, rfqId, supplierId });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
}
