# B2B Procurement Platform — Project Scope

*A summary written for external review (e.g., pasting into ChatGPT or another LLM for a second-opinion architecture/security/product audit). Written from the actual codebase, not from memory of the plan — every number below was checked against the repo at the time of writing.*

## 1. What this is

A multi-tenant B2B e-commerce and procurement platform serving three distinct audiences from one codebase:

- **Buyers** — companies that discover suppliers, request quotes, negotiate, raise purchase requests, route them through configurable approval chains, place orders, and pay invoices.
- **Suppliers** — companies that list products, respond to RFQs, fulfill orders, and get paid.
- **Platform operators** — staff who verify suppliers, moderate product listings, resolve disputes, and watch an audit log across every tenant.

Originally scaffolded as a consumer food-ordering app, then pivoted and rebuilt (see git history: `Archive: SpringFood consumer food-ordering app` is the very first commit) into this current B2B procurement product across roughly a dozen numbered "Phases," the most recent and largest of which ("Phase 14") migrated the entire backend from a frontend-only mock (localStorage-backed) to a real, database-backed server — the focus of most of this document.

## 2. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack), React 19 |
| Language | TypeScript, strict mode |
| Database | PostgreSQL 17 |
| ORM | Prisma 6.19.3 — **56 models** in `prisma/schema.prisma` |
| Auth | bcrypt password hashing + opaque, httpOnly-cookie sessions (no JWT, no third-party auth provider) |
| Validation | Zod, one schema file per domain under `src/server/validation/` |
| Styling | Tailwind CSS v4 |
| Testing | Vitest — **43 test files, 344 tests** (updated through Phase 17), run against a real dev Postgres instance (not mocked) |
| Icons | lucide-react |

No ORM-agnostic abstraction, no GraphQL layer, no separate backend service — Next.js's own API routes (`src/app/api/**/route.ts`) are the entire backend, **99 route files** as of this writing (updated through Phase 17 - see git history).

## 3. Architecture

### 3.1 Layering
Every mutating request follows the same stack, enforced by convention rather than a framework:

```
Route handler (src/app/api/**)
  → auth/tenant check (src/server/auth/require.ts: requireAuthenticated / requireCompanyAccess / requireSupplierAccess)
  → Zod validation (src/server/validation/*.ts)
  → service function (src/server/services/*.ts) — the only layer that touches Prisma
  → DTO mapper (src/server/dto/*.ts) — strips internal fields, converts Decimal→number and Date→ISO string before anything crosses the API boundary
```

**21 server service files** hold all business logic; nothing touching the database lives in a route file or a React component.

