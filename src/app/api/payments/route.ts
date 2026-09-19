import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { parsePagination } from '@/server/pagination';
import { listAllPayments } from '@/server/services/payment.service';
import { withErrorHandling } from '@/server/errors';

/** Every payment across every company - the platform admin overview (section 46), paginated
 *  (?page=&pageSize=, default 25, max 100 - section 14/15). */
export const GET = withErrorHandling("/api/payments", async (request: NextRequest) => {
  // Cross-company payment data - PLATFORM_SUPER_ADMIN (and legacy PLATFORM_ADMIN) only.
  // PLATFORM_MANAGER never sees company transactions - see rbac.ts's own comment.
  const access = await requireAuthenticated(request, Permission.PLATFORM_TRANSACTIONS_ACCESS);
  if (!access.ok) return access.response;

  const { auditCrossCompanyRead } = await import('@/server/services/audit.service');
  await auditCrossCompanyRead(access.auth, 'Payment', 'LIST');

  const pagination = parsePagination(request);
  const result = await listAllPayments(pagination);
  return NextResponse.json(result.ok ? result.data : { items: [], total: 0, page: pagination.page, pageSize: pagination.pageSize });
});
