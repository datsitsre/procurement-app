# Phase 16 — Enterprise API & Performance Audit

*Produced before any implementation, per the brief's own Section 3/4 instruction. All findings below were verified directly against the current repository (greps/reads run this session), not recalled from earlier phase reports.*

## API — pagination status

**60 GET route files** exist. Checked directly: `grep -rl "parsePagination" src/app/api` and `grep -rln "take:|skip:" src/server/services` both return **exactly one file each** — `src/app/api/payments/route.ts` / `payment.service.ts#listAllPayments` (built in the prior phase). Every other list-returning endpoint is unbounded.

Full `findMany` inventory (55 call sites across services) classified:

### Category A — must paginate (real, tenant-scoped, unbounded growth)
| Service fn | Route | Scope | Sort | Notes |
|---|---|---|---|---|
| `orders.service#listOrders` | `GET /api/companies/[companyId]/orders` | companyId | createdAt desc | Years of order history for an active buyer |
| `orders.service#listOrdersForSupplier` | `GET /api/suppliers/[supplierId]/orders` | supplierId | createdAt desc | Same risk, supplier side |
| `orders.service#listAllOrders` | `GET /api/orders` | **none (platform-wide)** | createdAt desc | Admin view, most unbounded of all |
| `procurement.service#listPurchaseRequests` | `GET /api/companies/[companyId]/purchase-requests` | companyId | createdAt desc (via include order) | Core procurement domain |
| `purchase-order.service#listPurchaseOrders` | `GET /api/companies/[companyId]/purchase-orders` | companyId | createdAt desc | |
| `invoices.service#listInvoices` / `ForSupplier` | `.../invoices` | companyId/supplierId | issuedAt desc | |
| `payment.service#listPayments` / `ForSupplier` | `.../payments` | companyId/supplierId | createdAt desc | Only the platform-wide variant is paginated today |
| `notification.service#listNotifications` | `GET /api/notifications` | userId | createdAt desc | Append-only, polled continuously - best cursor candidate |
| `catalog.service#listProducts` | `GET /api/products` | none (public catalog) | filter-dependent | Buyer-facing, filterable |
| `catalog.service#listAllProductsForModeration` | `GET /api/products/moderation` | none (platform) | createdAt desc | |
| `catalog.service#listSuppliers` | `GET /api/suppliers` | none (public directory) | name asc | |
| `disputes.service#listAllDisputes` | `GET /api/disputes` | none (platform) | createdAt desc | |

### Category B — small, bounded, no pagination needed
Categories, departments, cost centers, branches, warehouses-per-supplier, approval rules, spending limits, budgets-per-company, purchase-templates-per-company, recurring-purchases-per-company, team-members-per-company. All are per-company configuration lists that stay small in practice (tens, not thousands, of rows) even at enterprise scale. Confirmed by reading each - none takes unbounded user input that grows per-transaction.

