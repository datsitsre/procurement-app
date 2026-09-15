import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { addTeamMember, listTeamMembers } from '@/server/services/company.service';
import { NewTeamMemberSchema } from '@/server/validation/company';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/team'>) {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.USERS_MANAGE);
  if (!access.ok) return access.response;

  const result = await listTeamMembers(companyId);
  return NextResponse.json(result.ok ? result.data : []);
}

// requireCompanyAccess already applies the same-origin (CSRF) check for any non-GET method -
// see its own comment - so this route doesn't need its own.
export async function POST(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/team'>) {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.USERS_MANAGE);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = NewTeamMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const result = await addTeamMember(companyId, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
}
