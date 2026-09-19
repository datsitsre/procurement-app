# Phase 16 Final Report

## Audit Findings

Full findings are in `PHASE16_AUDIT.md` (produced before any code change, per the brief's Step 0). Summary of what was actionable and acted on:

| # | Finding | Evidence | Risk | Affected files | Recommended change | Expected impact |
|---|---|---|---|---|---|---|
| 1 | Only 1 of ~60 GET list endpoints (`/api/payments`) paginated; every other `findMany` returns the full result set | `grep -rl "parsePagination" src/app/api` → 1 file; `grep -rln "take:\|skip:" src/server/services` → 1 file | A tenant with years of orders/purchase requests/notifications gets an unbounded, ever-slower response | `orders.service.ts`, `procurement.service.ts`, `notification.service.ts` + their routes/pages | Extend the existing `Page<T>` utility (offset) and add a cursor utility for append-only feeds; apply to the highest-volume, most-likely-to-grow endpoints first | Bounded response size/time regardless of tenant age; no behavior change for small tenants |
| 2 | Zero composite indexes exist for tenant-scoped, time-ordered queries | 99 index/unique declarations audited, all single-column for tenant scoping | Once paginated, `WHERE companyId = ? ORDER BY createdAt DESC LIMIT` queries would still full-scan without a matching composite index | `prisma/schema.prisma` (`Order`, `PurchaseRequest`, `Notification`) | Add `(tenantColumn, createdAt)` composite indexes for exactly the queries the new pagination introduces | Query plan uses an index scan instead of a sequential scan as row counts grow; small write-side storage cost |
| 3 | Dashboards compute aggregate stats (`totalSpend`, `monthlySpend`, `openOrders`, `ordersToFulfill`) via client-side `.reduce()`/`.filter().length` over the full orders array | `dashboard/page.tsx`, `SupplierDashboard.tsx` read before pagination | Paginating `listOrders` without fixing this would silently make these numbers wrong for any company with more than one page of orders | `orders.service.ts` (server+client), `dashboard/page.tsx`, `SupplierDashboard.tsx` | Add real Prisma `aggregate()`/`count()` endpoints; consume those instead of deriving from a page of rows | Dashboard numbers stay correct after pagination, computed server-side once instead of client-side over unbounded data |
| 4 | Phase 15's mutation routes (budgets/purchase-templates/recurring-purchases create/update/delete, run-due) have zero rate limiting | `grep -rn enforceRateLimit` across those route files → no matches | Scriptable write flood against admin-configuration endpoints | 8 route handlers across 4 route files | Add a dedicated `procurementWrite` rate-limit kind, same pattern as existing kinds | Bounded write rate per user+IP; no change to legitimate usage |
| 5 | No CSP of any kind; Next injects inline hydration `<script>` tags with no nonce | Live response inspected earlier in the session | A blocking CSP shipped now would either break the app (no `unsafe-inline`) or be a no-op allowlist (with it) | `next.config.ts` | Ship `Content-Security-Policy-Report-Only` (can never block), collect real violation data via a report endpoint, defer blocking CSP to a scoped nonce-rollout phase | Zero regression risk; real evidence collected for the next phase instead of guessing |
| 6 | Error standardization (`withErrorHandling`), observability, health/readiness, financial-precision handling, and the three existing atomic-concurrency mechanisms (budget reservation, quote acceptance, recurring-sweep claim) were all re-inspected and found unchanged/correct | Direct code re-read, no regressions found | — | — | No action — "if something is already correct, leave it alone" | None; confirmed via the full test suite passing before and after |

## Architecture

No architectural rebuild. The existing Route → Auth → Zod → Service → DTO → Prisma layering, `ServiceResult<T>` contract, and multi-tenant `ownsRecord` model are unchanged and were reused for every new endpoint added this phase (`orders/summary`, `orders/to-fulfill-count`, `notifications/unread-count`, `csp-report`). Prisma, PostgreSQL, and Next.js versions are unchanged.

## API Pagination

- **Offset pagination** (`src/server/pagination.ts`): pre-existing `parsePagination`/`toPage`/`Page<T>` extended to three more service functions this phase:
  - `orders.service.ts#listOrders` / `#listAllOrders` / `#listOrdersForSupplier` — routes: `GET /api/companies/[companyId]/orders`, `GET /api/orders`, `GET /api/suppliers/[supplierId]/orders`.
  - `procurement.service.ts#listPurchaseRequests` — route: `GET /api/companies/[companyId]/purchase-requests`.
  - Query params: `?page=&pageSize=`, default 25, max 100, invalid/negative/non-numeric values fall back to safe defaults (`src/server/pagination.ts`, `parsePagination`).
- **Cursor pagination** (new this phase, `src/server/pagination.ts`'s `parseCursorPagination`/`toCursorPage`/`CursorPage<T>`): applied to `notification.service.ts#list` — route: `GET /api/notifications`. Cursor encodes `(createdAt, id)` as base64url; a malformed cursor decodes to `null` and falls back to page one rather than erroring.
- Tenant scoping happens inside the same query as pagination in every case (`WHERE companyId = ? ... skip/take`), never applied after fetching — verified by the pagination-security tests below.

## Query Performance

- N+1/over-fetching audit: no new N+1 introduced. `listOrders`/`listPurchaseRequests`/notification `list` each remain a single `findMany` (plus one `count` for offset pagination, using `Promise.all` to run concurrently) — no per-row follow-up query.
- `select`/`include` shapes were left unchanged from before this phase (`PURCHASE_REQUEST_INCLUDE` etc.) — not touched, since the audit found no over-fetching regression introduced by adding `skip`/`take`.
- Dashboard aggregate stats (`totalSpend`, `monthlySpend`, `openOrders`, `ordersToFulfill`, unread notification count) moved from client-side reduction over full arrays to single Prisma `aggregate()`/`count()` calls: `orders.service.ts#getOrderSummary`, `#getSupplierOrdersToFulfillCount`, `notification.service.ts#getUnreadCount`.

## Database Indexes

Two hand-written migrations (Prisma's interactive `migrate dev` is unavailable in this non-interactive environment — see prior phases' established workaround), applied via `prisma migrate deploy` and confirmed with `prisma migrate status` → "Database schema is up to date!":

- `prisma/migrations/20260916105232_phase16_pagination_indexes/migration.sql`:
  - `Order(companyId, createdAt)` — supports `GET /api/companies/[companyId]/orders`'s `WHERE companyId = ? ORDER BY createdAt DESC LIMIT`. No prior index covered this combination (only single-column `companyId`/`createdAt` existed). Write-storage cost: one more index maintained on every order insert/update.
  - `PurchaseRequest(companyId, createdAt)` — supports the equivalent purchase-requests list query. Same justification/cost shape.
  - `Notification(userId, createdAt)` — supports the cursor query's `WHERE userId = ? AND (createdAt < ? OR (createdAt = ? AND id < ?)) ORDER BY createdAt DESC, id DESC LIMIT`. Same shape.
- `prisma/migrations/20260916105611_order_supplier_created_at_index/migration.sql`:
  - `Order(supplierId, createdAt)` — supports `GET /api/suppliers/[supplierId]/orders`'s equivalent supplier-scoped query.

No `prisma migrate reset` was run at any point; no data was destroyed.

## API Contracts

No formal OpenAPI spec was generated this phase — the existing Zod schemas (`src/server/validation/*.ts`) are the closest artifact to a contract and were not touched, since no request/response shape changed for existing fields (pagination is purely additive query params + a new envelope on previously-array-returning endpoints, which is a breaking wire-format change handled entirely on the consuming side in this same phase — see Frontend Compatibility below). Generating a full OpenAPI document from the Zod schemas was judged out of proportion to this phase's scope and is left as a documented limitation rather than attempted partially.

## Rate Limiting

- New `RateLimitKind`: `procurementWrite` (`src/server/auth/rate-limit.ts`), windowMs 60s, max 20, keyed by `userId:ip` — same in-memory sliding-window mechanism as every other kind, explicitly still not Redis-backed/cross-instance (documented, unchanged from before this phase — see `PROJECT_SCOPE.md` §5).
- Wired into 8 handlers across 4 route files: `budgets` POST, `budgets/[budgetId]` DELETE, `purchase-templates` POST, `purchase-templates/[templateId]` DELETE, `recurring-purchases` POST, `recurring-purchases/[recurringId]` PATCH + DELETE, `recurring-purchases/run-due` POST.
- Test: `src/server/auth/rate-limit.test.ts` — new test confirms `procurementWrite` enforces its own configured limit independently of other kinds.

## Observability

Unchanged from the prior phase — the existing structured `logger` (`src/server/observability/logger.ts`) was reused as-is for the new CSP report collector (`logger.warn('CSP report-only violation', { report: body })`), redacting sensitive keys the same way every other log call site does. No new observability infrastructure was added or was needed.

## Security Headers / CSP

- `next.config.ts` now ships `Content-Security-Policy-Report-Only` alongside the existing headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security` — all unchanged).
- Policy: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; report-uri /api/csp-report`.
- **Deliberately no `'unsafe-inline'` on `script-src`** — this means Next's own inline hydration scripts will report as violations. That's intentional: Report-Only can never block them, so the reports are real evidence of what a future nonce rollout needs to cover, rather than a guess. `style-src` does allow `'unsafe-inline'` since a handful of components use `style={{...}}` props, and that's already-known, accepted behavior, not something worth generating report noise for.
- **Explicit blocker for a blocking (enforced) CSP, per the brief's own allowance to document rather than force**: Next's inline hydration scripts aren't nonce'd anywhere in this codebase's control (they're framework-generated), so a blocking `script-src 'self'` would break every page's hydration today. Fixing that needs a dedicated nonce-threading pass (per-request nonce generated in middleware, passed to Next's script nonce config, verified live) — out of scope for this phase, and not attempted partially.
- New route `GET/POST /api/csp-report`: rate-limited (reuses the `webhook` kind, keyed by IP), logs the report, returns `204`. Not session-authenticated by necessity (the browser sends it directly, same as a webhook).
- Verified live: `curl -sI http://localhost:3100/dashboard` shows the header on a real response (see Live Verification).

