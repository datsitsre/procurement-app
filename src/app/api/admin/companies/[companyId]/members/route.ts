import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { listTeamMembers } from '@/server/services/company.service';
import { withErrorHandling } from '@/server/errors';

/** A specific company's own member list, from the platform admin side (Phase 28, section 14) -
 *  gated on PLATFORM_MEMBERS_VIEW (Super Admin/legacy Admin only), deliberately scoped to one
 *  already-identified company, never a platform-wide "every user at every company" directory
 *  (see rbac.ts's own comment on that permission, and platformUsers.service.ts's established
 *  reasoning for the same distinction). Reuses the exact same `listTeamMembers` a company's own
 *  Team page calls - the DTO already excludes passwordHash/tokens/secrets (server/dto/company.ts)
 *  - and maps it down to only what section 14 asks for: name, email, role, status, joined date. */
export const GET = withErrorHandling(
  "/api/admin/companies/[companyId]/members",
  async (request: NextRequest, ctx: RouteContext<'/api/admin/companies/[companyId]/members'>) => {
    const access = await requireAuthenticated(request, Permission.PLATFORM_MEMBERS_VIEW);
    if (!access.ok) return access.response;

    const { companyId } = await ctx.params;

    const { auditCrossCompanyRead } = await import('@/server/services/audit.service');
    await auditCrossCompanyRead(access.auth, 'CompanyMembers', companyId, companyId);

    const result = await listTeamMembers(companyId);
    if (!result.ok) return NextResponse.json([], { status: 200 });

    return NextResponse.json(
      result.data.map((t) => ({
        userId: t.user.id,
        name: t.user.name,
        email: t.user.email,
        role: t.membership.role,
        status: t.membership.status,
        joinedAt: t.membership.joinedAt,
      })),
    );
  },
);
