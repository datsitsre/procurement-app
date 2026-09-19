# Phase 21 Final Report

Deployment, external services, and final acceptance. Follows the same evidence discipline as
Phases 18-20: IMPLEMENTED / VERIFIED / MEASURED / NOT VERIFIED / NOT MEASURED / REQUIRES EXTERNAL
CREDENTIALS / REQUIRES EXTERNAL INFRASTRUCTURE / DEFERRED / OUT OF SCOPE / BLOCKED. No claim is
made without saying what evidence backs it.

## 1. Executive Summary

The Phase 20 baseline (407/407 tests) was confirmed clean before any change. This phase's real,
substantive work: (1) closed a genuine, previously-undetected gap in the MTN MoMo gateway client -
none of its three `fetch` calls carried a timeout, meaning a hung gateway connection would have
hung a checkout or reconciliation request indefinitely; every call now has a 10-second
`AbortSignal.timeout`, verified by a new test that a timeout fails closed exactly like any other
transport error; (2) implemented a real, adapter-tested S3-compatible object-storage provider
(`S3StorageProvider`, `@aws-sdk/client-s3`) behind the existing `StorageProvider` interface Phase
20 established - selected automatically once all four `STORAGE_*` variables are configured,
`LocalDiskStorageProvider` otherwise (true in this environment, since no real bucket exists
anywhere in this repository); (3) brought `DEPLOYMENT.md` and `.env.example` up to date with
Phase 20's real state (they still described file storage as "nothing to wire up yet," which
stopped being true the moment Phase 20 shipped it); (4) ran a genuine, real-backend browser
acceptance pass across buyer, supplier, and admin journeys, including one live, positive tenant-
isolation check (an unrelated supplier's own authenticated session was used to `fetch()` a buyer's
RFQ directly and got a real 404). Payment sandbox verification, Docker verification, and Redis all
remain exactly where Phase 20 left them, for the same honest reasons: no real MTN MoMo/object-
storage credentials or `docker` binary exist in this environment, and no evidence anywhere in this
repository's own configuration indicates multi-instance deployment is planned. 413/413 tests pass
(6 new, 0 removed, 0 weakened), TypeScript clean, ESLint clean, production build clean, Prisma
schema valid, migrations up to date.

## 2. Phase 20 Baseline

Confirmed live before any change:

```
Tests:       407/407 passing (46 files)
TypeScript:  PASS (0 errors)
Lint:        PASS (0 errors/warnings)
Build:       PASS
Database:    PostgreSQL 17 (postgresql-x64-17), Running
Docker:      NOT AVAILABLE (`docker --version` -> command not found)
Payment:     Real MTN MoMo gateway client + HMAC-verified, idempotent webhook pipeline exist,
             pre-dating this phase; no real sandbox credentials
Storage:     Local-disk StorageProvider + authenticated RFQ/purchase-request document routes
             (Phase 20), no real object-storage credentials
Cron:        Four idempotent, cron-secret-protected sweep jobs, no external scheduler wired up
             inside this repository
Accessibility: One targeted defect (Catalog category filter, aria-pressed) found and fixed
             live in Phase 20; explicitly not a full WCAG audit
Deployment:  Dockerfile reviewed, never built or run (Docker unavailable)
```

One transient environment issue was hit and resolved during this phase's own baseline re-checks:
the local PostgreSQL Windows service (`postgresql-x64-17`) stopped mid-test-run partway through
this phase (cause unknown - not triggered by any file this phase touched, and it had been running
continuously through Phases 18-20's own multi-hour sessions), producing 32 failed test files with
`Can't reach database server at 127.0.0.1:5432`. Restarted via `Start-Service
postgresql-x64-17`, re-ran the full suite immediately after: clean, 413/413 (see Test Results). No
code caused this, and no code was changed in response to it - it is recorded here only in the
interest of "do not hide uncertainty."

## 3. Deployment Target

Determined from the repository itself, not invented:

- **Hosting model**: platform-agnostic. `Dockerfile` builds a standard Next.js `output:
  'standalone'` image (`node server.js`) that runs on any container host; `DEPLOYMENT.md` (this
  phase, updated) documents three concrete scheduler options (Vercel Cron, a GitHub Actions
  scheduled workflow, or system crontab) without picking one - the repository itself doesn't
  commit to a single hosting provider.
- **Node runtime**: `>= 22` (`package.json` `engines`; `Dockerfile` uses `node:22-alpine`).
- **PostgreSQL hosting**: any PostgreSQL 17-compatible instance reachable via `DATABASE_URL` - no
  managed-Postgres-provider-specific code exists anywhere (no RDS/Neon/Supabase-specific SDK
  calls); `sslmode` is whatever the connection string itself specifies, not hardcoded.
- **Environment variables**: fully enumerated in `.env.example` (updated this phase - see Section
  11).
- **Persistent filesystem**: required only if `LocalDiskStorageProvider` remains active (the
  default, since no `STORAGE_*` vars are set anywhere) - `.uploads/` must survive between requests
  on whichever instance serves them. Not required once `S3StorageProvider` is configured.
- **External scheduler**: required for all four cron jobs - nothing in this repository invokes
  them on a timer (see Section 8/9).
- **Webhooks**: `POST /api/webhooks/payments/[provider]` must be reachable from the public
  internet by a real payment gateway - requires a public HTTPS URL once a real gateway is
  configured; not required while gateways run in fallback/simulation mode.
- **Object storage**: optional - required only for a real multi-instance deployment of the
  document-upload feature (Section 5).
- **TLS/HTTPS**: not implemented inside this application (no code terminates TLS) - this is
  correctly deployment-platform responsibility (a reverse proxy, load balancer, or platform edge
  terminates TLS in front of the Next.js process); `session.ts`'s own cookie is `secure: true` only
  when `NODE_ENV=production`, which assumes TLS is present at that point, consistent with this
  model.
- **Domain**: not hardcoded anywhere in application code - `PAYMENT_WEBHOOK_SIGNING_SECRET`/
  `CRON_SECRET` are the actual authenticity mechanisms, not a domain allowlist.
- **Single- vs multi-instance**: **single-instance is the only model this repository's own
  configuration currently supports correctly** - the in-memory rate limiter (`rate-limit.ts`) and
  `LocalDiskStorageProvider` (default) are both instance-local state. No `docker-compose.yml`, no
  Kubernetes manifest, no load-balancer configuration exists anywhere in this repository to
  suggest multi-instance deployment is actually planned (re-confirmed this phase, unchanged from
  Phase 20's own finding).

**No infrastructure decision was invented this phase.** Where the repository doesn't commit to a
specific platform (which managed Postgres, which object-storage provider, which scheduler), this
report documents that as a real open decision for whoever deploys this application, not a
silently-chosen default.

## 4. Production Database Readiness

```
npx prisma validate       -> "The schema at prisma\schema.prisma is valid"
npx prisma migrate status -> "12 migrations found in prisma/migrations" / "Database schema is up to date!"
```

- **Migration ordering**: 12 migrations, all already applied to the local dev database in the
  order they were created; `prisma migrate status` reports no drift.
- **Startup behavior**: `env.ts`'s `required('DATABASE_URL')` throws immediately if unset - the
  app fails to start rather than serving requests against an undefined database.
- **Connection configuration/SSL**: entirely delegated to the `DATABASE_URL` connection string
  itself (e.g. `?sslmode=require` for a managed provider that needs it) - no separate SSL toggle
  exists in `env.ts`, which is correct: Prisma's own connection string format already covers this,
  and duplicating it would be exactly the kind of redundant configuration surface to avoid.
- **Connection pooling**: Prisma's own default connection pool (`db.ts` instantiates one
  `PrismaClient` per process, reused across requests - not one per request) - no `pgbouncer`/
  external pooler is configured in this repository; a production deployment fronting Postgres with
  a connection pooler (common for serverless/many-instance deployments) is a deployment-time
  decision, not something this phase's own code needs to change.
- **Transaction behavior**: unchanged - `webhook.service.ts`'s `db.$transaction` (payment +
  invoice + order state updates) and the job files' atomic conditional-updates were re-read this
  phase (Objective E/F below) and confirmed still correct.
