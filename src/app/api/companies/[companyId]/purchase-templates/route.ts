import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { enforceRateLimit } from '@/server/auth/rate-limit';
import { createTemplate, listTemplates } from '@/server/services/template.service';
import { NewPurchaseTemplateSchema } from '@/server/validation/procurement-backend';
import { withErrorHandling } from '@/server/errors';

export const GET = withErrorHandling("/api/companies/[companyId]/purchase-templates", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/purchase-templates'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await listTemplates(companyId);
  return NextResponse.json(result.ok ? result.data : []);
});

export const POST = withErrorHandling("/api/companies/[companyId]/purchase-templates", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/purchase-templates'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.PURCHASE_REQUEST_CREATE);
  if (!access.ok) return access.response;

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const limited = enforceRateLimit('procurementWrite', `${access.auth.userId}:${ip}`);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const parsed = NewPurchaseTemplateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });

  const result = await createTemplate(
    { companyId, name: parsed.data.name, items: parsed.data.items, createdByUserId: access.auth.userId },
    { id: access.auth.userId, name: access.auth.userName },
  );
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
});
