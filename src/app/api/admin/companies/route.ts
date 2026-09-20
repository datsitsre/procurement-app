import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { createCompanyAsPlatformAdmin, listAllCompanies } from '@/server/services/company.service';
import { NewPlatformCompanySchema } from '@/server/validation/company';
import { withErrorHandling } from '@/server/errors';

/** The platform-wide company directory (Phase 26 follow-up - closes the gap where
 *  /admin/companies read from a frontend-only localStorage mock instead of a real endpoint).
 *
 *  Gated on PLATFORM_COMPANIES_VIEW (Phase 28 - a dedicated organization-management permission,
 *  replacing the PLATFORM_TRANSACTIONS_ACCESS gate this route used before). The actual roles
 *  that pass are unchanged - PLATFORM_SUPER_ADMIN/legacy PLATFORM_ADMIN only, never
 *  PLATFORM_MANAGER - see that permission's own doc comment in rbac.ts for why a full company
 *  roster still isn't "free" platform-operations metadata. */
export const GET = withErrorHandling("/api/admin/companies", async (request: NextRequest) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_COMPANIES_VIEW);
  if (!access.ok) return access.response;

  const { auditCrossCompanyRead } = await import('@/server/services/audit.service');
  await auditCrossCompanyRead(access.auth, 'Company', 'LIST');

  const result = await listAllCompanies();
  return NextResponse.json(result.ok ? result.data : []);
});

/** Creates a new buyer company as a platform administrator (Phase 28, section 5) - distinct
 *  from a prospective customer's own self-registration (POST /api/auth/register), which always
 *  starts PENDING_APPROVAL. This is a platform admin directly vouching for and creating a
 *  company on someone's behalf - it's immediately usable (isBuyer: true), with no membership of
 *  its own yet (this endpoint deliberately does not create a User/CompanyMembership - see
 *  createCompanyAsPlatformAdmin's own comment on why). */
export const POST = withErrorHandling("/api/admin/companies", async (request: NextRequest) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_COMPANIES_CREATE);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = NewPlatformCompanySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const result = await createCompanyAsPlatformAdmin(parsed.data, { userId: access.auth.userId, name: access.auth.userName });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
});