- **No new migration was created this phase.** The `Document` model (used by this phase's storage
  work) was already fully defined in the schema before this phase started - this phase added
  application code (a new `S3StorageProvider` implementation) on top of an existing table, not a
  schema change. No destructive command was run. No database was reset.

## 5. Object Storage

### Audit (before any change)

Re-read `StorageProvider.ts`, `LocalDiskStorageProvider`, and `documents.service.ts` in full - the
existing abstraction (Phase 20) is sound: a two-method interface (`store`/`retrieve`/`delete`),
selected once, with `documents.service.ts` never aware of which backend is behind it. **Neither
the interface nor `documents.service.ts` was changed this phase** - exactly the brief's own
instruction to preserve both.

### What was added

- **`src/server/env.ts`**: `optionalS3Storage()` reads `STORAGE_BUCKET`/`STORAGE_REGION`/
  `STORAGE_ACCESS_KEY_ID`/`STORAGE_SECRET_ACCESS_KEY`/`STORAGE_ENDPOINT`, returning `null` (the
  same "null, not empty strings" convention `optionalMobileMoneyGateway` already uses) unless all
  four required fields are set. None are set in this environment.
- **`src/server/services/storage/s3Storage.ts`**: `S3StorageProvider`, built on the official
  `@aws-sdk/client-s3` (added as a new dependency - the only new dependency this phase introduces,
  justified because hand-rolling AWS SigV4 request signing would be exactly the kind of risky,
  hard-to-verify-without-real-infrastructure reinvention the brief warns against; the official SDK
  is the industry-standard, safest choice). `endpoint` is optional and `forcePathStyle` is enabled
  whenever it's set, so this works against real AWS S3 (leave `endpoint` unset) or any
  S3-compatible provider - Cloudflare R2, DigitalOcean Spaces, MinIO, Backblaze B2 - matching the
  brief's explicit "S3-compatible", not "AWS-only", requirement. `retrieve()` maps the SDK's own
  `NoSuchKey` error onto `LocalDiskStorageProvider`'s existing "return `null`, never throw"
  contract for a missing object, so `documents.service.ts`'s own `getDocumentForDownload` behaves
  identically regardless of which provider is active.
- **`src/server/services/storage/index.ts`**: the one selection line now reads
  `env.STORAGE ? new S3StorageProvider(env.STORAGE) : new LocalDiskStorageProvider()` - mirrors
  `payment/providers.ts`'s own `env.MTN_MOMO === null ? fallback : realGateway` pattern exactly.
  Resolves to `LocalDiskStorageProvider` in this environment, unchanged from Phase 20's actual
  runtime behavior.
- **`.env.example`**: documented the exact four (plus one optional) variables, what setting them
  does, and the honest caveat that this has been verified with the SDK's own commands mocked, not
  against a real bucket.

### What was NOT added

No new object-storage credentials were invented or hardcoded. No real S3-compatible bucket was
created or connected to. `documents.service.ts` was not touched - the exact same upload/download/
delete/ownership/MIME/size/path-traversal logic Phase 20 already tested with 18 real route-level
tests continues to run unchanged, now simply capable of writing through a different backend if one
is ever configured.

### Tests (5 new, `s3Storage.test.ts`, `S3Client.send` mocked)

| Case | Result |
|---|---|
| `store()` sends a `PutObjectCommand` with the exact bucket/key/body/length | Verified |
| `retrieve()` sends a `GetObjectCommand` and returns the real bytes as a `Buffer` | Verified |
| `retrieve()` returns `null` (never throws) when the SDK reports `NoSuchKey` | Verified |
| `retrieve()` re-throws a genuine transport/auth error, not silently swallowed as "not found" | Verified |
| `delete()` sends a `DeleteObjectCommand` with the exact bucket/key | Verified |

