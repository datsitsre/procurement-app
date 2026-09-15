import { NextResponse, type NextRequest } from 'next/server';
import { getSupplierBySlug } from '@/server/services/catalog.service';

/** Public read, same precedent as GET /api/suppliers and GET /api/products/slug/[slug]. Does
 *  NOT filter by verification status itself - a buyer following a link to a supplier that was
 *  since suspended should see why, not a generic 404 (getSupplierBySlug returns whatever
 *  verification state the supplier is actually in; the page decides what to show for it). */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/suppliers/slug/[slug]'>) {
  const { slug } = await ctx.params;
  const result = await getSupplierBySlug(slug);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json(result.data);
}
