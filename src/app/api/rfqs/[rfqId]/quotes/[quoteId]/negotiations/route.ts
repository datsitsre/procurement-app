import { NextResponse, type NextRequest } from 'next/server';
import { Permission, hasPermission } from '@/config/rbac';
import { getAuthContext, unauthorized, forbidden } from '@/server/auth/context';
import { isSameOrigin } from '@/server/auth/csrf';
import { getRfq, listNegotiationMessages, listQuotesForRfq, sendNegotiationMessage } from '@/server/services/procurement.service';
import { SendNegotiationMessageSchema } from '@/server/validation/procurement';
import { ownsRecord } from '@/services/base';

type Ctx = RouteContext<'/api/rfqs/[rfqId]/quotes/[quoteId]/negotiations'>;

export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const { rfqId, quoteId } = await ctx.params;
  const rfq = await getRfq(rfqId);
  if (!rfq.ok) return NextResponse.json({ error: 'That RFQ could not be found.' }, { status: 404 });

  const isInvitedSupplier = rfq.data.suppliers.some((s) => s.supplierId === auth.tenant.supplierId);
  if (!ownsRecord(auth.tenant, rfq.data.companyId) && !isInvitedSupplier) {
    return NextResponse.json({ error: 'That RFQ could not be found.' }, { status: 404 });
  }

  const result = await listNegotiationMessages(rfqId, quoteId);
  return NextResponse.json(result.ok ? result.data : []);
}

/** Either side of the negotiation can post here - the RFQ's own buyer company, or the invited
 *  supplier who owns this specific quote (never a competing supplier also invited to the same
 *  RFQ, even though they can see the RFQ itself). `senderRole` is resolved here, from who the
 *  authenticated caller actually is, and handed to the service - never trusted from the request
 *  body. */
export async function POST(request: NextRequest, ctx: Ctx) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });

  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const { rfqId, quoteId } = await ctx.params;
  const rfq = await getRfq(rfqId);
  if (!rfq.ok) return NextResponse.json({ error: 'That RFQ could not be found.' }, { status: 404 });

  const quotes = await listQuotesForRfq(rfqId);
  const quote = quotes.ok ? quotes.data.find((q) => q.id === quoteId) : undefined;
  if (!quote) return NextResponse.json({ error: 'That quote could not be found.' }, { status: 404 });

  const isBuyer = ownsRecord(auth.tenant, rfq.data.companyId);
  const isQuoteOwner = auth.tenant.supplierId === quote.supplierId;

  let senderRole: 'BUYER' | 'SUPPLIER';
  if (isBuyer && auth.role && hasPermission(auth.role, Permission.RFQ_CREATE)) {
    senderRole = 'BUYER';
  } else if (isQuoteOwner && auth.role && hasPermission(auth.role, Permission.RFQ_RESPOND)) {
    senderRole = 'SUPPLIER';
  } else {
    return forbidden();
  }

  const body = await request.json().catch(() => null);
  const parsed = SendNegotiationMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const result = await sendNegotiationMessage(
    rfqId,
    quoteId,
    parsed.data.message,
    auth.userId,
    senderRole,
    parsed.data.proposedPrice,
    parsed.data.proposedQuantity,
  );
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
}
