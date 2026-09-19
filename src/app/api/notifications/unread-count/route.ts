import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { getUnreadCount } from '@/server/services/notification.service';
import { withErrorHandling } from '@/server/errors';

/** The notification bell's badge count, computed via a real database count (Phase 16) - replaces
 *  a client-side `.filter(n => !n.read).length` over whatever page of notifications happened to
 *  be loaded. */
export const GET = withErrorHandling("/api/notifications/unread-count", async (request: NextRequest) => {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const result = await getUnreadCount(auth.userId);
  return NextResponse.json({ count: result.ok ? result.data : 0 });
});
