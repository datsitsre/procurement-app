import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { listInvoices } from '@/server/services/invoices.service';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/invoices'>) {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await listInvoices(companyId);
  return NextResponse.json(result.ok ? result.data : []);
}
