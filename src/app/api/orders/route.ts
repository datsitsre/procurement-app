import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { parsePagination } from '@/server/pagination';
import { listAllOrders } from '@/server/services/orders.service';
import { withErrorHandling } from '@/server/errors';

/** Every order across every company - the platform admin overview (section 46), paginated
 *  (?page=&pageSize=, default 25, max 100 - Phase 16). */
export const GET = withErrorHandling("/api/orders", async (request: NextRequest) => {
  // Cross-company order data - PLATFORM_SUPER_ADMIN (and legacy PLATFORM_ADMIN) only.
  const access = await requireAuthenticated(request, Permission.PLATFORM_TRANSACTIONS_ACCESS);
  if (!access.ok) return access.response;

  const { auditCrossCompanyRead } = await import('@/server/services/audit.service');
  await auditCrossCompanyRead(access.auth, 'Order', 'LIST');

  const pagination = parsePagination(request);
  const result = await listAllOrders(pagination);
  return NextResponse.json(result.ok ? result.data : { items: [], total: 0, page: pagination.page, pageSize: pagination.pageSize });
});