## Concurrency & Idempotency

Re-verified, not re-derived — the three existing atomic-conditional-update mechanisms were read again in full and found unchanged:
- `budget.service.ts#reserveBudget`/`#releaseBudget` — atomic conditional SQL update.
- `procurement.service.ts#acceptQuote`/`#decideStep` — the section 6/25 duplicate-PO race fix from a prior phase.
- `recurringPurchase.service.ts#runDueSchedules` — atomic-claim sweep + `RecurringPurchaseRun` unique-constraint backstop.

No code in these paths was touched this phase. Confirmed via the full test suite (all pre-existing concurrency tests for these three mechanisms pass — see Tests).

## Security Verification

- Pagination tenant isolation: verified both by new automated tests (below) and manually live — a cross-tenant probe against another company's paginated orders/purchase-requests returns 404 regardless of query params; switching active company via `/api/auth/switch-company` and re-querying returns only that company's own rows.
- Manipulated/tampered cursor: decodes to `null` server-side, falls back to page one, never throws or leaks rows outside the caller's own `userId` scope (tested and live-verified — see below).
- Excessive `pageSize` (`999999`): clamped to 100 (tested and live-verified).
- Negative/invalid `page` (`-5`): falls back to `1` (tested).
- No new IDOR surface: every new list route reuses the existing `requireCompanyAccess`/`requireSupplierAccess`/session-derived-`userId` pattern; no route accepts a tenant id from a cursor or pagination param.

