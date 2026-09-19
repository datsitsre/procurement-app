import { NextResponse, type NextRequest } from 'next/server';
import { enforceRateLimit } from '@/server/auth/rate-limit';
import { processPaymentWebhook, verifyWebhookSignature } from '@/server/services/webhook.service';
import { PaymentWebhookSchema } from '@/server/validation/webhooks';
import { withErrorHandling } from '@/server/errors';

/**
 * Inbound payment-provider webhook (Phase 14, Stage 11). Not session/cookie-authenticated - a
 * real gateway calls this server-to-server, so authenticity comes entirely from the HMAC
 * signature (section 20's "verify webhook signatures" rule), never from same-origin/CSRF checks
 * that only make sense for a browser-originated, cookie-carrying request.
 *
 * `[provider]` is accepted for routing/logging clarity (each provider gets its own configured
 * webhook URL in a real integration) but isn't otherwise trusted - the signature check is the
 * only thing that matters for whether this request is genuine.
 */
export const POST = withErrorHandling("/api/webhooks/payments/[provider]", async (request: NextRequest, ctx: RouteContext<'/api/webhooks/payments/[provider]'>) => {
  const { provider } = await ctx.params;

  // Bounds signature-guessing spam without throttling a real provider's own legitimate retry
  // traffic (section 6/7) - keyed by IP + provider, not by anything inside the (as yet
  // unverified) request body.
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const limited = enforceRateLimit('webhook', `${provider}:${ip}`);
  if (limited) return limited;

  // Verify the signature over the exact raw bytes received - parsing to JSON first (and letting
  // whitespace/key-order differences creep in) could let a tampered body slip past the check.
  const rawBody = await request.text();
  const signature = request.headers.get('x-webhook-signature');
  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 });
  }

  const body = (() => {
    try {
      return JSON.parse(rawBody);
    } catch {
      return null;
    }
  })();
  const parsed = PaymentWebhookSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid webhook payload.' }, { status: 422 });

  const result = await processPaymentWebhook(parsed.data);
  // A reference this app doesn't recognize is still a 200 - a real gateway will keep retrying a
  // non-2xx response, and there's nothing this app can do differently on a retry for a payment
  // it never created (e.g. a webhook misconfigured to point at the wrong environment).
  if (!result.ok) return NextResponse.json({ ok: true, provider, note: result.error.message });

  return NextResponse.json({ ok: true, provider, changed: result.data.changed });
});
