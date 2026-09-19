import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { listAllSuppliers } from '@/server/services/catalog.service';
import { withErrorHandling } from '@/server/errors';

/** Every supplier regardless of verification status - the admin verification queue (section
 *  46), same shape as GET /api/products/moderation. */
export const GET = withErrorHandling("/api/suppliers/moderation", async (request: NextRequest) => {
  // Supplier onboarding quality control, not a company's transaction data - available to
  // PLATFORM_MANAGER too.
  const access = await requireAuthenticated(request, Permission.PLATFORM_CATALOG_MODERATE);
  if (!access.ok) return access.response;

  const result = await listAllSuppliers();
  return NextResponse.json(result.ok ? result.data : []);
});
