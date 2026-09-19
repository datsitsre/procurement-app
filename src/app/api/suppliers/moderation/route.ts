import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { listAllSuppliers } from '@/server/services/catalog.service';
import { withErrorHandling } from '@/server/errors';

/** Every supplier regardless of verification status - the admin verification queue (section
 *  46), same shape as GET /api/products/moderation. */
export const GET = withErrorHandling("/api/suppliers/moderation", async (request: NextRequest) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_MANAGE);
  if (!access.ok) return access.response;

  const result = await listAllSuppliers();
  return NextResponse.json(result.ok ? result.data : []);
});