**Explicitly classified `PROVIDER ADAPTER TEST`, not a real integration/round-trip test** - the
same distinction Phase 20 already established for the payment gateway's own adapter tests. The 18
existing `documents.routes.test.ts` tests (upload/download/delete/tenant isolation/oversized/
invalid-MIME/path-traversal) all continue to run against the real local-disk backend, unchanged
and still passing - they were not modified to also cover S3, since doing so without a real bucket
would mean either mocking the exact same thing `s3Storage.test.ts` already mocks (redundant) or
silently skipping real verification while claiming coverage.

**Classification: `IMPLEMENTED` (code exists, adapter-tested). `REAL PROVIDER NOT VERIFIED` - no
real S3-compatible bucket or credentials exist anywhere in this environment.** A production,
multi-instance deployment of this feature **REQUIRES EXTERNAL INFRASTRUCTURE** (a real bucket +
credentials) before `S3StorageProvider` should be relied on; `LocalDiskStorageProvider` remains
correct and fully verified for local development or a genuinely single-instance deployment.
`.uploads/` is never served through the public web root - confirmed unchanged from Phase 20 (it
lives outside `public/` and outside the Next.js build output; download only ever happens through
the authenticated `GET /api/documents/[documentId]` route, which streams bytes after checking
ownership, never a static file URL).

## 6. Payment Provider

### Audit (re-confirmed, not re-implemented)

Re-read `momoGatewayClient.ts`, `mobileMoneyProvider.ts`, `webhook.service.ts`,
`pendingPaymentSweep.ts`, and the full payment test suite. Confirmed unchanged from Phase 20's own
audit: a real MTN MoMo Collections "Request to Pay" client (OAuth2 token, `POST .../requesttopay`,
poll `GET .../requesttopay/{id}`), fallback-to-simulation when credentials are unset (true for
every network in this environment), and fail-closed (not silent fallback) on a real transport/auth
error once configured.

### Real gap found and fixed this phase

