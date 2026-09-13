import { NextResponse } from 'next/server';
import { listCategories } from '@/server/services/catalog.service';

/** Public read - categories aren't tenant-scoped or sensitive, the same way the mock's
 *  listCategories() never checked auth either. */
export async function GET() {
  const result = await listCategories();
  return NextResponse.json(result.ok ? result.data : []);
}
