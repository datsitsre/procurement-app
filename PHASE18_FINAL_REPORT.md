# Phase 18 Final Report

Production reliability, CSP re-evaluation, and final acceptance. Follows the same evidence
discipline as prior phase reports: IMPLEMENTED / VERIFIED / MEASURED / NOT MEASURED /
NOT VERIFIED / DEFERRED / OUT OF SCOPE / REQUIRES BACKEND WORK, distinguished throughout rather
than blurred together.

## Executive Summary

Phase 18's core objective - standardizing API error handling during a database failure - is
**IMPLEMENTED and VERIFIED**: 96 of 99 route files (116 exported handlers) now wrap their handler
in the existing `withErrorHandling` utility, applied via an AST-based codemod (the TypeScript
compiler API, not regex/brace-counting) rather than 96 manual edits, and live-verified by actually
stopping and restarting the real PostgreSQL service against the real standalone server. Every
route now returns this app's own standard `{"error": "...", "requestId": "..."}` shape on an
unexpected failure instead of a bare empty `500`. The CSP nonce architecture was re-evaluated
against real build output and real measurements and **kept unchanged** (Outcome A) - the evidence
shows the current site-wide nonce approach is already as narrow as structurally possible, not that
a narrower scope was overlooked. `Retry-After` is now implemented and live-verified. The
`Notification` composite index change is implemented with real, measured `EXPLAIN ANALYZE`
evidence (a genuine ~6x improvement, not a speculative change). A full buyer→supplier→payment
business journey, a 22-check cross-role/tenant-isolation battery, and a responsive sweep across
all 6 required viewports were all re-run this phase with fresh evidence, and the mock/localStorage
audit found and fixed one genuine bug (the Compare page reading stale demo data instead of the
live catalog) plus removed one piece of confirmed dead code. The original 344-test baseline is
fully intact; 10 new tests were added (354 total), none removed or weakened.

## Baseline

Confirmed live before any implementation:

```
npx vitest run --no-file-parallelism
Test Files  43 passed (43)
     Tests  344 passed (344)
```

Matches the brief's stated Phase 17 ending state exactly (43 files / 344 tests / 344 passing / 0
failing). This is the number every later section's "still passes" claim is measured against.

## Step 0 Audit

Read `PROJECT_SCOPE.md`, `PHASE17_AUDIT.md`, and `PHASE17_FINAL_REPORT.md` in full before any
implementation. Direct repository inspection (not assumptions from the prior reports):

- **`src/proxy.ts`**: two independent concerns in one file - `apiProxy` (request-id tagging,
  `/api/*` only) and `pageProxy` (per-request CSP nonce, everything else). Confirmed unchanged in
  shape from Phase 17.
- **Route handler count**: `find src/app/api -name route.ts` → **99 files**, **118 exported HTTP
  method handlers** (`grep -c "^export async function \(GET\|POST\|PUT\|PATCH\|DELETE\)"`).
- **`withErrorHandling` usage before this phase**: exactly **1** of 99 route files
  (`src/app/api/invoices/[id]/pay/route.ts`) - confirmed via `grep -rln "withErrorHandling" src`.
  The utility itself (`src/server/errors.ts`) is well-designed: typed `ApiError` subclasses map to
  the right status/message, anything unexpected is logged server-side (with requestId/route) and
  answered with a generic `{"error": "Unable to process request.", "requestId": "..."}` - already
  exactly what section 6's target contract asks for. It just wasn't applied broadly.
