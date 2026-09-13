import { NextResponse, type NextRequest } from 'next/server';
import { getProductBySlug } from '@/server/services/catalog.service';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/products/slug/[slug]'>) {
  const { slug } = await ctx.params;
  const result = await getProductBySlug(slug);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json(result.data);
}
