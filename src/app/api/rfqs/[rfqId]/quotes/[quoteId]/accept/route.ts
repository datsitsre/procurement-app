import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { acceptQuote, getRfq } from '@/server/services/procurement.service';

/** Only the RFQ's own buyer company may accept one of its quotes. Returns the real RFQ/Quote
 *  DTOs so the client can hand them to the still-mock purchase-order.service.ts, exactly as the
 *  mock acceptQuote used to build its PurchaseOrder from the RFQ/Quote it already had in hand. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/rfqs/[rfqId]/quotes/[quoteId]/accept'>) {
  const { rfqId, quoteId } = await ctx.params;

  const rfq = await getRfq(rfqId);
  if (!rfq.ok) return NextResponse.json({ error: 'That RFQ could not be found.' }, { status: 404 });

  const access = await requireCompanyAccess(request, rfq.data.companyId, Permission.PURCHASE_ORDER_CREATE);
  if (!access.ok) return access.response;

  const result = await acceptQuote(rfqId, quoteId);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json(result.data);
}
