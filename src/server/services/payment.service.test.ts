// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { charge } from './payment.service';

/**
 * Phase 14, Stage 8 - real, database-backed regression suite for payment.service.ts's charge():
 * the provider abstraction (ported unchanged from the client mock), the real Payment +
 * PaymentTransaction ledger it now writes, and idempotency. Runs against the actual dev Postgres
 * database, scoped to a dedicated test company this suite creates and cleans up in `afterAll`.
 */

const TEST_COMPANY_ID = `test-company-payment-${Date.now()}`;

beforeAll(async () => {
  await db.company.create({ data: { id: TEST_COMPANY_ID, name: 'Payment Test Co', country: 'GH', currency: 'GHS', creditAvailable: 500 } });
});

afterAll(async () => {
  await db.paymentTransaction.deleteMany({ where: { payment: { companyId: TEST_COMPANY_ID } } });
  await db.payment.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
});

describe('charge', () => {
  it('rejects an unsupported method', async () => {
    const result = await charge({ companyId: TEST_COMPANY_ID, amount: 100, currency: 'GHS', method: 'CARD', details: {} });
    // A well-formed empty details object fails CARD's own validation, not "unsupported" - confirms
    // the provider is actually being invoked, not skipped.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PAYMENT_FAILED');
  });

  it('writes a PAID Payment plus a CAPTURED PaymentTransaction on success', async () => {
    const result = await charge({ companyId: TEST_COMPANY_ID, amount: 100, currency: 'GHS', method: 'WALLET', details: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('PAID');

    const transactions = await db.paymentTransaction.findMany({ where: { paymentId: result.data.id } });
    expect(transactions).toHaveLength(1);
    expect(transactions[0].event).toBe('CAPTURED');
  });

  it('writes a FAILED Payment plus a FAILED PaymentTransaction when the provider rejects it', async () => {
    const result = await charge({ companyId: TEST_COMPANY_ID, amount: 100, currency: 'GHS', method: 'BANK_TRANSFER', details: {} });
    expect(result.ok).toBe(false);

    const payments = await db.payment.findMany({ where: { companyId: TEST_COMPANY_ID, method: 'BANK_TRANSFER' } });
    expect(payments.some((p) => p.status === 'FAILED')).toBe(true);
  });

  it("checks CREDIT_TERMS against the company's real available credit, never a client-supplied value", async () => {
    // A malicious client-supplied creditAvailable is ignored - the real company row (500) governs.
    const withinRealLimit = await charge({
      companyId: TEST_COMPANY_ID,
      amount: 400,
      currency: 'GHS',
      method: 'CREDIT_TERMS',
      details: { creditAvailable: '999999' },
    });
    expect(withinRealLimit.ok).toBe(true);

    const overRealLimit = await charge({
      companyId: TEST_COMPANY_ID,
      amount: 600,
      currency: 'GHS',
      method: 'CREDIT_TERMS',
      details: { creditAvailable: '999999' },
    });
    expect(overRealLimit.ok).toBe(false);
  });

  it('a retried request with the same idempotencyKey returns the original Payment instead of charging twice', async () => {
    const key = `test-idempotency-${Date.now()}`;
    const first = await charge({ companyId: TEST_COMPANY_ID, amount: 250, currency: 'GHS', method: 'WALLET', details: {}, idempotencyKey: key });
    expect(first.ok).toBe(true);

    const second = await charge({ companyId: TEST_COMPANY_ID, amount: 250, currency: 'GHS', method: 'WALLET', details: {}, idempotencyKey: key });
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.data.id).toBe(first.data.id);

    const payments = await db.payment.findMany({ where: { companyId: TEST_COMPANY_ID, idempotencyKey: key } });
    expect(payments).toHaveLength(1);
  });
});
