import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { parsePagination } from '@/server/pagination';
import { listAllOrders } from '@/server/services/orders.service';
import { withErrorHandling } from '@/server/errors';

/** Every order across every company - the platform admin overview (section 46), paginated
 *  (?page=&pageSize=, default 25, max 100 - Phase 16). */
export const GET = withErrorHandling("/api/orders", async (request: NextRequest) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_MANAGE);
  if (!access.ok) return access.response;

  const pagination = parsePagination(request);
  const result = await listAllOrders(pagination);
  return NextResponse.json(result.ok ? result.data : { items: [], total: 0, page: pagination.page, pageSize: pagination.pageSize });
});