## Tests

- **Before this phase**: 40 test files / 300 tests (confirmed live before any implementation, per Step 0).
- **After this phase**: **41 test files / 326 tests**.
- **Passed**: 326. **Failed**: 0.
- New/updated test files:
  - `src/server/pagination.test.ts` — +15 tests for cursor encode/decode round-trip, malformed input, `parseCursorPagination` defaults/clamping, `toCursorPage` behavior (25 tests total, up from 10).
  - `src/server/services/orders.routes.test.ts` — +5 tests: cross-tenant list refusal (company and supplier), a real caller getting a correctly-scoped `Page` envelope, pageSize clamping, invalid-page fallback.
  - `src/server/services/procurement.routes.test.ts` — +3 tests: same pattern for purchase requests.
  - `src/server/services/notification.routes.test.ts` — new file, 7 tests: tenant isolation via session (never a query param), tampered-cursor fallback, a well-formed-but-foreign cursor still can't cross tenant scope, pageSize clamping, unauthenticated rejection (both the list and unread-count routes).
  - `src/server/services/notification.service.test.ts` — updated existing `list` call site for the new cursor-paginated signature.
  - `src/server/services/procurement.service.test.ts` — updated existing `listPurchaseRequests` call site for the new paginated signature.
  - `src/server/auth/rate-limit.test.ts` — +1 test for the new `procurementWrite` kind.
