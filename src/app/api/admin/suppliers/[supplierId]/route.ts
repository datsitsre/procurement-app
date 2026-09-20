import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { updateSupplierAsPlatformAdmin } from '@/server/services/catalog.service';
import { PlatformSupplierUpdateSchema } from '@/server/validation/catalog';
import { withErrorHandling } from '@/server/errors';

/** A platform administrator editing an existing supplier's profile (Phase 28, section 11) -
 *  gated on PLATFORM_SUPPLIERS_UPDATE (Super Admin/legacy Admin only). Verification status
 *  (VERIFIED/SUSPENDED/REJECTED) is NOT editable here - that stays on its own dedicated route,
 *  PATCH /api/suppliers/[supplierId]/verification. */
export const PATCH = withErrorHandling("/api/admin/suppliers/[supplierId]", async (request: NextRequest, ctx: RouteContext<'/api/admin/suppliers/[supplierId]'>) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_SUPPLIERS_UPDATE);
  if (!access.ok) return access.response;

  const { supplierId } = await ctx.params;
  const body = await request.json().catch(() => null);
  const parsed = PlatformSupplierUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const result = await updateSupplierAsPlatformAdmin(supplierId, parsed.data, { userId: access.auth.userId, name: access.auth.userName });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json(result.data);
});