**None of the three `fetch` calls in `momoGatewayClient.ts` carried a timeout.** A hung TCP
connection to the gateway (a real, observable failure mode for any third-party HTTP dependency)
would have hung `getAccessToken`/`requestToPay`/`getStatus` - and therefore a checkout request or
a reconciliation sweep - indefinitely, with no bound. **Fixed**: every `fetch` call now passes
`signal: AbortSignal.timeout(10_000)`. Verified by a new test (`gateways.test.ts`) that simulates
the exact `DOMException`/`TimeoutError` `AbortSignal.timeout()` produces on firing, confirming the
existing fail-closed `catch` block in `mobileMoneyProvider.ts` correctly treats a timeout exactly
like any other transport failure (`FAILED`, with the same user-facing message - "Could not reach
the mobile money gateway. Please try again." - not a hang, not a false success).

### Environment credentials

**REQUIRES EXTERNAL CREDENTIALS.** Checked for `MTN_MOMO_API_USER`/`MTN_MOMO_API_KEY`/
`MTN_MOMO_SUBSCRIPTION_KEY`/`MTN_MOMO_BASE_URL`/`MTN_MOMO_TARGET_ENVIRONMENT` (the repository's
actual variable names) and their Telecel Cash/AirtelTigo Money equivalents - none are set in this
environment (`.env`, `.env.example` both confirm every value is empty). No credentials were
invented. No sandbox round-trip was performed. No sandbox transaction was fabricated.

```
MTN MoMo implementation:       IMPLEMENTED
Local/adapter provider tests:  VERIFIED (10 tests, gateways.test.ts, fetch mocked)
Sandbox credentials:           NOT AVAILABLE
Real sandbox round-trip:       NOT VERIFIED
Production status:             REQUIRES EXTERNAL CREDENTIALS
```

The exact remaining verification procedure, for whoever obtains real credentials: sign up for a
free MTN MoMo Collections sandbox subscription at momodeveloper.mtn.com, set
`MTN_MOMO_SUBSCRIPTION_KEY`/`MTN_MOMO_API_USER`/`MTN_MOMO_API_KEY` in a real `.env`, then exercise
a real checkout with `MTN_MOMO` selected as the payment method - `mobileMoneyProvider.ts` will
automatically switch from simulation to the real HTTP flow the moment those three variables are
all present, with no code change required.

## 7. Payment Security

Re-verified this phase (all VERIFIED by direct code re-reading, not re-implemented):

| Check | Status | Evidence |
|---|---|---|
| Server-side payment amount | VERIFIED | `PaymentWebhookPayload` has no `amount` field at all - `processPaymentWebhook` always re-reads it from the `Payment` row, never from webhook input |
| Server-side currency | VERIFIED | Same - no `currency` field in the webhook payload |
| Tenant ownership | VERIFIED | Buyer-facing payment routes still go through `requireCompanyAccess`/`requireSupplierAccess`, unchanged |
| Payment ownership | VERIFIED | `db.payment.findUnique({where: {reference}})` resolves the real owning record; no payment is addressable by anything else |
| Provider reference handling | VERIFIED | `NOT_FOUND` for an unrecognized reference (test: `webhook.service.test.ts`) |
| Webhook authenticity | VERIFIED | HMAC-SHA256 over the raw body, fails closed with no secret configured |
| HMAC constant-time comparison | VERIFIED | `crypto.timingSafeEqual`, re-read this phase, unchanged |
| Duplicate webhook handling | VERIFIED | Two independent idempotency guards (status-match, eventId-match), re-confirmed passing |
| Replay resistance | VERIFIED | The eventId guard specifically closes the "replay after status moved on for an unrelated reason" gap |
| Invalid event handling | VERIFIED | `PaymentWebhookSchema.safeParse` rejects a malformed body with 422 before ever reaching `processPaymentWebhook` |
| Failed provider requests | VERIFIED | `gateways.test.ts`'s REJECTED-response test |
| Timeout handling | **Fixed this phase** | See Section 6 - was a real gap, now covered |
| Provider transport errors | VERIFIED | Fails closed (`FAILED`), never a silent fallback, once a gateway is configured |
| Missing credentials | VERIFIED | Falls back to simulation - explicitly documented behavior, not a security gap (this app ships no real credentials, so this path is what every environment actually exercises) |
| Malformed provider responses | VERIFIED | `response.json().catch(() => ({}))` in `requestToPay`'s rejection path; `body.access_token` presence-checked in `getAccessToken` |
| Logging exposes no secrets | VERIFIED | `logger.ts`'s own key-based `SENSITIVE_KEY_PATTERN` redaction (password/token/secret/signature/authorization/cookie/card/cvv/pin/apikey), re-read this phase |
| Secrets never reach client bundles | VERIFIED | Zero `NEXT_PUBLIC_*` variables exist anywhere in `src/` (confirmed by grep this phase); every credential-reading module (`env.ts`, gateway clients, webhook service) carries `import 'server-only'` |

No fake payment success path was introduced. No existing test was weakened.

## 8. Background Jobs

Re-audited all four (`invoiceDueSweep`, `lowStockSweep`, `pendingPaymentSweep`, `runDueSchedules`)
by re-reading each in full - unchanged from Phase 20's own findings, all four remain genuinely
idempotent:

- `invoiceDueSweep`/`lowStockSweep`: conditional `updateMany`/24h-dedupe-window, safe to re-run or
  overlap.
- `pendingPaymentSweep`: polls the gateway's own status endpoint - re-polling is inherently safe,
  the gateway is the source of truth.
- `runDueSchedules` (recurring purchases): an atomic claim via `updateMany({where: {id, nextRunAt:
  occurrenceAt, active: true}, ...})` - the strongest of the four, a real optimistic-concurrency
  guard against two overlapping sweeps double-claiming the same due schedule.

`requireCronSecret` (re-read this phase): constant-time comparison, fails closed (401) whenever
`CRON_SECRET` is unset - unchanged, still correct.

No new job or queue was created - per the brief's own instruction, and because every real
candidate already has a secured, idempotent, cron-triggerable implementation (re-confirmed, no new
candidate emerged this phase).

## 9. Scheduler

**`IMPLEMENTED - EXTERNAL SCHEDULER REQUIRED`.** Nothing in this repository invokes any of the
four `/api/cron/*` routes on a timer. `DEPLOYMENT.md` (updated this phase) documents three concrete
scheduler options (Vercel Cron, a GitHub Actions scheduled workflow, system crontab + curl)
without the repository committing to one - consistent with the platform-agnostic deployment target
found in Section 3. No scheduler was added this phase, since none is currently configured for any
real target environment.

## 10. Docker

```
docker --version  -> command not found
docker info       -> command not found
```

**NOT VERIFIED - Docker unavailable**, unchanged from Phase 20. No claim is made that the image
builds, runs, or connects to a database. The `Dockerfile` itself was not modified this phase (per
the brief's own "do not rewrite the Dockerfile before testing it" instruction - there was nothing
to test it against). `DEPLOYMENT.md`'s own top note (unchanged, already accurate) states this
plainly: "reviewed, not run end-to-end in this environment."

## 11. Environment Variables

Every variable, classified:

| Variable | Classification | Notes |
|---|---|---|
| `DATABASE_URL` | Required in production | App fails to start without it |
| `AUTH_SECRET` | Required in production | App fails to start without it |
| `SESSION_TTL_SECONDS` | Optional | Has a working default (604800s / 7 days) |
| `NODE_ENV` | Required (has default) | Defaults to `development`; controls `secure` cookie flag and CSP enforcement |
| `PAYMENT_WEBHOOK_SIGNING_SECRET` | Required in production for real webhooks / External-service credential | Route fails closed (401) while unset, doesn't block app startup |
| `CRON_SECRET` | Required in production for real cron / reserved until a scheduler is wired | Routes fail closed (401) while unset |
| `MTN_MOMO_*` / `TELECEL_CASH_*` / `AIRTELTIGO_MONEY_*` | External-service credential | App runs correctly without them (simulation mode) |
| `STORAGE_BUCKET` / `STORAGE_REGION` / `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` / `STORAGE_ENDPOINT` | External-service credential (this phase: newly wired, still unset in every real environment) | Falls back to local disk while any is unset |
| `REDIS_URL` | Reserved/future | Not read anywhere in `src/` - confirmed by grep this phase, unchanged from Phase 20 |
| `CSP_ENFORCED` | Development-only | Emergency rollback switch; production enforces CSP by default regardless |
| `NEXT_PUBLIC_*` | N/A | **Zero such variables exist anywhere in this codebase** - confirmed by grep this phase |

**Unsafe-if-exposed-client-side check**: every module reading a credential (`env.ts` itself, both
gateway client files, `webhook.service.ts`) carries `import 'server-only'`, which is a Next.js
build-time enforcement - importing any of them from a `'use client'` file is a build error, not
just a lint warning. **No hardcoded secrets, API keys, passwords, tokens, or connection strings**
were found in any file this phase touched or reviewed (`env.ts`, `s3Storage.ts`,
`momoGatewayClient.ts`, `Dockerfile`, `.env.example`, `DEPLOYMENT.md`). No secret value is printed
anywhere in this report. `.env` itself is confirmed `.gitignore`d and not tracked by git (checked
this phase via `git check-ignore .env`).

## 12. Rate Limiting / Redis Decision

Re-determined, unchanged from Phase 20: this deployment is **single-instance** by every piece of
actual evidence in the repository (no `docker-compose.yml`, no Kubernetes manifest, no
load-balancer configuration, `REDIS_URL` read nowhere in `src/`). The current in-process
`Map<string, Bucket>` rate limiter (`rate-limit.ts`) remains correct for this model, with its
single-instance limitation already documented in the file's own comments and in `DEPLOYMENT.md`.

**`REDIS DEFERRED`** - not added, per the brief's own explicit instruction not to introduce Redis
without a concrete multi-instance deployment requirement, and none exists in this repository's own
configuration. If multi-instance deployment is later adopted, the rate limiter is the one
component in this codebase that would need a shared store - background jobs are already
instance-agnostic (Section 8), and sessions are already database-backed, not server-side
in-memory, so neither needs Redis for that reason.

## 13. Accessibility

Extended, not repeated - Phase 20's own targeted sweep (clickable non-interactive elements, missing
alt text, color-only indicators, tab/radio patterns, icon-only buttons) is not re-run from scratch;
this phase specifically checked the areas the brief additionally named that Phase 20 didn't cover:

