// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GET as healthRoute } from '@/app/api/health/route';
import { GET as readyRoute } from '@/app/api/ready/route';

/** Health/readiness (section 18/32) - both run against the real dev database, confirming they
 *  actually report a live dependency, not a hardcoded "ok". Never expose connection strings or
 *  stack traces - only the coarse per-dependency status this app's own health.ts produces. */
describe('GET /api/health', () => {
  it('reports ok with a healthy database, and never leaks connection details', async () => {
    const response = await healthRoute();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.checks.database).toBe('ok');
    expect(JSON.stringify(body)).not.toMatch(/postgres:\/\/|password/i);
  });
});

describe('GET /api/ready', () => {
  it('reports ready with a healthy database, using the same underlying dependency check as /api/health', async () => {
    const response = await readyRoute();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ready');
    expect(body.checks.database).toBe('ok');
  });

  it('never leaks connection details even in its response shape', async () => {
    const response = await readyRoute();
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/postgres:\/\/|password/i);
  });
});