### Category C — aggregation/reporting
`analytics.service#getBuyerAnalytics`/`getSupplierAnalytics`/`getPlatformAnalytics` - each does one `findMany` (with `include`, no N+1 loop) then aggregates in JS. Correct pattern, but the *source* query is unbounded (loads a company's entire order history to compute analytics). Not fixed this phase - real at very large scale, not urgent, would need a different strategy (DB-side aggregation) rather than pagination.

**Decision for this phase**: implement pagination for the three highest-value, clearest Category A targets - **notifications** (cursor, the paradigmatic append-only feed), **orders** (offset, company/supplier/admin-scoped), **purchase requests** (offset, company-scoped). The remaining Category A endpoints are real but lower urgency at current scale; cataloged here as follow-up, not touched this phase, per the brief's own "do not paginate everything in one pass" instruction.

## Database indexes

99 index/unique declarations exist, but checked directly: every tenant-scoping index is single-column (`@@index([companyId])`, `@@index([status])` separately - never composite). `Order` has `@@index([companyId])` + `@@index([status])` + `@@index([supplierId])` + `@@index([paymentStatus])`, no `(companyId, createdAt)`. `Notification` has `@@index([userId, read])`, no `(userId, createdAt)`. `PurchaseRequest` has `@@index([companyId])` + `@@index([status])`, no `(companyId, createdAt)`.

This directly affects the three endpoints being paginated: a `WHERE companyId = ? ORDER BY createdAt DESC LIMIT ?` query can use `@@index([companyId])` for the filter but still needs a separate sort step over all matching rows. **Decision**: add composite indexes `Order(companyId, createdAt)`, `PurchaseRequest(companyId, createdAt)`, `Notification(userId, createdAt)` - justified directly by the new paginated query shape being introduced, not speculative.

## Rate limiting

Current kinds (`src/server/auth/rate-limit.ts`): `auth`, `payment`, `webhook`, `negotiation`, `rfqCreate`. Checked directly: **none of Phase 15's new mutation routes** (`POST .../budgets`, `POST .../purchase-templates`, `POST .../recurring-purchases`, `POST .../recurring-purchases/run-due`) have any rate limiting - a real gap introduced by the previous phase, not present before it. `run-due` is the most notable: it triggers a real server-side sweep (iterates schedules, hits the catalog, can create purchase requests) and has no protection against being spammed via the "Run due schedules now" button.

**Decision**: add a `procurementWrite` rate-limit kind, applied to these four routes.

## Error standardization

`src/server/errors.ts` (`ApiError`/`toSafeErrorResponse`/`withErrorHandling`) exists from the prior phase. Checked adoption: only `src/app/api/invoices/[id]/pay/route.ts` uses it - a deliberate, documented, opt-in decision (high-risk routes only, not a blanket rewrite). No regression found. Not expanded further this phase beyond the three newly-paginated routes' own error paths, which already follow the existing hand-rolled `{ error: string }` convention consistently.

## Observability

`proxy.ts` + `server/observability/logger.ts` unchanged since the prior phase - request IDs and structured logging cover all `/api/*` routes automatically via the proxy, plus explicit outcome logging on login/invoice-pay. No duration measurement exists for individual database queries (only whole-request timing on the two explicitly-instrumented routes). Not adding per-query DB timing this phase - no evidence of a specific slow query to justify instrumenting one over another; would be speculative.

## Health/readiness

`/api/health` and `/api/ready` both exist (prior phase), both check real DB connectivity, distinct paths for liveness vs. readiness semantics as documented then. Reverified they still return correct shapes - no changes needed.

## Security headers / CSP

`next.config.ts` ships `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `HSTS`. No CSP - deliberately deferred in the prior phase. Checked this phase: `src/app/layout.tsx` has no `dangerouslySetInnerHTML` and no third-party script/style hosts (only `next/font/google`, self-hosted at build time). However, Next.js's own App Router injects inline `<script>` tags carrying RSC hydration payloads on every page (confirmed via a live response earlier this session: `<script>self.__next_f.push(...)</script>` with no nonce attribute). A blocking `script-src 'self'` CSP without `'unsafe-inline'` or a per-request nonce would break hydration on every page.

**Decision**: ship a **report-only** CSP (`Content-Security-Policy-Report-Only`) - genuinely zero-risk, since report-only mode never blocks anything, only logs violations via the browser's own reporting. This gives real visibility into what a future blocking policy would need to allow. **Not** switching to blocking/enforced mode this phase - that requires either accepting `'unsafe-inline'` for scripts (undermines the point of CSP) or implementing Next.js's nonce-based CSP support (a real, separate, non-trivial task: generating a per-request nonce in `proxy.ts`, threading it through every page's script tags via Next's own nonce convention, and verifying it doesn't break any of the ~70 pages). Documented as the concrete blocker, not silently deferred.

## Concurrency/idempotency re-verification

Re-read (not re-derived) the three atomic-conditional-update mechanisms already shipped:
- `budget.service#reserveBudget` - `UPDATE Budget SET committedAmount = committedAmount + :amt WHERE committedAmount + :amt <= amount` - still present, unchanged.
- `procurement.service#acceptQuote` / `#decideStep` - atomic `updateMany` guards on RFQ status / ApprovalStep status - still present, unchanged.
- `recurringPurchase.service#runDueSchedules` - atomic claim (`WHERE nextRunAt = :occurrenceAt`) + `RecurringPurchaseRun` unique constraint backstop - still present, unchanged.

No regressions found. Existing tests for all four (`budget.service.test.ts`, `procurement.service.test.ts`, `recurringPurchase.service.test.ts`) still pass (confirmed below). Not re-implementing anything here - re-verifying was the task, and everything checked out.

## Frontend pagination-consumer risk

The catalog client-side `Map` cache (`catalog.service.ts`) reads from `listProducts()`/`listSuppliers()` results - if I paginate these, the cache-priming behavior would only see one page's worth of suppliers at a time. **Decision**: since `listProducts`/`listSuppliers` are *not* among the three endpoints being paginated this phase, this risk doesn't apply yet - flagged here for whoever picks up Category A's remaining items next.

## Test baseline (verified before any change)
`npx vitest run --no-file-parallelism` → confirmed 40 files / 300 tests / 300 passed / 0 failed, matching the brief's stated baseline exactly.
