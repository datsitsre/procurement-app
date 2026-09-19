// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/server/db';

/**
 * Deployment-readiness follow-up: "wire a real payment gateway" - regression suite for the
 * reconciliation job that resolves mobile money Payments a webhook never confirmed. `@/server/env`
 * is partially mocked so `env.MTN_MOMO` can be toggled between "not configured" (the real value
 * in this repo/test run - no test ships real credentials) and "configured" per test, without
 * touching every other env var real code elsewhere in this file's import chain depends on.
 */

vi.mock('@/server/env', async (importActual) => {
  const actual = await importActual<typeof import('@/server/env')>();
  return { ...actual, env: { ...actual.env, MTN_MOMO: null as import('@/server/env').MobileMoneyGatewayEnv | null } };
});

const TEST_COMPANY_ID = `test-company-pending-sweep-${Date.now()}`;

function tokenResponse() {
  return new Response(JSON.stringify({ access_token: 'test-token' }), { status: 200 });
}

beforeAll(async () => {
  await db.company.create({ data: { id: TEST_COMPANY_ID, name: 'Pending Sweep Test Co', country: 'GH', currency: 'GHS' } });
});

afterEach(async () => {
  await db.paymentTransaction.deleteMany({ where: { payment: { companyId: TEST_COMPANY_ID } } });
  await db.payment.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
});

afterAll(async () => {
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
});

describe('runPendingPaymentSweep', () => {
  it('leaves a pending MTN MoMo payment alone (counted stillPending) when no real gateway is configured', async () => {
    await db.payment.create({
      data: { companyId: TEST_COMPANY_ID, amount: 100, method: 'MTN_MOMO', status: 'PENDING', reference: `unconfigured-${Date.now()}` },
    });

    const { runPendingPaymentSweep } = await import('./pendingPaymentSweep');
    const result = await runPendingPaymentSweep({ companyId: TEST_COMPANY_ID });

    expect(result.resolved).toBe(0);
    expect(result.stillPending).toBe(1);
  });

  it('settles a pending payment as PAID once the gateway reports SUCCESSFUL, going through the same processPaymentWebhook cascade a real webhook would', async () => {
    vi.doMock('@/server/env', async (importActual) => {
      const actual = await importActual<typeof import('@/server/env')>();
      return {
        ...actual,
        env: {
          ...actual.env,
          MTN_MOMO: { baseUrl: 'https://sandbox.example.test', subscriptionKey: 'k', apiUser: 'u', apiKey: 'k', targetEnvironment: 'sandbox' },
        },
      };
    });
    vi.resetModules();

    const reference = `configured-success-${Date.now()}`;
    await db.payment.create({ data: { companyId: TEST_COMPANY_ID, amount: 100, method: 'MTN_MOMO', status: 'PENDING', reference } });

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'SUCCESSFUL' }), { status: 200 })) as unknown as typeof fetch;

    const { runPendingPaymentSweep } = await import('./pendingPaymentSweep');
    const result = await runPendingPaymentSweep({ companyId: TEST_COMPANY_ID });

    expect(result.resolved).toBe(1);
    const payment = await db.payment.findUnique({ where: { reference } });
    expect(payment?.status).toBe('PAID');

    vi.doUnmock('@/server/env');
    vi.resetModules();
  });
});
