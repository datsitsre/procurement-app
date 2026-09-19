# Phase 23 Final Report

Vercel production deployment + Docker/VPS portability. Follows the same evidence discipline as
Phases 18-22: VERIFIED / IMPLEMENTED / MEASURED / NOT VERIFIED / NOT MEASURED / REQUIRES EXTERNAL
CREDENTIALS / REQUIRES EXTERNAL INFRASTRUCTURE / DEFERRED / OUT OF SCOPE / BLOCKED. A mocked
adapter test is never reported as a real integration. A local test is never reported as a
production verification. A Dockerfile review is never reported as "Docker verified." A manually-
called cron endpoint is never reported as "scheduler verified."

## Executive Summary

**Vercel was selected as the primary deployment target per this phase's own instruction. No
Vercel account, project, or credentials exist anywhere in this environment, so no actual Vercel
deployment occurred** - this phase did not pretend otherwise. What this phase *could* honestly do,
and did: audited the repository against Vercel's actual, documented calling conventions and found
**two real, genuine, deployment-blocking incompatibilities** that would have silently broken
production the moment this application was deployed to Vercel with no further code changes -
neither was a hypothetical concern, both were confirmed and fixed:

1. **Vercel Cron always invokes its configured path with a plain `GET` request, never `POST`.**
   All four cron routes (`invoice-due-sweep`, `low-stock-sweep`, `pending-payment-sweep`,
   `recurring-purchase-sweep`) exported only `POST` - Vercel's own scheduled ping would have
   received a `405 Method Not Allowed` before ever reaching authentication. **Fixed**: each route
   now also exports `GET` as the identical handler (`export const GET = POST`, not a duplicate).
2. **Vercel Cron can only ever send one specific authentication header itself -
   `Authorization: Bearer <CRON_SECRET>`** (automatically, whenever a Vercel project environment
   variable is literally named `CRON_SECRET`) - `vercel.json`'s cron config has no field to
   customize the header it sends. The existing `requireCronSecret` only checked the custom
   `x-cron-secret` header (correct for a GitHub Actions workflow or system crontab, which can send
   any header they like, but never satisfiable by Vercel's own automatic mechanism). **Fixed**:
   `requireCronSecret` now accepts either header, additively - every existing caller using
   `x-cron-secret` keeps working unchanged.

Both fixes were verified two ways: real route-level tests (`cron.routes.test.ts`, 3 new tests) and
a live check against the real standalone server, sending the exact `GET` + `Authorization: Bearer`
request shape Vercel documents and confirming a real `200` (alongside confirming the legacy
`POST` + `x-cron-secret` shape still also returns `200`, and an unauthenticated request still
returns `401`). A `vercel.json` declaring the four cron schedules was also added - configuration
only, no business logic. Everything else this phase's brief asked for (a real Vercel deployment, a
real managed PostgreSQL database, a real S3 bucket round-trip, a real MTN MoMo sandbox
transaction, a real Docker build, TLS against a real domain, production browser acceptance,
production tenant-isolation testing, backup/restore verification) genuinely requires external
infrastructure or credentials that do not exist in this environment, and none of it was
fabricated. **Final classification: `NOT READY - BLOCKERS REMAIN`** - identical in substance to
Phase 22's own conclusion, because the same external blockers (no deployment target account, no
Docker, no payment/storage credentials) still exist; what changed this phase is that the
application code itself is now measurably closer to correct-on-first-deploy for Vercel
specifically, with two real bugs found and fixed before they could ever manifest in production.

## Baseline

```
Previous tests (Phase 22): 413/413 passing, 47 files
Final tests (this phase):  416/416 passing, 47 files
Added:    3 (all in src/app/api/cron/cron.routes.test.ts, verifying the Vercel Cron compatibility
             fix - see Changes Made)
Removed:  0
Modified: 0
Weakened: 0
```

TypeScript, ESLint, `npx prisma validate`, and `npx prisma migrate status` were all re-confirmed
clean/passing both before and after this phase's changes.

## Deployment Architecture

### Primary target: Vercel

