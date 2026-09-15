import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { enforceRateLimit } from '@/server/auth/rate-limit';
import { getInvoice, payInvoice } from '@/server/services/invoices.service';
import { logger } from '@/server/observability/logger';
import { PayInvoiceSchema } from '@/server/validation/orders';

/** Only the invoice's own billed company may pay it - without this, any authenticated buyer
 *  with PAYMENTS_CREATE could pay off (and mark PAID) an invoice belonging to a company they
 *  have no relationship to at all (section 9.2).
 *
 *  High-risk domain (section 12/24) - logs invoiceId/companyId/method/status/errorCode/duration
 *  for every attempt, but never `details` (the payment method's own raw fields - a phone number,
 *  a card fragment, provider-specific data) and never a full request body. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/invoices/[id]/pay'>) {
  const startedAt = Date.now();
  const requestId = request.headers.get('x-request-id') ?? undefined;
  const route = '/api/invoices/[id]/pay';
  function complete(status: number, fields: { errorCode?: string; userId?: string; companyId?: string; method?: string } = {}) {
    logger.info('invoice payment attempt completed', { requestId, route, method: 'POST', invoiceId: id, status, durationMs: Date.now() - startedAt, ...fields });
  }

  const { id } = await ctx.params;

  const invoice = await getInvoice(id);
  if (!invoice.ok) {
    complete(404, { errorCode: 'INVOICE_NOT_FOUND' });
    return NextResponse.json({ error: 'That invoice could not be found.' }, { status: 404 });
  }

  const access = await requireCompanyAccess(request, invoice.data.companyId, Permission.PAYMENTS_CREATE);
  if (!access.ok) {
    complete(access.response.status, { errorCode: 'ACCESS_DENIED', companyId: invoice.data.companyId });
    return access.response;
  }

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const limited = enforceRateLimit('payment', `${access.auth.userId}:${ip}`);
  if (limited) {
    complete(429, { errorCode: 'RATE_LIMITED', userId: access.auth.userId, companyId: invoice.data.companyId });
    return limited;
  }

  const body = await request.json().catch(() => null);
  const parsed = PayInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    complete(422, { errorCode: 'INVALID_REQUEST', userId: access.auth.userId, companyId: invoice.data.companyId });
    return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });
  }

  const result = await payInvoice(id, parsed.data.method, parsed.data.details, parsed.data.idempotencyKey);
  if (!result.ok) {
    complete(422, { errorCode: result.error.code, userId: access.auth.userId, companyId: invoice.data.companyId, method: parsed.data.method });
    return NextResponse.json({ error: result.error.message }, { status: 422 });
  }
  complete(200, { userId: access.auth.userId, companyId: invoice.data.companyId, method: parsed.data.method });
  return NextResponse.json(result.data);
}