### 3.2 Multi-tenancy
- A **company ID is never trusted from the client.** Every tenant-scoped route re-derives the caller's own `companyId`/`supplierId` from their authenticated session server-side (`server/auth/context.ts`'s `resolveTenant`), then checks the URL's id against it (`ownsRecord`). A mismatch returns a generic 404 — never a distinct "forbidden" — so an ID-guessing probe can't distinguish "doesn't exist" from "exists but isn't yours."
- One `CompanyMembership` row ties a `User` to a `Company` with a `Role`; a single person can belong to multiple companies (buyer and/or supplier) simultaneously — the login flow and company switcher both handle this.
- RBAC (`src/config/rbac.ts`) defines 10 roles across three "workspaces" (buyer/supplier/platform) and a permission matrix that both the UI (hide, don't just disable) and every route (re-check server-side) consult.

### 3.3 Auth
- Passwords: bcrypt, cost factor 12.
- Sessions: random opaque token, hashed before storage, httpOnly + `Secure` (in production) + `SameSite=lax` cookie — deliberately not a JWT, so a session can be revoked server-side instantly.
- CSRF: same-origin check applied centrally to every non-GET request through `requireCompanyAccess`/`requireSupplierAccess`/`requireAuthenticated`.
- Machine-to-machine routes (payment webhooks, cron sweeps) use HMAC signature / shared-secret + constant-time comparison instead of a session, and **fail closed** (reject everything) while unconfigured rather than the whole app refusing to boot.

### 3.4 Data integrity
- Multi-record writes (checkout → order + invoice + payment + timeline, in one shot) run inside `db.$transaction`.
- Idempotency keys prevent a retried request from double-charging.
- An append-only `AuditLog` and `PaymentTransaction`/`NegotiationMessage` ledger record what happened, not just current state.

## 4. Domain coverage

All of the following are real, Postgres-backed, and covered by at least route-boundary tests (auth/tenant-isolation) — none of it is mock data dressed up as a feature.

| Domain | Buyer surface | Supplier surface | Platform surface |
|---|---|---|---|
| Catalog | Browse/search/filter products & suppliers, product detail, compare | Manage own products & inventory, moderation queue visibility | Moderate listings, verify/suspend suppliers |
| RFQ & negotiation | Create RFQ, invite suppliers, compare quotes, **two-way negotiation thread**, accept a quote | Respond to RFQ invites, submit quote, **reply in the same negotiation thread** | — |
| Procurement | Purchase requests, configurable multi-step approval rules (admin-defined, by spend band/role), purchase orders, spending limits, **budgets** (company/department/cost-center-scoped, enforced server-side against every new purchase request, not just displayed), **purchase templates** (reusable product lists, no stored price - re-validated at use time), **recurring/scheduled purchases** (real cron-driven, idempotent, never bypasses approval or budget checks) | — | — |
| Orders | Checkout (real payment charge before order creation), order timeline, disputes | Fulfillment (processing → dispatch → delivered), shipment tracking | Cross-tenant order/dispute oversight |
| Invoices & payments | Pay via a provider abstraction (card/mobile money/bank transfer/wallet/credit terms), invoice aging | Receive payments, invoice history | Cross-tenant payment oversight |
| Notifications | Real, DB-backed, polled (not just seeded) — RFQ/quote/negotiation/approval/payment/shipment/invoice-due/low-stock events | Same | — |
| Analytics | Spend, order, supplier performance | Revenue, fulfillment performance | Platform-wide aggregates |
| Team management | Add a team member (existing account → new membership; brand-new email → real account + one-time temporary password shown in the UI, since there's no email delivery), edit an existing member's role/department/name/photo, department picker backed by the company's real declared departments | Same (supplier-side roles) | — |
| Company workspace | Profile, branches, departments, cost centers, credit terms | Same | Company directory |
| Finance | **Finance Manager gets a dedicated dashboard** (not the generic buyer one) — outstanding/overdue invoices aged by due date, credit utilization, pending approvals. A **"balance sheet"** page shows accounts payable/receivable and inventory value from real data, explicitly *not* a formal GAAP statement (no cash-ledger or equity tracking exists to make Assets = Liabilities + Equity honest) | Same shape, receivable instead of payable, + inventory value | — |
| Auth/account | Login with an explicit **Company user / Supplier workspace toggle** (an account with several companies of the same kind gets a picker, not an arbitrary pick), self-service profile edit (name/phone/**photo**, resized/compressed client-side into a data URI — no file storage exists so this is the honest ceiling of what "upload a photo" can mean here), password reset infra exists in-schema but is unused (no route) | | Verification queue, product moderation, dispute resolution, audit log viewer |

## 5. What's explicitly *not* built, and why (deliberate, not oversight)

- **Real payment gateway wiring**: MTN MoMo's Collections API is implemented for real against MTN's actual public sandbox spec — the only one of Ghana's three mobile-money networks with public documentation. Telecel Cash / AirtelTigo Money reuse the same request shape (industry-standard for this API class) but their exact endpoints are **unverified** — no real credentials exist for any of the three anywhere in this repo by design; every network falls back to an instant-success simulation until an operator supplies real keys.
- **File/document storage**: a `Document` Prisma model exists but no frontend page ever references it — building it now would be inventing scope, not filling a gap. (Avatar photos are the one exception, and are handled by client-side resize into a data URI stored directly in the `User` row — a deliberately small-scale workaround, not a storage system.)
- **Redis-backed distributed rate limiting**: current limiter is in-memory, correct for one instance; explicitly deferred until the app actually runs on more than one.
- **Email delivery**: nothing sends real email. Where a real system would email an invite link or a password reset, this one either shows a one-time credential in the UI (team member invites) or simply doesn't have the flow (password reset has a DB table, `PasswordResetToken`, and nothing else).
- **A formal balance sheet / general ledger**: no cash accounts, no owner's equity, no chart of accounts anywhere in the schema — the "Balance sheet" page is scoped to what's real (AP/AR aging + inventory value) and says so on the page itself.
- **True multi-tab, multi-account sessions**: sessions are httpOnly cookies (deliberate, for XSS resistance) and therefore scoped to the browser, not the tab — this is standard cookie behavior, not a bug, and wasn't "fixed" by downgrading the storage mechanism.
- **Docker**: a multi-stage `Dockerfile` + `output: 'standalone'` exist and were reviewed against the standard Next.js pattern, but **never actually run** — `docker` isn't installed in the development environment this was built in. Re-confirmed unavailable in Phase 17 (`docker --version` → command not found); still not claimed as tested.
- ~~Budgets, purchase templates, and recurring/scheduled purchases were client-side localStorage mocks~~ - **resolved (Phase 15)**: all three are now real, Postgres-backed, API-routed, tenant-isolated, RBAC-protected. The `Budget`/`PurchaseTemplate`/`RecurringPurchase` Prisma models (and their live database tables) already existed before this phase - they had simply never been wired to a service or route. See section 4's table and the dedicated write-up in section 10 below for the budget-enforcement/recurring-execution architecture. `PROJECT_SCOPE.md` previously (both originally, and then again after a later hardening pass) described these inconsistently; this is the corrected, current state, and every claim here was live-verified against a real running instance, not assumed from reading the code.

## 6. Security posture (what's been specifically checked, not just assumed)

- Tenant isolation is exercised by dedicated tests per domain: "company A can't read/write company B's records," "a supplier can't touch a competitor's product," "an uninvited supplier can't see a competing quote," etc.
- Every role-granting action (adding a team member, changing someone's role) validates the target role belongs to the *target company's own side of the marketplace* server-side — the concern being a buyer-side `USERS_MANAGE` holder using it as a path to grant `SUPPLIER_ADMIN` or even `PLATFORM_ADMIN`.
- Webhook and cron endpoints fail closed while unconfigured, verified with constant-time comparison (no timing side-channel on a guessed secret).
- Production-mode behavior (not just `next dev`) was explicitly verified: secure cookie flags only appear when `NODE_ENV=production`, confirmed via a real `next build && next start` + live cookie inspection.
- **CSP is enforced (Phase 17)**, not Report-Only. `src/proxy.ts` mints a cryptographically random nonce every request, threads it through both the `Content-Security-Policy` header and an `x-nonce` request header the root layout reads (forcing every page to render dynamically per request - a real, measured trade-off, since ~20 pages were previously statically prerendered; see PHASE17_FINAL_REPORT.md's CSP section). Live-verified with zero violations across buyer/supplier/platform-admin workspaces in both Report-Only and enforced mode before flipping the default. `CSP_ENFORCED=false` is available as an emergency Report-Only rollback without a redeploy.
- Rate limiting covers the Phase 15 procurement-configuration mutation routes (budget/purchase-template/recurring-purchase create/update/delete, and the manual "run due schedules now" trigger) under a dedicated `procurementWrite` kind (20/min per user+IP), live-verified end to end (a real 429 after the configured limit, login's own 10/15min limit reproduced live too).
- **A full database outage was tested live** (Phase 17, re-tested Phase 18): `/api/health`/`/api/ready` correctly degrade to `503` with a safe, generic `{"database":"error"}` body (never a raw Prisma stack trace or connection string) and the process itself never crashes or needs a restart once the database returns. **Resolved (Phase 18)**: every route handler is now wrapped in `withErrorHandling` except `/api/health`/`/api/ready` (which already handle this correctly themselves) — 96 of 99 route files (116 exported handlers), applied via an AST-based codemod (the TypeScript compiler API, not regex/brace-counting, for exact syntactic safety) rather than 96 manual edits. A genuine database outage now returns this app's own standard `{"error": "Unable to process request.", "requestId": "..."}` shape everywhere, live-verified by actually stopping and restarting the local PostgreSQL service against the real standalone server. No intentional status code (401/403/404/422/429) changed anywhere - confirmed by the full 344-test baseline still passing unchanged after the codemod.
- **`Retry-After` header (Phase 18)**: every `429` response (both `enforceRateLimit`'s and login's own manually-built one) now carries a real, computed `Retry-After` header reflecting the caller's actual remaining window - never a hardcoded value. Live-verified: 11 consecutive failed logins produced a `429` with `Retry-After` counting down correctly (898s → 895s) against the real 15-minute window.
- **CSP site-wide nonce architecture re-evaluated, not changed (Phase 18)**: real build output confirms every HTML page route remains dynamically rendered (`ƒ`), which is structurally required - Next.js's own documentation states nonce-based CSP requires dynamic rendering for any page consuming the nonce, and every page here does (Next's own hydration script needs it). The two routes that remain static (`/robots.txt`, `/sitemap.xml`) are non-HTML metadata routes that never read the nonce at all - proof the current architecture is already as narrow as structurally possible, not evidence a narrower scope was overlooked. Real latency measurements found no measurable dynamic-rendering cost (a dynamic authenticated page and the two genuinely-static routes both measured ~200-235ms at steady state). Live browser re-verification across buyer/supplier/platform-admin (dropdowns, dialogs, table navigation, forms, negotiation) found zero CSP violations, zero console errors, zero hydration errors. Kept as-is.

## 7. Testing

- **44 test files / 354 tests** (updated through Phase 18), entirely at the service and API-route boundary against a real Postgres database — no service-layer mocking. Client-side/UI-only components are not unit-tested (this codebase's own convention); those changes are instead verified live against a running instance (see below).
- Every new feature added across this session's hardening/completion phases was also **live-verified** against a running production build (`next build` + `NODE_ENV=production next start`) using real HTTP requests and, for UI flows, a real browser session — not just "tests pass."

## 8. Known rough edges worth an outside eye on

- ~~The client-side `catalog.service.ts` still carries a legacy localStorage-backed runtime cache bridge~~ - **resolved**: `catalog.service.ts` now calls the real API for every read/write and keeps only an in-memory `Map` (not `localStorage`) as a synchronous lookup cache for the ~16 call sites that need `getSupplierById`/`getSupplierByCompanyId` synchronously; the cache is warmed from the session payload itself (`primeSupplierCache`, called by `useAuth.tsx`'s `AuthProvider`) so it's never cold on first render. Verified by direct inspection - no `localStorage` reference remains anywhere in the file.
- `CompanyMembership.department` is a free-text string, not a foreign key to the real `Department` table — the Team page's department picker now surfaces real department names as options, but nothing enforces they stay in sync if a department is later renamed or removed.
- No soft-delete/undo on most destructive actions (removing a department/cost center/branch is immediate).
- The invoice-pay UI has no client-generated idempotency key of its own (the *server* now refuses a second charge attempt while one is already pending for the same invoice, closing the practical double-charge risk, but the defense is server-side only).
- ~~The admin "Audit log" page read a `localStorage`/demo-data mock, never the real `AuditLog` table~~ - **resolved (Phase 17)**: `GET /api/audit-log` (platform-admin only, cursor-paginated) now serves the real, already-populated table directly; the client mock is gone. This was a genuine visibility bug, not a missing feature - real audit events had been recorded since at least Phase 6 with no read path anywhere.
- ~~Error-response consistency during a full outage~~ - **resolved (Phase 18)**: see §6 above. 96 of 99 route files now wrapped in `withErrorHandling`.
- **`Notification`'s composite index reworked (Phase 18)**: `(userId, createdAt)` replaced with `(userId, createdAt, id)`, matching the cursor query's real `ORDER BY createdAt DESC, id DESC`. Real `EXPLAIN ANALYZE` against a disposable 1000-row fixture showed the prior index needed an `Incremental Sort` on top of its index scan (0.242ms); the new one is a pure `Index Scan` (0.039ms) - a real, measured ~6x improvement, not a speculative change.
- ~~The Compare page (`/compare`) resolved product display data from a static demo-data array instead of the real catalog~~ - **resolved (Phase 18)**: found during this phase's mock/localStorage audit - `demoProducts.find(...)` would silently show stale price/stock/spec data for any product whose real data had changed since the demo-data file was written, and would silently drop any product created after seeding (its id would never match the static array). Now calls the real, already-existing `catalogService.getProductById` per selected product.
- **`CompanySwitcher`'s parent-group label (`CompanyGroup.name`) is still resolved from static demo data, not a real API** - found during the same Phase 18 audit, left as documented technical debt rather than fixed: `CompanyGroup` is a real Prisma model with real seeded rows (3 real companies currently have a non-null `parentGroupId`), but no route anywhere exposes it (`grep` for `companyGroup`/`CompanyGroup` across `src/app/api` and `src/services` → no matches) - the same class of gap as the Companies-directory bridge below. Not fixed this phase because building a new `GET /api/company-groups/[id]` endpoint is new backend scope; today it happens to show correct data (nothing can edit a `CompanyGroup` row without a raw DB operation, so it cannot currently drift), but it is real, not cosmetic, technical debt.
- `src/components/layout/PhasePlaceholder.tsx` was dead code (zero imports anywhere in the codebase, confirmed by `grep`) - removed (Phase 18).
- The RFQ-creation product picker (`/rfqs/create`) is a single-select dropdown that needs "the whole catalog" to choose from, so it requests `GET /api/products` at its own higher, documented cap (pageSize=500) rather than the standard 25/100 - a tenant with more than 500 published products would not see the rest there. A searchable async picker would be the real fix; out of scope for a pagination-hardening phase.
- **Invoices, payments, and RFQ list endpoints remain unpaginated** (`GET /api/companies/[companyId]/invoices`, `.../payments`, `GET /api/rfqs?companyId=`, and their supplier-side equivalents) - a real gap missed by both the Phase 16 and Phase 17 pagination audits (neither's own summary table mentions these three domains), found and measured in Phase E: at a 1000-row fixture, invoices returned 339.5KB/119ms in one unbounded response. Not fixed - changing these endpoints' response shape from a bare array to a `Page<T>` envelope would break this engagement's own "preserve existing service interfaces" instruction and requires coordinated frontend changes; flagged as scoped backend follow-up work.
- **`allCompanies()`/`allCompanyUsers()` (`src/services/auth.service.ts`) remain a `localStorage`-mirrored bridge, not a real API-backed directory** (Phase E, formally called out as technical debt rather than left as an unlabeled rough edge). What it is: every successful `/api/auth/login`, `/api/auth/register`, and `/api/auth/switch-company` response mirrors its real company/user/membership data into a `localStorage` cache (`mirrorIntoRuntimeCache`), seeded once with static demo data (`src/lib/demo-data/companies.ts`) for everything the current session hasn't touched yet. It is never edited directly by the user and never trusted for authorization (every real permission/tenant check still goes through the server session) - but it is the *only* data source behind two real UI surfaces: the admin "Companies" directory (`/admin/companies`) and every buyer-company-name lookup on the supplier side (payments/invoices/disputes list pages showing "which buyer" a row belongs to). Why it's still like this: no real backend endpoint (`GET /api/companies` - a platform-wide company directory) has ever been built; Phase 14's migration covered auth, catalog, orders, procurement, invoices, payments, disputes, and notifications, but never a companies-directory list endpoint, because nothing needed one until the admin page was built later reusing what was already there. **This is exactly the same class of gap as the missing Users/System admin pages below** - real, not cosmetic, and the fix is a backend list-companies endpoint (with pagination, matching every other list endpoint's shape), not a frontend change. Left as-is rather than "fixed" in this phase, per the explicit instruction not to fake backend work on the frontend.
- **No "Users" or "System configuration" admin page exists, and neither is being added.** Checked against this file's own §4 domain-coverage table (which only ever committed the platform surface to "verification queue, product moderation, dispute resolution, audit log viewer") and against this project's own history: a prior request to build a user-management system was explicitly paused by the user pending scope decisions (soft-delete vs. hard-delete removed members, cross-company visibility, bulk actions) that were never resolved. No backend capability to list all platform users, or any "system configuration" domain, exists anywhere in the schema. Building either is a real, separate backend-plus-product-scoping effort - not a frontend gap this redesign can close by itself.

## 9. Budgets, purchase templates, and recurring purchases (Phase 15 architecture)

**Budgets.** `Budget` (company/department/cost-center-scoped, annual or monthly). Utilization
shown to the buyer is computed live from real PAID orders (never a stored running total, so it
can't drift). Enforcement is a separate, narrower concern: a `committedAmount` column tracks
reserved-but-not-yet-final spend, updated with an atomic conditional SQL update
(`UPDATE ... WHERE committedAmount + :amount <= amount`) - the same row-level-lock technique this
app already uses for quote acceptance and approval decisions - so two purchase requests racing the
same budget can never both be admitted when combined they'd exceed it. Creating a purchase request
resolves the single most specific applicable budget (cost center, else department, else
company-wide, for the request's own period) and reserves against it inside the same transaction as
the insert; a rejection releases the reservation. This is deliberately not a formal
accounting/ledger system - no cash accounts, no double-entry, no chart of accounts.

**Purchase templates.** A named, reusable list of `(productId, quantity)` pairs - no price is ever
stored. Applying one goes through the normal cart → checkout path, so current price/availability
is always re-fetched, never assumed from when the template was saved.

**Recurring purchases.** A schedule (`frequency`, optional department/cost-center, a product list)
with a `nextRunAt`. Execution is a real backend sweep
(`POST /api/cron/recurring-purchase-sweep`, authenticated the same way every other cron job in
this app is) - not something the browser computes. Idempotency is a real database guarantee: the
sweep atomically claims a due occurrence with a conditional update (`WHERE nextRunAt = <the exact
due value>`), so two overlapping sweeps can never both generate a purchase request for the same
occurrence. A schedule missed for multiple occurrences (the scheduler was offline) generates
exactly one purchase request and fast-forwards to the next real future occurrence, rather than
backlogging one per missed interval. Every generated request goes through
`createPurchaseRequest` unchanged - the same approval rules, spending limits, and budget
enforcement a manually-submitted request faces; a schedule never bypasses any of them. Each
execution attempt (success, skipped - no available items, or failed - e.g. exceeded a budget) is
recorded on `RecurringPurchaseRun`, so a failure is visible and diagnosable rather than silent, and
is never silently retried into a duplicate request.

## 10. API pagination and index hardening (Phase 16)

Phase 16 audited every `findMany` in `src/server/services` for whether it could return an
unbounded result set as a tenant's data grows, then paginated the highest-value ones rather than
touching all of them speculatively:

- **Offset pagination** (`src/server/pagination.ts`'s `parsePagination`/`toPage`, returning the
  shared `Page<T>` envelope): applied to the platform-wide payments list (pre-existing), and, this
  phase, to `listOrders`/`listAllOrders`/`listOrdersForSupplier` and `listPurchaseRequests`.
  `?page=`/`?pageSize=` are parsed leniently — a missing, non-numeric, negative, or excessive value
  falls back to a safe default/clamped maximum (25 default, 100 max) rather than erroring the
  request.
- **Cursor pagination** (`parseCursorPagination`/`toCursorPage`, returning `CursorPage<T>`):
  applied to notifications, an append-only feed with no natural upper bound for a long-lived
  account. The cursor encodes `(createdAt, id)` as a base64url string; a malformed/tampered cursor
  decodes to `null` and falls back to the first page rather than throwing. The cursor is never
  trusted for authorization — every query stays scoped to the caller's own session `userId`
  regardless of what a cursor claims.
- **Composite indexes** were added to back every new paginated query's `WHERE tenant = ? ORDER BY
  createdAt DESC` shape, which no index previously covered (every existing tenant-scoping index
  was single-column): `Order(companyId, createdAt)`, `Order(supplierId, createdAt)`,
  `PurchaseRequest(companyId, createdAt)`, `Notification(userId, createdAt)`.
- **Frontend consumers were updated in lockstep, not left to break silently.** The buyer/supplier
  dashboards previously computed `totalSpend`/`monthlySpend`/`openOrders`/`ordersToFulfill` via a
  client-side `.reduce()`/`.filter().length` over what used to be the *entire* unpaginated orders
  array — once `listOrders` only returns one page, that would have quietly started producing wrong
  totals for any company with more than a page of orders. Fixed with real server-side Prisma
  `aggregate()`/`count()` endpoints (`getOrderSummary`, `getSupplierOrdersToFulfillCount`,
  `getUnreadCount` for the notification bell's badge) instead of ever loading full history into the
  browser just to sum it. The orders/purchase-requests list pages gained a simple Previous/Next
  pager; the notifications page gained a "Load more" button (matching its cursor shape).
- **Not paginated this phase**: `listProducts`/`listSuppliers` and most other `findMany` call
  sites — the audit classified these as lower-risk at current data volumes (see
  `PHASE16_AUDIT.md`'s Category A/B/C table) and deliberately left unpaginated rather than doing
  speculative work; they remain candidates for a future pass using the exact same utilities.

## 11. Production security & scalability validation (Phase 17)

**CSP nonce rollout.** A real per-request nonce (`src/proxy.ts`) replaced the Report-Only-only
header from Phase 16. The nonce is threaded to Next's own framework/hydration scripts by having
the root layout read `headers()`, which is also what forces every previously-static page to
render dynamically - nonces and static prerendering are fundamentally incompatible (a build-time
nonce would be served to every visitor forever), confirmed against Next's own documentation, not
assumed. Live-verified with a real browser across every workspace (buyer, supplier, platform
admin) and every major page, in both Report-Only and enforced mode, with zero violations either
time - only then was enforced mode made the default. `style-src 'unsafe-inline'` remains
necessary and unrelated to the nonce (a nonce only covers `<style>`/`<script>` elements, never a
`style=""` attribute, and this app uses inline style props in a few components).

**Real load-testing evidence.** A disposable ~1000-row fixture (products/orders/purchase
requests/notifications/audit log, all tagged and fully removed afterward - verified via
before/after row counts) replaced Phase 16's "Not benchmarked." `EXPLAIN ANALYZE` against that
fixture confirmed every composite pagination index (`Order`/`PurchaseRequest`/`Notification`) is
actually used as an Index Scan, not just present in the schema. A real HTTP latency measurement
found `GET /api/products` (unpaginated at the time) taking ~114ms average with a ~480KB response
at 1000 rows - 4x slower and 40x larger than every already-paginated endpoint - real,
measured evidence that Phase 16's "leave it unpaginated" call needed revisiting at this volume.

**Products pagination (new).** `listProducts`/`GET /api/products` are now paginated the same way
orders/purchase-requests are, with a composite `Product(moderationStatus, createdAt)` index.
Re-measured after the fix: ~26ms average, ~12KB response - back in line with every other
paginated endpoint. The one consumer that generally needs "the whole catalog" at once (the
RFQ-creation product picker, a single-select dropdown) requests a documented, higher pageSize cap
(500) rather than being silently broken by the new default page size of 25.

**Audit log (new, real bug found and fixed).** The admin "Audit log" page had been reading a
`localStorage`/demo-data mock the entire time - the real `AuditLog` table (900+ rows before this
phase, entirely invisible in the UI) had no read path at all. `GET /api/audit-log`
(platform-admin only, cursor-paginated) now serves it for real.

**Database failure tested live**, not just reasoned about: the local Postgres service was
actually stopped and restarted. `/api/health`/`/api/ready` degrade to a safe `503` with no
leaked detail; the process itself never crashes. See §8's rough-edges entry on the one
inconsistency this surfaced (a bare `500` instead of this app's own JSON error shape on routes
without explicit error handling - not a leak, just inconsistent).

**Rate limiting, cron, and webhook resilience** were re-verified rather than re-built - all three
were already correct (fail-closed auth, HMAC signature + event-id dedup, atomic-claim sweeps).
Two new live checks (Phase 17): a real 429 after login's configured 10-attempt/15-minute limit,
and cron's auth boundary confirmed against no-auth/malformed-auth requests. Rate limiting remains
explicitly in-memory/single-instance; not changed, and Redis was not installed speculatively.

**Not done, and why**: an enforced-CSP rollout risk assessment concluded the trade-off (losing
static rendering on ~20 pages) was acceptable for this app (nearly everything already requires
auth), but that judgment call - not a technical limitation - is what made enforcement possible
this phase, and is worth an outside second opinion. No formal OpenAPI contract was generated
(same call as Phase 16 - the API surface didn't grow enough to justify the duplication risk this
phase). No distributed rate limiter was installed (still correctly deferred). Docker remains
unavailable in this environment - the Dockerfile was reviewed, not run.

## 12. Suggested angles for the external review

If you're pasting this into ChatGPT (or another model) for a second opinion, the most useful things to ask it to focus on are probably:

1. Does the tenant-isolation model (never trust a client-supplied ID, re-derive everything from the session, generic 404 on mismatch) have any gaps this description doesn't surface?
2. Is the "fail closed while unconfigured" pattern for webhooks/cron actually sufficient, or does it need rate limiting / replay protection on top?
3. Given no file storage exists, is data-URI-in-a-database-column an acceptable long-term choice for avatars, or should it be flagged as tech debt now before more "upload a file" features get built the same way?
4. Any concerns with cookie-based session-per-browser (not per-tab) as a design choice, versus token-based multi-session support?
5. Is the mobile-money payment gateway abstraction (real for MTN, spec-following-but-unverified for the other two, simulated when unconfigured) a reasonable way to ship a payments feature without real merchant credentials, or does it risk shipping something that looks more finished than it is?
6. Is trading static prerendering for ~20 pages in exchange for an enforced, nonce-based CSP (§11) the right call for this specific app, or would a narrower nonce scope (only the few pages that actually need it) have been the more conservative choice?
