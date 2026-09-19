import { NextResponse } from 'next/server';
import { listCategories } from '@/server/services/catalog.service';
import { withErrorHandling } from '@/server/errors';

/** Public read - categories aren't tenant-scoped or sensitive, the same way the mock's
 *  listCategories() never checked auth either. */
export const GET = withErrorHandling("/api/categories", async () => {
  const result = await listCategories();
  return NextResponse.json(result.ok ? result.data : []);
});
