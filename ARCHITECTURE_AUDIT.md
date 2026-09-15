# Backend Architecture & Security Audit

*Produced per the "Production Hardening" brief's own Section 1/2 instructions: inspect before modifying, audit before fixing. This is the audit — implementation follows incrementally, prioritized per the brief's own Section 56 order (Security → Data integrity → Reliability → Performance → Observability → Enterprise readiness), one reviewable increment at a time, not all 62 sections at once.*

Numbers below were checked against the repo, not recalled: 83 API route files, 21 server services, 56 Prisma models, 96 `@@index`/`@unique`/`@@unique` declarations, 32 test files / 220 tests (221 as of the most recent commit).

## Strengths (already correctly implemented)

- **Tenant isolation**: every tenant-scoped route re-derives `companyId`/`supplierId` from the authenticated session (`server/auth/context.ts`'s `resolveTenant`), never from a client-supplied value; a mismatch is a generic 404, never a distinct 403 that would confirm a record exists. This pattern is consistent across every domain checked (products, RFQs, quotes, negotiations, purchase requests, approvals, orders, invoices, payments, disputes, company members) and is exercised by dedicated cross-tenant tests per domain.
- **RBAC**: 10 roles, one permission matrix (`config/rbac.ts`), checked server-side on every mutating route via `requireCompanyAccess`/`requireSupplierAccess`/`requireAuthenticated(request, Permission.X)` — never only hidden in the UI. Role-granting actions (adding/editing a team member) specifically validate the target role belongs to the target company's own workspace, closing the "buyer admin grants SUPPLIER_ADMIN/PLATFORM_ADMIN" escalation path.
- **Auth**: bcrypt (cost 12), opaque session tokens hashed before storage, httpOnly + `Secure`-in-production + `SameSite=lax` cookies, verified against a real production build (not just `next dev`).
- **CSRF**: same-origin check applied centrally inside `requireAuthAndPermission` for every non-GET request — not re-implemented per route, so a route can't forget it.
- **Transactions**: multi-record writes (checkout → order+items+invoice+timeline+payment link, quote acceptance → RFQ+quote+purchase order, approval → step+request+audit) run inside `db.$transaction`.
- **Idempotency**: `Payment.idempotencyKey` is a real unique constraint; a retried charge with the same key returns the original payment instead of charging twice.
- **Webhooks/cron**: HMAC-SHA256 (webhooks) / shared-secret (cron), both compared with `crypto.timingSafeEqual`, both **fail closed** (reject everything) while unconfigured rather than the app refusing to boot. Webhook processing is idempotent (a replayed event for a payment already in the target status is a no-op).
- **Financial precision**: every money column is Prisma `Decimal`, never a float.
- **DTO boundary**: raw Prisma models never cross the API boundary directly — a `server/dto/*.ts` mapper strips internal fields and converts `Decimal`→`number`/`Date`→ISO string for every domain checked.

## Weaknesses / gaps found this pass

| Area | Finding | Severity |
|---|---|---|
| **Pagination** | Zero list endpoints paginate — every `findMany` across all 21 services returns the full result set (confirmed: no `take`/`skip`/`cursor` anywhere in `src/server/services`). Fine at current seed-data scale; a real production tenant with thousands of orders/invoices/audit entries would load them all into memory on every list call. | Medium (real, but scale-dependent) |
| **Rate limiting** | Only `/api/auth/login` is rate-limited. `/api/auth/register`, invoice payment attempts, and webhook endpoints have no rate limiting at all. | Medium |
| **Security headers** | `next.config.ts` sets none — no `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, `Strict-Transport-Security`, no CSP. | Medium |
| **Observability** | Zero structured logging anywhere in `src/server` (no `console.error`/logger calls at all outside test files) — a production failure has no request ID, no correlation, nothing beyond whatever Next.js's own default crash output shows. No metrics, no request-ID propagation. | Medium-High (real operational risk once deployed) |
| **Error response shapes** | Every route hand-builds its own `NextResponse.json({ error, fieldErrors? }, { status })` — consistent in *practice* (checked: always `{error: string}` at minimum) because every route was written against the same convention by hand, but nothing enforces it centrally; a future route could drift. | Low |
| **MFA** | No TOTP/recovery-code infrastructure exists at all (no schema fields, no routes). | Not started (expected — never built) |
| **API docs** | No OpenAPI spec or generated docs. | Not started |
| **Health checks** | `/api/health` exists and checks the database; no separate `/api/ready`. | Minor gap |

## Security risks — specifically checked, not assumed

- **Tenant leakage**: spot-checked negotiations, invoices, payments, company team management — all correctly scoped. No route found that trusts a client-supplied `companyId`/`supplierId` for authorization (several *display* conveniences accept one as a URL param, but every one is re-verified against the session's own tenant before use).
- **Privilege escalation**: `addTeamMember`/`updateTeamMember` both validate the granted role against `BUYER_ROLES`/`SUPPLIER_ROLES` for the *target* company, not the caller's own role — closing the specific escalation path Section 8 of the brief calls out by name.
- **Payment manipulation**: charge amount is always server-computed from the invoice/order record, never accepted from the client; the payment provider abstraction resolves success/failure/pending server-side, never trusts a client-reported "it worked."
- **Replay**: webhook signature check is constant-time; no timestamp/nonce layer beyond that, so a captured-and-replayed *valid* webhook within the idempotency window is a no-op (safe) but a replay *outside* any window still succeeds if the underlying state hasn't changed back — low real risk given the idempotency check, but worth noting as the brief's Section 16 explicitly asks about.
- **Session abuse**: no session rotation on privilege change (e.g., after a role edit, existing sessions for that user keep their previously-resolved permission set until they re-authenticate or switch company) — not exploited by anything found, but worth flagging under Section 5's "session rotation where appropriate."

## Performance risks

- No N+1 pattern found in the services checked (dashboard/analytics aggregates use `include`/`select` deliberately, not a per-row loop of queries) — but this wasn't exhaustively checked across all 21 services in this pass.
- Unbounded `findMany` (see Pagination above) is the dominant real risk, not per-query inefficiency.
- 96 index/unique declarations already cover the tenant-scoping columns (`companyId`, `supplierId`, `status`) on the models checked — reasonably indexed for the query patterns actually used.

## Reliability risks

- No background job/retry infrastructure for anything beyond the three cron sweeps already built (invoice-due, low-stock, pending-payment reconciliation) — acceptable for current scope, but Section 27's "job architecture" isn't started.
- No dead-letter/retry handling if a webhook handler itself throws mid-transaction — Prisma's own transaction rollback protects data consistency, but there's no automatic re-delivery request to the provider beyond whatever the provider's own retry policy already does.

## Technical debt

- `services/catalog.service.ts` (client) still carries a "mirror the server session into a localStorage-backed runtime cache" bridge for a handful of read paths — documented in-file, already patched twice this session for real bugs it caused. Not a security issue (server never trusts it), but real complexity.
- `CompanyMembership.department` is a free-text string, not a foreign key to `Department` — the Team page now surfaces real department names as picker options, but nothing enforces they stay in sync if renamed/removed.

## Addendum: session rotation (Implementation order step 3)

Inspected before implementing anything, per the brief's own "inspect, don't blindly implement"
rule.

**Finding: there is no stale-permission window to close.** `resolveTenant` (`server/auth/context.ts`)
re-derives the caller's role and tenant from `CompanyMembership` **live, from the database, on
every single request** - nothing about a user's role or permissions is cached in the session row
or the cookie. A role change made via `updateTeamMember` therefore already takes effect on that
user's very next request; there is no window in which a downgraded user retains their old,
higher-privilege permission set. This is architecturally equivalent to what session rotation
exists to guarantee in a cached-claims system (e.g. a JWT with roles baked into it) - it's just
achieved here by never caching the claim in the first place.

Also checked the other events the brief calls out:
- **Membership suspension/removal**: `MembershipStatus.SUSPENDED` is declared in the schema but
  no code path in the app ever sets it - there is no "remove/deactivate a team member" feature to
  begin with (`updateTeamMember` only edits role/department/name/photo). Nothing to rotate against
  yet.
- **Password change**: no route exists (`PasswordResetToken` is schema-only, confirmed earlier in
  this document and in `PROJECT_SCOPE.md`). `revokeAllSessions(userId)` already exists in
  `session.ts` as a ready primitive - wiring it in is one line whenever a real password-change
  flow is built, not before.
- **MFA enrollment/removal**: not implemented (expected - never built).

**Decision: no code change here.** Forcing a session-revocation call on every role edit today
would add user friction (an unexpected forced logout) without closing any actual vulnerability,
since the live-resolution model already prevents a downgraded user from retaining old
permissions. Per the brief's own final principle ("every new component must solve a real
problem"), this is left as-is; `revokeAllSessions` is documented here as the primitive to call
from a future password-change or membership-removal route once either exists.

## Addendum: webhook replay protection (Implementation order step 4)

Added an event-level idempotency key (`PaymentTransaction.providerEventId`, required on every
inbound webhook payload as `eventId`) checked *before* the existing status-equality short-circuit,
so a captured event replayed after the payment's status has since moved on for an unrelated
reason (e.g. a refund) is still recognized as already-processed instead of being reprocessed.
Previously the only defense was "does the current status already equal the event's target
status," which stops the ordinary case (a gateway retrying until it gets a 2xx) but not a
captured-and-replayed event arriving after the state has genuinely changed since.

**Pre-existing constraint found while adding this, out of scope to change here:**
`PaymentTransaction` already had `@@unique([provider, providerReference])`, which means at most
one `PaymentTransaction` row can ever exist for a given `(provider, providerReference)` pair,
full stop - not per event, per reference. In practice this has never mattered because this app's
only two webhook events (`payment.captured` / `payment.failed`) are mutually exclusive terminal
outcomes for a single payment attempt, so no real code path ever sends a second, distinct event
for the same reference. Documented here rather than changed, since redesigning that constraint
would be scope creep beyond "add replay protection" and there is no real scenario in this
codebase that hits it.

## Addendum: pagination (Implementation order step 7)

Added a shared, reusable pagination utility (`src/server/pagination.ts`: `parsePagination` for
`?page=&pageSize=` query-param validation with a default of 25 and a hard max of 100, `toPage`
building the `Page<T>` envelope already declared - but unused - in `types/common.ts`) and applied
it end-to-end (service, route, client service, and UI) to exactly one endpoint: `GET /api/payments`,
the platform-wide "every payment across every company" admin view. Chosen deliberately as the
single most unbounded-by-construction list in the app - it has no tenant scope at all to bound it
naturally, unlike a company's own orders/invoices/products.

Per the brief's own explicit instruction not to blindly paginate every route in one pass, the
other 44 unbounded `findMany` calls found during the original audit (orders, invoices, products,
notifications, RFQs, quotes, negotiations, disputes, purchase requests/orders, team members, ...)
are left as-is, cataloged here as real follow-up work using the same shared utility, not fixed in
this pass. None of them were flagged as an active problem at current data volume; this establishes
the pattern and closes the one genuinely unbounded case.

Live-verified against a real standalone production server, including through an actual rendered
browser session (not just curl): `?pageSize=1000000` is clamped to 100, different pages return
non-overlapping real rows, `total` matches the real row count, and the admin Payments page
correctly renders the paginated envelope with a Previous/Next pager that only appears once there's
more than one page.

**Methodology note surfaced by this verification pass**: earlier increments' "live verification"
this session used `curl` against JSON API endpoints only, which never exercises static asset
serving - confirmed here that the standalone server needs `.next/static` and `public/` copied into
`.next/standalone/` to serve a working frontend at all (the *real* `Dockerfile` already does this
correctly; it was only my own ad hoc manual test-server invocations that skipped it). Worth
remembering for any future manual standalone-server check that needs to load an actual page, not
just hit an API route directly.

## Addendum: catalog localStorage bridge (Implementation order step 9)

Inspected `src/services/catalog.service.ts` in full, per the brief's own "identify which read
paths still depend on it, don't just delete" instruction.

**Finding: already resolved, no `localStorage` reference remains in the file.** The bridge the
original audit (and `PROJECT_SCOPE.md`) described was accurate *at the time it was written*, but
this session had already patched it twice before reaching this step (see the earlier "cold-cache
blank-page regression" fixes) by replacing the localStorage-backed cache with an in-memory `Map`
warmed synchronously from the session payload itself (`primeSupplierCache`, called by
`useAuth.tsx`'s `AuthProvider` the moment a session loads) - every read now goes through the real
`/api/*` backend, and the in-memory cache exists only to serve the ~16 call sites that need a
*synchronous* supplier lookup (`getSupplierById`/`getSupplierByCompanyId`), never as a substitute
for a real fetch. No code change needed here; `PROJECT_SCOPE.md`'s stale claim about this file
(written before the fix, never updated) has been corrected in place.

**A separate, more significant finding surfaced while verifying this**: `budgets.service.ts`,
`templates.service.ts`, and `recurring.service.ts` (backing the live `/budgets` and
`/purchase-requests/recurring` pages, plus `TemplatesPanel.tsx`) are still **entirely** client-side
`localStorage`-only mocks - no Prisma model, no API route, no server-side tenant isolation or
authorization at all, despite sitting in the same "Procurement" UI area as the real,
Postgres-backed purchase requests/approvals/purchase orders. `PROJECT_SCOPE.md` previously (and
incorrectly) listed these as real, Postgres-backed features in its domain-coverage table - that
claim predates this investigation and has been corrected there too.

This is real, disclosed technical debt, not a security vulnerability (nothing server-side trusts
this client-only data for authorization), but it's a materially different and larger finding than
"a runtime cache bridge" - building real backing for these three features would mean new Prisma
models, services, routes, validation, and tests, which is new-feature scope, not hardening. Left
deliberately out of scope for this pass per the brief's own "do not rebuild" / "prioritize
security first" principles; documented here and in `PROJECT_SCOPE.md` so it's visible rather than
silently inherited.

## Addendum: CompanyMembership.department relationship (Implementation order step 10)

Inspected the actual data before deciding, per the brief's own "determine whether it is safe to
migrate" instruction - not assumed either way.

**Finding: migrating to a hard foreign key now would be lossy.** Queried every
`CompanyMembership` row with a non-null `department` value (9 rows across the real seeded/test
data) and checked each against the company's own real `Department` table for a matching name.
**All 9 have no matching `Department` row at all** - a 100% mismatch rate. The Team page's
`DepartmentSelect` (added earlier this session) only started sourcing options from the real
`Department` table recently; every existing `department` string predates that and was typed
freely, with no `Department` entities ever created to back most of them.

Converting `department: String?` to a real `departmentId` foreign key today would force one of
two outcomes for all 9 existing values: silently drop them (set `departmentId` null, losing the
text with no way to know what it said), or auto-create a new `Department` row from each orphaned
string during the migration - which is itself a real, unreviewed data-creation decision (some of
that text could be a stale/renamed/typo'd value nobody actually wants preserved as a permanent
department going forward). Neither is safe to do unattended, exactly the risk the brief's own
Section 20 describes.

**Decision: documented as technical debt, not migrated.** The current design (a picker sourced
from real departments for *new* edits, coexisting with legacy free text on old memberships) is a
reasonable interim state - it doesn't corrupt data, and every membership's department still
displays correctly as whatever text it holds. Revisit this once/if a real product decision is
made about what should happen to each of the 9 mismatched values (migrate as new departments?
clear them? ask each company to re-pick?) - that's a product question, not one this hardening pass
should decide unilaterally by picking a migration strategy that happens to be technically
convenient.

## Priority order for implementation (per the brief's own Section 56)

1. **Security** — of the gaps found, the concrete, low-risk, high-value items are: security headers (this turn), extending rate limiting beyond login, and a session-rotation-on-role-change follow-up.
2. **Data integrity** — already strong; no concrete gap found this pass beyond what's listed above.
3. **Reliability** — logging/observability is the real gap here, not job architecture.
4. **Performance** — pagination is the one concrete item; not urgent at current scale.
5. **Observability** — structured logging + request IDs, currently at zero.
6. **Enterprise readiness** — not started; correctly deferred (no real external consumer exists yet to build against).
