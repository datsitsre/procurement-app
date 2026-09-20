import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { getSupplierById } from '@/server/services/catalog.service';
import { listTeamMembers } from '@/server/services/company.service';
import { withErrorHandling } from '@/server/errors';

/** A specific supplier's own member list, from the platform admin side (Phase 28, section 14) -
 *  same shape and reasoning as GET /api/admin/companies/[companyId]/members: gated on
 *  PLATFORM_MEMBERS_VIEW, scoped to one already-identified supplier, never a platform-wide
 *  directory. A SupplierProfile's members are really its underlying Company's memberships
 *  (SUPPLIER_ADMIN/SUPPLIER_STAFF), so this resolves supplierId -> companyId first. */
export const GET = withErrorHandling(
  "/api/admin/suppliers/[supplierId]/members",
  async (request: NextRequest, ctx: RouteContext<'/api/admin/suppliers/[supplierId]/members'>) => {
    const access = await requireAuthenticated(request, Permission.PLATFORM_MEMBERS_VIEW);
    if (!access.ok) return access.response;

    const { supplierId } = await ctx.params;
    const supplier = await getSupplierById(supplierId);
    if (!supplier.ok) return NextResponse.json({ error: supplier.error.message }, { status: 404 });

    const { auditCrossCompanyRead } = await import('@/server/services/audit.service');
    await auditCrossCompanyRead(access.auth, 'SupplierMembers', supplierId, supplier.data.companyId);

    const result = await listTeamMembers(supplier.data.companyId);
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
