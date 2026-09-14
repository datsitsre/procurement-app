import 'server-only';
import crypto from 'node:crypto';

export interface MomoGatewayConfig {
  baseUrl: string;
  subscriptionKey: string;
  apiUser: string;
  apiKey: string;
  targetEnvironment: string;
}

export type RequestToPayOutcome = { outcome: 'ACCEPTED'; referenceId: string } | { outcome: 'REJECTED'; reason: string };
export type RequestToPayStatus = 'PENDING' | 'SUCCESSFUL' | 'FAILED';

/**
 * HTTP client for the "Collections - Request to Pay" flow, modeled directly on MTN Mobile
 * Money's public Open API (momodeveloper.mtn.com) - the only one of Ghana's three mobile money
 * networks with a documented, publicly available developer sandbox. The flow (get an OAuth2
 * token, POST a request-to-pay that returns 202 Accepted with no body, then poll a status
 * endpoint by the reference id you generated) is standard for this class of API and is reused
 * as-is for Telecel Cash and AirtelTigo Money in mobileMoneyProvider.ts - but unlike MTN, this
 * repo has not verified those two networks' actual endpoint paths/payload shapes against real
 * published documentation (neither publishes one the way MTN does). Treat the MTN configuration
 * as the verified one and the other two as "same shape, paths to be confirmed with that
 * network's own integration team or an aggregator (Hubtel, ExpressPay, Paystack, ...) before
 * going live" - see .env.example.
 *
 * Nothing here is exercised by the demo/seed data or the default test run: every call requires a
 * real subscriptionKey/apiUser/apiKey, which nothing in this repo ships (see
 * mobileMoneyProvider.ts's fallback for what runs instead when they're absent).
 */
export class MomoGatewayClient {
  constructor(private readonly config: MomoGatewayConfig) {}

  private async getAccessToken(): Promise<string> {
    const basicAuth = Buffer.from(`${this.config.apiUser}:${this.config.apiKey}`).toString('base64');
    const response = await fetch(`${this.config.baseUrl}/collection/token/`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Ocp-Apim-Subscription-Key': this.config.subscriptionKey,
      },
    });
    if (!response.ok) throw new Error(`Mobile money gateway token request failed (HTTP ${response.status}).`);
    const body = (await response.json()) as { access_token?: string };
    if (!body.access_token) throw new Error('Mobile money gateway token response had no access_token.');
    return body.access_token;
  }

  /**
   * Initiates a debit request the customer approves on their phone. Only ever throws for a
   * transport/auth failure (the request was never attempted) - a gateway-level rejection (bad
   * MSISDN, insufficient funds reported synchronously, ...) comes back as `REJECTED`, not a
   * thrown error, so callers always get a `PaymentChargeResult` rather than an unhandled
   * exception for an ordinary declined payment.
   */
  async requestToPay(input: { amount: number; currency: string; phone: string; externalId: string; payerMessage: string; payeeNote: string }): Promise<RequestToPayOutcome> {
    const token = await this.getAccessToken();
    const referenceId = crypto.randomUUID();

    const response = await fetch(`${this.config.baseUrl}/collection/v1_0/requesttopay`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Reference-Id': referenceId,
        'X-Target-Environment': this.config.targetEnvironment,
        'Ocp-Apim-Subscription-Key': this.config.subscriptionKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: input.amount.toFixed(2),
        currency: input.currency,
        externalId: input.externalId,
        payer: { partyIdType: 'MSISDN', partyId: input.phone },
        payerMessage: input.payerMessage,
        payeeNote: input.payeeNote,
      }),
    });

    if (response.status === 202) return { outcome: 'ACCEPTED', referenceId };

    const body = await response.json().catch(() => ({}) as Record<string, unknown>);
    const reason = typeof body.message === 'string' ? body.message : `Mobile money gateway rejected the request (HTTP ${response.status}).`;
    return { outcome: 'REJECTED', reason };
  }

  /**
   * Polls the current status of a previously-accepted request-to-pay by its reference id. Used
   * by the reconciliation job (jobs/pendingPaymentSweep.ts) for the case a webhook callback
   * never arrives - MTN's own sandbox is documented as not reliably sending one.
   */
  async getStatus(referenceId: string): Promise<RequestToPayStatus> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.config.baseUrl}/collection/v1_0/requesttopay/${referenceId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Target-Environment': this.config.targetEnvironment,
        'Ocp-Apim-Subscription-Key': this.config.subscriptionKey,
      },
    });
    if (!response.ok) return 'PENDING';

    const body = (await response.json()) as { status?: string };
    if (body.status === 'SUCCESSFUL') return 'SUCCESSFUL';
    if (body.status === 'FAILED') return 'FAILED';
    return 'PENDING';
  }
}
