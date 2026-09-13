import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { createDepartment, listDepartments } from '@/server/services/company.service';
import { NewDepartmentSchema } from '@/server/validation/company';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/departments'>) {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await listDepartments(companyId);
  return NextResponse.json(result.ok ? result.data : []);
}

export async function POST(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/departments'>) {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.SETTINGS_MANAGE);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = NewDepartmentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const result = await createDepartment(companyId, parsed.data.name);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
}