- **Rate limiting** (`src/server/auth/rate-limit.ts`): in-memory sliding-window buckets keyed by
  `kind:key`, with `windowStartedAt`/`count` per bucket - confirmed no `Retry-After` header existed
  anywhere before this phase (`grep -rn "status: 429"` → 2 call sites, `enforceRateLimit`'s own and
  login's manual one, neither setting the header).
- **Notification indexes**: `@@index([userId, read])` and `@@index([userId, createdAt])` -
  confirmed the cursor query's real shape (`ORDER BY createdAt DESC, id DESC`) doesn't match the
  second index's column list exactly.
- **CSP**: unchanged from Phase 17's description - nonce generated per request in `pageProxy`,
  threaded via `x-nonce`, enforced by default (`CSP_ENFORCED !== 'false'`).
- No route handler used a non-standard export shape (`export const` arrow function) except the
  one already-wrapped file - confirmed via `grep -rln "^export const (GET|POST|PUT|PATCH|DELETE)"`.
  No route exported a non-async handler. No route file used `export const dynamic/runtime/
  revalidate`. This uniformity is what made a mechanical, AST-based codemod safe.

## Error Handling

**IMPLEMENTED.** Built a Node script (`scratch_wrap_routes.js`, run once from the repo root, not
committed) using the `typescript` package's own compiler API - not regex or manual brace-counting,
which risks corrupting a handler body containing braces inside a string/template/object literal.
For each of the 99 route files, the script:

1. Parses the file with `ts.createSourceFile`.
2. Finds every top-level, exported, `async` `FunctionDeclaration` named `GET`/`POST`/`PUT`/
   `PATCH`/`DELETE`.
3. Uses the AST node's own `getStart()`/`getEnd()` positions (never string search) to extract the
   exact parameter list and function body text, so nested braces/strings/template literals can
   never be misparsed.
4. Replaces `export async function NAME(params) { body }` with
   `export const NAME = withErrorHandling('/api/route/path', async (params) => { body });`,
   preserving the original body byte-for-byte.
5. Adds the `withErrorHandling` import if not already present.
6. Skips `/api/health` and `/api/ready` (which already implement their own correct, explicit-catch
   `503` behavior and must keep that contract, not this app's generic `{error}` `500` shape) and
   the one already-wrapped route.

**Result**: 96 files changed, 116 handlers wrapped. Every route's own intentional status codes
(`401`/`403`/`404`/`422`/`429`, and every hand-built success/error response) are completely
untouched - `withErrorHandling` only intercepts a genuinely *thrown* exception it never sees
otherwise, since every existing route already returns its own responses directly rather than
throwing. **VERIFIED**: `npx tsc --noEmit`, `npm run lint`, and the full 344-test suite all passed
unchanged immediately after the codemod, with zero manual fixes needed to any of the 96 files -
strong evidence the transform was syntactically and semantically correct across every route
shape (0-arg `GET()`, 1-arg, 2-arg with a typed `RouteContext<'...'>`, nested nested nested logic
like the webhook route's own inline `try/catch`).

**Why not `src/proxy.ts` (Option C)**: confirmed via Next's own bundled docs
(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`) that
`error.tsx` only catches page-render exceptions, never Route Handler exceptions - there is no
framework-level "catch every API route's uncaught exception" mechanism in Next.js 16. `proxy.ts`
runs *before* a route handler and has no way to wrap its execution or catch what it throws.
Confirmed this is a real constraint, not a design choice this phase is free to work around.

**Why not a hand-written per-route rewrite (touching only "high-risk" routes)**: every route in
this app touches the database in some way (it is a database-backed app end to end), so "which
routes are DB-failure-exposed" is not a meaningful narrowing question here - the honest answer is
"all of them." Given `withErrorHandling` already existed, was already correctly designed, and a
mechanical AST transform could apply it safely and verifiably to every remaining route in one
pass (rather than 96 separate manual edits with 96 separate chances for a typo), this was judged
the smallest-risk path to genuine standardization, not "blindly rewriting 90 files."

## Database Failure Testing

**VERIFIED live** against the real standalone server, with the real local `postgresql-x64-17`
Windows service actually stopped and restarted (not simulated):

| Request | Before (Phase 17) | After (Phase 18) |
|---|---|---|
| `GET /api/health` | `503 {"status":"degraded","checks":{"database":"error"}}` | Unchanged |
| `GET /api/ready` | `503 {"status":"not_ready","checks":{"database":"error"}}` | Unchanged |
| `POST /api/auth/login` (no cookie) | `500`, empty body | `500 {"error":"Unable to process request.","requestId":"..."}` |
| `GET /api/products` | `500`, empty body | `500 {"error":"Unable to process request.","requestId":"..."}` |
| `GET /api/orders`, `/api/notifications`, `/api/audit-log` (no session cookie) | n/a | `401 {"error":"Authentication required."}` - correctly short-circuits before any DB call |
| `GET /api/orders`, `/api/notifications`, `/api/audit-log` (real session cookie minted before the outage) | n/a | `500 {"error":"Unable to process request.","requestId":"..."}` - the session-lookup DB call itself fails safely |

Every `500` response body was inspected directly (`curl -i`) and confirmed to contain **only**
`error` and `requestId` keys - no Prisma connection string, no file path, no stack trace, no SQL.
**Recovery confirmed**: after restarting PostgreSQL, `/api/health` returned to `{"status":"ok"}`
within ~2 seconds and the full 344-test suite (run against the restored database) passed
unchanged.

## Regression Tests

**IMPLEMENTED**, new file `src/server/errorHandling.routes.test.ts` (6 tests), exercising real,
already-wrapped route exports end to end (not the existing isolated `errors.test.ts` unit tests,
which only exercise `withErrorHandling`/`toSafeErrorResponse` in isolation):

- A known application error (invalid login credentials) remains `401`.
- A validation error (malformed login body) remains `422`.
- An unauthenticated request to a wrapped, protected route (`/api/audit-log`, `/api/orders`)
  remains `401`.
- **A genuine, unmocked database failure** - a real `PrismaClient` pointed at a real, unreachable
  address (`postgresql://baduser:badpass@localhost:1/nonexistent`), producing a real
  `PrismaClientInitializationError` with a connection string, host, and file path embedded in its
  own `.message` - is converted to the standardized safe `500` shape. Explicit assertions confirm
  the response body never contains `postgresql://`, the fake credentials, `PrismaClient`, or a
  `.ts:` file-path fragment.
- A generic unexpected exception (a `TypeError` with a fake internal file path in its message)
  collapses to the same safe shape, confirming the safety net isn't Prisma-specific.

This satisfies the brief's "use the real service/database boundary, don't mock away the behavior"
instruction via a genuinely failing real database connection, not a hand-rolled mock of the
Prisma client. **Result**: 44 test files / 354 tests / 354 passing (344 original + 6 here + 4 in
the Rate Limiting section below).

## CSP Review

**Outcome A - kept unchanged**, evidence-backed rather than assumed:

- **Real build output** (`npm run build`): every HTML page route (`/`, `/login`, `/dashboard`,
  `/catalog`, `/orders`, ... all ~45 page routes) is marked `ƒ` (dynamic). The only two `○`
  (static) routes are `/robots.txt` and `/sitemap.xml` - non-HTML metadata routes that never
  render through the root layout and therefore never read the nonce at all. This is real proof the
  current architecture is already as narrow as it can structurally be: anything that consumes the
  nonce must be dynamic (Next's own documented nonce/static incompatibility, re-confirmed against
  `node_modules/next/dist/docs/.../content-security-policy.md`), and the two routes that don't
  consume it already remain static without any extra work.
- **No safe narrower alternative exists**: the only way to make more routes static while keeping a
  CSP would be to either (a) bake a single nonce into the static build and reuse it for every
  visitor forever - not a real nonce, defeats its entire purpose - or (b) exempt some pages from
  the nonce/CSP protection entirely - a real security regression. Both violate the brief's own
  Outcome B requirements ("preserves nonce security", "does not weaken CSP"). Outcome A is the only
  evidence-supported choice.
- **Real latency measurements** (standalone server, `curl -o /dev/null -w '%{time_total}'`, 5
  requests each): `/login` (dynamic, nonce-bearing) steady state ~207-235ms; `/dashboard`
  (dynamic, authenticated, heavier page) ~208-234ms; `/robots.txt` (genuinely static) ~207-238ms.
  **No measurable difference** between dynamic and static rendering at this app's scale - the
  ~200ms floor is this environment's own baseline request overhead, not a cost attributable to
  the CSP/nonce architecture.
- **Nonce freshness confirmed real**: 3 consecutive requests to `/login` produced 3 distinct
  base64 nonce values in the `Content-Security-Policy` header, each also matching what a fresh
  page load would need to hydrate correctly.
- **Live browser re-verification** (`agent-browser`, real standalone server): buyer, supplier, and
  platform-admin workspaces, each logged in fresh. Checked: company/notification dropdowns
  (buyer), table row/detail navigation (RFQ quote comparison, negotiation thread), direct URL
  navigation to a blocked admin page (as buyer, correctly showing "Not available"), forms (login).
  **Zero CSP violations, zero console errors, zero hydration errors** across every check.

## Rate Limiting

**IMPLEMENTED and VERIFIED.** Added `getRetryAfterSeconds(kind, key)` to
`src/server/auth/rate-limit.ts`, deriving the remaining window in whole seconds directly from the
same bucket state `checkRateLimit` itself reads (`windowStartedAt` + `windowMs` - `now`), never a
hardcoded value, always at least 1. Wired into both `429` call sites: `enforceRateLimit`'s own
response and login's manually-built one (`src/app/api/auth/login/route.ts`).

**Live-verified**: 11 consecutive failed login POSTs against the real standalone server -
attempts 1-5 returned `401`, attempts 6-11 returned `429` with a real, counting-down
`Retry-After` header (`898` → `897` → `896` → `896` → `895` → `895`, matching the configured
15-minute/900-second auth window minus elapsed time).

**New tests** (`src/server/auth/rate-limit.test.ts`, +4): a `429` response's `Retry-After` header
is present, positive, and within the configured window; `getRetryAfterSeconds` returns the full
window when no bucket exists yet; it decreases (never reaches 0 or negative) as attempts
accumulate; different `kind`s for the same key have independent, non-conflated remaining times.

## Notification Index

**IMPLEMENTED, MEASURED.** Seeded 1000 real notifications for a real seeded user
(`user-john-doe`), ran `EXPLAIN ANALYZE` against the real dev database before and after adding a
`(userId, createdAt, id)` composite index (via a disposable raw-SQL `CREATE INDEX`, dropped again
before the real schema migration was written):

```
BEFORE - (userId, createdAt) only:
Limit (actual time=0.058..0.059 rows=25)
  -> Incremental Sort (actual time=0.057..0.058 rows=25)
       Sort Key: "createdAt" DESC, id DESC
       Presorted Key: "createdAt"
       -> Index Scan Backward using "Notification_userId_createdAt_idx" (actual time=0.019..0.023 rows=26)
Execution Time: 0.242 ms

AFTER - (userId, createdAt, id):
Limit (actual time=0.025..0.028 rows=25)
  -> Index Scan using "Notification_userId_createdAt_id_idx" (actual time=0.025..0.027 rows=25)
Execution Time: 0.039 ms
```

The `Incremental Sort` step disappears entirely - not a marginal cost reduction, a whole plan node
removed - and execution time drops ~6x (0.242ms → 0.039ms) at 1000 rows. Given this is a real,
measurable, structurally meaningful improvement with negligible write-side cost (one more index on
an insert-mostly table), **implemented as a real migration**
(`prisma/migrations/20260917100441_phase18_notification_composite_index/`), replacing the old
2-column index outright (any query it could serve, the 3-column version serves equally well, so
keeping both would only add index-maintenance cost for no further read benefit). Fixture fully
cleaned up before the real migration was applied - verified 1000 → 0 fixture rows.

## End-to-End Buyer Testing

**VERIFIED**, real HTTP requests (disposable script, session scratchpad, not committed) against
the real standalone server + real database, full journey: register a new buyer company → browse
the marketplace filtered to a real supplier → create an RFQ inviting that supplier → supplier
submits a quote → bidirectional negotiation (buyer, then supplier) → buyer accepts the quote → a
real Purchase Order is generated → separately, add a product to cart → submit a Purchase Request
→ approve it as sole OWNER → **auto-conversion confirmed**: `IN_APPROVAL` → `CONVERTED_TO_PO` →
checkout with `CARD` → order created `CONFIRMED`/`PAID` (synchronous payment method) → invoice
fetched, `PAID`. **Final settlement confirmed real**: `order.status = DELIVERED`,
`paymentStatus = PAID`. Every state transition was checked at each step, not assumed from the
final result. All scratch data (3 companies across 2 failed schema-mismatch attempts + 1
successful run) fully cleaned up afterward - verified 3 → 0.

## Supplier Testing

**VERIFIED**, covered within the same E2E script: the supplier correctly received the RFQ invite,
submitted a quote scoped to its own products/company, participated in the negotiation thread, and
fulfilled the resulting order end to end (`processing` → `dispatch`, `SHIPPED` → `delivered`,
`DELIVERED`). Supplier-facing data scoping was separately and more rigorously verified by the
cross-role security battery below (a supplier cannot see another supplier's orders, cannot mutate
another supplier's products, cannot reach any buyer-only or platform-admin-only action).

## Admin Testing

**VERIFIED.** Logged in as the real seeded platform admin (`grace.owusu@platform.example`);
confirmed real (non-mock) data end to end: `GET /api/analytics` returns real platform GMV/order
aggregates; `GET /api/audit-log` returns real `AuditLog` rows (re-confirmed the client-side mock
this endpoint replaced in Phase 17 has not reappeared - `grep` for `localStorage`/`demoData` in
`src/services/audit-log.service.ts` finds only historical doc-comment mentions, zero live usage).
Direct URL navigation to `/admin/audit` as an authenticated buyer, live in a real browser, was
confirmed correctly blocked ("Not available") with zero console errors - not just an API-level
check.

## Tenant Isolation

**VERIFIED**, a 22-check cross-role/cross-tenant battery (disposable script, session scratchpad)
against the real standalone server + database, using two distinct real companies (Acme
Technologies Ghana and Nigeria, the same underlying user account explicitly switched to each) and
two distinct real suppliers:

| Category | Checks | Result |
|---|---|---|
| Positive controls (own data) | buyer→own orders, supplier→own orders, admin→analytics | 3/3 ALLOWED |
| Cross-company (A→B) | orders, invoices, cart | 3/3 DENIED (404) |
| Cross-supplier (A→B) | orders, product mutation | 2/2 DENIED (404) |
| Cross-role (buyer↔supplier↔admin) | 9 checks spanning product creation, order lists, RFQ creation, analytics, audit log, supplier verification | 9/9 DENIED (403/404, exactly per the intended distinct-vs-indistinguishable-404 design) |
| Manipulated identifiers | malformed id, well-formed-but-nonexistent id | 2/2 DENIED (404) |
| Unauthenticated | orders, audit log, RFQ creation | 3/3 DENIED (401) |

**22 passed, 0 failed** (one initial script-level false alarm - wrong HTTP method assumed for the
supplier-verification route, `POST` vs. the real `PATCH` - fixed in the test script, not a real
finding). Direct-URL-navigation blocking was additionally verified live in a real browser (see
Admin Testing above), satisfying the brief's "verify both UI navigation, direct URL, and direct
API request" requirement.

## Frontend Error/Loading/Empty States

**VERIFIED, no new gaps found.** Re-ran the exact audit query this phase
(`grep -rl "useAsyncData" ... | while read f; do grep -q "error" "$f" || echo "$f"; done` across
every page/feature component) - **zero results**: every page using `useAsyncData` already reads
and renders its `error` value. A second, broader check for any other loading-state pattern
(`useState.*loading`/`isLoading`) without a corresponding `error`/`catch` also returned zero
results. This reflects real prior work (the earlier Phase E session's 15-file failure-state audit)
holding up under a fresh, independent re-check, not an assumption carried forward.

**Live-verified the actual failure UX**, not just the presence of an `error` variable: used
`agent-browser network route "**/api/companies/*/orders*" --abort` to make the real orders API
call genuinely fail against a live, authenticated session. Result: the Orders page rendered
"Couldn't load orders / Could not reach the server. Check your connection and try again. / Try
again" - never an infinite loading skeleton. Removing the network intercept and clicking "Try
again" successfully reloaded and displayed the real order list, confirming the retry mechanism
itself works end to end, not just that an error message appears.

## Responsive Verification

**VERIFIED**, real browser viewport resizing (`agent-browser set viewport`) against the real
standalone server, all 6 required viewports:

| Viewport | Pages checked | Result |
|---|---|---|
| 390×844 | Dashboard | Clean (2-col stat grid, bottom tab bar) |
| 375×812 | Dashboard | Clean |
| 768×1024 | Dashboard, Orders (table), Catalog (grid+filters), RFQs (list), RFQ detail (quote comparison + negotiation thread), Cart, Invoices, Payments, Disputes, Settings, Checkout (5-step stepper) | Clean - the 6-column orders table fits with no horizontal scroll at this width; the quote-comparison table has a legitimate, working `overflow-x: auto` (18px real overflow, not a bug) |
| 1024×768 | Dashboard | Full sidebar layout appears exactly at this breakpoint (Tailwind `lg:`, 1024px) - confirmed a deliberate, standard breakpoint choice, not an accidental gap at 768px |
| 1440×900 | Dashboard | Clean, appropriate use of extra width |
| 1920×1080 | Dashboard | Clean, 5-column stat grid, no awkward stretching |
| 390×844 (again) | Checkout | 5-step workflow stepper wraps to 2 lines gracefully, no overlap/cutoff |

Special attention items from the brief - tables, filters, dialogs, dropdowns, sidebar, checkout,
RFQ comparison, workflow steppers - were each explicitly covered above. No new defects found this
phase; the mobile-specific bugs found and fixed in the earlier Phase E session (an invisible
`BarChart`, a horizontally-overflowing cart row, two admin pages missing a mobile card layout
entirely) remain fixed and were not seen to regress.

## Mock/localStorage Audit

Repository-wide search for `localStorage`, `sessionStorage`, `mock`/`mockData`, `demoData`,
`fixture`, `fake`, `hardcoded`, `placeholder`, classified:

| Finding | Classification | Action |
|---|---|---|
| `src/app/(app)/catalog/page.tsx`, `compare/page.tsx` - `sessionStorage` for the "compare" product-id selection | **B** (UI preference/state) | None - correct as-is |
| `src/app/(app)/layout.tsx` - `localStorage` for sidebar collapsed/expanded | **B** (UI preference/state) | None - correct as-is |
| `src/services/auth.service.ts` - `allCompanies()`/`allCompanyUsers()` `localStorage`-mirrored bridge | **F** (legacy bridge, requires backend work) | Already fully documented in `PROJECT_SCOPE.md` §8 (Phase E); re-confirmed still accurate - no `GET /api/companies` endpoint has been added |
| 7 server-side files matched by `localStorage`/`mock` grep (`context.ts`, `audit.service.ts`, `budget.service.ts`, `company.service.ts`, `payment.service.ts`, `recurringPurchase.service.ts`, `template.service.ts`) | **False positive** | Doc-comment mentions of historical context only ("...instead of localStorage") - zero live server-side `localStorage` usage exists (impossible in a server module regardless) |
| 4 client service files (`audit-log.service.ts`, `budgets.service.ts`, `recurring.service.ts`, `templates.service.ts`) | **False positive** | Same - doc comments describing what each replaced, all real, `apiRequest`-based, database-backed |
| **`src/app/(app)/compare/page.tsx` - resolved product display data (price/stock/specs) from a static `demoProducts` array, keyed only by real product ids from `sessionStorage`** | **E** (legacy mock that should be removed) | **Fixed** - now calls the real `catalogService.getProductById` per selected id; a genuine bug (any product created after seeding, or any price/stock change since, would have silently shown wrong or missing data) |
| **`src/components/layout/CompanySwitcher.tsx` - resolves the parent-`CompanyGroup`'s display name from static demo data** | **F** (legacy bridge, requires backend work) | Documented, not fixed - `CompanyGroup` is a real model with real rows (3 live companies reference one), but no route anywhere exposes it; building `GET /api/company-groups/[id]` is new backend scope. Not currently capable of showing wrong data (nothing can edit a `CompanyGroup` row without a raw DB operation), but real technical debt |
| `src/app/(app)/rfqs/create/page.tsx` - resolves category names from a static `demoCategories` array | **B/D** (immutable reference data) | None - no create/update route for categories exists anywhere in the app; this list structurally cannot drift from the 5 real seeded categories, unlike products |
| `src/components/layout/PhasePlaceholder.tsx` | **E** (legacy mock/dead code) | **Removed** - zero imports anywhere in the codebase (`grep -rln "PhasePlaceholder" src` → only its own file) |
| `src/server/services/payment/gateways/mobileMoneyProvider.ts` - "instant-success simulation" | **D** (documented, honest development-only helper) | None - already fully described in `PROJECT_SCOPE.md` §5, falls back only when a network's real credentials are unconfigured, logs a warning |
| `src/server/services/payment/providers.ts` - `WALLET` "placeholder balance" | **D** (documented, honest placeholder) | None - already fully described in `PROJECT_SCOPE.md` §5 |
| `GET /api/companies/[companyId]/invoices`, `.../payments`, `GET /api/rfqs?companyId=` (unpaginated) | **F** (requires backend work, previously found in Phase E) | Not fixed this phase - re-confirmed still accurate, changing the response shape would break "preserve existing service interfaces" |
| Every other `placeholder`/`hardcoded`/`fake` grep hit | **False positive** | Form input `placeholder="..."` attributes (UI hint text), not fake data |

## Security Verification

- **Authentication**: unchanged, re-verified via the 344/354-test suite and the live 11-failed-
  login `Retry-After` check above.
- **Authorization / tenant isolation / IDOR resistance**: re-verified live, 22/22 checks passing
  (see Tenant Isolation above).
- **Input validation**: unchanged, covered extensively by the existing suite; not re-litigated
  line by line.
- **Generic 404 ownership failures**: re-confirmed unchanged - malformed and well-formed-but-
  foreign ids both return `404`, indistinguishable.
- **CSP**: re-verified enforced by default, zero violations live (see CSP Review).
- **Session cookie**: unchanged, `httpOnly`/`secure` (prod)/`sameSite=lax`, not touched this phase.
- **Rate limiting**: unchanged in limits/keys/semantics, `Retry-After` added on top (see Rate
  Limiting).
- **Cron secret / Webhook HMAC / idempotency**: unchanged this phase; re-confirmed present by
  reading `requireCronSecret` and `webhook.service.ts#processPaymentWebhook` directly - both still
  fail-closed, constant-time-compared, and event-id-deduplicated exactly as Phase 17 described.
- **Audit logging**: re-confirmed real (see Admin Testing).
- **Security headers**: unchanged - `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, `Content-Security-Policy`
  all present on every response checked this phase (including every `503`/`500`/`429`/`401` seen
  during failure testing).
- **No secret exposure / no stack traces in HTTP responses**: explicitly, repeatedly verified this
  phase - both via manual `curl -i` inspection during the live database-outage test and via the
  new automated regression tests asserting the response body never contains a connection string,
  credentials, class name, or file path.

## Performance Measurements

Real numbers only, captured this phase:

| Measurement | Value |
|---|---|
| `/login` (dynamic, nonce-bearing), steady state, 5 requests | 207-235ms |
| `/dashboard` (dynamic, authenticated), steady state, 5 requests | 208-234ms |
| `/robots.txt` (genuinely static), steady state, 3 requests | 207-238ms |
| `Notification` cursor query, 1000-row fixture, before composite index | 0.242ms (`Incremental Sort` + `Index Scan Backward`) |
| `Notification` cursor query, 1000-row fixture, after composite index | 0.039ms (pure `Index Scan`) |
| Login rate-limit `Retry-After`, real countdown across 6 requests | 898s → 895s |

**Not measured this phase**: sustained concurrent load/throughput (this phase's checks were all
single-request latency, not a load test); per-query Prisma timing in isolation (no query-timing
middleware installed, same as every prior phase); a fresh 1000-row Products/Orders/Invoices/
Payments/RFQs benchmark repeat (already measured with real numbers in Phase E; not re-run this
phase since neither the route-wrapping codemod nor the notification-index change touches those
query shapes - re-verified by inspection that `withErrorHandling` adds a try/catch around an
already-async function, not an additional await/round-trip).

## Production Build

```
npx tsc --noEmit     -> clean (0 errors)
npm run lint         -> clean (0 errors, 0 warnings)
npx vitest run --no-file-parallelism -> 44 files / 354 tests / 354 passed / 0 failed
npm run build        -> succeeds, zero errors/warnings
```

Re-run after every round of changes this phase (route-wrapping codemod, Retry-After, notification
index, Compare-page fix), not just once at the end.

## Docker

**NOT VERIFIED.** `docker --version` → `command not found`, confirmed again this phase - same
result as every prior phase (Phase 14 through 17). The `Dockerfile` was reviewed, not run: its
three-stage structure (`deps` → `builder` → `runner`) is unchanged from Phase 17's own review and
still matches the standalone-build composition this phase manually ran and verified live many
times over (`.next/standalone` + `.next/static` + `public/` + `node server.js`). This gives
reasonable confidence but is explicitly **not** the same as verification, and is not claimed as
one.

## Environment Variables

Unchanged from Phase 17's own classified table - no new environment variable was introduced this
phase. `CSP_ENFORCED`, `CRON_SECRET`, `PAYMENT_WEBHOOK_SIGNING_SECRET`, `REDIS_URL`, `STORAGE_*`
all remain exactly as previously documented.

## Payment Integration Status

```
Provider integration ready (MTN MoMo, against MTN's real public sandbox spec)
Real provider credentials/configuration not supplied in this environment
Not production-tested
```

Unchanged this phase - not touched, not re-implemented, not claimed as more complete than it is.
The webhook receiver's full chain (signature verification over raw bytes → idempotency via a
unique `(provider, providerEventId)` constraint → atomic transaction updating `Payment`/`Invoice`
state) was re-confirmed by reading `webhook.service.ts` directly, unchanged from Phase 17.

## Redis Status

```
Rate limiting remains in-memory.
Redis migration boundary is documented (the four functions checkRateLimit/recordAttempt/
clearAttempts/enforceRateLimit, in src/server/auth/rate-limit.ts, are the entire surface a
Redis-backed version would need to replace).
Redis becomes required when multiple application instances share traffic - not the case today.
```

Not installed this phase, per the brief's explicit instruction. `getRetryAfterSeconds`, the one
new function added this phase, was designed against the same in-memory bucket state and would
need no interface change if the storage were later swapped for Redis.

## OpenAPI Status

Not attempted this phase - same reasoning as Phase 16/17, re-confirmed rather than re-litigated:
the Zod schemas under `src/server/validation/*` describe request bodies, not response shapes or
path/query parameters; route handlers construct responses ad hoc from DTOs. Generating an accurate
OpenAPI document would mean hand-writing response schemas alongside the existing request schemas
(ongoing duplication risk) or a non-trivial codegen pass across 99 route files, disproportionate to
this phase's scope. The API surface's shape didn't change enough this phase (behavior-preserving
wrapping, one header addition, one index change) to change this calculus.

## Tests

```
Before: 43 files / 344 tests / 344 passed / 0 failed  (Phase 17's ending state, re-confirmed live)
After:  44 files / 354 tests / 354 passed / 0 failed
```

New test files/additions this phase:
- `src/server/errorHandling.routes.test.ts` (new, 6 tests) - real-route, real-database-boundary
  regression coverage for the standardized error-handling architecture (see Regression Tests).
- `src/server/auth/rate-limit.test.ts` (+4 tests) - `Retry-After` header correctness and
  `getRetryAfterSeconds` behavior.

No test was deleted, skipped, or had an assertion weakened. Every one of the original 344 tests
passed unchanged throughout every round of this phase's changes (route-wrapping codemod,
Retry-After, notification index, Compare-page fix) - re-run after each round, not just once at the
end.

## Build

See Production Build above - re-run after every round of changes, always clean.

## Database Migrations

One new migration this phase, applied via `prisma migrate deploy` (the established non-
interactive-safe path):

- `prisma/migrations/20260917100441_phase18_notification_composite_index/migration.sql` - drops
  `Notification_userId_createdAt_idx`, creates `Notification_userId_createdAt_id_idx` on
  `(userId, createdAt, id)`.

`prisma migrate status` confirms "Database schema is up to date!" - 12 migrations total, all
applied. `prisma migrate reset` was never run; no data was destroyed.

## Documentation

`PROJECT_SCOPE.md` updated:
- §6 (Security posture): error-response consistency marked resolved with the real fix description;
  `Retry-After` added; CSP re-evaluation documented with the real evidence (build output, latency
  measurements, live browser re-verification).
- §7 (Testing): count corrected to 44 files / 354 tests.
- §8 (Known rough edges): error-response inconsistency marked resolved; notification index change
  documented with real before/after numbers; the Compare-page bug documented as found-and-fixed;
  the `CompanySwitcher`/`CompanyGroup` gap newly documented as technical debt; `PhasePlaceholder.tsx`
  removal noted.
- This report (new).

## Remaining Limitations

- Invoices, payments, and RFQ list endpoints remain unpaginated (found in Phase E, re-confirmed
  unfixed this phase - would require a response-shape change that conflicts with this engagement's
  "preserve existing service interfaces" instruction).
- `CompanySwitcher`'s parent-group name is still resolved from static demo data (real technical
  debt, not currently capable of drifting since no route can edit a `CompanyGroup` row).
- File storage remains schema-only (`Document` model, no upload route) - unchanged, not this
  phase's scope.
- Live payment-provider round-trip remains unverified (no real credentials available).
- Docker remains unverified (unavailable in this environment).
- No OpenAPI contract (re-confirmed, not re-attempted).
- Rate limiting remains in-memory/single-instance (correctly deferred, migration boundary
  documented).
- Accessibility was not specifically re-audited this phase (out of this phase's stated scope).
- Sustained concurrent load/throughput testing remains not measured (this and every prior phase
  measured single-request latency, not a load test).

## Recommended Next Phase

1. Add pagination (offset or cursor, matching the existing `Page<T>`/`CursorPage<T>` envelope
   convention) to invoices, payments, and RFQ list endpoints - the one remaining real, measured
   scaling risk this and the prior phase both found and both correctly deferred pending a
   deliberate API-contract-change decision, since it touches the "preserve existing service
   interfaces" boundary and several frontend consumers per domain.
2. Build a real `GET /api/company-groups/[id]` (or fold group name into an existing company
   payload) to close the `CompanySwitcher` technical debt properly, rather than leaving it
   resolved from static data indefinitely.
3. If/when this app is deployed on more than one instance, swap `rate-limit.ts`'s in-memory `Map`
   for a Redis-backed counter behind the same four-function interface - already fully scoped, not
   built.

## Files Changed

**Error handling (Objective 1/2)**: 96 route files wrapped in `withErrorHandling` via an
AST-based codemod (full list: every `src/app/api/**/route.ts` file except `health`, `ready`, and
the already-wrapped `invoices/[id]/pay`); `src/server/errorHandling.routes.test.ts` (new).

**Rate limiting (Objective 4)**: `src/server/auth/rate-limit.ts` (+`getRetryAfterSeconds`,
`Retry-After` header on `enforceRateLimit`'s `429`), `src/app/api/auth/login/route.ts`
(`Retry-After` on its own manual `429`), `src/server/auth/rate-limit.test.ts` (+4 tests).

**Database (Objective 5)**: `prisma/schema.prisma` (`Notification(userId, createdAt, id)`
replacing `(userId, createdAt)`), new migration
`prisma/migrations/20260917100441_phase18_notification_composite_index/`.

**Mock/localStorage audit (Objective 9)**: `src/app/(app)/compare/page.tsx` (rewritten to call
the real `catalogService.getProductById` instead of a static demo-data array),
`src/components/layout/PhasePlaceholder.tsx` (deleted - confirmed dead code).

**Docs**: `PROJECT_SCOPE.md`, this report (new).

**Not committed to the repo** (disposable, scratch-only, verified fully cleaned up):
`scratch_wrap_routes.js` (the route-wrapping codemod itself, deleted after running once),
`p18_e2e.js`, `p18_security.js` (session scratchpad) - both deleted their own scratch database
rows on completion, independently re-verified via direct row-count queries.
