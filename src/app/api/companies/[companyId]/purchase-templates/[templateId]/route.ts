import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { enforceRateLimit } from '@/server/auth/rate-limit';
import { removeTemplate } from '@/server/services/template.service';
import { withErrorHandling } from '@/server/errors';

export const DELETE = withErrorHandling("/api/companies/[companyId]/purchase-templates/[templateId]", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/purchase-templates/[templateId]'>) => {
  const { companyId, templateId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.PURCHASE_REQUEST_CREATE);
  if (!access.ok) return access.response;

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const limited = enforceRateLimit('procurementWrite', `${access.auth.userId}:${ip}`);
  if (limited) return limited;

  const result = await removeTemplate(templateId, companyId, { id: access.auth.userId, name: access.auth.userName });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json({ ok: true });
});
