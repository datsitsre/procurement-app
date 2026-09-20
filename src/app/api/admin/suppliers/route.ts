import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { createSupplierAsPlatformAdmin, listAllSuppliersForAdmin } from '@/server/services/catalog.service';
import { NewPlatformSupplierSchema } from '@/server/validation/catalog';
import { withErrorHandling } from '@/server/errors';

/** The platform Suppliers management table (Phase 27 - Platform Command Center). Gated on
 *  PLATFORM_CATALOG_MODERATE - supplier onboarding/quality-control data, not a company's
 *  transaction data, so (like /api/suppliers/moderation) this is available to PLATFORM_MANAGER
 *  too, not just PLATFORM_SUPER_ADMIN/legacy PLATFORM_ADMIN. */
export const GET = withErrorHandling("/api/admin/suppliers", async (request: NextRequest) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_CATALOG_MODERATE);
  if (!access.ok) return access.response;

  const result = await listAllSuppliersForAdmin();
  return NextResponse.json(result.ok ? result.data : []);
});

/** Creates a new supplier as a platform administrator (Phase 28, section 10) - gated on
 *  PLATFORM_SUPPLIERS_CREATE, deliberately separate from PLATFORM_CATALOG_MODERATE (which
 *  governs moderating *already-existing* suppliers, not bringing a new one onto the platform) -
 *  PLATFORM_MANAGER holds the former but not this. */
export const POST = withErrorHandling("/api/admin/suppliers", async (request: NextRequest) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_SUPPLIERS_CREATE);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = NewPlatformSupplierSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const result = await createSupplierAsPlatformAdmin(parsed.data, { userId: access.auth.userId, name: access.auth.userName });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
});
