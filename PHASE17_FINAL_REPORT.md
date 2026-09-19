# Phase 17 Final Report

## Audit Findings

Full findings in `PHASE17_AUDIT.md`, produced before any implementation (Step 0). Summary:

| # | Finding | Action taken |
|---|---|---|
| 1 | No `middleware.ts` — Next 16 renamed it to `proxy.ts`; one already exists (`src/proxy.ts`), scoped to `/api/*` only | Extended to also cover page routes for CSP nonce generation |
| 2 | A nonce-based CSP requires every matched page to render dynamically; ~20 pages were statically prerendered | Implemented, live-verified, accepted the trade-off with real evidence (see CSP section) |
| 3 | No historical CSP reports exist to classify (no persisted store, no live traffic since Phase 16) | Proceeded from direct inspection, not fabricated violation data |
| 4 | Admin "Audit log" page read a `localStorage`/demo-data mock; the real `AuditLog` table (900+ real rows) had no read path at all | Wired a real, platform-admin-only, cursor-paginated `GET /api/audit-log` |
| 5 | Negotiation messages are correctly bounded by design (one thread per RFQ+quote, 4 rows total) | No change — Category B |
| 6 | `listProducts`/`listSuppliers` looked low-volume (11 products, 5 suppliers) at the time of the audit | Re-tested under a real 1000-row fixture — products needed pagination after all (see Performance Measurements); suppliers did not |
| 7 | Webhook resilience (signature, event-id dedup, fail-closed) already correct | Re-verified, no code change |
| 8 | Cron auth (fail-closed, constant-time) already correct | Re-verified, no code change |
| 9 | Environment variable handling already correct (fail loudly on missing required, fail closed on missing optional secrets) | Documented (see Environment Variables) |
| 10 | Rate limiting coverage already complete for sensitive mutations; still in-memory/single-instance | Re-verified live, documented migration boundary, no Redis installed |
| 11 | No load-testing tool installed | Wrote a disposable measurement script using the platform's own `fetch`/`performance.now()` — no new dependency |
| 12 | Docker unavailable in this environment | Re-confirmed (`docker --version` → not found), documented, not claimed tested |

## CSP

**Starting point**: `Content-Security-Policy-Report-Only`, static, defined in `next.config.ts` (Phase 16) — same value on every response, no nonce possible.

