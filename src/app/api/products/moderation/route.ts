import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { listAllProductsForModeration } from '@/server/services/catalog.service';

/** Every product across every supplier, unfiltered by moderation status - the admin
 *  product-moderation queue (section 46). */
export async function GET(request: NextRequest) {
  const access = await requireAuthenticated(request, Permission.PLATFORM_MANAGE);
  if (!access.ok) return access.response;

  const result = await listAllProductsForModeration();
  return NextResponse.json(result.ok ? result.data : []);
}
