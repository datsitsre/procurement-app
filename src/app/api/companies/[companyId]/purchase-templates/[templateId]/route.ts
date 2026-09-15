import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { removeTemplate } from '@/server/services/template.service';

export async function DELETE(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/purchase-templates/[templateId]'>) {
  const { companyId, templateId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.PURCHASE_REQUEST_CREATE);
  if (!access.ok) return access.response;

  const result = await removeTemplate(templateId, companyId, { id: access.auth.userId, name: access.auth.userName });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json({ ok: true });
}
