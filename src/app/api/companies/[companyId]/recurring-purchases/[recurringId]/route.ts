import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { removeRecurringPurchase, setActive } from '@/server/services/recurringPurchase.service';
import { SetRecurringActiveSchema } from '@/server/validation/procurement-backend';

/** Pause/resume - a full status machine (Active/Paused/Completed/Cancelled/Failed) was
 *  considered and rejected as unnecessary scope beyond what the existing UI actually needs: this
 *  app models "paused" as `active: false` and "cancelled" as deletion, matching the mock's own
 *  prior behavior exactly. Failure is tracked per-run, not as a schedule-level status - see
 *  RecurringPurchaseRun. */
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/recurring-purchases/[recurringId]'>) {
  const { companyId, recurringId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.PURCHASE_REQUEST_CREATE);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = SetRecurringActiveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const result = await setActive(recurringId, companyId, parsed.data.active, { id: access.auth.userId, name: access.auth.userName });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json(result.data);
}

export async function DELETE(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/recurring-purchases/[recurringId]'>) {
  const { companyId, recurringId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.PURCHASE_REQUEST_CREATE);
  if (!access.ok) return access.response;

  const result = await removeRecurringPurchase(recurringId, companyId, { id: access.auth.userId, name: access.auth.userName });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json({ ok: true });
}
