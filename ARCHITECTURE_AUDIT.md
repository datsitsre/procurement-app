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

## Priority order for implementation (per the brief's own Section 56)

1. **Security** — of the gaps found, the concrete, low-risk, high-value items are: security headers (this turn), extending rate limiting beyond login, and a session-rotation-on-role-change follow-up.
2. **Data integrity** — already strong; no concrete gap found this pass beyond what's listed above.
3. **Reliability** — logging/observability is the real gap here, not job architecture.
4. **Performance** — pagination is the one concrete item; not urgent at current scale.
5. **Observability** — structured logging + request IDs, currently at zero.
6. **Enterprise readiness** — not started; correctly deferred (no real external consumer exists yet to build against).
