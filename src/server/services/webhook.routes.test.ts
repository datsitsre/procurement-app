// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { POST as webhookRoute } from '@/app/api/webhooks/payments/[provider]/route';

/**
 * Phase 14, Stage 11 - regression suite at the real API boundary for the inbound payment
 * webhook: signature enforcement (not cookie/session auth - a real gateway calls this server-to-
 * server) and the actual route wiring around processPaymentWebhook.
 */

const TEST_COMPANY_ID = `test-company-webhook-routes-${Date.now()}`;
let paymentReference: string;
let paymentId: string;

function sign(rawBody: string): string {
  return crypto.createHmac('sha256', env.PAYMENT_WEBHOOK_SIGNING_SECRET).update(rawBody).digest('hex');
}

function requestFor(body: string, signature: string | null) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signature !== null) headers.set('x-webhook-signature', signature);
  return new NextRequest('http://localhost/api/webhooks/payments/mtn_momo', { method: 'POST', body, headers });
}

beforeAll(async () => {
  await db.company.create({ data: { id: TEST_COMPANY_ID, name: 'Webhook Routes Test Co', country: 'GH', currency: 'GHS' } });
  paymentReference = `MTN-WEBHOOK-ROUTES-${Date.now()}`;
  const payment = await db.payment.create({
    data: { companyId: TEST_COMPANY_ID, amount: 500, method: 'MTN_MOMO', status: 'PENDING', reference: paymentReference },
  });
  paymentId = payment.id;
});

afterAll(async () => {
  await db.paymentTransaction.deleteMany({ where: { paymentId } });
  await db.payment.delete({ where: { id: paymentId } }).catch(() => undefined);
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
});

describe('POST /api/webhooks/payments/[provider]', () => {
  it('rejects a request with no signature header', async () => {
    const body = JSON.stringify({ providerReference: paymentReference, event: 'payment.captured' });
    const response = await webhookRoute(requestFor(body, null), { params: Promise.resolve({ provider: 'mtn_momo' }) });
    expect(response.status).toBe(401);
  });

  it('rejects a request with a wrong signature', async () => {
    const body = JSON.stringify({ providerReference: paymentReference, event: 'payment.captured' });
    const wrongSignature = crypto.createHmac('sha256', 'wrong-secret').update(body).digest('hex');
    const response = await webhookRoute(requestFor(body, wrongSignature), { params: Promise.resolve({ provider: 'mtn_momo' }) });
    expect(response.status).toBe(401);
  });

  it('rejects a correctly signed but malformed payload', async () => {
    const body = JSON.stringify({ providerReference: paymentReference, event: 'not-a-real-event' });
    const response = await webhookRoute(requestFor(body, sign(body)), { params: Promise.resolve({ provider: 'mtn_momo' }) });
    expect(response.status).toBe(422);
  });

  it('accepts a correctly signed, valid payload and settles the payment', async () => {
    const body = JSON.stringify({ providerReference: paymentReference, event: 'payment.captured' });
    const response = await webhookRoute(requestFor(body, sign(body)), { params: Promise.resolve({ provider: 'mtn_momo' }) });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.changed).toBe(true);

    const payment = await db.payment.findUnique({ where: { id: paymentId } });
    expect(payment?.status).toBe('PAID');
  });

  it('still returns 200 for a reference it does not recognize - never a distinct error a retrying gateway would fail loudly on', async () => {
    const body = JSON.stringify({ providerReference: 'unknown-reference', event: 'payment.captured' });
    const response = await webhookRoute(requestFor(body, sign(body)), { params: Promise.resolve({ provider: 'mtn_momo' }) });
    expect(response.status).toBe(200);
  });
});
