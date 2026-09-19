import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { parseCursorPagination } from '@/server/pagination';
import { list } from '@/server/services/notification.service';
import { withErrorHandling } from '@/server/errors';

/** A user's own notifications - always scoped to the caller's session id, never a query param
 *  or path segment, since there's no legitimate reason to read anyone else's. Cursor-paginated
 *  (?cursor=&pageSize=, default 25, max 100 - Phase 16). */
export const GET = withErrorHandling("/api/notifications", async (request: NextRequest) => {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const pagination = parseCursorPagination(request);
  const result = await list(auth.userId, pagination);
  return NextResponse.json(result.ok ? result.data : { items: [], nextCursor: null, hasNext: false });
});
