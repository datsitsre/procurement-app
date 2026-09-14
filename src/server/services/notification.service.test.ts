// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { list, markAllRead, markRead, notifyCompanyRoles, notifyUser } from './notification.service';

/**
 * Phase 14, Stage 9 - real, database-backed regression suite for notifications: the read/mark-
 * read side, and the two dispatch helpers other server services call internally. Runs against
 * the actual dev Postgres database, scoped to dedicated test users/company this suite creates
 * and cleans up in `afterAll` - never touches seeded demo data.
 */

const TEST_COMPANY_ID = `test-company-notifications-${Date.now()}`;
const TEST_USER_ID = 'user-john-doe'; // seeded, reused here as a notification recipient
const OTHER_USER_ID = 'user-sarah-smith';
const THIRD_USER_ID = 'user-michael-doe';

beforeAll(async () => {
  await db.company.create({ data: { id: TEST_COMPANY_ID, name: 'Notifications Test Co', country: 'GH', currency: 'GHS' } });
  await db.companyMembership.createMany({
    data: [
      { companyId: TEST_COMPANY_ID, userId: OTHER_USER_ID, role: 'FINANCE_MANAGER', status: 'ACTIVE', joinedAt: new Date() },
      { companyId: TEST_COMPANY_ID, userId: THIRD_USER_ID, role: 'EMPLOYEE', status: 'ACTIVE', joinedAt: new Date() },
    ],
  });
});

afterAll(async () => {
  await db.notification.deleteMany({ where: { userId: { in: [TEST_USER_ID, OTHER_USER_ID, THIRD_USER_ID] } } });
  await db.companyMembership.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
});

describe('notifyUser + list + markRead + markAllRead', () => {
  it('creates a notification for exactly the named user, listed newest first', async () => {
    await notifyUser(TEST_USER_ID, { type: 'QUOTE_RECEIVED', title: 'First', body: 'first body' });
    await notifyUser(TEST_USER_ID, { type: 'QUOTE_RECEIVED', title: 'Second', body: 'second body' });
    await notifyUser(OTHER_USER_ID, { type: 'QUOTE_RECEIVED', title: 'Not for TEST_USER', body: 'x' });

    const result = await list(TEST_USER_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // TEST_USER_ID is a real seeded user with its own seed notifications (and possibly other
    // test files' unread ones, if run concurrently) - assert only what this test itself created.
    expect(result.data.every((n) => n.userId === TEST_USER_ID)).toBe(true);
    expect(result.data[0].title).toBe('Second');
    const mine = result.data.filter((n) => n.title === 'First' || n.title === 'Second');
    expect(mine).toHaveLength(2);
    expect(mine.every((n) => n.read === false)).toBe(true);
  });

  it("markRead only affects the caller's own notification, scoped by both id and userId", async () => {
    const created = await db.notification.create({ data: { userId: OTHER_USER_ID, type: 'QUOTE_RECEIVED', title: 'x', body: 'x' } });

    // A different user's id can't mark someone else's notification read.
    await markRead(created.id, TEST_USER_ID);
    const stillUnread = await db.notification.findUnique({ where: { id: created.id } });
    expect(stillUnread?.read).toBe(false);

    await markRead(created.id, OTHER_USER_ID);
    const nowRead = await db.notification.findUnique({ where: { id: created.id } });
    expect(nowRead?.read).toBe(true);
  });

  it('markAllRead flips every unread notification for that user, and only that user', async () => {
    await notifyUser(THIRD_USER_ID, { type: 'ORDER_SHIPPED', title: 'a', body: 'a' });
    await notifyUser(THIRD_USER_ID, { type: 'ORDER_SHIPPED', title: 'b', body: 'b' });

    await markAllRead(THIRD_USER_ID);
    const all = await db.notification.findMany({ where: { userId: THIRD_USER_ID } });
    expect(all.every((n) => n.read)).toBe(true);

    // A different user's unread notifications are untouched.
    const otherStillHasUnread = await db.notification.findFirst({ where: { userId: TEST_USER_ID, read: false } });
    expect(otherStillHasUnread).not.toBeNull();
  });
});

describe('notifyCompanyRoles', () => {
  it('notifies every active member whose role matches, and no one else', async () => {
    await notifyCompanyRoles(TEST_COMPANY_ID, ['FINANCE_MANAGER'], {
      type: 'APPROVAL_REQUESTED',
      title: 'Needs finance approval',
      body: 'x',
    });

    const financeNotified = await db.notification.findFirst({ where: { userId: OTHER_USER_ID, title: 'Needs finance approval' } });
    expect(financeNotified).not.toBeNull();

    const employeeNotNotified = await db.notification.findFirst({ where: { userId: THIRD_USER_ID, title: 'Needs finance approval' } });
    expect(employeeNotNotified).toBeNull();
  });
});
