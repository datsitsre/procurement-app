import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { listAllCompanies } from '@/server/services/company.service';
import { withErrorHandling } from '@/server/errors';

/** The platform-wide company directory (Phase 26 follow-up - closes the gap where
 *  /admin/companies read from a frontend-only localStorage mock instead of a real endpoint).
 *
 *  Gated on PLATFORM_TRANSACTIONS_ACCESS, exactly like the other cross-company admin lists
 *  (`/api/orders`, `/api/payments`, `/api/disputes`, `/api/analytics`) - granted only to
 *  PLATFORM_SUPER_ADMIN and the legacy PLATFORM_ADMIN, never PLATFORM_MANAGER (rbac.ts's own
 *  comment on that permission). A full roster of every real buyer company is exactly the kind of
 *  "another company's business data" that permission exists to gate - PLATFORM_MANAGER getting
 *  this endpoint "for free" just because it exists would be the same regression Section 5 of the
 *  access-control audit already closed for orders/payments/disputes. */
export const GET = withErrorHandling("/api/admin/companies", async (request: NextRequest) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_TRANSACTIONS_ACCESS);
  if (!access.ok) return access.response;

  const { auditCrossCompanyRead } = await import('@/server/services/audit.service');
  await auditCrossCompanyRead(access.auth, 'Company', 'LIST');

  const result = await listAllCompanies();
  return NextResponse.json(result.ok ? result.data : []);
});