- **Notifications (`NotificationBell.tsx`)**: re-read in full. The trigger button's `aria-label`
  dynamically includes the unread count (`"Notifications (3 unread)"`), and each unread item in the
  dropdown carries a labeled dot (`aria-label="Unread"`), never color alone - both **VERIFIED,
  already correct**. **One real, honestly-scoped limitation, not fixed**: there is no `aria-live`
  region announcing a *newly arrived* notification while focus is elsewhere - a screen-reader user
  only learns about a new notification by returning focus to the bell. Not fixed this phase: the
  component already polls every 20 seconds, and an `aria-live="polite"` region announcing every
  poll's result indiscriminately risks being more disruptive than helpful without careful
  throttling logic this phase didn't judge as clearly justified by the evidence gathered - a real,
  judged trade-off, not an oversight, documented as a limitation rather than silently left out of
  the report.
- **Dialogs (`Dialog.tsx`)**: re-confirmed **zero real usage anywhere in `src/app`/`src/features`**
  (grep, this phase) - unchanged from Phase 20's own finding. Re-read the component: it has no
  focus trap (Tab can move focus to background content while "open") - a real, latent defect in
  code that has never been live-exercised. **Not fixed this phase** - hardening dead code with no
  verification path (nothing renders it, so no live test could ever confirm a fix) was judged lower
  value than the object-storage and payment-timeout work actually completed; documented as a known
  limitation, consistent with Phase 20's own decision not to invest further in these four unused
  components until a real page adopts one.
- **Tables/row actions**: re-confirmed (via the live browser acceptance pass, Section 14) that the
  Orders/Invoices keyboard-accessible row fix from Phase 19 is still functioning correctly end to
  end in a real browser against the real backend.
- **Responsive layouts**: not re-verified at all three required viewport sizes this phase - no
  layout-affecting UI change was made (Section 5/6's changes are backend-only), so there was no
  regression risk to check.

**No automated accessibility scanner was introduced this phase.** None was already present; adding
one is a real dependency/maintenance decision, and this phase's own findings (one documented,
judged-acceptable limitation; one documented, judged-lower-priority latent defect in dead code) did
not surface a systemic pattern that would clearly justify it over continuing targeted manual review.
**No WCAG conformance level is claimed.**

## 14. Browser Acceptance

Real standalone production server (`node .next/standalone/server.js`), real browser
(`agent-browser`), real backend APIs and real Postgres throughout - no mocked frontend state.

### Buyer (John Doe, Acme Technologies Ghana)

| Step | Result |
|---|---|
| Login (real email/password, multi-company picker, company selection) | PASS - reached `/dashboard` |
| Dashboard | PASS |
| Catalog | PASS |
| RFQs (list) | PASS |
| RFQ detail (real click-through from the list) | PASS - `/rfqs/cmu2c55tc0007kg2gbo54fgcz` rendered real RFQ content |
| Orders (list) | PASS |
| Order detail (real click via the Phase 19 keyboard-accessible row) | PASS - `/orders/cmu2caw0b0016kg2ggzr7tipu` rendered real order content |
| Invoices (list + detail) | PASS - detail page rendered with "Download / print" action present |
| Payments | PASS - a real `Failed` status row rendered correctly (confirmed this was real payment data, not an app error, by reading the full row) |
| Purchase requests, Cart, Budgets, Balance sheet, Analytics, Suppliers | PASS - all loaded without error |

### Supplier (Adwoa Mensah, ABC Tech, SUPPLIER_ADMIN)

