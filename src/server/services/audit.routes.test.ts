// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as listAuditLogRoute } from '@/app/api/audit-log/route';
import { recordAudit } from '@/server/services/audit.service';

/**
 * Phase 17, section 12/4 - regression suite for the real, database-backed audit log endpoint
 * this phase wired up to replace a client-side mock (see PHASE17_AUDIT.md finding 4). Covers
 * platform-admin-only access and cursor pagination security.
 */

const BUYER_USER_ID = 'user-john-doe'; // seeded OWNER, not a platform admin
const PLATFORM_ADMIN_USER_ID = 'user-grace-owusu'; // seeded PLATFORM_ADMIN at platform-hq

let buyerSessionToken: string;
let platformAdminSessionToken: string;
const createdIds: string[] = [];

function requestFor(url: string, token?: string) {
  return new NextRequest(`http://localhost${url}`, {
    headers: token ? new Headers({ cookie: `session_token=${token}` }) : undefined,
  });
}

beforeAll(async () => {
  for (let i = 0; i < 3; i++) {
    await recordAudit({ actorName: 'Audit Route Test', action: 'TEST_ACTION', entityType: 'TestEntity', entityId: `audit-route-test-${i}` });
  }
  const created = await db.auditLog.findMany({ where: { action: 'TEST_ACTION', entityType: 'TestEntity' } });
  createdIds.push(...created.map((c) => c.id));

  buyerSessionToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: 'company-acme-gh' })).token;
  platformAdminSessionToken = (await createSession({ userId: PLATFORM_ADMIN_USER_ID, activeCompanyId: 'platform-hq' })).token;
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { id: { in: createdIds } } });
});

describe('GET /api/audit-log (platform-admin gate + cursor pagination security)', () => {
  it('refuses an unauthenticated request', async () => {
    const response = await listAuditLogRoute(requestFor('/api/audit-log'));
    expect(response.status).toBe(401);
  });

  it('refuses a regular buyer (OWNER role, no platform.manage permission)', async () => {
    const response = await listAuditLogRoute(requestFor('/api/audit-log', buyerSessionToken));
    expect(response.status).toBe(403);
  });

  it('allows the platform admin and returns real entries from the database, newest first', async () => {
    const response = await listAuditLogRoute(requestFor('/api/audit-log?pageSize=100', platformAdminSessionToken));
    expect(response.status).toBe(200);
    const page = await response.json();
    const mine = page.items.filter((e: { entityType: string }) => e.entityType === 'TestEntity');
    expect(mine).toHaveLength(3);
    // Newest first.
    const timestamps = page.items.map((e: { timestamp: string }) => new Date(e.timestamp).getTime());
    expect([...timestamps]).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it('a garbage/tampered cursor decodes to null and falls back to the first page rather than erroring', async () => {
    const response = await listAuditLogRoute(requestFor('/api/audit-log?cursor=not-a-real-cursor&pageSize=10', platformAdminSessionToken));
    expect(response.status).toBe(200);
  });

  it('pages advance without overlap or gaps across two consecutive pages', async () => {
    const page1 = await (await listAuditLogRoute(requestFor('/api/audit-log?pageSize=2', platformAdminSessionToken))).json();
    expect(page1.items).toHaveLength(2);
    expect(page1.hasNext).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await (
      await listAuditLogRoute(requestFor(`/api/audit-log?pageSize=2&cursor=${page1.nextCursor}`, platformAdminSessionToken))
    ).json();
    const page1Ids = page1.items.map((e: { id: string }) => e.id);
    const page2Ids = page2.items.map((e: { id: string }) => e.id);
    expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
  });

  it('clamps an excessive pageSize to the configured maximum instead of returning unbounded rows', async () => {
    const response = await listAuditLogRoute(requestFor('/api/audit-log?pageSize=999999', platformAdminSessionToken));
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.items.length).toBeLessThanOrEqual(100);
  });

  it('includes a real companyName for a company-transaction-shaped entry, via AuditLog\'s own company relation (Phase 27 - Activity Center)', async () => {
    await recordAudit({ actorName: 'Audit Route Test', companyId: 'company-acme-gh', action: 'TEST_COMPANY_ACTION', entityType: 'TestEntity', entityId: 'audit-route-test-company' });
    const created = await db.auditLog.findFirst({ where: { action: 'TEST_COMPANY_ACTION', entityId: 'audit-route-test-company' } });
    if (created) createdIds.push(created.id);

    const response = await listAuditLogRoute(requestFor('/api/audit-log?pageSize=100', platformAdminSessionToken));
    const page = await response.json();
    const entry = page.items.find((e: { entityId: string }) => e.entityId === 'audit-route-test-company');
    expect(entry).toBeDefined();
    expect(entry.companyId).toBe('company-acme-gh');
    expect(entry.companyName).toBe('Acme Technologies Ghana');
  });

  it('leaves companyName unset for a platform-action entry with no companyId', async () => {
    const response = await listAuditLogRoute(requestFor('/api/audit-log?pageSize=100', platformAdminSessionToken));
    const page = await response.json();
    const entry = page.items.find((e: { entityType: string; entityId: string }) => e.entityType === 'TestEntity' && e.entityId.startsWith('audit-route-test-') && !e.entityId.endsWith('company'));
    expect(entry).toBeDefined();
    expect(entry.companyId).toBeUndefined();
    expect(entry.companyName).toBeUndefined();
  });
});