**Implementation** (`src/proxy.ts`): the existing request-id proxy was extended, not replaced. Page requests (matched via Next's own documented negative-match pattern, excluding `_next/static`, `_next/image`, `favicon.ico`, and prefetch requests) now get:
- A fresh `crypto.randomUUID()`-derived nonce every request.
- `script-src 'self' 'nonce-<value>' 'strict-dynamic'` — no `'unsafe-inline'`. Matches Next's own documented pattern exactly (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`, "Adding a nonce with Proxy").
- `style-src 'self' 'unsafe-inline'` — unchanged from Phase 16, and **not** a leftover default: a nonce only ever applies to `<style>`/`<script>` elements, never to a `style=""` attribute, and this app genuinely uses inline style props in a few components (`grep -rl "style={{" src --include=*.tsx` → 3 files).
- The `x-nonce` value is forwarded as a request header; `src/app/layout.tsx` reads it via `headers()`, which is what forces the page to render dynamically (required — a nonce baked into a build-time-static HTML shell would be reused by every visitor, defeating its own purpose).

**File**: `src/proxy.ts` (extended `pageProxy`), `src/app/layout.tsx` (now `async`, reads `headers()`), `next.config.ts` (static CSP header removed — it now only comes from the proxy).

**Live verification** (real standalone server, real browser via `agent-browser`, not `next dev`):
1. Report-Only mode first: confirmed the header carries a fresh nonce every request (`curl -sI` twice, two different `nonce-` values); confirmed the HTML's own `<script nonce="...">` tags carry the exact same value as the header (16 script tags, all matching).
2. Logged in as buyer (John Doe, Acme Ghana), supplier (Adwoa Mensah), and platform admin (Grace Owusu); navigated dashboard, orders (including a real row-click navigation), purchase requests, budgets, recurring purchases, notifications (bell dropdown + full page), catalog, suppliers, RFQs, settings, and the newly-wired `/admin/audit` page. **Zero console errors/CSP violations in Report-Only mode across every page and workspace.**
3. Flipped to enforced (`CSP_ENFORCED=true`, then made this the default): re-ran the exact same checklist. **Zero console errors under a fully blocking CSP.** Confirmed real interactivity still works (a table row's `onClick` handler navigated to `/orders/[id]`, not just a static render).
4. `curl -sI /login` under enforced mode: `content-security-policy: default-src 'self'; script-src 'self' 'nonce-...' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; ...` — no `Content-Security-Policy-Report-Only` present alongside it (exactly one variant is ever set — also unit-tested, see Tests).

**Decision**: enforced CSP is now the default (`CSP_ENFORCED !== 'false'`), not Report-Only. `CSP_ENFORCED=false` remains available as a same-config emergency rollback. This is a judgment call, not a certainty — see PROJECT_SCOPE.md §12, item 6 for the honest framing of the trade-off (static rendering lost on ~20 pages) offered for outside review.

**Test**: `src/proxy.test.ts` (new, 8 tests) — nonce/CSP-header match, nonce uniqueness per call, no `unsafe-inline` on `script-src`, `unsafe-inline` retained on `style-src`, exactly one CSP header variant set, API requests unaffected (still get a request id, no CSP header), request-id trust/rejection behavior unchanged.

## Performance Test Environment

- **Fixture**: `phase17-fixture-create.js` (scratch script, not committed) created ~1000 rows each of Product, Order, PurchaseRequest, Notification, and AuditLog, under a single tagged scratch company/supplier/user (`phase17-perf-*` ids), via direct Prisma calls against the real dev database. Verified via `db.<model>.count({where:{id:{startsWith:'phase17-perf'}}})` → exactly 1000 for each before measurement.
- **Server**: real standalone production build (`npm run build` → `node .next/standalone/server.js`, `.next/static`+`public/` copied in, matching the Dockerfile's own approach), not `next dev`.
- **Sessions**: real `Session` rows minted directly (same token/hash scheme as `src/server/auth/session.ts`) for a buyer-side view, a supplier-side view, and the seeded platform admin — real HTTP requests with real session cookies, not direct service calls.
- **Measurement tool**: a disposable Node script (`phase17-benchmark.js`) using the platform's own `fetch` + `performance.now()` — no load-testing library installed for a one-time measurement (`autocannon`/`k6` etc. are not repository dependencies).
- **Cleanup**: `phase17-fixture-cleanup.js` deleted every tagged row in FK-safe order. Verified before/after: 1000/1000/1000/1000/1000 → 0/0/0/0/0 for products/orders/purchase-requests/notifications/audit-log, plus 0 residual companies/users/sessions/memberships matching the `phase17` tag anywhere in the database (`grep`-style `contains: 'phase17'` count across every touched table → all zero).

## Performance Measurements

30 requests per endpoint, real HTTP round-trips against the standalone server with the 1000-row fixture in place:

| Endpoint | Dataset | Page | Avg | Median | P95 | Response size | DB query count |
|---|---|---|---|---|---|---|---|
| `GET .../orders?page=1&pageSize=25` | 1000 rows | 1 | 37.14ms | 29.72ms | 44.40ms | 12,407B | 2 (`findMany`+`count`, via `Promise.all`) |
| `GET .../orders?page=20&pageSize=25` | 1000 rows | 20 | 33.27ms | 32.56ms | 43.49ms | 12,548B | 2 |
| `GET .../orders/summary` | 1000 rows | — | 31.34ms | 28.91ms | 43.97ms | 62B | 2 (`aggregate`+`count`) |
| `GET .../suppliers/[id]/orders?page=1` | 1000 rows | 1 | 32.37ms | 30.50ms | 53.20ms | 12,407B | 2 |
| `GET .../purchase-requests?page=1&pageSize=25` | 1000 rows | 1 | 33.40ms | 30.83ms | 49.72ms | 13,807B | 2 |
| `GET /api/notifications?pageSize=25` (cursor, page 1) | 1000 rows | — | 29.76ms | 29.09ms | 38.12ms | 6,059B | 1 (`findMany` with `take+1`, no separate count) |
| `GET /api/notifications?pageSize=25&cursor=...` (page 2) | 1000 rows | — | 26.40ms | 26.84ms | 34.86ms | 6,079B | 1 |
| `GET /api/notifications/unread-count` | 1000 rows | — | 28.83ms | 28.32ms | 40.91ms | 14B | 1 (`count`) |
| `GET /api/audit-log?pageSize=25` (cursor) | 1000 rows | — | 23.95ms | 25.68ms | 39.29ms | 7,059B | 1 |
| `GET /api/products?supplierId=...` — **before** pagination fix | 1000 rows | (unbounded) | **113.54ms** | **105.13ms** | **146.54ms** | **479,561B** | 1 (unbounded `findMany`) |
| `GET /api/products?supplierId=...` — **after** pagination fix | 1000 rows | 1 | **25.87ms** | **27.11ms** | **36.41ms** | **12,047B** | 2 |
| `GET /api/suppliers` (unpaginated, global) | 5 real + 0 fixture (suppliers weren't part of the fixture — see below) | (unbounded) | 15.09ms | 14.39ms | 23.88ms | 2,493B | 1 |

Database query *duration* in isolation was not separately instrumented (Prisma query-level timing middleware was not added this phase) — the response-time column above is the real, end-to-end number a caller experiences, which is the more meaningful figure for this exercise; per-query duration inside that total is **Not measured**.

Suppliers were deliberately not inflated to 1000 rows in the fixture — a real marketplace's supplier count is inherently much smaller than its product count (an order-of-magnitude difference every real B2B catalog exhibits), so testing it at product-scale would have been a synthetic, unrealistic scenario rather than real evidence. Its 15ms/2.5KB unpaginated response is not a target for optimization at any volume this app is likely to reach organically.

## Query Plans

`EXPLAIN ANALYZE` against the real 1000-row fixture (Prisma `$queryRawUnsafe`, `psql` unavailable in this environment):

```
Order(companyId, createdAt) — page 1:
Limit (actual time=0.046..0.062 rows=25)
  -> Index Scan Backward using "Order_companyId_createdAt_idx" (actual time=0.044..0.058 rows=25)
Execution Time: 0.126 ms

Order(companyId, createdAt) — page 20 (OFFSET 475):
Limit (actual time=0.195..0.211 rows=25)
  -> Index Scan Backward using "Order_companyId_createdAt_idx" (actual time=0.010..0.201 rows=500)
Execution Time: 0.222 ms

Order(supplierId, createdAt) — page 1:
Limit (actual time=0.039..0.114 rows=25)
  -> Index Scan Backward using "Order_supplierId_createdAt_idx" (actual time=0.039..0.112 rows=25)
Execution Time: 0.124 ms

PurchaseRequest(companyId, createdAt) — page 1:
Limit (actual time=0.070..0.074 rows=25)
  -> Index Scan Backward using "PurchaseRequest_companyId_createdAt_idx" (actual time=0.070..0.073 rows=25)
Execution Time: 0.098 ms

Notification(userId, createdAt) — cursor, page 1:
Limit (actual time=0.121..0.123 rows=26)
  -> Incremental Sort (Sort Key: createdAt DESC, id DESC; Presorted Key: createdAt)
     -> Index Scan Backward using "Notification_userId_createdAt_idx" (actual time=0.029..0.040 rows=27)
Execution Time: 0.416 ms

AuditLog(timestamp, id) — cursor, page 1:
Limit (actual time=0.025..0.043 rows=26)
  -> Index Scan Backward using "AuditLog_timestamp_id_idx" (actual time=0.024..0.041 rows=26)
Execution Time: 0.055 ms
```

**Confirmed**: every composite pagination index this app relies on (`Order(companyId, createdAt)`, `Order(supplierId, createdAt)`, `PurchaseRequest(companyId, createdAt)`, `Notification(userId, createdAt)`, plus the new `AuditLog(timestamp, id)`) is actually chosen by the query planner as an **Index Scan**, not merely present in the schema unused — this is real `EXPLAIN ANALYZE` evidence, not an assumption from the index existing.

**Two honest observations, not fixed this phase** (both sub-millisecond at this data volume, so neither justifies a change here):
1. The `Notification` query needs an `Incremental Sort` on top of its index scan, because the index is `(userId, createdAt)` without `id` as a third column, but the cursor's stable order is `createdAt DESC, id DESC`. A `(userId, createdAt, id)` index would let Postgres serve the exact sort order directly from the index with no extra sort step. Left as a documented future micro-optimization, not implemented, since the actual cost (0.416ms) doesn't justify it yet.
2. **Offset pagination's known degradation pattern is real, if small at this scale**: `Order`'s page-1 query cost `0.28..3.33`; its page-20 query (`OFFSET 475`) cost `58.26..61.31` — Postgres must still scan-and-discard every skipped row even with an index. At 1000 rows this is negligible (0.126ms vs 0.222ms); at a much larger scale (100k+ rows per tenant) this is exactly why notifications and the audit log were built cursor-based from the start rather than offset-based.

## Pagination Audit

Re-run in full (not just cited from Phase 16), classified against real, current data:

| Endpoint | Classification | Action |
|---|---|---|
| Orders (3 list endpoints) | A (already paginated, Phase 16) | Unchanged |
| Purchase requests | A (already paginated, Phase 16) | Unchanged |
| Notifications | A (already cursor-paginated, Phase 16) | Unchanged |
| **Products** (`GET /api/products`) | **A — re-classified this phase**, evidence-backed (see Performance Measurements) | **Paginated this phase** — offset, max pageSize 500 (see note below) |
| **Audit log** (`GET /api/audit-log`) | **A — newly real**, 900+ rows and growing | **Wired to the real table + cursor-paginated this phase** |
| Suppliers (`GET /api/suppliers`) | B — bounded by construction (a real marketplace has orders-of-magnitude fewer suppliers than products) | No change |
| Negotiation messages | B — bounded by construction (one thread per RFQ+quote pair; 4 rows total in the whole database) | No change |
| Every other `findMany` in `src/server/services` (team members, approval rules, branches, cost centers, departments, inventory records, price tiers, specifications, warehouses, RFQ items, quote items, ...) | B/D — small, tenant-scoped configuration/reference data, or internal-only queries never exposed as a user-facing list | No change |

**Tenant isolation for the two newly-paginated endpoints, verified**: `GET /api/products` has no session/tenant concept (public catalog, filtered only by the `PUBLISHED` moderation status already enforced) — pagination params can't leak anything across a tenant boundary that didn't already exist. `GET /api/audit-log` is scoped only by the `platform.manage` permission gate (platform admins legitimately see every tenant's audit trail by design — this is not a per-tenant list), verified via a dedicated route test.

## API Contracts

No OpenAPI document was generated this phase. Assessed against the brief's own test ("if OpenAPI can be generated reliably from existing Zod definitions without introducing significant schema duplication, implement it"): the Zod schemas in `src/server/validation/*` describe request bodies, not response shapes or path/query parameters, and route handlers construct responses ad hoc from DTOs rather than from a schema. Deriving a complete, accurate OpenAPI document would mean either (a) hand-writing response schemas alongside the existing request schemas — real, ongoing duplication risk the brief explicitly warns against — or (b) a non-trivial code-generation pass across 99 route files, which is disproportionate to this phase's validation scope and risks silently drifting from the real routes the moment either side is edited without the other. This call is unchanged from Phase 16's own conclusion, re-confirmed rather than re-litigated, since the API surface didn't grow in a way that changes the calculus (2 new routes, both simple).

Documented instead, in plain terms, matching the brief's minimum list:
- **Authentication**: httpOnly session cookie (`session_token`), set on `/api/auth/login`. No bearer tokens, no API keys for first-party use.
- **Authorization**: every tenant-scoped route re-derives the caller's own `companyId`/`supplierId` from the session server-side and checks it against the URL/body's claimed id (`ownsRecord`); a mismatch is a generic `404`, never a distinct `403`. Role/permission checks (`Permission` enum, `hasPermission`) gate specific actions on top of tenant ownership.
- **Tenant behavior**: see above — IDOR-resistant by construction, verified by dedicated cross-tenant tests for every domain.
- **Request parameters/bodies**: Zod-validated per route (`src/server/validation/*.ts`); a validation failure returns `422` with `{error, fieldErrors}`.
- **Response formats**: `ServiceResult<T>` internally (`{ok:true,data}` / `{ok:false,error}`), surfaced over HTTP as either the raw `data` on success or `{error: string, fieldErrors?}` on failure.
- **Pagination**: offset (`?page=&pageSize=`, `Page<T>` envelope: `{items,total,page,pageSize}`, default 25/max 100, or 500 for `/api/products` specifically) or cursor (`?cursor=&pageSize=`, `CursorPage<T>` envelope: `{items,nextCursor,hasNext}`) — see `src/server/pagination.ts`.
- **Standard errors**: `401` unauthenticated, `403` authenticated but lacking permission, `404` not found *or* not yours (indistinguishable, deliberately), `422` validation failure, `429` rate-limited, `500` unhandled (see Failure Testing).
- **Rate limits**: per-kind, in-memory, documented in `src/server/auth/rate-limit.ts` (see Rate Limiting).
- **Webhook authentication**: HMAC-SHA256 over the raw request body (`x-webhook-signature` header), constant-time comparison, fails closed while `PAYMENT_WEBHOOK_SIGNING_SECRET` is unset.
- **Cron authentication**: shared secret (`x-cron-secret` header), constant-time comparison, fails closed while `CRON_SECRET` is unset.

## Rate Limiting

Re-verified live, not re-architected:
- **Coverage confirmed complete** for every sensitive mutation class: auth (login, via `checkRateLimit`/`recordAttempt` directly since it needs "count only failures" semantics), payments, webhooks, negotiation messages, RFQ creation, and the Phase 15 procurement-configuration writes (`procurementWrite`, added Phase 16).
- **Live test — login**: 12 consecutive failed-login requests against the real standalone server → attempts 1–10 returned `401`, attempts 11–12 returned `429` with `{"error":"Too many attempts. Try again later."}`, matching the configured 10-per-15-minutes limit exactly.
- **Centralization confirmed**: every route uses the same four-function surface (`checkRateLimit`/`recordAttempt`/`clearAttempts`/`enforceRateLimit` in `src/server/auth/rate-limit.ts`) — no route implements its own ad hoc throttling.
- **Bypass resistance**: keys are `userId:ip` or `email:ip` (never a client-supplied, spoofable value alone); a harmless extra query param can't change which bucket a request lands in.
- **Response**: `429` with a JSON body, consistent with every other error response shape in this app.
- **Logging**: the proxy's own request-id is present on every rate-limited response (`X-Request-Id` header, confirmed present on the live `429` response above); no credentials or secrets appear in any rate-limit-related log line (the structured logger's own redaction pattern covers `password|token|secret|signature|authorization|cookie|card...` regardless of call site).
- **Not present, and not claimed**: a `Retry-After` header. The message tells the caller to try later but doesn't say precisely when — a minor, non-blocking polish item, not implemented this phase (see Remaining Limitations).

**Migration boundary to a shared (Redis) limiter, documented, not built**: the entire surface a Redis-backed version would need to replace is the four functions above — `checkRateLimit`, `recordAttempt`, `clearAttempts`, `enforceRateLimit` — none of the ~15 call sites across route handlers would need to change, since they only ever call this module's exported functions, never touch its internal `Map` directly. The swap is: replace the in-memory `Map`/`sweepExpired` internals with `INCR`/`EXPIRE` calls against a shared Redis instance, keeping the exact same function signatures. Not built this phase — genuinely not yet needed at single-instance scale, and the brief explicitly warned against installing it speculatively.

## Failure Testing

**Database unavailable — tested live**, not simulated in a unit test: the local `postgresql-x64-17` Windows service was actually stopped (`Stop-Service`), the standalone server was probed, then the service was restarted (`Start-Service`) and recovery was confirmed.

| Request | Result while DB down |
|---|---|
| `GET /api/health` | `503`, body `{"status":"degraded","checks":{"database":"error"}}` — no connection string, no stack trace |
| `GET /api/ready` | `503`, body `{"status":"not_ready","checks":{"database":"error"}}` |
| `POST /api/auth/login` (real credentials) | `500`, **empty body**, no `Content-Type` header — no leaked detail, but not this app's own `{error}` JSON shape either |
| `GET /api/products` | `500`, empty body — same pattern |

Server logs (not returned to the client) showed the real Prisma `P1001` connection error with a full stack trace and internal file paths — correctly confined to the server side, never reaching the HTTP response, confirmed by inspecting the raw response with `curl -i` (no body, no informative headers beyond the standard security headers and request id).

**Root cause**: `/api/health` and `/api/ready` explicitly catch and classify the connection failure (`checkDependencies`); most other routes call their service function directly and let an unhandled Prisma exception propagate to Next's own generic error handler, which returns an empty `500` for an API route. This is why only 1 of 99 route files (`invoices/[id]/pay`) uses the existing `withErrorHandling` utility (a Phase 16 finding, re-confirmed unchanged this phase) — the pattern exists but isn't consistently adopted.

**Verdict**: no secret leaks, a controlled (if inconsistent) HTTP status, the process itself never crashed or needed a restart, and readiness reporting is accurate — the brief's core safety bar is met. The inconsistency (empty `500` vs. this app's own `{error}` shape) is real and worth closing but is a polish item, not a security defect — flagged under Remaining Limitations rather than fixed via a sweeping refactor of ~90 route files in a single validation-phase pass.

**Recovery confirmed**: after `Start-Service`, `/api/health`/`/api/ready` returned to `200`/`"ok"` within 2 seconds, and a real product list request succeeded immediately — no manual intervention, no stale connection pool issue observed. The full 344-test suite was re-run against the restored database and passed unchanged.

## Concurrency

Re-run against the current implementation (no code in these paths changed this phase) via the existing real-database test suite, not re-derived from memory:

| Scenario | Test file | Expected | Actual (confirmed passing) |
|---|---|---|---|
| Two simultaneous requests competing for the final budget amount | `budget.service.test.ts` | One succeeds, one is refused (budget-exceeded) — atomic conditional SQL update | Confirmed |
| Two simultaneous quote-acceptance attempts | `procurement.service.test.ts` | Only one purchase order is ever created | Confirmed |
| Two simultaneous approval decisions on the same final step | `procurement.routes.test.ts` | Only one purchase order is ever created; never both, never zero | Confirmed |
| Two simultaneous recurring-purchase sweep executions | `recurringPurchase.service.test.ts` | Exactly one purchase request generated per due occurrence, never a duplicate | Confirmed |
| Duplicate payment webhook delivery / duplicate event id | `webhook.service.test.ts` | Second delivery is a no-op (event-id already recorded) | Confirmed |

All five mechanisms are the same atomic-conditional-update / unique-constraint techniques audited unchanged in Phase 16; this phase re-ran them against the current code (not just re-cited the prior result) as part of the full 344-test suite, all passing.

## Webhooks

Re-inspected, unchanged from Phase 16 (`src/app/api/webhooks/payments/[provider]/route.ts`, `webhook.service.ts`):
- **Authentication**: HMAC-SHA256 over the exact raw request bytes (never parsed-then-reserialized, which would let whitespace/key-order differences slip a tampered body past the check), constant-time comparison.
- **Event ID**: `payload.eventId` checked against a unique `(provider, providerEventId)` constraint on `PaymentTransaction` before any state change.
- **Duplicate handling**: a real payment is looked up by its own reference *before* the event-id check, specifically so a delayed/replayed event outside the normal window can't flip a since-changed payment's state back (documented in the service file itself).
- **Transaction boundaries**: the state change and the `PaymentTransaction` insert happen together.
- **Malformed payload**: `422` via Zod validation (`PaymentWebhookSchema.safeParse`).
- **Missing/invalid signature**: `401`, generic message, no signature-mismatch detail leaked.
- **Retry**: no automatic outbound retry exists in this app (it's a receiver, not a sender, for this integration) — a real gateway's own retry policy is accommodated by the generous `webhook` rate-limit kind (60/min) and idempotent event-id handling, not by this app initiating retries.

Not re-tested live this phase with a real duplicate-delivery curl sequence (it requires a real `Payment` fixture with a valid `method`/`reference`, and the existing `webhook.service.test.ts` already exercises exactly this scenario against a real, non-mocked Postgres database) — cited as sufficient evidence rather than duplicating the same check by hand.

## Cron

`POST /api/cron/recurring-purchase-sweep`, live-tested against the real standalone server:

| Test | Result |
|---|---|
| Called with no `x-cron-secret` header | `401 {"error":"Unauthorized."}` |
| Called with a wrong `x-cron-secret` value | `401 {"error":"Unauthorized."}` |
| Called twice in immediate succession, real secret | Both calls returned `200 {"ranCount":0,"createdPurchaseRequestIds":[],"warnings":[]}` — no error, no duplicate, no crash (no schedules happened to be due at test time; duplicate-occurrence prevention itself is covered by `recurringPurchase.service.test.ts`'s real-database concurrent-sweep test, confirmed passing — see Concurrency) |

Authentication fails closed (constant-time comparison, rejects whenever `CRON_SECRET` is unset or wrong) — confirmed unchanged from Phase 16, and now confirmed live rather than only by unit test.

## Security Verification

Consolidated battery, partly the existing 344-test suite (auth/authorization/tenant-isolation/input-validation categories are extensively covered there — not re-litigated line by line here) and partly new live spot-checks against the real standalone server this phase:

- **Malformed UUID in a path segment** (`GET /api/orders/not-a-valid-id`) → `404`, generic "could not be found" message (same as a real-but-not-yours id — no distinguishing signal).
- **Malformed JSON body on a mutation** → `422`, `{"error":"Invalid request.","fieldErrors":{}}`.
- **Unauthenticated mutation** → `401`, `{"error":"Authentication required."}`.
- **Attempted `orderBy`/sort injection via query string** (`?sortBy={"password":"asc"}` against the orders list) → silently ignored; the orders route accepts no `sortBy` parameter at all, its `ORDER BY createdAt DESC` is hardcoded server-side, never derived from client input. Confirmed live: the response ordering was unaffected by the injection attempt.
- **Negative `pageSize` / non-numeric `page`** → both fell back to their safe defaults (`pageSize=25`, `page=1`) rather than erroring or misbehaving, confirmed live against `/api/companies/.../orders`.
- **Cross-tenant probe**: `GET /api/companies/<a-real-other-company-id>/orders` while authenticated as a member of a different company → `404` (verified in Phase 16's suite, re-confirmed still passing this phase).
- **Security headers, verified live** (`curl -sI` against the standalone server): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`, and — now enforced, not Report-Only — `Content-Security-Policy`. All present on every page response checked.
- **Rate limits under repeated abuse**: see Rate Limiting (live 429 after 10 failed logins).

No new IDOR, injection, or authorization-bypass surface was found. Confirmation, not discovery, was this section's real output — consistent with the brief's own instruction that a clean result is a valid result, not a failure to try hard enough.

## Deployment Readiness

- **Production build**: `npm run build` succeeds cleanly (zero errors, zero warnings beyond the two known-benign, transient `AppRouteHandlerRoutes` type errors that resolve after the build itself regenerates `.next/types` — same pattern documented in every prior phase).
- **Standalone output**: `output: 'standalone'` in `next.config.ts`, unchanged. Verified this phase by actually running `node .next/standalone/server.js` (with `.next/static`+`public/` manually copied in, the one documented gap between this manual process and the Dockerfile's own automated `COPY` steps) repeatedly throughout this phase's live testing.
- **Startup command**: `node server.js` (the Dockerfile's `CMD`) — confirmed this is the correct standalone entrypoint, not `next start` (which expects the full, non-standalone build this image doesn't include).
- **Database migration strategy**: `prisma migrate deploy` (non-interactive-safe; `prisma migrate dev`/`--create-only` are both unavailable in this non-interactive environment, the same established workaround as every prior phase) — hand-written migration SQL files, reviewed before applying, never `prisma migrate reset`.
- **Environment variables**: see below.
- **Secure cookies**: unchanged, re-confirmed by inspection — `secure: isProduction` in `setSessionCookie`, so only set over HTTPS in production, plain-HTTP dev server unaffected.
- **Production secrets**: `AUTH_SECRET`/`DATABASE_URL` fail loudly at first access if missing or left as the placeholder `"CHANGE_ME"`; `PAYMENT_WEBHOOK_SIGNING_SECRET`/`CRON_SECRET` are optional at the env layer but the *consuming* route fails closed instead — verified by reading `src/server/env.ts` and `src/server/auth/require.ts` directly, and live-tested this phase (cron's no-auth/wrong-auth checks above).
- **No development-only assumption found** that would break in production: no hardcoded `localhost`, no dev-only conditional that silently no-ops a security check in production (`isDev` is used exactly once, in the CSP's `'unsafe-eval'` allowance, correctly scoped to `NODE_ENV === 'development'` only).

## Docker

**Not tested.** `docker --version` → `command not found`, confirmed again this phase (same result as every prior phase). Per the brief's own explicit fallback path (§21): the `Dockerfile` was reviewed instead, not run.

Review findings: the `Dockerfile`'s three-stage structure (`deps` → `builder` → `runner`) matches the standard Next.js `output: 'standalone'` pattern exactly — `npm ci` in `deps`, `prisma generate` + `npm run build` in `builder` (correctly noting neither step needs a real database connection), then the `runner` stage copies only `.next/standalone`, `.next/static`, `public/`, and `prisma/` from the builder, running as a non-root `nextjs` user, `CMD ["node", "server.js"]`. This is structurally identical to the manual standalone-server process this phase (and every prior phase) actually ran and verified live dozens of times — the same `.next/standalone` + `.next/static` + `public/` composition, just automated via `COPY` instead of a manual `cp`. This gives reasonable confidence the Dockerfile would work, but **confidence from structural review is not the same as verification**, and this report does not claim the latter.

## Environment Variables

| Variable | Required/Optional | Dev/Prod | Secret/Public | Behavior if absent |
|---|---|---|---|---|
| `DATABASE_URL` | Required | Both | Secret | Throws at first access (`env.ts`'s `required()`) |
| `AUTH_SECRET` | Required | Both | Secret | Throws at first access; also rejects the literal `"CHANGE_ME"` placeholder |
| `SESSION_TTL_SECONDS` | Optional | Both | Public | Defaults to `604800` (7 days) |
| `NODE_ENV` | Optional | Both | Public | Defaults to `"development"`; controls secure-cookie flag and CSP dev-eval allowance |
| `PAYMENT_WEBHOOK_SIGNING_SECRET` | Optional | Prod-meaningful | Secret | Webhook route fails closed (rejects every request) while unset |
| `CRON_SECRET` | Optional | Prod-meaningful | Secret | Every `/api/cron/*` route fails closed while unset |
| `MTN_MOMO_*` / `TELECEL_CASH_*` / `AIRTELTIGO_MONEY_*` (subscription key/API user/API key/base URL/target env) | Optional | Prod-meaningful | Secret | That network falls back to an instant-success simulation while any of its 3 required fields is unset |
| `STORAGE_*` | Optional | Future-stage | Secret | Unused — no code path reads these yet (`Document` model exists, no route does) |
| `REDIS_URL` | Optional | Future-stage | Secret | Unused — rate limiting remains in-memory |
| `CSP_ENFORCED` | Optional | Prod-relevant (new, Phase 17) | Public | Defaults to enforced (`true`); set to `"false"` for an emergency Report-Only rollback |

No `NEXT_PUBLIC_`-prefixed variable exists anywhere in `.env.example` — confirmed via direct grep — so no server secret can be compiled into the client bundle by construction, not merely by convention. No actual secret value is printed anywhere in this report or in `.env.example` (every real-looking value shown during live testing — e.g. the dev `.env`'s `CRON_SECRET`/`PAYMENT_WEBHOOK_SIGNING_SECRET` — is this local development database's own dev-only value, not a production credential, and was used only to drive `curl` requests in this session, never logged or committed).

## Browser Verification

Real standalone production build, real browser (`agent-browser`), across all three workspaces, performed twice (once for the CSP Report-Only check, once for enforced CSP) — see the CSP section for the full page list and results. Additionally, specific to this phase's other changes:
- **Catalog pagination**: logged in as buyer, navigated to `/catalog` against the live 1011-product dataset (11 seed + 1000 fixture, present at the time of this check) — pager correctly read "Page 1 of 41 · 1011 total"; clicking "Next" advanced to "Page 2 of 41 · 1011 total"; zero console errors throughout.
- **RFQ product picker**: navigated to `/rfqs/create` with the same 1011-product dataset live — page rendered cleanly with zero console errors (the picker's higher pageSize cap, 500, working as designed).
- **Audit log**: logged in as platform admin, navigated to `/admin/audit` — real audit entries rendered (genuine platform activity from this session's own testing, e.g. "purchase template removed", "purchase template created" with real timestamps and actor names), not demo/mock data; "Load more" fetched and appended a further page with zero console errors.
- No hydration errors, no console errors, and pagination/filters/navigation/notifications all confirmed working across every check performed — not claimed without actually opening the pages, per the brief's own instruction.
- Mobile-layout-specific verification was not performed this phase (no viewport-resize check was completed) — **not measured/not verified**, stated honestly rather than assumed fine because desktop was fine.

## Tests

```
Before: 41 files / 326 tests / 326 passed / 0 failed  (Phase 16's ending state)
After:  43 files / 344 tests / 344 passed / 0 failed
```

New/changed test files this phase:
- `src/proxy.test.ts` (new, 8 tests) — CSP nonce/header behavior, request-id behavior unchanged.
- `src/server/services/audit.routes.test.ts` (new, 6 tests) — platform-admin gate, cursor pagination security (tampered cursor, page-advance-without-overlap, pageSize clamping) for the newly-wired audit log endpoint.
- `src/server/services/catalog.routes.test.ts` (+4 tests) — `GET /api/products` pagination: real `Page` envelope, page-advance-without-overlap, pageSize clamped to the documented 500 max, invalid-page fallback.
- `src/server/services/catalog.service.test.ts` — updated 2 existing assertions for `listProducts`'s new paginated signature (no test weakened — same behavior asserted, new return shape).
- `src/server/auth/rate-limit.test.ts` (carried from Phase 16, re-confirmed passing, unchanged this phase).

No test was deleted, skipped, or had an assertion weakened to pass. Every modified test's assertions were updated only to match a new, still-fully-checked return shape (e.g. `.data` → `.data.items`), never loosened in strength.

## Build

- `npx vitest run --no-file-parallelism` → 43/43 files, 344/344 tests, 0 failed.
- `npx tsc --noEmit` → clean (0 errors), confirmed after a full `next build` regenerates `.next/types`.
- `npm run lint` → clean (0 errors, 0 warnings) — one real lint error was found and fixed during this phase (`react-hooks/set-state-in-effect` in the new catalog pager's filter-reset logic — moved `setPage(1)` into each filter-changing handler instead of a blanket effect, the idiomatic React fix, not a suppression).
- `npm run build` → succeeds, zero errors/warnings (beyond the known-benign transient route-type errors that resolve after this exact build completes).
- Standalone server (`node .next/standalone/server.js`) verified running repeatedly throughout this phase, including through a real database outage and recovery.

## Database Migrations

Two new migrations this phase, both applied via `prisma migrate deploy` (the established non-interactive-safe path — `prisma migrate dev`/`--create-only` remain unavailable in this environment) and confirmed via `prisma migrate status` → "Database schema is up to date!". `prisma migrate reset` was never run; no data was destroyed.

- `prisma/migrations/20260916122020_phase17_audit_log_index/migration.sql` — `AuditLog(timestamp, id)`, backing the new audit log's cursor pagination.
- `prisma/migrations/20260916124218_phase17_product_moderation_created_at_index/migration.sql` — `Product(moderationStatus, createdAt)`, backing the newly-paginated products browse query.

## Documentation

`PROJECT_SCOPE.md` updated only where implementation actually changed:
- Tech-stack table: test count (43/344) and route-file count (99).
- §6 (Security posture): CSP is now described as enforced (not Report-Only), with the live-verification evidence summarized; the database-outage finding added.
- §7 (Testing): count corrected.
- §8 (Known rough edges): audit log mock → real backend marked resolved; the `500`-vs-`{error}` inconsistency added as a new, honestly-labeled rough edge; the RFQ product-picker's 500-item cap documented.
- Docker line: re-confirmed still unavailable, not re-claimed as tested.
- New §11 ("Production security & scalability validation (Phase 17)"): CSP nonce rollout, real load-testing evidence (including the before/after products numbers), products pagination, the audit log bug/fix, live database-failure testing, and an explicit "not done, and why" list.
- New §12 item 6: an honest, outside-review-worthy question about whether the static-to-dynamic rendering trade-off was the right call.
- No claim was added or changed about Redis, Docker, OpenAPI, real payment providers, or email delivery — all remain exactly as previously documented (not implemented), consistent with the brief's instruction never to claim a deferred capability is complete when it isn't.

## Remaining Limitations

- **Error-response consistency during a full outage**: routes without `withErrorHandling` return an empty `500` instead of this app's own `{error}` JSON shape when the database is unreachable. Not a leak (confirmed via live `curl -i` — no body, no informative headers), and the client already degrades gracefully, but inconsistent with every other error path in the app. Real, live-discovered evidence this phase; not fixed (would mean touching ~90 route files, disproportionate to a validation phase) — see Recommended Next Phase.
- **No `Retry-After` header** on a `429` response — the message says "try again later" without a precise time. Minor, non-blocking.
- **`Notification`'s cursor query needs an `Incremental Sort`** on top of its index scan (see Query Plans) — a `(userId, createdAt, id)` index would remove it; not implemented, since measured cost is already sub-millisecond at realistic scale.
- **RFQ-creation product picker caps at 500 products** — a tenant with more than 500 published products wouldn't see the rest there. A searchable async picker is the real fix; out of scope for this phase.
- **CSP nonce required converting ~20 statically-prerendered pages to dynamic rendering** — accepted as a reasonable trade-off given this app is almost entirely behind auth already, but this was a judgment call this phase made, not a risk-free change; flagged explicitly for outside review (PROJECT_SCOPE.md §12, item 6).
- **No OpenAPI contract** — re-confirmed, not re-attempted, same reasoning as Phase 16.
- **Rate limiting remains in-memory/single-instance** — the Redis migration boundary is now documented precisely (see Rate Limiting) but not built; correctly still not yet needed.
- **Docker remains unverified** — Dockerfile reviewed and judged structurally sound against the same standalone-build process this phase verified live many times over, but never actually built/run.
- **Mobile-layout-specific browser verification was not performed this phase** — stated as not measured, not assumed fine.
- Suppliers list and every "Category B" `findMany` from the pagination audit remain unpaginated — re-confirmed as the right call at current/realistic data volumes, not revisited without cause.

## Files Changed

**CSP / proxy**: `src/proxy.ts`, `src/proxy.test.ts` (new), `src/app/layout.tsx`, `next.config.ts`.

**Audit log (new real backend)**: `src/server/services/audit.service.ts` (+`listAuditLog`), `src/app/api/audit-log/route.ts` (new), `src/services/audit-log.service.ts` (rewritten from mock to real API client), `src/app/(app)/admin/audit/page.tsx`, `src/app/(app)/admin/page.tsx`, `src/server/services/audit.routes.test.ts` (new).

**Products pagination**: `src/server/services/catalog.service.ts` (`listProducts`), `src/app/api/products/route.ts`, `src/services/catalog.service.ts`, `src/app/(app)/catalog/page.tsx`, `src/app/(app)/rfqs/create/page.tsx`, `src/server/services/catalog.routes.test.ts`, `src/server/services/catalog.service.test.ts`.

**Database**: `prisma/schema.prisma` (`AuditLog(timestamp, id)`, `Product(moderationStatus, createdAt)` indexes), two new migrations (see Database Migrations).

**Types**: `src/types/common.ts` — no change this phase beyond what Phase 16 already added (`CursorPage<T>`), reused as-is for the audit log.

**Config/docs**: `.env.example` (+`CSP_ENFORCED`), `PROJECT_SCOPE.md`, `PHASE17_AUDIT.md` (new), this report (new).

**Not committed to the repo** (disposable, scratch-only, verified fully cleaned up): `phase17-fixture-create.js`, `phase17-fixture-cleanup.js`, `phase17-mint-sessions.js`, `phase17-benchmark.js`, `phase17-query-plans.js` — all lived under this session's scratchpad directory, never under the project's own tracked source tree.

## Recommended Next Phase

1. Close the error-response inconsistency found under Failure Testing — either broaden `withErrorHandling` adoption across route handlers, or add a single top-level catch in the shared request pipeline (`src/proxy.ts` or a shared route wrapper) so a full outage returns this app's own `{error}` JSON shape everywhere, matching what `/api/health`/`/api/ready` already do correctly.
2. A narrower-scope CSP nonce alternative worth evaluating against this phase's site-wide choice: apply the nonce/dynamic-rendering requirement only to the handful of pages that actually need it, leaving the rest statically prerendered — trading some of this phase's simplicity for restored static-rendering performance on pages that don't need per-request freshness.
3. A `(userId, createdAt, id)` index for `Notification` to remove the `Incremental Sort` step identified in Query Plans (cosmetic at current scale, but free to fix once revisited).
4. A `Retry-After` header on `429` responses.
5. Redis-backed rate limiting once the app actually runs on more than one instance — the migration boundary is now documented precisely; still correctly deferred.
6. Docker build/run verification, the moment a Docker-capable environment is available — the Dockerfile has now been reviewed twice (Phase 14, Phase 17) against the real standalone-build process and judged sound, but "sound on review" still isn't "verified."
