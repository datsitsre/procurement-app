import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { createRfq, listRfqs } from '@/server/services/procurement.service';
import { NewRfqSchema } from '@/server/validation/procurement';

/** A buyer company's own RFQs, for the RFQ list page - `companyId` comes from the query string
 *  but is re-checked against the caller's own tenant, never trusted outright (section 6). */
export async function GET(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get('companyId') ?? '';
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await listRfqs(companyId);
  return NextResponse.json(result.ok ? result.data : []);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';

  const access = await requireCompanyAccess(request, companyId, Permission.RFQ_CREATE);
  if (!access.ok) return access.response;

  const parsed = NewRfqSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const result = await createRfq({ ...parsed.data, companyId, createdByUserId: access.auth.userId });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
}
