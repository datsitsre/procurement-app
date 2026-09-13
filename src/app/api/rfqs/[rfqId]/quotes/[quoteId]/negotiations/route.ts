import { NextResponse, type NextRequest } from 'next/server';
import { Permission, hasPermission } from '@/config/rbac';
import { getAuthContext, unauthorized, forbidden } from '@/server/auth/context';
import { isSameOrigin } from '@/server/auth/csrf';
import { getRfq, listNegotiationMessages, sendNegotiationMessage } from '@/server/services/procurement.service';
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

/** Negotiation is buyer-initiated only in this build - the supplier side replies with a canned
 *  acknowledgement (see the mock's own comment, ported unchanged into the server service). */
export async function POST(request: NextRequest, ctx: Ctx) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });

  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();
  if (!auth.role || !hasPermission(auth.role, Permission.RFQ_CREATE)) return forbidden();

  const { rfqId, quoteId } = await ctx.params;
  const rfq = await getRfq(rfqId);
  if (!rfq.ok || !ownsRecord(auth.tenant, rfq.data.companyId)) {
    return NextResponse.json({ error: 'That RFQ could not be found.' }, { status: 404 });
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
    parsed.data.proposedPrice,
    parsed.data.proposedQuantity,
  );
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
}
