import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { updateTeamMember } from '@/server/services/company.service';
import { UpdateTeamMemberSchema } from '@/server/validation/company';
import { withErrorHandling } from '@/server/errors';

/** Edits an existing team member's role/department, and optionally their own name/avatar - the
 *  Team page's "Edit" action. Same USERS_MANAGE permission and same-origin (CSRF, applied by
 *  requireCompanyAccess itself for non-GET methods) as adding one. */
export const PATCH = withErrorHandling("/api/companies/[companyId]/team/[userId]", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/team/[userId]'>) => {
  const { companyId, userId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.USERS_MANAGE);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = UpdateTeamMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const result = await updateTeamMember(companyId, userId, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
});
