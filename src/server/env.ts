/**
 * Server-only environment configuration (section 25). Every environment variable the backend
 * depends on is read and validated exactly once, here - nowhere else in the server codebase
 * should reach for `process.env` directly, so a missing/malformed value fails loudly at startup
 * instead of surfacing as a confusing runtime error deep inside a request handler.
 *
 * This module must never be imported from a `'use client'` file - importing it there would be a
 * build error anyway (server-only env vars aren't available to the client bundle), but the
 * explicit `import 'server-only'` makes that mistake fail immediately and clearly rather than
 * silently inlining `undefined`.
 */
import 'server-only';

function required(name: string): string {
  const value = process.env[name];
  if (!value || value === 'CHANGE_ME') {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill in a real value.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

/**
 * Config for one mobile money network's real gateway (Collections-style "request to pay" - see
 * server/services/payment/gateways/momoGatewayClient.ts). Returns null - not a config with empty
 * strings - when any of subscriptionKey/apiUser/apiKey is unset, so callers (providers.ts) can
 * use `=== null` as the single "is this network actually configured" check and fall back to a
 * local simulation instead. Nothing ships real values for any of these three prefixes; every
 * network runs in fallback mode until an operator supplies real credentials.
 */
export interface MobileMoneyGatewayEnv {
  baseUrl: string;
  subscriptionKey: string;
  apiUser: string;
  apiKey: string;
  targetEnvironment: string;
}

function optionalMobileMoneyGateway(prefix: string, defaultBaseUrl: string): MobileMoneyGatewayEnv | null {
  const subscriptionKey = optional(`${prefix}_SUBSCRIPTION_KEY`, '');
  const apiUser = optional(`${prefix}_API_USER`, '');
  const apiKey = optional(`${prefix}_API_KEY`, '');
  if (!subscriptionKey || !apiUser || !apiKey) return null;

  return {
    baseUrl: optional(`${prefix}_BASE_URL`, defaultBaseUrl),
    subscriptionKey,
    apiUser,
    apiKey,
    targetEnvironment: optional(`${prefix}_TARGET_ENVIRONMENT`, 'sandbox'),
  };
}

/**
 * Config for an S3-compatible object-storage bucket (Phase 21 - the production counterpart to
 * `LocalDiskStorageProvider`, see server/services/storage/). Returns null - the same "null, not a
 * config with empty strings" shape `optionalMobileMoneyGateway` already uses - when any required
 * field is unset, so `storage/index.ts` can use `=== null` as the single "is a real bucket
 * actually configured" check and fall back to local disk otherwise. `endpoint` is optional: unset
 * means real AWS S3 (the SDK's own default endpoint resolution for `region`); set it to point at
 * any S3-compatible provider instead (Cloudflare R2, DigitalOcean Spaces, MinIO, Backblaze B2,
 * ...) - "S3-compatible", not "AWS-only", is the actual requirement here.
 */
export interface S3StorageEnv {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string | undefined;
}

function optionalS3Storage(): S3StorageEnv | null {
  const bucket = optional('STORAGE_BUCKET', '');
  const region = optional('STORAGE_REGION', '');
  const accessKeyId = optional('STORAGE_ACCESS_KEY_ID', '');
  const secretAccessKey = optional('STORAGE_SECRET_ACCESS_KEY', '');
  if (!bucket || !region || !accessKeyId || !secretAccessKey) return null;

  return { bucket, region, accessKeyId, secretAccessKey, endpoint: optional('STORAGE_ENDPOINT', '') || undefined };
}

export const env = {
  NODE_ENV: optional('NODE_ENV', 'development') as 'development' | 'test' | 'staging' | 'production',
  DATABASE_URL: required('DATABASE_URL'),
  AUTH_SECRET: required('AUTH_SECRET'),
  SESSION_TTL_SECONDS: Number(optional('SESSION_TTL_SECONDS', '604800')),
  // Optional, not required(): unset simply means no payment provider has been wired to send
  // real webhooks yet (Phase 14, Stage 11) - the webhook route itself fails closed (rejects
  // every request) whenever this is empty, rather than the whole app refusing to start over an
  // integration nothing is using yet.
  PAYMENT_WEBHOOK_SIGNING_SECRET: optional('PAYMENT_WEBHOOK_SIGNING_SECRET', ''),
  // Shared secret the scheduler (Vercel Cron, a GitHub Actions cron job, system crontab + curl,
  // ...) sends back on every /api/cron/* request. Optional for the same reason as the webhook
  // secret above - the cron routes themselves fail closed while this is empty.
  CRON_SECRET: optional('CRON_SECRET', ''),
  // Real mobile money gateways (deployment-readiness follow-up: wiring a real payment gateway).
  // MTN MoMo's Collections API is publicly documented (momodeveloper.mtn.com) and its base URL
  // default points at MTN's own sandbox; Telecel Cash and AirtelTigo Money have no equivalent
  // public developer portal, so their defaults are empty - an operator must supply the real base
  // URL along with credentials once they have it from that network or an aggregator. See
  // gateways/mobileMoneyProvider.ts for what happens while any of these is null.
  MTN_MOMO: optionalMobileMoneyGateway('MTN_MOMO', 'https://sandbox.momodeveloper.mtn.com'),
  TELECEL_CASH: optionalMobileMoneyGateway('TELECEL_CASH', ''),
  AIRTELTIGO_MONEY: optionalMobileMoneyGateway('AIRTELTIGO_MONEY', ''),
  // Real object storage (Phase 21 - see server/services/storage/index.ts). No bucket exists in
  // this environment; every field is unset, so this resolves to null and storage stays on
  // LocalDiskStorageProvider.
  STORAGE: optionalS3Storage(),
};

export const isProduction = env.NODE_ENV === 'production';
