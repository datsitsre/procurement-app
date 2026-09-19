import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MomoGatewayClient, type MomoGatewayConfig } from './momoGatewayClient';
import { MobileMoneyGatewayProvider } from './mobileMoneyProvider';

/**
 * Deployment-readiness follow-up: "wire a real payment gateway". Unit tests only - no real
 * network call, no real credentials (none exist anywhere in this repo) - `fetch` is mocked to
 * return the exact response shapes MTN MoMo's public Collections API documents (see
 * momoGatewayClient.ts's own comment on how confident that spec is, versus Telecel Cash/
 * AirtelTigo Money which reuse the same shape unverified).
 */

const CONFIG: MomoGatewayConfig = {
  baseUrl: 'https://sandbox.example.test',
  subscriptionKey: 'test-subscription-key',
  apiUser: 'test-api-user',
  apiKey: 'test-api-key',
  targetEnvironment: 'sandbox',
};

function tokenResponse() {
  return new Response(JSON.stringify({ access_token: 'test-token', token_type: 'Bearer', expires_in: 3600 }), { status: 200 });
}

describe('MomoGatewayClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('requestToPay returns ACCEPTED with a generated reference id on a 202', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response(null, { status: 202 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new MomoGatewayClient(CONFIG);
    const result = await client.requestToPay({ amount: 100, currency: 'GHS', phone: '233244000000', externalId: 'ext-1', payerMessage: 'x', payeeNote: 'x' });

    expect(result.outcome).toBe('ACCEPTED');
    if (result.outcome === 'ACCEPTED') expect(result.referenceId).toMatch(/^[0-9a-f-]{36}$/);

    // Second call carried the reference id it generated as X-Reference-Id, and authenticated
    // with the token from the first call - confirms the real two-step flow, not a shortcut.
    const requestToPayCall = fetchMock.mock.calls[1];
    const headers = requestToPayCall[1].headers as Record<string, string>;
    expect(headers['X-Reference-Id']).toBe((result as { referenceId: string }).referenceId);
    expect(headers.Authorization).toBe('Bearer test-token');
  });

  it('requestToPay returns REJECTED with the gateway-reported reason on a non-202', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Payer account not found.' }), { status: 400 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new MomoGatewayClient(CONFIG);
    const result = await client.requestToPay({ amount: 100, currency: 'GHS', phone: '233244000000', externalId: 'ext-2', payerMessage: 'x', payeeNote: 'x' });

    expect(result.outcome).toBe('REJECTED');
    if (result.outcome === 'REJECTED') expect(result.reason).toBe('Payer account not found.');
  });

  it('getStatus maps the gateway status field to the three real outcomes', async () => {
    const statuses = [
      { body: { status: 'SUCCESSFUL' }, expected: 'SUCCESSFUL' },
      { body: { status: 'FAILED' }, expected: 'FAILED' },
      { body: { status: 'PENDING' }, expected: 'PENDING' },
    ] as const;

    for (const { body, expected } of statuses) {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

      const client = new MomoGatewayClient(CONFIG);
      expect(await client.getStatus('some-reference-id')).toBe(expected);
    }
  });

  it('getStatus treats an unreachable/error response as still PENDING, never a false FAILED', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response(null, { status: 500 })) as unknown as typeof fetch;

    const client = new MomoGatewayClient(CONFIG);
    expect(await client.getStatus('some-reference-id')).toBe('PENDING');
  });
});

describe('MobileMoneyGatewayProvider', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('rejects a malformed phone number without ever touching the network', async () => {
    const provider = new MobileMoneyGatewayProvider('MTN_MOMO', 'MTN', CONFIG);
    const result = await provider.charge({ amount: 100, currency: 'GHS', reference: 'ref-1', details: { phone: '12345' } });

    expect(result.status).toBe('FAILED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to an instant SUCCEEDED simulation when no gateway is configured - the demo/no-credentials path', async () => {
    const provider = new MobileMoneyGatewayProvider('MTN_MOMO', 'MTN', null);
    const result = await provider.charge({ amount: 100, currency: 'GHS', reference: 'ref-2', details: { phone: '0244000000' } });

    expect(result.status).toBe('SUCCEEDED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns PENDING (not SUCCEEDED) when a real gateway accepts the request - settlement is asynchronous', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(null, { status: 202 })) as unknown as typeof fetch;

    const provider = new MobileMoneyGatewayProvider('MTN_MOMO', 'MTN', CONFIG);
    const result = await provider.charge({ amount: 100, currency: 'GHS', reference: 'ref-3', details: { phone: '0244000000' } });

    expect(result.status).toBe('PENDING');
    expect(result.providerReference).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns FAILED when the real gateway rejects the request', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Insufficient funds.' }), { status: 400 })) as unknown as typeof fetch;

    const provider = new MobileMoneyGatewayProvider('MTN_MOMO', 'MTN', CONFIG);
    const result = await provider.charge({ amount: 100, currency: 'GHS', reference: 'ref-4', details: { phone: '0244000000' } });

    expect(result.status).toBe('FAILED');
    expect(result.failureReason).toBe('Insufficient funds.');
  });

  it('fails closed (FAILED, not a silent fallback) when the gateway is configured but unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('network down')) as unknown as typeof fetch;

    const provider = new MobileMoneyGatewayProvider('MTN_MOMO', 'MTN', CONFIG);
    const result = await provider.charge({ amount: 100, currency: 'GHS', reference: 'ref-5', details: { phone: '0244000000' } });

    expect(result.status).toBe('FAILED');
  });

  it('fails closed (FAILED, not a hang) when the gateway never responds - Phase 21: every real fetch call now carries a hard timeout', async () => {
    // A DOMException named 'TimeoutError' is exactly what AbortSignal.timeout() produces when it
    // fires - simulating that here is a faithful stand-in for a real hung connection without
    // this test itself needing to wait 10 real seconds.
    global.fetch = vi.fn().mockRejectedValueOnce(new DOMException('The operation was aborted.', 'TimeoutError')) as unknown as typeof fetch;

    const provider = new MobileMoneyGatewayProvider('MTN_MOMO', 'MTN', CONFIG);
    const result = await provider.charge({ amount: 100, currency: 'GHS', reference: 'ref-6', details: { phone: '0244000000' } });

    expect(result.status).toBe('FAILED');
    expect(result.failureReason).toBe('Could not reach the mobile money gateway. Please try again.');
  });
});
