// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as listNotificationsRoute } from '@/app/api/notifications/route';
import { GET as unreadCountRoute } from '@/app/api/notifications/unread-count/route';

/**
 * Phase 16, section 5/7 - regression suite at the real API boundary for the cursor-paginated
 * notification feed: tenant isolation (always the caller's own session id, never a query param),
 * cursor tampering, and pageSize clamping.
 */

const USER_ID = 'user-john-doe'; // seeded user, reused as the notification recipient
const OTHER_USER_ID = 'user-sarah-smith';

let userSessionToken: string;
let otherUserSessionToken: string;
const createdIds: string[] = [];

function requestFor(url: string, token: string) {
  return new NextRequest(`http://localhost${url}`, {
    headers: new Headers({ cookie: `session_token=${token}` }),
  });
}

beforeAll(async () => {
  for (let i = 0; i < 3; i++) {
    const n = await db.notification.create({
      data: { userId: USER_ID, type: 'QUOTE_RECEIVED', title: `Route test ${i}`, body: 'x' },
    });
    createdIds.push(n.id);
  }
  userSessionToken = (await createSession({ userId: USER_ID, activeCompanyId: 'company-acme-gh' })).token;
  otherUserSessionToken = (await createSession({ userId: OTHER_USER_ID, activeCompanyId: 'company-acme-gh' })).token;
});

afterAll(async () => {
  await db.notification.deleteMany({ where: { id: { in: createdIds } } });
});

describe('GET /api/notifications (cursor pagination security)', () => {
  it("always scopes to the caller's own session id - two different sessions never see each other's cursor-decoded pages", async () => {
    const mine = await listNotificationsRoute(requestFor('/api/notifications?pageSize=100', userSessionToken));
    expect(mine.status).toBe(200);
    const minePage = await mine.json();
    expect(minePage.items.every((n: { userId: string }) => n.userId === USER_ID)).toBe(true);
    expect(createdIds.every((id) => minePage.items.some((n: { id: string }) => n.id === id))).toBe(true);

    const theirs = await listNotificationsRoute(requestFor('/api/notifications?pageSize=100', otherUserSessionToken));
    expect(theirs.status).toBe(200);
    const theirsPage = await theirs.json();
    expect(theirsPage.items.some((n: { id: string }) => createdIds.includes(n.id))).toBe(false);
  });

  it('a garbage/tampered cursor decodes to null and falls back to the first page rather than erroring or leaking rows', async () => {
    const response = await listNotificationsRoute(requestFor('/api/notifications?cursor=not-a-real-cursor&pageSize=100', userSessionToken));
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.items.every((n: { userId: string }) => n.userId === USER_ID)).toBe(true);
  });

  it("a well-formed cursor crafted for a different account still can't be used to page through this account's data out of tenant scope", async () => {
    // Build a real cursor as if it came from the other user's feed, then present it on this
    // user's session - the query is still scoped by session userId, so this can only ever page
    // through USER_ID's own notifications, never leak OTHER_USER_ID's.
    const theirs = await listNotificationsRoute(requestFor('/api/notifications?pageSize=1', otherUserSessionToken));
    const theirsPage = await theirs.json();
    const foreignCursor = theirsPage.nextCursor ?? Buffer.from(`${new Date().toISOString()}|some-other-id`, 'utf8').toString('base64url');

    const response = await listNotificationsRoute(requestFor(`/api/notifications?cursor=${foreignCursor}&pageSize=100`, userSessionToken));
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.items.every((n: { userId: string }) => n.userId === USER_ID)).toBe(true);
  });

  it('clamps an excessive pageSize to the configured maximum instead of returning unbounded rows', async () => {
    const response = await listNotificationsRoute(requestFor('/api/notifications?pageSize=999999', userSessionToken));
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.items.length).toBeLessThanOrEqual(100);
  });

  it('rejects an unauthenticated request', async () => {
    const response = await listNotificationsRoute(new NextRequest('http://localhost/api/notifications'));
    expect(response.status).toBe(401);
  });
});

describe('GET /api/notifications/unread-count', () => {
  it("reflects the caller's own unread count, computed server-side, not derivable from a manipulated page size", async () => {
    const response = await unreadCountRoute(requestFor('/api/notifications/unread-count', userSessionToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(typeof body.count).toBe('number');
    expect(body.count).toBeGreaterThanOrEqual(3);
  });

  it('rejects an unauthenticated request', async () => {
    const response = await unreadCountRoute(new NextRequest('http://localhost/api/notifications/unread-count'));
    expect(response.status).toBe(401);
  });
});
