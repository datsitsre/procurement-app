import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { updateCompanyAsPlatformAdmin } from '@/server/services/company.service';
import { PlatformCompanyUpdateSchema } from '@/server/validation/company';
import { withErrorHandling } from '@/server/errors';

/** A platform administrator editing an existing company's profile (Phase 28, section 6) -
 *  gated on PLATFORM_COMPANIES_UPDATE (Super Admin/legacy Admin only), distinct from
 *  PATCH /api/companies/[companyId] (SETTINGS_MANAGE - that company's own OWNER/ADMIN editing
 *  their own profile). Never trusts a client-supplied id/ownership/membership/role field - the
 *  Zod schema only accepts the same plain profile-metadata fields the self-service route does. */
export const PATCH = withErrorHandling("/api/admin/companies/[companyId]", async (request: NextRequest, ctx: RouteContext<'/api/admin/companies/[companyId]'>) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_COMPANIES_UPDATE);
  if (!access.ok) return access.response;

  const { companyId } = await ctx.params;
  const body = await request.json().catch(() => null);
  const parsed = PlatformCompanyUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const result = await updateCompanyAsPlatformAdmin(companyId, parsed.data, { userId: access.auth.userId, name: access.auth.userName });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json(result.data);
});