| Step | Result |
|---|---|
| Login (account has no buyer workspace - the app's own "sign in with what it does have instead" path) | PASS |
| Dashboard, RFQs, Orders, Products, Analytics | PASS - all loaded without redirect or error |

### Admin (Grace Owusu, PLATFORM_ADMIN)

| Step | Result |
|---|---|
| Login | PASS |
| `/admin`, `/admin/audit`, `/analytics`, `/admin/products`, `/admin/orders`, `/admin/disputes` | PASS - all loaded without redirect to login (confirming admin authorization) |

### Live tenant-isolation check (positive control)

Using the real, authenticated supplier session for Kofi Boateng (Prime Office Supplies - genuinely
unrelated to the buyer's RFQ), executed `fetch('/api/rfqs/cmu2c55tc0007kg2gbo54fgcz')` directly
from the live browser console against the real running server: **response status 404** - the
generic, IDOR-safe not-found this codebase's convention specifies, not a distinct 403 that would
confirm the record's existence. This is real, live, positive evidence of tenant isolation working
end-to-end through the full stack (browser -> real session cookie -> real route -> real
`requireCompanyAccess`/`ownsRecord` check -> real Postgres), not a unit test in isolation.

No failures were found in this pass. Full RFQ-to-payment negotiation/quote/approval sub-flows (form
submissions, not just navigation) were not each individually re-exercised this phase - they were
live-verified in earlier phases (18/19) and no code this phase touched affects them; this pass
focused on navigation-level regression across every major route plus one real security check,
given the phase's actual code changes were backend/infrastructure, not UI flow changes.

## 15. Tenant Isolation

Re-ran the full existing test suite (413/413 passing, including every pre-existing tenant-isolation
test from Phases 14-20) plus the one live browser check in Section 14. Specifically re-confirmed
via existing, passing tests (not re-litigated from scratch, since no authorization code was changed
this phase):

- Buyer A cannot access buyer B data - `company.routes.test.ts`, `procurement.routes.test.ts`, etc.
- Supplier A cannot access supplier B data - `procurement.routes.test.ts`'s uninvited-supplier tests
- Buyer cannot access another buyer's documents - `documents.routes.test.ts` (Phase 20, 18 tests,
  re-run this phase, all passing)
- Supplier cannot access unrelated RFQs - re-confirmed live (Section 14) with a real fetch, not
  just a test
- Purchase-request documents are isolated - `documents.routes.test.ts`
- Invoices/payments remain tenant-scoped - `invoices.routes.test.ts`, `payment.routes.test.ts`
- Orders remain tenant-scoped - `orders.service.test.ts` and related route tests
- Admin-only routes remain protected - live-verified this phase (Section 14): the admin account
  reached `/admin/*` routes; re-confirmed via existing RBAC tests that a non-admin role cannot
- `companyId`/`supplierId` never accepted as an authorization source from the browser -
  `requireCompanyAccess`/`requireSupplierAccess` re-read this phase, unchanged: both always
  re-derive the caller's real tenant from the verified session, never from the URL/body alone

**No authorization was loosened anywhere this phase.**

## 16. Security Regression

| Area | Status |
|---|---|
| Session hashing | VERIFIED (unchanged) - SHA-256 of the token, never the raw token, persisted |
| Cookie flags | VERIFIED (unchanged) - httpOnly, sameSite=lax, secure in production |
| Expiry | VERIFIED (unchanged) - `SESSION_TTL_SECONDS`-based expiry |
| Logout/stale sessions | VERIFIED (unchanged) - not touched this phase |
| Company/supplier/admin/cron access | VERIFIED (unchanged) - re-read `require.ts` in full this phase, no modification |
| CSRF (same-origin on mutations) | VERIFIED (unchanged) - `isSameOrigin` re-confirmed still called by every mutating route this phase touched (none were - documents/payment routes weren't modified) |
| CSP (nonce, production enforcement) | VERIFIED (unchanged) - not touched this phase |
| Rate limits (login/procurement/documents/payment/webhook) | VERIFIED (unchanged) - re-read `rate-limit.ts`'s bucket definitions, none modified |
| Input validation (Zod, path/query params) | VERIFIED (unchanged) - not touched this phase |
| File security (MIME/size/traversal/authorization) | VERIFIED (unchanged) - `documents.service.ts` not modified; its 18 tests re-run, all still passing |
| Payment security (HMAC/idempotency/server-side state) | VERIFIED - see Section 7 in full |
| Error handling (generic message/requestId/no stack traces/no secret leakage) | VERIFIED (unchanged) - `errors.ts` not touched; `logger.ts`'s redaction re-read and confirmed |

No test was weakened, skipped, or converted from integration to unit to force a pass. No broad
`try/catch` was added to hide a failure - the one new `try/catch`-shaped code this phase added
(`S3StorageProvider.retrieve`'s `NoSuchKey` handling) re-throws every error it doesn't specifically
recognize as "not found," matching the brief's own "don't hide failures behind broad try/catch"
instruction.

## 17. OpenAPI Status

Re-inspected: response DTOs remain TypeScript-only, not machine-readable schemas - the same gap
Phase 20 found, unchanged by anything this phase touched (this phase's own new routes were zero -
`S3StorageProvider` is not itself an API surface, it's swapped in behind an existing one).
Generating an accurate spec today would still require either a codegen pipeline this project
doesn't have, or hand-authoring documentation that risks drifting from the real implementation.

**`DEFERRED - CONTRACT FOUNDATION EXISTS`** - Option B, unchanged reasoning from Phase 20. No
inaccurate documentation was generated.

## 18. Test Results

```
Before: 407 (46 files)
After:  413 (47 files)
Added:  6
Removed: 0
Modified: 0
Weakened: 0
```

All 6 new tests: 5 in `src/server/services/storage/s3Storage.test.ts` (Object storage, Section 5),
1 in `src/server/services/payment/gateways/gateways.test.ts` (the timeout fail-closed test, Section
6). No existing test file was modified. No existing assertion was strengthened, weakened, skipped,
or converted between integration and unit style.

## 19. Build Results

```
npx vitest run --no-file-parallelism  -> 47 files, 413 tests, all passing
npx tsc --noEmit                       -> clean, 0 errors
npx eslint .                           -> clean, 0 errors/warnings
npm run build                          -> clean, production build succeeds
```

Run in full after every functional code change this phase (momoGatewayClient timeout, S3 storage
provider + env wiring) - all four commands clean at the final checkpoint.

## 20. Migration Status

```
npx prisma validate       -> valid
npx prisma migrate status -> 12 migrations, database schema up to date
```

No migration was created, modified, or rolled back this phase. No destructive command was run
against any database.

## 21. Deployment Checklist

**Application**
- [x] authentication - VERIFIED live this phase (real login flow, 3 accounts)
- [x] authorization - VERIFIED (tests + live admin/supplier/buyer checks)
- [x] tenant isolation - VERIFIED (tests + live cross-tenant fetch returning 404)
- [x] error handling - VERIFIED (unchanged, re-confirmed)
- [x] CSP - VERIFIED (unchanged, not touched)
- [x] CSRF - VERIFIED (unchanged, not touched)
- [x] rate limiting - VERIFIED for single-instance; DEFERRED for multi-instance (Redis)
- [x] pagination - IMPLEMENTED (Phase 19, unchanged)
- [x] database migrations - VERIFIED (valid, up to date)

**Payments**
- [x] provider abstraction - IMPLEMENTED, unchanged
- [ ] real sandbox - REQUIRES EXTERNAL CREDENTIALS
- [x] webhook - IMPLEMENTED, VERIFIED (tests)
- [x] HMAC - VERIFIED
- [x] idempotency - VERIFIED
- [x] pending polling - IMPLEMENTED, VERIFIED (adapter tests)
- [ ] production credentials - REQUIRES EXTERNAL CREDENTIALS

**Storage**
- [x] upload - VERIFIED (18 tests, local disk)
- [x] download - VERIFIED (18 tests, local disk)
- [x] delete - VERIFIED (18 tests, local disk)
- [x] ownership - VERIFIED (tenant-isolation tests)
- [x] MIME validation - VERIFIED
- [x] size validation - VERIFIED
- [ ] production object storage - IMPLEMENTED (adapter-tested), REQUIRES EXTERNAL INFRASTRUCTURE

**Jobs**
- [x] invoice sweep - IMPLEMENTED, idempotent
- [x] low-stock sweep - IMPLEMENTED, idempotent
- [x] pending payment sweep - IMPLEMENTED, idempotent
- [x] recurring purchases - IMPLEMENTED, idempotent (atomic claim)
- [x] cron authentication - VERIFIED (`requireCronSecret`, fails closed)
- [ ] external scheduler - NOT CONNECTED (documented requirement, not a code gap)

**Deployment**
- [x] production build - VERIFIED (clean)
- [ ] Docker - NOT VERIFIED (unavailable in this environment)
- [ ] runtime (containerized) - NOT VERIFIED (same reason)
- [x] health endpoint - VERIFIED (live, standalone server, both `/api/health` and `/api/ready`)
- [x] database connectivity - VERIFIED (live health check + full test suite against real Postgres)
- [x] secrets - VERIFIED (none hardcoded, none client-exposed, `.env` gitignored)
- [ ] TLS - OUT OF SCOPE (deployment-platform responsibility by design)
- [x] environment configuration - VERIFIED (fully documented in `.env.example`, this phase updated)

**Accessibility**
- [x] keyboard navigation - VERIFIED (Phases 19-20, re-confirmed live this phase for Orders)
- [x] focus - VERIFIED for live-exercised components; NOT VERIFIED for the four unused Dialog/
      Drawer/DropdownMenu/ConfirmationDialog components (documented limitation)
- [ ] dialogs - see above (unused in the live app)
- [x] forms - VERIFIED (Phase 19's login radiogroup fix, re-confirmed unchanged)
- [x] navigation - VERIFIED (sidebar collapsed-state fix, Phase 19, re-confirmed unchanged)
- [x] tables - VERIFIED (Orders/Invoices row keyboard access, live-confirmed again this phase)
- [x] status indicators - VERIFIED (StatusBadge always pairs color with text; NotificationBell's
      unread dot has a real accessible label)
- [x] responsive behavior - VERIFIED in Phases 19-20; not re-verified this phase (no layout change)

**Testing**
- [x] unit - VERIFIED (413 passing)
- [x] integration - VERIFIED (real-Postgres route-level tests, 413 passing)
- [x] tenant isolation - VERIFIED (tests + live check)
- [x] browser acceptance - VERIFIED (Section 14, real backend, all three roles)
- [ ] payment sandbox - REQUIRES EXTERNAL CREDENTIALS
- [x] storage - VERIFIED (local disk, 18 tests) / adapter-tested (S3, 5 tests)
- [x] jobs - VERIFIED (pre-existing tests, re-confirmed passing)
- [x] build - VERIFIED (clean)

## 22. Known Limitations

- Real MTN MoMo (or Telecel Cash/AirtelTigo Money) sandbox round-trip has never been performed -
  `REQUIRES EXTERNAL CREDENTIALS`.
- `S3StorageProvider` has never been exercised against a real S3-compatible bucket - `REQUIRES
  EXTERNAL INFRASTRUCTURE`; `LocalDiskStorageProvider` (the active default) is unsuitable for
  multi-instance deployment.
- Docker has never been built or run in any environment this project's work has had access to -
  `NOT VERIFIED`.
- No external scheduler is currently connected to the four cron routes - a deployment-time
  configuration step, not a code gap.
- `Dialog.tsx` has no focus trap - a real, latent defect, but in a component with zero live usage
  anywhere in the application, so it has no current user-facing impact and was not fixed this
  phase (documented judgment call, not an oversight).
- `NotificationBell` does not proactively announce newly-arrived notifications via an ARIA live
  region while focus is elsewhere - a real, judged trade-off (avoiding disruptive/unthrottled
  announcements from a 20-second poll), documented rather than silently omitted.
- OpenAPI generation remains deferred - response DTOs are not yet machine-readable schemas.
- Redis remains deferred - no concrete multi-instance deployment plan exists in this repository's
  own configuration to design against.
- No automated accessibility scanner is installed - all accessibility findings across Phases
  19-21 are from manual code review and live spot-verification, not tool output.
- Sustained-load testing (Phase 19) was not re-run this phase - no code change this phase affects
  request-handling performance characteristics.

## 23. External Dependencies

Required for full production operation, none of which this phase can provide:

- Real MTN MoMo (and/or Telecel Cash/AirtelTigo Money) merchant credentials.
- A real S3-compatible object-storage bucket and credentials (AWS S3, Cloudflare R2, DigitalOcean
  Spaces, MinIO, Backblaze B2, or equivalent) - required only for multi-instance deployment of the
  document-upload feature.
- An external scheduler (Vercel Cron, a GitHub Actions scheduled workflow, or system crontab) to
  invoke the four `/api/cron/*` routes.
- A container runtime (Docker or equivalent) to build and verify the existing `Dockerfile`, if a
  containerized deployment path is chosen.
- A managed or self-hosted PostgreSQL 17-compatible instance for production data (this repository
  makes no assumption about which provider).
- TLS termination (a reverse proxy, load balancer, or platform edge) in front of the application
  process.

One new package dependency was added this phase: **`@aws-sdk/client-s3`** (the official AWS SDK
v3 S3 client) - justified in Section 5; introduces zero new vulnerabilities per `npm audit` (all
flagged vulnerabilities in this repository are pre-existing devDependency tooling issues -
vitest/vite/esbuild, Prisma's `deepmerge-ts` - unrelated to this addition, all requiring a breaking
major-version upgrade out of this phase's scope).

## 24. Final Readiness Matrix

| Area | Status | Evidence | Limitation |
|---|---|---|---|
| Authentication | VERIFIED | Real login flow, 3 accounts, live this phase | None found |
| Authorization | VERIFIED | RBAC tests + live admin/supplier/buyer role checks | None found |
| Tenant Isolation | VERIFIED | 413 passing tests + live cross-tenant fetch returning 404 | None found |
| CSP | VERIFIED (unchanged) | Phase 17's own live verification; not touched this phase | Not re-verified this phase (no change) |
| CSRF | VERIFIED (unchanged) | `isSameOrigin` re-read, unchanged | Not touched this phase |
| Error Handling | VERIFIED (unchanged) | `errors.ts`/`logger.ts` re-read, unchanged | Not touched this phase |
| Rate Limiting | VERIFIED for single-instance | In-memory `Map`, correct for current deployment model | Insufficient for multi-instance (documented, deferred) |
| Pagination | IMPLEMENTED (unchanged) | Phase 19's own work | Not touched this phase |
| Payment Provider | IMPLEMENTED | Real gateway client + timeout fix this phase, 10 adapter tests | Never exercised against a real gateway |
| Payment Sandbox | NOT VERIFIED | No credentials in this environment | REQUIRES EXTERNAL CREDENTIALS |
| Payment Webhook | VERIFIED | HMAC + 2-layer idempotency, 12+ tests re-confirmed passing | None found |
| File Storage | VERIFIED | 18 real tests, local disk, real tenant isolation | Local disk unsuitable for multi-instance |
| Object Storage | IMPLEMENTED | S3-compatible provider, 5 adapter tests (mocked SDK) | REQUIRES EXTERNAL INFRASTRUCTURE - never run against a real bucket |
| Background Jobs | IMPLEMENTED | 4 idempotent jobs, re-audited this phase | No external scheduler connected |
| External Scheduler | NOT CONNECTED | Documented in `DEPLOYMENT.md` (3 concrete options) | Deployment-time configuration required |
| Docker | NOT VERIFIED | `docker` unavailable; `Dockerfile` statically reviewed only | Never built or run |
| Database | VERIFIED | `prisma validate`/`migrate status` clean; real Postgres backs all 413 tests | None found |
| Accessibility | VERIFIED (targeted scope) | Phase 19-21 fixes, live-confirmed; 2 documented limitations (dead-code Dialog, NotificationBell live region) | Not a full WCAG audit |
| Browser Acceptance | VERIFIED | Real backend, 3 roles, ~20 routes, 1 live security check, this phase | Sub-flow form submissions not re-exercised (unchanged code) |
| OpenAPI | DEFERRED | Response DTOs not machine-readable; Option B (documented contract) | Full generation blocked on DTO format |
| Redis | DEFERRED | No multi-instance evidence in this repository's own configuration | Would be needed if that changes |
| Load Testing | MEASURED (Phase 19, unchanged) | 10/25/50/100 concurrency, 0% errors, real numbers | Not re-run this phase (no perf-affecting change) |
| Production Deployment | NOT VERIFIED | Never deployed to any real target from this codebase | Docker unbuilt, no real credentials, no scheduler connected |

## 25. Final Go/No-Go Assessment

```
READY:                        Authentication, Authorization, Tenant Isolation, Database,
                               Background Jobs (code), File Storage (local), Browser Acceptance
READY WITH EXTERNAL DEPENDENCIES: Payment Provider (needs real credentials), Object Storage
                               (needs real bucket for multi-instance), External Scheduler (needs
                               a real scheduler connected), Docker (needs a real Docker build/run)
DEFERRED:                      OpenAPI, Redis
NOT VERIFIED:                  Docker, Payment Sandbox, Object Storage (real provider),
                               Production Deployment itself
BLOCKED:                       None - nothing in this codebase is blocked on a decision only a
                               human can make beyond supplying external credentials/infrastructure
```

### Required Before Production

Only genuine blockers - things that must happen, not merely could be improved:

1. **Obtain real payment-gateway credentials** (MTN MoMo and/or an alternative) and perform at
   least one real sandbox round-trip before accepting real payments - currently entirely
   unverified against a live gateway.
2. **Build and run the Docker image at least once** in an environment where Docker is available,
   verifying the checklist in Section 21's Deployment block - this has never been done anywhere in
   this project's history.
3. **Connect an external scheduler** to the four `/api/cron/*` routes - without one, invoices never
   automatically become OVERDUE, low-stock alerts never fire, and pending mobile-money payments
   are never reconciled.
4. **Decide and configure production object storage** if more than one application instance will
   ever run - `LocalDiskStorageProvider` silently loses files that were uploaded to a different
   instance the moment there's more than one.

### Recommended Before Production

Meaningful improvements, not blockers:

1. Run a real automated accessibility scan (axe-core or equivalent) at least once for a broader,
   tool-backed confirmation alongside this project's manual findings.
2. Fix `Dialog.tsx`'s missing focus trap before any page actually adopts it (currently zero
   real-world impact, but worth doing before that changes).
3. Verify TLS termination and `secure`-cookie behavior against the actual chosen hosting platform,
   since this application deliberately doesn't implement TLS itself.

### Post-Launch Work

Deferred items that are not blockers:

1. Full OpenAPI specification generation, once response DTOs are converted to machine-readable
   schemas.
2. Redis-backed rate limiting, only if and when multi-instance deployment is actually adopted.
3. An `aria-live` region for newly-arrived notifications, with real throttling design.
4. Extending Telecel Cash/AirtelTigo Money support once either network's actual endpoint paths are
   confirmed against real documentation or aggregator integration (currently unverified assumptions
   copied from MTN's shape).
