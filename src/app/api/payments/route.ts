import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { listAllPayments } from '@/server/services/payment.service';

/** Every payment across every company - the platform admin overview (section 46). */
export async function GET(request: NextRequest) {
  const access = await requireAuthenticated(request, Permission.PLATFORM_MANAGE);
  if (!access.ok) return access.response;

  const result = await listAllPayments();
  return NextResponse.json(result.ok ? result.data : []);
}
