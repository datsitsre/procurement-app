import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { parsePagination } from '@/server/pagination';
import { listAllPayments } from '@/server/services/payment.service';

/** Every payment across every company - the platform admin overview (section 46), paginated
 *  (?page=&pageSize=, default 25, max 100 - section 14/15). */
export async function GET(request: NextRequest) {
  const access = await requireAuthenticated(request, Permission.PLATFORM_MANAGE);
  if (!access.ok) return access.response;

  const pagination = parsePagination(request);
  const result = await listAllPayments(pagination);
  return NextResponse.json(result.ok ? result.data : { items: [], total: 0, page: pagination.page, pageSize: pagination.pageSize });
}