```
                    ┌──────────────────────┐
                    │       Vercel         │
                    │                      │
Internet ──────────►│ Next.js Application  │
                    │ API Route Handlers   │
                    └──────────┬───────────┘
                               │
             ┌─────────────────┼─────────────────┐
             │                 │                 │
             ▼                 ▼                 ▼
      Managed PostgreSQL   S3 Storage       MTN MoMo
             │                 │                 │
             └─────────────────┼─────────────────┘
                               │
                               ▼
                      Vercel Cron (vercel.json)
```

**Not deployed.** No Vercel account or project exists in this environment. What is real: the
repository is standard Next.js App Router with no Vercel-specific build configuration required
(confirmed by inspection - `next.config.ts` only sets `output: 'standalone'`, which Vercel's own
Next.js runtime handles natively), plus the two compatibility fixes above and a `vercel.json`
declaring cron schedules.

### Future/portable target: Docker + VPS

```
                     Internet
                        |
                     HTTPS
                        |
                  Nginx / Caddy
                        |
                        v
              ┌───────────────────┐
              │ Docker Container  │
              │                   │
              │ Next.js standalone│
              └─────────┬─────────┘
                        |
          ┌─────────────┼─────────────┐
          |             |             |
          v             v             v
     PostgreSQL       S3/R2        Scheduler (GitHub Actions / crontab)
```

Unchanged in architecture from Phase 21/22 - the `Dockerfile` was not modified, the standalone
build was not modified, and this phase's two Vercel-compatibility fixes are additive (a `GET`
export alongside the existing `POST`, an additional accepted auth header alongside the existing
one) so Option B's own `POST` + `x-cron-secret` convention (documented in `DEPLOYMENT.md`)
continues to work identically, unaffected by the Vercel-specific fixes. **Not deployed** -
`docker` remains unavailable in this environment.

Both diagrams converge on the same application code - no business logic, domain service, or data
model differs between the two. The only file that exists for one deployment model and is inert for
the other is `vercel.json` (ignored entirely by a Docker/VPS deployment) and the `Dockerfile`
(irrelevant to a Vercel deployment, which builds the app directly from source).

## Changes Made

Every repository change this phase, in full:

1. **`src/server/auth/require.ts`** - `requireCronSecret` now accepts the shared secret via either
   the existing `x-cron-secret` header or a new `Authorization: Bearer <CRON_SECRET>` header
   (Vercel Cron's own automatic convention). Purely additive - the original check is unchanged in
   behavior for any caller already using `x-cron-secret`.
2. **`src/app/api/cron/invoice-due-sweep/route.ts`**, **`low-stock-sweep/route.ts`**,
   **`pending-payment-sweep/route.ts`**, **`recurring-purchase-sweep/route.ts`** - each now also
   exports `GET` as the exact same handler as the existing `POST` export (`export const GET =
   POST`) - Vercel Cron always invokes via `GET`; the existing `POST` export is unchanged and
   still works for any caller that uses it.
3. **`vercel.json`** (new file) - declares the four cron routes and their schedules (hourly for
   invoice-due-sweep/low-stock-sweep/recurring-purchase-sweep, every 5 minutes for
   pending-payment-sweep) using Vercel's standard `crons` config format. Has zero effect on any
   non-Vercel deployment.
4. **`.env.example`** - updated the `CRON_SECRET` documentation block to describe both accepted
   header shapes and both accepted HTTP methods, and added the fourth cron route
   (`recurring-purchase-sweep`) to the list, which had been missing from this block's own
   documentation since Phase 20 introduced that route.
5. **`DEPLOYMENT.md`** - restructured into an explicit "Option A: Vercel" / "Option B: Docker +
   VPS/VM" pair of sections (previously it only documented Option B in detail and mentioned Vercel
   only in passing), documented the two compatibility fixes and their evidence, and added the fact
   that neither deployment model has actually been exercised end to end.
6. **`src/app/api/cron/cron.routes.test.ts`** - 3 new tests: a wrong `Authorization: Bearer` token
   is rejected; the correct `Authorization: Bearer <CRON_SECRET>` is accepted (matching Vercel's
   exact header); the route's `GET` export (not just `POST`) returns the correct result, matching
   Vercel's exact HTTP method.

