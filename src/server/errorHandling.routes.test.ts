// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { withErrorHandling } from '@/server/errors';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { GET as auditLogRoute } from '@/app/api/audit-log/route';
import { GET as ordersRoute } from '@/app/api/orders/route';

/**
 * Phase 18, Objective 1/2 - regression coverage for the standardized error-handling
 * architecture (`withErrorHandling`, now applied to 96 of 99 route files by an AST-based
 * codemod; see PHASE18_FINAL_REPORT.md). Exercises real, already-wrapped route exports end to
 * end (not the isolated `errors.test.ts` unit tests, which only exercise `withErrorHandling`/
 * `toSafeErrorResponse` in isolation) to prove the wrapper didn't change any intentional status
 * code, and that a genuinely unexpected database failure - a real Prisma connection error, not
 * a hand-rolled mock - is converted into this app's own safe `{error, requestId}` shape instead
 * of Next's bare empty 500 or a leaked Prisma error.
 */

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', origin: 'http://localhost', ...headers }),
    body: JSON.stringify(body),
  });
}

describe('withErrorHandling in real, already-wrapped routes - intentional status codes are unchanged', () => {
  it('a known application error (invalid login credentials) remains 401, not converted to 500', async () => {
    const response = await loginRoute(jsonRequest('/api/auth/login', { email: 'not-a-real-user@example.com', password: 'wrong-password' }));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('That email or password is incorrect.');
  });

  it('a validation error (malformed login body) remains 422, not converted to 500', async () => {
    const response = await loginRoute(jsonRequest('/api/auth/login', { email: 'not-an-email', password: '' }));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe('Invalid request.');
  });

  it('an unauthenticated request to a protected, wrapped route remains 401, not converted to 500', async () => {
    const response = await auditLogRoute(new NextRequest('http://localhost/api/audit-log'));
    expect(response.status).toBe(401);
  });

  it('an unauthenticated request to a tenant-scoped, wrapped route remains 401, not converted to 500', async () => {
    const response = await ordersRoute(new NextRequest('http://localhost/api/orders'));
    expect(response.status).toBe(401);
  });
});

describe('withErrorHandling against a real, unmocked database failure', () => {
  it('a genuine Prisma connection error is converted to the standardized safe 500 shape, never leaking connection details', async () => {
    // A real PrismaClient pointed at a real, unreachable address - not a mock or a hand-thrown
    // Error. Any query against it throws a genuine PrismaClientInitializationError, the exact
    // failure mode a real database outage produces.
    const brokenDb = new PrismaClient({ datasourceUrl: 'postgresql://baduser:badpass@localhost:1/nonexistent' });

    const handler = withErrorHandling('/api/test-db-failure', async () => {
      await brokenDb.user.count();
      throw new Error('unreachable - the query above must throw first');
    });

    const response = await handler(new NextRequest('http://localhost/api/test-db-failure', { headers: { 'x-request-id': 'db-failure-test' } }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Unable to process request.');
    expect(body.requestId).toBe('db-failure-test');

    const rawBody = JSON.stringify(body);
    expect(rawBody).not.toContain('postgresql://');
    expect(rawBody).not.toContain('baduser');
    expect(rawBody).not.toContain('badpass');
    expect(rawBody).not.toContain('PrismaClient');
    expect(rawBody).not.toContain('.ts:');
    expect(Object.keys(body).sort()).toEqual(['error', 'requestId']);

    await brokenDb.$disconnect();
  });

  it('every genuinely unexpected exception - not just Prisma ones - collapses to the same safe shape, regardless of what the original error exposed', async () => {
    const handler = withErrorHandling('/api/test-generic-failure', async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'id') at /app/src/server/services/orders.service.ts:142:18");
    });

    const response = await handler(new NextRequest('http://localhost/api/test-generic-failure'));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Unable to process request.');
    const rawBody = JSON.stringify(body);
    expect(rawBody).not.toContain('orders.service.ts');
    expect(rawBody).not.toContain('TypeError');
  });
});
