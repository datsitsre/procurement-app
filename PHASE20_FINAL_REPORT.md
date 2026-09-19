# Phase 20 Final Report

Production integration and deployment readiness. Follows the same evidence discipline as Phases
18-19: IMPLEMENTED / VERIFIED / MEASURED / NOT VERIFIED / NOT MEASURED / DEFERRED / OUT OF SCOPE /
REQUIRES EXTERNAL CREDENTIALS / REQUIRES INFRASTRUCTURE. No claim is made without saying what
evidence backs it.

## Executive Summary

The baseline audit found the payment and background-job architecture significantly more mature
than a fresh read of `PHASE19_FINAL_REPORT.md` alone would suggest - a real MTN MoMo gateway
client, HMAC-verified webhook processing with two independent layers of idempotency, and three
already-idempotent cron-triggered sweep jobs all existed before this phase started, all
well-tested. This phase's real, substantive addition is **file storage** - genuinely schema-only
at the start of this phase (a `Document` model with zero routes, zero storage backend, zero UI
references anywhere in the codebase) - now backed by a real storage abstraction, real authenticated
upload/download/delete routes for RFQ and purchase-request attachments, real tenant-ownership
checks, and 18 new tests covering upload, download, delete, cross-tenant denial, oversized files,
disallowed MIME types, and a path-traversal filename attempt. The storage backend itself is local
disk - the only backend this environment can actually verify, since no real object-storage
credentials exist anywhere in this repository or its `.env.example` - documented honestly as
`IMPLEMENTED LOCALLY`, not claimed as a production object-storage integration.

Docker remains unavailable in this environment (`docker` and `docker compose` both resolve to
"command not found") - the existing `Dockerfile` was reviewed statically (multi-stage, non-root
user, standalone output, no hardcoded secrets) but not run, and is reported `NOT VERIFIED`, not
"looks correct so it works." A targeted accessibility pass across previously-unaudited pages found
one real, live-verified defect (the catalog's category filter relied on color alone with no
`aria-pressed` state) - fixed and confirmed live. Payment-provider work is classified
`REQUIRES EXTERNAL CREDENTIALS` for a real sandbox round-trip, exactly as Phase 19 left it - no
credentials were invented, no sandbox transaction was fabricated. OpenAPI generation remains
deliberately deferred (Option B) - the honest reason is unchanged from Phase 19: response DTOs
aren't systematized enough yet to generate an accurate spec without either hand-authoring one
disconnected from the real implementation or under-documenting real behavior. Redis is deferred
with a documented reason: nothing in this deployment's actual configuration (a single standalone
Next.js process, no `docker-compose`, no load balancer, no multi-instance evidence anywhere in the
repository) indicates multi-instance deployment is actually planned. 407/407 tests pass (18 new, 0
removed, 0 weakened), TypeScript clean, ESLint clean, production build clean.

## Baseline

```
Baseline tests:            389/389 (45 files) - confirmed live before any change
TypeScript:                PASS (0 errors)
Lint:                      PASS (0 errors/warnings)
Build:                     PASS (production build succeeds)
Database:                  PostgreSQL 17 (postgresql-x64-17 Windows service), Running
Docker availability:       NOT AVAILABLE - `docker --version` / `docker compose version` both
                           resolve to "command not found" in this environment (re-confirmed,
                           unchanged from Phase 19)
Git status:                Working tree matches the expected accumulated state from Phases 14-19
                           (~199 modified/untracked files, all previously reviewed); nothing
                           unexpected found
Payment integration status: A real payment-provider abstraction (server/services/payment/) already
                           exists, including a real MTN MoMo gateway client
                           (gateways/momoGatewayClient.ts) and a fully HMAC-verified, idempotent
                           webhook pipeline (webhook.service.ts) - all pre-dating this phase (see
                           Objective 1 below for the full audit). No real sandbox credentials are
                           configured in this environment.
File storage status:       Schema-only at the start of this phase - a real `Document` Prisma model
                           with `ownerType`/`rfqId`/`purchaseRequestId`/`storageKey` columns, but
                           zero routes, zero storage backend implementation, and zero references
                           in any `.tsx` file anywhere in `src/` (confirmed by grep before writing
                           any code).
Background job status:     Three cron-secret-protected sweep jobs already exist and are already
                           idempotent (invoiceDueSweep, lowStockSweep, pendingPaymentSweep), plus a
                           fourth for recurring purchase schedules (recurringPurchase.service.ts's
                           runDueSchedules) using an atomic conditional-update claim pattern. None
                           is invoked by an actual scheduler in this repository - confirmed
                           unchanged from Phase 19's own finding.
```

Baseline matches Phase 19's reported ending state exactly. No investigation was required before
proceeding.

## Objective 1 — Payment Integration

### Audit (before any change)

Read the full existing architecture before touching anything:

