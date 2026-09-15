import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { enforceRateLimit } from '@/server/auth/rate-limit';
import { getInvoice, payInvoice } from '@/server/services/invoices.service';
import { PayInvoiceSchema } from '@/server/validation/orders';

/** Only the invoice's own billed company may pay it - without this, any authenticated buyer
 *  with PAYMENTS_CREATE could pay off (and mark PAID) an invoice belonging to a company they
 *  have no relationship to at all (section 9.2). */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/invoices/[id]/pay'>) {
  const { id } = await ctx.params;

  const invoice = await getInvoice(id);
  if (!invoice.ok) return NextResponse.json({ error: 'That invoice could not be found.' }, { status: 404 });

  const access = await requireCompanyAccess(request, invoice.data.companyId, Permission.PAYMENTS_CREATE);
  if (!access.ok) return access.response;

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const limited = enforceRateLimit('payment', `${access.auth.userId}:${ip}`);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const parsed = PayInvoiceSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const result = await payInvoice(id, parsed.data.method, parsed.data.details, parsed.data.idempotencyKey);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
}