No business logic, domain service, UI component, database schema, or test outside the file listed
above was touched. No dependency was added or removed.

## Environment Variables

Every variable this phase's brief specifically asks about, using the repository's actual names
(unchanged from Phase 21/22's own audit - re-confirmed, not re-invented):

| Variable | In this environment | Notes |
|---|---|---|
| `DATABASE_URL` | SET (local dev value) | Required in production - no production database exists |
| `AUTH_SECRET` | SET (local dev value) | Required in production |
| `NODE_ENV` | SET (`development`) | Must be `production` on a real deployment |
| `SESSION_TTL_SECONDS` | NOT SET | Optional, has a working default |
| `CRON_SECRET` | SET (local dev value) | Required for any cron route to authenticate - now accepted via either header shape (this phase's fix) |
| `PAYMENT_WEBHOOK_SIGNING_SECRET` | SET (local dev value) | Required for real webhook use |
| `MTN_MOMO_API_USER` / `MTN_MOMO_API_KEY` / `MTN_MOMO_SUBSCRIPTION_KEY` / `MTN_MOMO_BASE_URL` / `MTN_MOMO_TARGET_ENVIRONMENT` | NOT SET | External-service credential - REQUIRES EXTERNAL CREDENTIALS |
| `TELECEL_CASH_*` / `AIRTELTIGO_MONEY_*` | NOT SET | Same |
| `STORAGE_BUCKET` / `STORAGE_REGION` / `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` / `STORAGE_ENDPOINT` | NOT SET | External-service credential - REQUIRES EXTERNAL INFRASTRUCTURE |

**No production values exist anywhere to compare against development values, since no production
environment has been provisioned.** No secret value is printed in this report ("SET"/"NOT SET"
only). No `NEXT_PUBLIC_*` variable exists anywhere in this codebase (re-confirmed by grep this
phase, unchanged). No public application URL variable exists in the codebase, and none was
added - the application itself never needs to know its own public URL (every internal request is
relative/same-origin); the production domain matters only for external configuration (where an
operator points the MTN MoMo webhook config, where DNS resolves), not for anything the code reads.

## Database

- **Provider**: none selected - no managed PostgreSQL instance exists in this environment.
- **Migration status**: `npx prisma migrate status` against the local development database
  reports 12 migrations, schema up to date, `npx prisma validate` reports the schema valid. No
  migration was created, modified, or rolled back this phase.
- **Backup status**: `NOT APPLICABLE` - no production database provider has been selected, so
  there is nothing to check backup configuration on.
- **Restore status**: `NOT VERIFIED` - no production database exists to test a restore against, no
  restore was performed against any database, disposable or otherwise.

## Object Storage

- **Provider**: `S3StorageProvider` (Phase 21, `@aws-sdk/client-s3`) remains implemented and
  adapter-tested (`S3Client.send` mocked, 5 tests, unchanged this phase) behind the existing
  `StorageProvider` interface - not modified, not replaced, exactly per this phase's instruction.
- **Bucket configuration**: none exists - `STORAGE_BUCKET`/`STORAGE_REGION`/
  `STORAGE_ACCESS_KEY_ID`/`STORAGE_SECRET_ACCESS_KEY` are all unset, so `LocalDiskStorageProvider`
  remains the active backend in this environment (confirmed by re-reading `storage/index.ts`'s
  selection logic, unchanged from Phase 21).
- **Upload / download / delete / tenant authorization**: all still `VERIFIED` against the local
  disk backend - the existing 18 tests in `documents.routes.test.ts` were re-run this phase and
  still pass.
- **Real S3-compatible round-trip**: `NOT PERFORMED` - no real bucket exists. **Classification
  unchanged from Phase 21/22: `IMPLEMENTED` (code + adapter tests), `REQUIRES EXTERNAL
  INFRASTRUCTURE` for a real round-trip.**

## Payments

- **Sandbox**: no real MTN MoMo (or Telecel Cash/AirtelTigo Money) sandbox credentials exist
  anywhere in this environment - re-confirmed this phase by inspecting `.env` (masked check only).
- **Credentials**: `NOT SET`.
- **Real request**: `NOT PERFORMED` - no credentials to make one with.
- **Webhook**: HMAC verification, timing-safe comparison, replay resistance, and event-ID
  idempotency all remain `VERIFIED` at the local/integration-test level (re-run this phase,
  `webhook.service.test.ts`'s 12+ tests still passing) - unchanged, since none of that code was
  touched this phase. Public HTTPS reachability from a real gateway is `NOT VERIFIED` - no
  deployed endpoint exists.
- **Timeout**: the `AbortSignal.timeout(10s)` fix from Phase 21 remains in place and covered by
  its own adapter test, unchanged and re-confirmed passing.
- **Signature verification**: `VERIFIED` (local/integration-test level, unchanged).
- **Classification: `IMPLEMENTED` (code, adapter/local-integration tested); `REQUIRES EXTERNAL
  CREDENTIALS` for any real sandbox or production round-trip.** No fake payment success path was
  introduced. No payment-related test was weakened.

## Cron

| Job | Idempotent (re-verified) | Authenticated (re-verified, both header/method shapes) | Scheduled execution observed |
|---|---|---|---|
| `invoiceDueSweep` | Yes - conditional `updateMany` | Yes - `cron.routes.test.ts`, 9 tests total across this route incl. this phase's 3 new ones | **NOT VERIFIED** - no scheduler is actually connected to any deployment |
| `lowStockSweep` | Yes - 24h dedupe window | Yes - existing tests, re-run, passing | **NOT VERIFIED** |
| `pendingPaymentSweep` | Yes - gateway status is the source of truth | Yes - `requireCronSecret` unchanged for this route, both header shapes now work | **NOT VERIFIED** |
| `runDueSchedules` (recurring purchases) | Yes - atomic conditional claim | Yes - `requireCronSecret` unchanged for this route, both header shapes now work | **NOT VERIFIED** |

`vercel.json` declares a real schedule for each of the four routes - this is `IMPLEMENTED`
configuration, not proof of execution, and is not reported as more than that. **No actual
scheduled invocation - by Vercel Cron or any other scheduler - has ever been observed against any
deployment, because no deployment exists for a scheduler to target.** This report does not confuse
"the route works when called manually" (true, re-verified this phase) with "the scheduler is
operational" (not true, and not claimed).

## Security

Re-verified this phase, all unchanged except where explicitly noted:

- **Authentication**: bcrypt password hashing, opaque server-side sessions (hashed token
  persisted, never the raw token), httpOnly cookies, `secure` in production only, `sameSite=lax`,
  TTL-based expiry - all re-read in `session.ts`, unchanged.
- **Authorization**: `requireCompanyAccess`/`requireSupplierAccess` re-read in `require.ts` -
  unchanged in their core logic; the one change this phase (`requireCronSecret`) is scoped
  entirely to cron authentication and does not touch session/company/supplier authorization at
  all.
- **Tenant isolation**: `companyId`/`supplierId`/`userId` are never accepted from the client as an
  authorization source - re-confirmed by re-reading every `ownsRecord` call site touched by this
  phase's changes (none - this phase touched no tenant-scoped route). Full test suite (416 tests,
  including every pre-existing tenant-isolation test) re-run and passing.
- **CSRF**: `isSameOrigin` re-read, unchanged, not touched this phase.
- **CSP**: not touched this phase.
- **Rate limiting**: still single-instance in-process (`Map`), unchanged. **Re-assessed against
  Vercel specifically, per this phase's own explicit instruction**: Vercel's Next.js runtime can
  and does distribute a single deployment's traffic across multiple concurrent serverless function
  instances - this is a real, documented characteristic of the platform, not a hypothetical. **This
  means the in-memory rate limiter would NOT provide globally-consistent enforcement on Vercel** -
  each concurrent instance would track its own independent counters. This is recorded honestly as
  a genuine production concern for a Vercel deployment specifically (more so than for a
  single-container Docker/VPS deployment, where one process really is one instance). **No Redis or
  other distributed store was added** - per this phase's explicit instruction not to introduce one
  without a concrete deployment decision forcing it, and because no real Vercel deployment exists
  yet to measure the actual severity of this gap against (traffic volume, whether the
  rate-limited routes are hit heavily enough for split counters to matter in practice). This is
  documented as a known limitation of choosing Vercel, to be resolved before or shortly after a
  real Vercel production launch - not fixed speculatively now.
- **Payment security**: HMAC/idempotency/server-side-only amount-and-currency all re-confirmed
  unchanged (Section "Payments", above).
- **Secrets**: not committed (`.env` gitignored, confirmed), not client-exposed (zero
  `NEXT_PUBLIC_*` vars), not logged (`logger.ts`'s redaction re-confirmed), not present in the
  production build output (re-confirmed by inspecting `.next/` for any credential-shaped string).

## Accessibility

No UI code was changed this phase (every change this phase is server-side: an auth-header check
and route method exports). Re-confirmed, by re-reading the two files directly, that Phase 21/22's
documented limitations remain accurate and unchanged:

- `Dialog.tsx` still has no focus trap; still has zero real usage anywhere in `src/app`/
  `src/features` (re-confirmed by grep).
- `NotificationBell.tsx` still has no `aria-live` region for newly-arrived notifications; the
  unread count is still correctly conveyed via a dynamic `aria-label` and a labeled (never
  color-only) dot.

No new accessibility work was performed this phase - none was in scope (a deployment/infrastructure
phase with no UI changes), and no automated scanner was newly introduced. **No WCAG conformance
level is claimed.**

## Browser Acceptance

No deployed URL exists (Vercel or otherwise) - a production browser-acceptance pass was not
possible this phase. What was verified live this phase was narrower and specifically targeted at
this phase's own actual change: real HTTP requests (`curl`) against the real local standalone
server, exercising the exact request shapes Vercel Cron and a legacy scheduler each produce (GET +
Bearer token; POST + x-cron-secret; unauthenticated), confirmed to behave correctly in all three
cases. This is not a substitute for production browser acceptance and is not reported as one.
Phase 21's own full local browser-acceptance pass (buyer/supplier/admin, ~20 routes, one live
tenant-isolation check) remains the most recent such evidence and stands unchanged, since no
application-facing code was touched this phase.

## Performance

No production performance measurement was taken - there is no production deployment to measure.
Phase 19's own 10/25/50/100-concurrency local load-test campaign remains the most recent
performance evidence and was not repeated, since neither the deployment architecture nor any
request-handling code changed this phase. No local result from any phase is reported here as a
production number.

## Docker/VPS Portability

- **Docker status**: `NOT VERIFIED` - `docker`/`docker info` both resolve to "command not found"
  in this environment, unchanged since Phase 20. The `Dockerfile` was not modified this phase.
- **Standalone build status**: `VERIFIED` (local) - `npm run build` succeeds and produces the
  `.next/standalone` bundle this phase's own cron-compatibility smoke test ran directly via `node
  server.js`, confirmed healthy and responding correctly to both cron-authentication shapes.
- **Portability status**: `VERIFIED` at the code level - this phase's two Vercel-compatibility
  fixes are additive and change nothing about how the Docker/VPS deployment model calls these same
  routes (`POST` + `x-cron-secret` continues to work, confirmed by the same live smoke test). No
  business logic, domain service, or data-access code differs between the two deployment targets.
- **Known multi-instance considerations**: unchanged from Phase 21/22 for a Docker/VPS deployment
  (single-instance in-memory rate limiter is correct only for exactly one running container) -
  **and now additionally documented as a live concern for Vercel specifically** (Security,
  above), since Vercel's own execution model can distribute traffic across multiple concurrent
  instances even for what looks like "one deployment."
- **Future Redis requirement**: not added this phase. If a real Vercel deployment's traffic
  volume makes the in-memory rate limiter's per-instance counters a genuine problem (something
  that can only be assessed once real traffic exists), a shared store (Redis, or a
  platform-provided equivalent such as Vercel KV) would be the fix - this remains a documented,
  deferred decision, not implemented speculatively.

## Final Readiness Matrix

| Area | Status | Evidence |
|---|---|---|
| Vercel deployment | NOT VERIFIED | No Vercel account/project exists in this environment |
| Production DB | NOT VERIFIED | No managed PostgreSQL instance selected or provisioned |
| Migrations | VERIFIED (local only) | `prisma validate`/`migrate status` clean against local dev DB |
| Object storage | IMPLEMENTED, REQUIRES EXTERNAL INFRASTRUCTURE | 5 adapter tests (SDK mocked); no real bucket |
| MTN MoMo | IMPLEMENTED, REQUIRES EXTERNAL CREDENTIALS | 10 adapter tests (fetch mocked); no real credentials |
| Payment webhook | VERIFIED (local/integration), NOT VERIFIED (public reachability) | 12+ tests against real Postgres/real HMAC; no deployed HTTPS endpoint |
| Cron scheduler | IMPLEMENTED (routes + config), NOT VERIFIED (actual scheduled execution) | `vercel.json` + 2 real compatibility fixes, live-tested locally; no real scheduler connected |
| HTTPS/TLS | NOT VERIFIED | No deployed endpoint exists |
| Authentication | VERIFIED (local) | Unchanged, re-confirmed via 416 passing tests |
| Tenant isolation | VERIFIED (local) | 416 passing tests; no isolation-relevant code touched this phase |
| CSRF | VERIFIED (local, unchanged) | Not touched this phase |
| CSP | VERIFIED (unchanged, Phase 17) | Not touched this phase |
| Rate limiting | VERIFIED for single-instance; DOCUMENTED CONCERN for Vercel | In-memory `Map`; Vercel's multi-instance execution model newly documented as a real risk |
| Accessibility | VERIFIED (targeted, local, unchanged) | Phase 19-22 findings restated, no new UI changes this phase |
| Browser acceptance | VERIFIED (local, Phase 21, unchanged) | No deployed URL to test against this phase |
| Backups | NOT APPLICABLE | No production database provider selected |
| Restore test | NOT VERIFIED | No production database exists |
| Observability | VERIFIED (local, unchanged) | Structured logs, request IDs, redaction; re-confirmed, not re-tested against a real incident |
| Docker portability | VERIFIED (code-level), NOT VERIFIED (actual build/run) | Standalone bundle runs correctly locally; `docker` unavailable |
| Production deployment | NOT VERIFIED | Never deployed anywhere from this codebase |

## Final Go/No-Go

```
NOT READY — BLOCKERS REMAIN
```

This is not a statement that the application code has gotten worse or that Vercel is unsuitable -
if anything, this phase found and fixed two real bugs that would have caused a silent, confusing
production failure (cron jobs simply never running, with no error visible anywhere except a 405
that nothing was watching for) had a real Vercel deployment been attempted without this phase's
work. The blockers remain exactly what Phase 22 already identified, unresolved because they are
external to this codebase, not because of anything this phase could have done differently:

1. **No Vercel account/project exists** - nothing can be deployed until one does.
2. **No managed PostgreSQL instance exists** - production data has nowhere to live yet.
3. **No real MTN MoMo (or alternative) sandbox credentials exist** - payments cannot be verified
   end-to-end until they do.
4. **No real S3-compatible bucket exists** - object storage cannot be verified beyond local disk
   until one is provisioned (and is only strictly required if the eventual deployment needs
   more-than-one-instance-safe storage, which single-instance Vercel deployments may not).
5. **Docker remains unavailable in every environment this project's work has had access to** - the
   `Dockerfile` has still never been built or run, for either deployment path.

Once a Vercel account and a managed PostgreSQL database exist, most of the remaining verification
in this report becomes directly actionable - the two real compatibility bugs this phase found are
already fixed, `vercel.json` is already in place, and the application's own architecture has been
confirmed (again, this phase) to require no Vercel-specific rewrite. The application code is not
the obstacle; provisioning the accounts and credentials it depends on is.