- No test was deleted, skipped, or weakened to pass. Every pre-existing assertion in a modified test file was updated only to match the new (still-correct) return shape, never loosened.

## Build

- `npx tsc --noEmit` → clean, 0 errors (confirmed after a full `next build`, which regenerates `.next/types` and resolves the transient `AppRouteHandlerRoutes` errors new route files show before their first build — expected/benign, not a real defect).
- `npm run lint` → clean, 0 errors, 0 warnings (one unused-import warning in `SupplierDashboard.tsx`, introduced by this phase's own refactor, was found and fixed, not left in).
- `npm run build` → succeeded, all new routes present in the route manifest (`/api/companies/[companyId]/orders/summary`, `/api/suppliers/[supplierId]/orders/to-fulfill-count`, `/api/notifications/unread-count`, `/api/csp-report`).

## Performance Measurements

**Not benchmarked.** No load-testing tool was run and no before/after latency numbers were measured this phase — the brief's own instruction is to say so explicitly rather than invent numbers. What was verified instead: query *shape* (index-backed `WHERE tenant = ? ORDER BY createdAt DESC LIMIT` instead of an unbounded `findMany`), and that pagination correctly bounds response size (`pageSize` clamped to 100, confirmed live and in tests). A controlled ~1000-row fixture load test was considered per the brief's suggestion but not run this phase; it's listed under Recommended Next Phase rather than fabricated.

## Live Verification

Performed against a real standalone production build (`npm run build` → `node .next/standalone/server.js`, with `.next/static` and `public/` manually copied in, matching the existing `Dockerfile`'s own approach), not just `next dev`:

- `GET /api/health` → `{"status":"ok","checks":{"database":"ok"}}`; `GET /api/ready` → `{"status":"ready",...}`.
- Logged in as the seeded `john.doe@acmetech.example` account, switched active company to `company-acme-gh` via `/api/auth/switch-company`.
- `GET /api/companies/company-acme-gh/orders?page=1&pageSize=2` and `?page=2&pageSize=2` returned two distinct, non-overlapping pages of real orders with `total: 6`.
- `GET /api/companies/company-acme-gh/orders/summary` returned real aggregated figures (`totalSpend: 110551`, `monthlySpend: 56501`, `openOrders: 4`) that matched what the dashboard rendered in a real browser session.
- `GET /api/companies/company-acme-gh/purchase-requests?page=1&pageSize=2` returned a correctly-scoped, correctly-paginated `Page` envelope (`total: 5`).
- Created 5 scratch notifications directly in the database, then verified `GET /api/notifications?pageSize=2` and a second call with the returned `nextCursor` returned two non-overlapping pages covering all 5, newest-first; `GET /api/notifications/unread-count` returned `5`; `POST /api/notifications/read-all` then brought it to `0`. Scratch data cleaned up afterward.
- Cross-tenant probe: `GET /api/companies/company-acme-ng/orders` while the active company was `company-acme-gh` → `404`.
- `curl -sI /dashboard` confirmed the `Content-Security-Policy-Report-Only` header is present on a real response, alongside the pre-existing security headers.
- Real browser session (`agent-browser`, not just `curl`): logged in, selected the Ghana company, and visually confirmed the Dashboard (server-computed summary stats matching the API), Orders list, Purchase requests list, notification bell dropdown ("No notifications" after cleanup), and the full `/notifications` page all render correctly with no browser console errors.
- Standalone server and browser session were both cleanly shut down afterward; no leftover processes.

## Documentation

`PROJECT_SCOPE.md` updated only where implementation actually changed:
- Tech-stack table: test count (41 files/326 tests) and route-file count (98) corrected to the current, verified state.
- §6 (Security posture): added the Report-Only CSP note and the `procurementWrite` rate-limiting note.
- §7 (Testing): test count corrected.
- New §10 ("API pagination and index hardening (Phase 16)"): documents the offset/cursor pagination utilities, the four new composite indexes with their justification, the dashboard-aggregation fix, and an explicit list of what was *not* paginated this phase and why (deliberately, not an oversight).
- No claim about Redis, Docker, a blocking/enforced CSP, real payment providers, or email delivery was added or changed — all remain exactly as previously documented (still not implemented), consistent with the brief's instruction never to claim a deferred capability is complete when it isn't.

## Remaining Limitations

- Cursor pagination was applied only to notifications this phase. Other append-only-ish feeds (audit log, negotiation messages) would use the same utility if/when they get a dedicated paginated list endpoint — not done speculatively here.
- `listProducts`/`listSuppliers` and the majority of other `findMany` call sites remain unpaginated — classified as lower-risk in `PHASE16_AUDIT.md`'s Category A/B/C table at current data volumes, left as future work rather than touched speculatively.
- No blocking/enforced CSP — Report-Only only, with the exact blocker (Next's un-nonce'd inline hydration scripts) documented above rather than worked around unsafely.
- Rate limiting remains in-memory/single-instance, as it has been since it was first introduced — unchanged and still explicitly documented as such, not silently left ambiguous.
- No formal OpenAPI contract was generated — judged disproportionate to this phase's scope; the Zod schemas remain the closest thing to a contract.
- No load-test/before-after performance numbers exist (see Performance Measurements) — query *shape* was verified, not measured throughput/latency.

## Files Changed

**Server pagination core**: `src/server/pagination.ts` (+cursor utilities), `src/server/pagination.test.ts` (+15 tests), `src/types/common.ts` (+`CursorPage<T>`).

**Services**: `src/server/services/orders.service.ts` (paginated `listOrders`/`listAllOrders`/`listOrdersForSupplier`, +`getOrderSummary`, +`getSupplierOrdersToFulfillCount`), `src/server/services/procurement.service.ts` (paginated `listPurchaseRequests`), `src/server/services/notification.service.ts` (cursor-paginated `list`, +`getUnreadCount`).

**Routes (modified)**: `src/app/api/orders/route.ts`, `src/app/api/companies/[companyId]/orders/route.ts`, `src/app/api/suppliers/[supplierId]/orders/route.ts`, `src/app/api/companies/[companyId]/purchase-requests/route.ts`, `src/app/api/notifications/route.ts`, plus rate-limiting added to `src/app/api/companies/[companyId]/budgets/route.ts`, `.../budgets/[budgetId]/route.ts`, `.../purchase-templates/route.ts`, `.../purchase-templates/[templateId]/route.ts`, `.../recurring-purchases/route.ts`, `.../recurring-purchases/[recurringId]/route.ts`, `.../recurring-purchases/run-due/route.ts`.

**Routes (new)**: `src/app/api/companies/[companyId]/orders/summary/route.ts`, `src/app/api/suppliers/[supplierId]/orders/to-fulfill-count/route.ts`, `src/app/api/notifications/unread-count/route.ts`, `src/app/api/csp-report/route.ts`.

**Client services**: `src/services/orders.service.ts`, `src/services/procurement.service.ts`, `src/services/notification.service.ts`.

**Frontend pages/components**: `src/app/(app)/dashboard/page.tsx`, `src/features/supplier/SupplierDashboard.tsx`, `src/app/(app)/orders/page.tsx`, `src/app/(app)/admin/orders/page.tsx`, `src/app/(app)/purchase-requests/page.tsx`, `src/app/(app)/notifications/page.tsx`, `src/components/layout/NotificationBell.tsx`.

**Rate limiting / security**: `src/server/auth/rate-limit.ts`, `src/server/auth/rate-limit.test.ts`, `next.config.ts`.

**Database**: `prisma/schema.prisma`, two new migrations (below).

**Tests (new/updated)**: `src/server/services/orders.routes.test.ts`, `src/server/services/procurement.routes.test.ts`, `src/server/services/notification.routes.test.ts` (new file), `src/server/services/notification.service.test.ts`, `src/server/services/procurement.service.test.ts`.

**Docs**: `PROJECT_SCOPE.md`, `PHASE16_AUDIT.md` (new), this report (new).

## Database Migrations

Both applied via `prisma migrate deploy` (the non-interactive-safe path; `prisma migrate dev`/`--create-only` are unavailable in this environment, per the established workaround from prior phases) and confirmed with `prisma migrate status` → "Database schema is up to date!". No data was reset or destroyed.

- `prisma/migrations/20260916105232_phase16_pagination_indexes/migration.sql` — `Order(companyId, createdAt)`, `PurchaseRequest(companyId, createdAt)`, `Notification(userId, createdAt)`.
- `prisma/migrations/20260916105611_order_supplier_created_at_index/migration.sql` — `Order(supplierId, createdAt)`.

## Git Status

Clean working tree apart from this phase's own changes (verified via `git status`/`git diff` before and after implementation). Two pre-existing, unrelated changes from before this session were left untouched, not committed over or investigated as part of this phase: `Demo Accounts.docx` (binary diff) and untracked `pnpm-lock.yaml`/`pnpm-workspace.yaml` (dated a day before this phase's work). No secrets were introduced — the standalone-server `.env` copy used for live verification lives under the gitignored `.next/` directory. 38 tracked files modified, 8 new files added (2 migrations, `PHASE16_AUDIT.md`, this report, 4 new route files, 1 new test file — see Files Changed for the full list), net **759 insertions / 152 deletions**. No commits were created — left staged for the user to review and commit, per this session's own commit-only-on-request convention.

## Recommended Next Phase

1. A scoped nonce-rollout to move the CSP from Report-Only to enforced (`script-src 'self' 'nonce-<per-request>'`), using the violation data `/api/csp-report` starts collecting from this phase onward.
2. Cursor-paginate remaining append-only feeds (audit log, negotiation messages) if/when they get dedicated list endpoints, using the exact same `parseCursorPagination`/`toCursorPage` utilities.
3. A controlled ~1000-row fixture load test (per this phase's own brief) to get real before/after latency numbers for the newly-paginated endpoints — deliberately not fabricated this phase.
4. Extend offset pagination to `listProducts`/`listSuppliers` if/when their result sets are observed to grow past what a single unbounded response should reasonably carry.
5. Redis-backed rate limiting once the app actually runs on more than one instance — still correctly deferred, not yet needed.