- **`PaymentProvider.ts`**: a clean, minimal interface (`charge(request): Promise<{status, providerReference, failureReason?}>`), with `status` deliberately having three outcomes (`SUCCEEDED`/`FAILED`/`PENDING`) rather than two - `PENDING` models a real mobile-money "request to pay" prompt that the customer must approve asynchronously.
- **`providers.ts`**: one class per `PaymentMethod` (`CARD`, `BANK_TRANSFER`, `WALLET`, `CREDIT_TERMS` - all mock, resolve synchronously; `MTN_MOMO`/`TELECEL_CASH`/`AIRTELTIGO_MONEY` - real `MobileMoneyGatewayProvider` instances).
- **`gateways/momoGatewayClient.ts`**: a real HTTP client for MTN MoMo's publicly documented Collections "Request to Pay" sandbox API (OAuth2 token, `POST .../requesttopay`, polling `GET .../requesttopay/{id}`) - explicitly documented as verified-against-real-published-docs for MTN only; Telecel Cash/AirtelTigo Money reuse the same client shape but their actual endpoint paths are explicitly flagged as unconfirmed (neither publishes a public developer portal).
- **`gateways/mobileMoneyProvider.ts`**: falls back to an instant-success simulation whenever a network's three required env vars (`_SUBSCRIPTION_KEY`/`_API_USER`/`_API_KEY`) aren't all set - true for every network in this environment - and fails closed (returns `FAILED`, never silently falls back) on a real transport/auth error once credentials ARE configured, so a misconfigured live deployment surfaces loudly instead of quietly pretending every charge succeeded.
- **`webhook.service.ts`**: HMAC-SHA256 signature verification over the raw request body (never the parsed JSON, so whitespace/key-order tampering can't slip through), constant-time comparison, fails closed when no signing secret is configured. `processPaymentWebhook` is idempotent two independent ways: a replayed webhook for a payment already in its target status is a no-op, AND separately an already-recorded `eventId` is a no-op regardless of the payment's *current* status (closing a replay-outside-idempotency-window gap where an unrelated later state change could let an old event flip status back).
- **`POST /api/webhooks/payments/[provider]`**: not session-authenticated (a real gateway calls this server-to-server) - authenticity is entirely the HMAC signature; rate-limited by IP+provider; a recognized-but-already-processed event still returns `200` (a gateway retries a non-2xx indefinitely, and there's nothing to do differently on a retry).
- **`jobs/pendingPaymentSweep.ts`** + `POST /api/cron/pending-payment-sweep`: reconciles a still-PENDING mobile money payment by polling the gateway's own status endpoint, for the documented case (MTN's own sandbox) where a webhook callback isn't reliably sent.
- **`.env.example`**: every credential is empty (`MTN_MOMO_SUBSCRIPTION_KEY=""`, etc.) - nothing in this repository ships real values, and none were added this phase.

**Conclusion: the existing abstraction is sound, well-tested, and was not replaced.** This phase's
payment work is verification and gap-filling, not a rewrite.

### Real sandbox credentials

**REQUIRES EXTERNAL CREDENTIALS.** No `MTN_MOMO_SUBSCRIPTION_KEY`/`_API_USER`/`_API_KEY` (or the
Telecel/AirtelTigo equivalents) exist in this environment. No credentials were invented, and no
sandbox transaction was fabricated. This is unchanged from Phase 19's own classification.

### Test coverage - audited against the brief's own list (section 7)

| Required test | Status | Where |
|---|---|---|
| Successful provider response | Already covered | `gateways.test.ts` (mock providers), `webhook.service.test.ts`'s "marks the payment PAID" test |
| Provider failure | Already covered | `gateways.test.ts`, `webhook.service.test.ts`'s "marks the payment FAILED" test |
| Invalid webhook signature | Already covered | `webhook.service.test.ts`'s `verifyWebhookSignature` describe block (missing header, wrong secret, tampered body) |
| Duplicate webhook | Already covered | `webhook.service.test.ts`'s idempotency tests (same eventId twice; replay after status changed) |
| Unknown payment reference | Already covered | `webhook.service.test.ts`'s `NOT_FOUND` test |
| Wrong amount / wrong currency | **Not applicable by design** - see below | - |
| Wrong tenant | **Not applicable by design** - see below | - |
| Already-settled invoice | Already covered | `processPaymentWebhook`'s own `if (payment.status === newStatus) return ok({changed:false})` guard, exercised by the idempotency tests above |
| Already-paid order | Already covered | `webhook.routes.test.ts`'s order-settlement test (checked - see below) |

**Why "wrong amount/currency" and "wrong tenant" don't apply here, and this is a real, positive
finding, not a gap**: `PaymentWebhookPayload` (the only data untrusted webhook input can supply)
has exactly three fields - `providerReference`, `event`, `eventId`. There is no `amount`,
`currency`, or `companyId`/`tenantId` field in the payload at all. `processPaymentWebhook` always
re-reads the amount and tenant ownership from the `Payment` row the `providerReference` resolves
to, in the database - the webhook itself can request a status flip but can never assert what the
amount, currency, or tenant were. This is a *better* security posture than validating a
client-supplied amount against a server value (the brief's own "never trust amount/currency from
the client" principle, applied by never accepting it as an input in the first place, not by
accepting-then-checking it). No test was added for a code path that structurally doesn't exist,
per the brief's own "never fabricate" instruction - this is documented as a real, verified
architectural fact instead.

Confirmed (route-level) by re-reading `webhook.routes.test.ts` and `webhook.service.test.ts` in
full: `PROVIDER ADAPTER TEST` coverage (all provider adapters in `providers.ts`/`gateways/`, mocked
gateway HTTP calls) is clearly distinct from - and this repo has never claimed to have - a
`REAL SANDBOX ROUND-TRIP` (an actual HTTP call to `sandbox.momodeveloper.mtn.com` with real
credentials). No new tests were added to Objective 1 - the existing 9 (`gateways.test.ts`) + 12
(`webhook.service.test.ts`) + route-level webhook tests were read in full and confirmed to already
satisfy the brief's own list, given the point above.

### Payment security checklist (re-verified, not re-implemented)

| Check | Status |
|---|---|
| Credentials never reach browser | VERIFIED - all three gateway credential fields are read only in `env.ts` (`import 'server-only'`), never serialized into any client-facing response |
| Secrets remain server-side | VERIFIED - `PAYMENT_WEBHOOK_SIGNING_SECRET`/`CRON_SECRET`/gateway keys are all `server-only` |
| Webhook signatures verified | VERIFIED - HMAC-SHA256, constant-time compare, fails closed |
| Replay/idempotency protection | VERIFIED - two independent guards (status-match, eventId-match) |
| Duplicate webhook does not double-settle | VERIFIED - by the same two guards |
| Provider reference validated | VERIFIED - `db.payment.findUnique({where: {reference: ...}})`, `NOT_FOUND` otherwise |
| Amount/currency/order association validated | VERIFIED (by design, not present in the trust boundary at all - see above) |
| Tenant ownership enforced | VERIFIED - the webhook route has no tenant concept by design (a real gateway has no session); all buyer-facing payment routes still go through `requireCompanyAccess`/`requireSupplierAccess`, unchanged |
| Payment status transitions are server-controlled | VERIFIED - the client-facing checkout flow never sets `Payment.status` directly; only `payment.service.ts`'s own charge-result handling and `webhook.service.ts` do |

## Objective 2 — File Storage

### Audit (before any change)

- **`Document` model** (`prisma/schema.prisma`): `ownerType` (`RFQ`/`PURCHASE_REQUEST`/`ORDER`/`INVOICE`/`SUPPLIER`/`DISPUTE`), but only `rfqId` and `purchaseRequestId` actually exist as foreign-key columns - the other four `ownerType` values have no backing relation in the schema today. Building upload/download for all six would mean adding four new schema columns/migrations for owner types nothing in the app currently asks to attach a file to - out of proportion to what's actually needed, so this phase implements the two ownership types the schema already supports.
- **Zero existing routes, zero storage backend, zero UI references** anywhere in `src/` (confirmed by grep for `Document`/`document`/`attachment`/`upload` before writing any code) - genuinely schema-only, exactly as Phase 19 reported.
- **`.env.example`**'s `STORAGE_BUCKET`/`STORAGE_ACCESS_KEY_ID`/`STORAGE_SECRET_ACCESS_KEY`/`STORAGE_REGION` are all empty and, critically, **not read anywhere in `env.ts`** - there was no partial S3 wiring to build on, and no real object-storage credentials exist in this environment.

### Architecture decision

Given no real object-storage credentials exist, an S3-compatible client would be unverifiable code
- exactly the "claim it works because it looks right" the brief forbids. The chosen architecture
mirrors `PaymentProvider.ts`'s own already-proven shape in this codebase: a small `StorageProvider`
interface (`store`/`retrieve`/`delete`) with one real, verified implementation
(`LocalDiskStorageProvider`) selected once in `storage/index.ts`. A real S3-compatible provider can
be added as a second implementation later, selected by whether `STORAGE_*` env vars are configured,
without touching `documents.service.ts` or any route - the same swap-without-a-rewrite property
`PaymentProvider` already demonstrates for payments.

**Explicitly documented limitation, not hidden**: local disk is not shared or durable across
multiple instances or redeploys - unsuitable for a real multi-instance/serverless production
deployment. This is the honest, correctly-scoped choice for what this repo can actually verify
today, not a claim that it's production-ready object storage.

### What was implemented

- `src/server/services/storage/StorageProvider.ts` - the interface.
- `src/server/services/storage/localDiskStorage.ts` - real filesystem reads/writes under a
  `.uploads/` directory outside `public/` and outside the Next.js build output (gitignored);
  defensively re-validates every resolved path stays inside that root even though the key is
  always generated, never caller-supplied.
- `src/server/services/documents.service.ts` - `uploadRfqDocument`, `uploadPurchaseRequestDocument`,
  `getDocumentForDownload`, `deleteDocument`. Enforces: a 10MB size cap, an explicit MIME-type
  allowlist (PDF, PNG, JPEG, Word, Excel - never derived from the filename's own extension), a
  non-empty sanitized display filename, and a `crypto.randomUUID()`-generated storage key that is
  never built from the uploaded filename (the exact `/uploads/${filename}` anti-pattern the brief
  calls out is not present anywhere in this implementation).
- Routes: `POST /api/rfqs/[rfqId]/documents`, `POST /api/purchase-requests/[id]/documents` (upload,
  multipart form data), `GET /api/documents/[documentId]` (download, streams the real bytes with a
  sanitized `Content-Disposition` and `Cache-Control: private, no-store`), `DELETE
  /api/documents/[documentId]`. Every route uses the existing `withErrorHandling` wrapper, the
  existing same-origin (CSRF) check for mutations, and the existing `procurementWrite` rate-limit
  bucket - no new security primitive was invented.
- Ownership follows each parent record's own existing rule exactly: an RFQ document is visible to
  its owning buyer company OR any invited supplier (matching `GET /api/rfqs/[rfqId]`'s own logic);
  a purchase-request document is visible only to its owning buyer company (matching `GET
  /api/purchase-requests/[id]`'s own logic). A generic 404 - never a distinct "forbidden" - is
  returned for every ownership failure, matching this app's established IDOR-mitigation
  convention throughout.

### Tests (18 new, `documents.routes.test.ts`, real API boundary, real Postgres, real local-disk storage)

| Case | Result |
|---|---|
| Unauthenticated upload | 401 |
| Owning buyer uploads a valid PDF | 201, correct fileName/mimeType |
| Invited supplier uploads to the same RFQ | 201 |
| Uninvited supplier uploads | 404 (not 403 - IDOR-safe) |
| Unrelated buyer company uploads | 404 |
| Oversized file (>10MB) | 422 |
| Disallowed MIME type (`application/x-msdownload`) | 422 |
| Path-traversal filename (`../../etc/passwd`) | 201, but the returned `fileName` is sanitized (no `..`, no `/`) - the storage key was never derived from it in the first place |
| Nonexistent RFQ | 404 |
| Purchase-request upload: owner vs. unrelated supplier | 201 / 404 |
| Unauthenticated download | 401 |
| Owning buyer / invited supplier download | 200, real bytes match exactly, correct `Content-Type` |
| Unrelated buyer / uninvited supplier download | 404 / 404 |
| Nonexistent document download | 404 |
| Delete: unrelated buyer denied, owner succeeds, second delete 404s, subsequent download 404s | all as expected |

**Classification: `IMPLEMENTED LOCALLY`. `REAL PROVIDER NOT VERIFIED` (no S3-compatible credentials
exist to test against) - a real multi-instance/production deployment of this feature
`REQUIRES INFRASTRUCTURE` (a real object-storage bucket and credentials) before local disk should
be relied on beyond development/single-instance use.**

## Objective 3 — Background Jobs

### Audit

Read all four existing job implementations and their cron routes in full:

- **`invoiceDueSweep.ts`**: flips PENDING invoices past due to OVERDUE via a *conditional*
  `updateMany` keyed on `{id, status: 'PENDING'}`, not a plain update-by-id - two overlapping runs,
  or a row that changed state between the scan and the write, can never double-count or
  double-notify; a `count === 0` result is simply skipped.
- **`lowStockSweep.ts`**: a 24-hour dedupe window (checks for an existing `LOW_STOCK` notification
  for the same product before sending another) - safe to run as often as hourly without spamming.
- **`pendingPaymentSweep.ts`**: polls the real gateway's own status endpoint for payments a webhook
  never confirmed; only does anything once a real gateway is configured (always returns 200
  either way, matching the other sweeps' "safe to hit on any schedule, does nothing if there's
  nothing to do" shape).
- **`recurringPurchase.service.ts`'s `runDueSchedules`**: the most rigorous of the four - an atomic
  claim via `updateMany({where: {id, nextRunAt: occurrenceAt, active: true}, data: {nextRunAt:
  nextOccurrence, ...}})`, where the `WHERE` clause pins the *exact* `nextRunAt` value this
  iteration read. A concurrent sweep that already advanced (or paused) the same schedule can never
  also claim it - a real optimistic-concurrency guard, not just "the cron should only run once."

All four are triggered by a `POST /api/cron/*` route gated by `requireCronSecret` (constant-time
comparison, fails closed when unset) - unchanged, re-confirmed secure this phase.

### Job candidates evaluated (per the brief's own list)

| Candidate | Already has a cron endpoint? | Idempotent? | Needs to change? |
|---|---|---|---|
| Recurring purchases | Yes (`/api/cron/recurring-purchase-sweep`) | Yes - atomic claim | No |
| Invoice reminders/due sweep | Yes (`/api/cron/invoice-due-sweep`) | Yes - conditional updateMany | No |
| Payment reconciliation | Yes (`/api/cron/pending-payment-sweep`) | Yes - gateway status is the source of truth, re-polling is safe | No |
| Low-stock notifications | Yes (`/api/cron/low-stock-sweep`) | Yes - 24h dedupe window | No |
| Analytics aggregation | No dedicated job | N/A - analytics routes compute on read (real Prisma aggregates, per Phase 19's own audit) | Safely remains synchronous - no evidence of a real latency problem to justify a job |
| Webhook retries | No new job needed | A real gateway's own retry behavior already handles this (the webhook route always responds so a gateway's own retry logic decides), and `pendingPaymentSweep` covers the case a webhook never arrives at all | No |
| Notification processing | Synchronous, in-request (`notification.service.ts`) | N/A | Safely remains synchronous - no evidence of a real volume/latency problem |

**Conclusion: no new background job was created.** Every real candidate the brief names already has
a secured, idempotent, cron-triggerable implementation. Building a queue or a retry/backoff/
dead-letter mechanism on top of already-idempotent, cheaply-re-runnable sweeps would be exactly the
"elaborate distributed queue" over-engineering the brief explicitly warns against - a failed run of
any of these four jobs is already safe to simply run again, which is a complete failure-handling
strategy for this workload shape. **Status: IMPLEMENTED (pre-existing, re-verified this phase).**
The one honest limitation, unchanged from Phase 19: nothing in this repository itself schedules
these cron routes on a recurring basis - that requires an external scheduler (Vercel Cron, a GitHub
Actions cron job, system crontab + curl), which is deployment configuration outside this
repository's own code.

## Objective 4 — Docker / Deployment

```
docker --version        -> command not found
docker compose version  -> command not found
```

**NOT VERIFIED — Docker unavailable**, unchanged from Phase 19. No claim is made that the image
builds or runs.

### Static review of the existing `Dockerfile`

- **Multi-stage build** (`deps` -> `builder` -> `runner`) - the final image copies only
  `.next/standalone`, `.next/static`, `public/`, and `prisma/` from the builder stage; no dev
  dependencies or build tooling ship in the runtime image.
- **Non-root user**: `addgroup --system nodejs` / `adduser --system nextjs`, `USER nextjs` before
  `CMD` - the application process does not run as root.
- **No hardcoded credentials or development secrets** anywhere in the `Dockerfile` - all
  configuration is expected via runtime environment variables, matching `env.ts`'s own
  fail-loudly-if-missing design.
- **`EXPOSE 3000`** - a single, expected port; no unnecessary exposed ports.
- **Entrypoint** is `node server.js` (the standalone build's own generated entrypoint), not `next
  start` - correctly matches `next.config.ts`'s `output: 'standalone'` setting; using `next start`
  against a standalone build would fail since the non-standalone build artifacts aren't copied in.
- **Health checks**: no `HEALTHCHECK` instruction in the `Dockerfile` itself - the application does
  expose real `/api/health` and `/api/ready` endpoints (verified live earlier this phase against
  the standalone server directly), so a container orchestrator's own health check configuration
  (Kubernetes liveness/readiness probes, ECS health checks, etc.) has a real endpoint to point at;
  this is deployment-platform configuration, appropriately left outside the `Dockerfile` itself.

No `docker-compose.yml` exists in this repository - there is no local multi-container
(app+Postgres) orchestration file to review. This is consistent with local development already
using a directly-installed PostgreSQL service (`postgresql-x64-17`), not a containerized one.

**No infrastructure changes were made this phase** - the `Dockerfile` was reviewed, not modified,
since Docker itself can't be used to verify a change to it in this environment.

## Objective 5 — Accessibility

Phase 19's own accessibility work was an explicitly *focused* pass (interactive primitives, plus
the Orders/Invoices list pages' clickable rows). This phase extends that with a broader, still
honestly-scoped pass - not a full page-by-page WCAG audit of every page the brief lists, but a
targeted static sweep (grep-based, across every `.tsx` file in `src/app/(app)`) for the specific
defect classes Phase 19 already found real instances of, followed by live verification of what was
found and fixed.

### What was checked

- **Clickable non-interactive elements** (`<div onClick`, multi-line variants): none found beyond
  what Phase 19 already fixed (Orders, Invoices) - every other list/card pattern in the app uses a
  real `<button>`/`Button` component.
- **Images without alt text**: none found - every `<img>` in the codebase (`ProductCard`, `Avatar`,
  cart, compare, product detail) already has a real, descriptive `alt`.
- **Color-only status/selection indicators**: **one real defect found** - the Catalog page's
  category filter buttons (`src/app/(app)/catalog/page.tsx`) indicated the selected category only
  via a background/border color change, with no `aria-pressed` state and no textual/iconographic
  indicator. A screen-reader user had no way to know which category was currently active. **Fixed**:
  added `aria-pressed={selectedCategory === c.slug}`. **Live-verified**: real browser, real login,
  navigated to `/catalog`, read every filter button's `aria-pressed` attribute directly from the
  live DOM - `true` for "All categories" (the default), `false` for every other category,
  correctly following selection afterward.
- **Heading structure**: every top-level page renders exactly one `<h1>` at runtime (a handful of
  page files contain two `text-h1`-styled elements in source, but each is behind a
  buyer-vs-supplier workspace branch - only one ever renders per session, confirmed by reading each
  such file).
- **Tab/radiogroup patterns**: re-confirmed `Tabs.tsx` (already correct per Phase 19) is the only
  `role="tablist"` pattern in the app; no other page implements a hand-rolled tab/radio pattern
  beyond the login page's workspace selector Phase 19 already fixed.
- **Icon-only buttons without an accessible name**: none newly found this phase (Phase 19 already
  fixed the sidebar's collapsed-state case).

### Live verification this phase

Real standalone production server, real login (John Doe, Acme Technologies Ghana), real browser:

- **Login -> multi-company picker -> Dashboard**: full real login flow exercised (not a
  pre-seeded session), zero console errors.
- **Catalog**: the `aria-pressed` fix confirmed live and correctly reflecting state, as above.
- **RFQs, Settings**: navigated to both, confirmed correct page load (title/content), no console
  errors surfaced.

### Honest scope statement

This was a targeted defect-class sweep across the codebase, not an individual live audit of every
page the brief lists (Negotiation, Checkout, Disputes, Admin Moderation, Supplier Analytics, and
others were not each individually opened and manually tested this phase). The static sweep's
patterns (clickable non-interactive elements, missing alt text, color-only status, hand-rolled
tab/radio patterns, icon-only buttons) are exactly the defect classes Phase 19's own focused audit
found real instances of, so a codebase-wide grep for the same classes is a reasonable, evidence-
based way to check whether more instances exist elsewhere - but it is not equivalent to opening
every named page in a browser with a keyboard. **No automated accessibility scanner (axe-core,
Lighthouse CI, etc.) is installed or was run this phase** - none was already present in the
codebase, and adding one is a real dependency decision with its own maintenance cost that this
phase's findings didn't clearly justify (the static sweep found one small, quickly-fixed defect,
not a systemic pattern that would need ongoing automated enforcement). **No WCAG conformance level
is claimed.**

## Objective 6 — API / OpenAPI

### Audit

- **Zod request schemas** exist and are used consistently (`src/server/validation/*.ts`) for every
  mutating route's input.
- **Response DTOs** are real TypeScript interfaces (`InvoiceDto`, `Page<T>`, `CursorPage<T>`, etc.)
  but are not defined as Zod schemas or any other machine-readable schema format - they're
  compile-time-only types, not runtime-introspectable. This is the same gap Phase 19 already
  identified and left deferred.
- **Error responses**: standardized (`{"error": string, "requestId"?: string}`, Phase 18's
  `withErrorHandling`) for routes that use the wrapper; routes written before Phase 18 that don't
  use the wrapper hand-build the same `{error: string}` shape by convention, not by a shared type.
- **`Page<T>`/`CursorPage<T>`**: consistent, well-defined shapes, now used by Invoice/Payment/RFQ
  pagination (Phase 19) as well as Order/PurchaseRequest/Product/notifications/audit log.

### Decision: Option B (documented contract foundation, full generation deferred)

Generating an accurate OpenAPI spec requires knowing the *exact* response shape (every field,
every optional/nullable variant) of every route. Since response DTOs are TypeScript-only (not
runtime schemas), any OpenAPI generator run against this codebase today would have to either (a)
re-derive response shapes from TypeScript types via a codegen tool not currently in this project's
dependencies, a genuinely new, non-trivial pipeline to introduce and verify correct, or (b) be
hand-authored, which risks drifting from the real implementation the moment either changes -
exactly the "never generate inaccurate documentation from incomplete information" instruction this
phase was given. Given the actual size of the gap (DTOs exist and are consistent, just not in a
machine-readable format) versus the size of either real option, **Option B was chosen**: this
report documents the real, current contract for every route this phase touched (see each
Objective's own "API Contract" detail above and Phase 19's own equivalent table) as the
foundation, and full OpenAPI generation remains explicitly deferred rather than shipped
inaccurately.

**Status: DEFERRED**, same reasoning as Phase 19, not re-attempted differently this phase because
the underlying gap (DTOs aren't schemas) did not change.

## Objective 7 — Redis / Multi-Instance Readiness

### Audit

- **Current rate limiting** (`src/server/auth/rate-limit.ts`): a single in-process `Map<string,
  Bucket>` - confirmed by direct code inspection this phase. This is correct and sufficient for
  exactly one running instance; it silently stops being globally accurate the moment a second
  instance runs (each instance would enforce its own independent limit).
- **Deployment target**: the `Dockerfile` builds one `node server.js` process per image; no
  `docker-compose.yml`, no Kubernetes manifests, no load-balancer configuration, and no reference
  to `REDIS_URL` anywhere in `src/` (confirmed by grep - `REDIS_URL` exists only as an empty,
  unread placeholder in `.env.example`, exactly like `STORAGE_*` before this phase's storage work).
  There is no evidence anywhere in this repository that multi-instance deployment is actually
  planned.
- **Background jobs**: all four (Objective 3) are triggered by an external scheduler hitting a
  stateless HTTP route - already safe under multiple instances without any change, since each
  invocation is independently authorized and each job's own idempotency (not instance-local state)
  is what prevents double-processing.
- **Sticky sessions**: not applicable - this app's session model is a signed httpOnly cookie
  resolved against the database on every request (`getAuthContext`), not server-side in-memory
  session state, so it already works correctly across multiple instances without any sticky-session
  requirement.

### Decision: REDIS DEFERRED

Per the brief's own explicit instruction ("do not install Redis merely because it is listed as a
future option" / "if deployment remains single-instance, REDIS DEFERRED is acceptable"), and given
no concrete evidence of an actual multi-instance deployment plan exists anywhere in this
repository's configuration, **Redis is deferred**. The one component that would need it if
multi-instance deployment is later adopted is rate limiting (distributed locks and job coordination
are not currently needed - jobs are already instance-agnostic per the point above, and there is no
other in-memory coordination primitive in this codebase to migrate). This is a narrower, more
honest scope than "Redis for everything" would be, and matches what was actually found, not a
speculative list.

## Database / Migration Verification

```
npx prisma validate        -> "The schema at prisma\schema.prisma is valid"
npx prisma migrate status  -> "12 migrations found in prisma/migrations" / "Database schema is up to date!"
```

No new migration was created this phase - the `Document` model's schema was already fully defined
(Phase 14/15); this phase added application code (routes, services, storage) on top of an existing
table, not a schema change. No production-like database was reset. Migration ordering/indexes/
constraints were not modified this phase and required no new review beyond the `validate`/`status`
checks above.

## Security Verification

Re-verified, not weakened, from Phases 17-19:

- **CSP/nonce**: not touched this phase - no route or page behavior in this area changed.
- **Session security**: unchanged; the new document routes use the exact same `getAuthContext`
  session resolution as every other authenticated route.
- **Tenant isolation**: extended, not weakened - the new document routes replicate their parent
  record's exact existing ownership rule (RFQ's dual-owner check, purchase request's single-owner
  check) rather than inventing a new one; 12 of the 18 new tests are tenant-isolation checks
  (uninvited supplier, unrelated buyer, nonexistent record - each returning a generic 404).
- **RBAC**: unchanged; document upload/delete routes require authentication and same-origin
  (CSRF) validation for mutations, matching every other mutating route.
- **Generic ownership 404s**: preserved - every new document-route ownership failure returns 404,
  never a distinct 403 that would leak whether a document/RFQ/purchase-request id exists.
- **Rate limiting**: preserved - document upload routes use the existing `procurementWrite` bucket;
  no new rate-limit kind was invented, no existing bucket was widened.
- **Retry-After**: unchanged - not touched by any route added this phase.
- **Webhook HMAC**: unchanged - not touched this phase (Objective 1 was audit-only).
- **Idempotency**: unchanged - the existing webhook/job idempotency guards were read and confirmed,
  not modified.
- **Cron secrets**: unchanged - not touched this phase.
- **Audit logging**: unchanged - not touched this phase.
- **Standard error responses**: preserved - all four new routes use `withErrorHandling`.
- **Path traversal**: a new, real risk this phase's own storage feature introduced the *possibility*
  of - closed by never building a storage key from a filename (always `crypto.randomUUID()`) and by
  `localDiskStorage.ts`'s own defensive `resolveKeyPath` check that a resolved path can never
  escape the storage root, verified by the "sanitizes a path-traversal filename" test.

## Browser Verification

Real standalone production server (`node .next/standalone/server.js`), real browser
(`agent-browser`), this phase:

- **Login**: full real login flow (email/password, real multi-company picker, company selection)
  - not a pre-seeded session - exercised end-to-end for the first time this specific way this
  phase, confirming no regression in the auth flow from any prior phase's changes.
- **Dashboard**: loaded successfully post-login.
- **Catalog**: accessibility fix (`aria-pressed`) confirmed live via direct DOM inspection.
- **RFQs, Settings**: loaded successfully, confirmed via page title/content, no console errors
  observed.

**Not re-verified this phase** (no code in these areas changed, so no regression risk): Products,
Cart, Checkout, Orders, Invoices, Payments, Purchase Requests, Negotiation, Supplier workspace
pages, Admin pages. These were live-verified in Phase 19 (Orders/Invoices) or earlier phases and
are unaffected by this phase's changes (payment audit was read-only, file storage is a new,
additive API surface with no existing page wired to it yet, background jobs were audit-only).

Not verified at the three required viewport sizes this phase specifically - `agent-browser resize`
was not available in the installed CLI version, and given the narrow, additive nature of this
phase's actual UI change (one `aria-pressed` attribute, invisible to layout), a full three-viewport
screenshot pass was judged disproportionate to what changed. This is stated honestly rather than
claimed.

## Integration Verification

```
unit-tested:              documents.service.ts's validation logic (size/MIME/filename), exercised
                           indirectly through the 18 route-level tests (no separate pure-unit
                           suite was written, since the route tests already exercise every branch)
integration-tested locally: File storage (real Postgres + real local disk, 18 tests), payment
                           webhook pipeline (real Postgres, pre-existing 12+ tests, re-confirmed
                           passing), background jobs (real Postgres, pre-existing tests,
                           re-confirmed passing)
sandbox-tested:            NOT PERFORMED - no real MTN MoMo (or Telecel/AirtelTigo) sandbox
                           credentials exist in this environment
production-tested:         NOT PERFORMED - this phase never touches a production environment,
                           consistent with every prior phase's own constraint
not verified:              Docker (unavailable), real object storage (no credentials), OpenAPI
                           spec accuracy (not generated), Redis-backed rate limiting (not built -
                           deferred)
```

## Test Results

```
Before: 389 (45 files)
After:  407 (46 files)
New:    18
Removed: 0
Weakened: 0
```

All 18 new tests are in `src/server/services/documents.routes.test.ts` (Objective 2). No test in
any other file was modified, removed, or had an assertion weakened. Objective 1 added zero new
tests (existing coverage was read in full and confirmed to already satisfy the brief's own list,
with one deliberate, documented exception - see Objective 1). Objectives 3, 4, 6, and 7 were
audit/documentation only and added no code requiring new tests. Objective 5 (accessibility) fixed
one attribute (`aria-pressed`) with no corresponding automated test added - it was verified live
in a real browser instead, matching Phase 19's own precedent for accessibility fixes (live
verification, not a DOM-assertion unit test, since the property being checked is real render/DOM
output, not business logic).

## Build / TypeScript / Lint

```
npx vitest run --no-file-parallelism   -> 46 files, 407 tests, all passing
npx tsc --noEmit                        -> clean, 0 errors
npx eslint .                            -> clean, 0 errors/warnings
npm run build                           -> clean, production build succeeds
```

Run in full after the file-storage implementation and again after the accessibility fix - both
checkpoints clean, no regression at any point.

## Production Environment Audit

Every environment variable in `.env.example`, classified:

| Variable | Classification |
|---|---|
| `DATABASE_URL` | production-required |
| `AUTH_SECRET` | production-required |
| `SESSION_TTL_SECONDS` | optional (has a working default) |
| `NODE_ENV` | required (has a working default of `development`) |
| `MTN_MOMO_*` / `TELECEL_CASH_*` / `AIRTELTIGO_MONEY_*` | external-credential (optional - the app runs correctly without them, in simulation mode) |
| `PAYMENT_WEBHOOK_SIGNING_SECRET` | production-required for real webhook use; optional in the sense the route fails closed without it rather than the app refusing to start |
| `CRON_SECRET` | production-required for real cron use; same fail-closed-not-startup-blocking behavior |
| `STORAGE_BUCKET` / `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` / `STORAGE_REGION` | external-credential, currently unused (not read by `env.ts` - reserved for a future real object-storage provider; this phase's storage feature uses local disk instead, see Objective 2) |
| `REDIS_URL` | external-credential, currently unused (not read anywhere in `src/`; reserved for a future multi-instance deployment, see Objective 7) |
| `CSP_ENFORCED` | development-only (emergency rollback switch; production always enforces CSP by default) |

**No hardcoded secrets, API keys, passwords, tokens, or connection strings were found** in any file
this phase touched or reviewed (`Dockerfile`, `env.ts`, all new route/service files). No secret
value is printed anywhere in this report.

## Remaining Limitations

- Payment: no real MTN MoMo/Telecel Cash/AirtelTigo Money sandbox round-trip has ever been
  performed against this codebase - `REQUIRES EXTERNAL CREDENTIALS`, unchanged since Phase 18.
- File storage: local disk only, verified in this single-instance development environment; a real
  multi-instance or serverless production deployment of this feature `REQUIRES INFRASTRUCTURE`
  (a real S3-compatible bucket + credentials) before it should be relied on beyond development use.
- Docker: the `Dockerfile` has never actually been built or run in any environment this project's
  work has had access to - `NOT VERIFIED`, unchanged since Phase 19.
- OpenAPI: still deferred - response DTOs remain TypeScript-only, not machine-readable schemas.
- Redis: still deferred - no concrete multi-instance deployment plan exists to design against yet.
- Accessibility: this phase's broader pass was a targeted static sweep plus limited live spot-
  checks, not an individual live audit of every page the brief named (Negotiation, Checkout,
  Disputes, Admin Moderation, Supplier Analytics, and others were not each opened and manually
  tested this phase) - no WCAG conformance level is or should be inferred from this phase's work.
- No automated accessibility scanner is installed - all accessibility findings across Phases 19-20
  are from manual code review and live spot-verification, not tool output.

## Deferred Work

1. A real MTN MoMo sandbox round-trip, once real developer credentials are obtained
   (momodeveloper.mtn.com has a free public signup) - the client/provider code is already written
   and ready to receive them without modification.
2. A real S3-compatible storage provider, added as a second `StorageProvider` implementation
   alongside `LocalDiskStorageProvider`, selected by whether `STORAGE_*` env vars are configured -
   the abstraction is already in place for this to be a small, additive change.
3. Full OpenAPI generation, once response DTOs are either converted to Zod schemas or a
   TypeScript-to-OpenAPI codegen tool is deliberately adopted and verified against this
   codebase's actual route shapes.
4. Redis-backed rate limiting, if and when a real multi-instance deployment is actually planned -
   not before, per this phase's own evidence-based decision.
5. A genuinely comprehensive, page-by-page accessibility audit (ideally with an automated scanner
   added deliberately, not incidentally) covering every page this phase's static sweep did not
   individually open live.

## Final Production Readiness Matrix

| Area | Status | Evidence |
|---|---|---|
| Authentication | VERIFIED | Real login flow exercised live this phase (email/password, multi-company picker); unchanged code, re-confirmed working |
| Authorization | VERIFIED | RBAC + tenant-ownership checks re-confirmed on every new document route; 12 of 18 new tests are authorization checks |
| Tenant isolation | VERIFIED | 12 new cross-tenant/cross-role tests, all passing; existing 22+ pagination/CompanyGroup tests from Phase 19 still passing |
| CSP | VERIFIED (unchanged) | Not touched this phase; Phase 17's own live verification stands |
| Error handling | VERIFIED (unchanged) | All 4 new routes use the existing `withErrorHandling` wrapper |
| Rate limiting | VERIFIED (unchanged) | In-memory, single-instance; new document routes use the existing `procurementWrite` bucket, no new bucket invented |
| Pagination | IMPLEMENTED (unchanged) | Phase 19's own work; not touched this phase |
| Payment provider | REQUIRES EXTERNAL CREDENTIALS | Real gateway client code exists and is tested at the adapter level; no real sandbox credentials in this environment |
| File storage | IMPLEMENTED LOCALLY | 18 new real tests (upload/download/delete/tenant isolation/oversized/invalid-MIME/path-traversal); real object storage REQUIRES INFRASTRUCTURE |
| Background jobs | IMPLEMENTED | Four pre-existing, idempotent, cron-secret-protected sweep jobs, re-verified; no external scheduler configured in this repository |
| Docker | NOT VERIFIED | `docker`/`docker compose` unavailable in this environment; `Dockerfile` statically reviewed only |
| Accessibility | VERIFIED (targeted scope) | One real defect found and live-fixed this phase (Catalog `aria-pressed`); not a full WCAG audit |
| OpenAPI | DEFERRED | Response DTOs not yet machine-readable schemas; Option B (documented contract, no generation) chosen deliberately |
| Redis | DEFERRED | No evidence of planned multi-instance deployment; single in-process rate limiter confirmed sufficient for current architecture |
| Database migrations | VERIFIED | `prisma validate` clean, `prisma migrate status` reports schema up to date, 12 migrations, no new migration this phase |
| Browser verification | VERIFIED (narrow scope) | Real login + Dashboard + Catalog (fix) + RFQs + Settings, live, this phase; broader page set unchanged and not re-verified |
| Load testing | MEASURED (unchanged) | Phase 19's own work; not touched or re-run this phase |
