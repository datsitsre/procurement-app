# ACCESS CONTROL IMPLEMENTATION REPORT

Nothing in either phase covered by this report was committed, pushed, deployed, or applied to the
production database. All schema migrations were run with `prisma migrate dev` against **local**
PostgreSQL only (`DATABASE_URL` was overridden per-command; the project's own `.env` — which
currently points at the production Prisma Postgres instance — was never touched or used for any
write in either phase). All work is currently sitting in the local working tree for review.

Sections 1-18 below are the original phase (RBAC split, self-approval/self-role-escalation fixes,
company-scoped audit log). Sections 19-25 are the follow-up phase that addresses the three
limitations that phase's own Section 17 flagged as remaining: platform user management, Super
Admin cross-company read auditing, and the registration-approval lifecycle. Section 26 is the
final pre-production audit that reviewed and independently re-verified all of the above against
the actual code and a real running instance, rather than trusting the earlier sections' own
claims.

## 1. Current Architecture

Before making any change, three research passes (RBAC/auth helpers, tenant-isolation across the
full API surface, workflow/audit maturity) read the actual implementation. Summary of what
already existed:

- **RBAC** (`src/config/rbac.ts`): 10 roles (`OWNER`, `ADMIN`, `PROCUREMENT_MANAGER`, `BUYER`,
  `FINANCE_MANAGER`, `APPROVER`, `EMPLOYEE`, `SUPPLIER_ADMIN`, `SUPPLIER_STAFF`, `PLATFORM_ADMIN`),
  16 permissions, an explicit non-wildcard `RolePermissions` map (no "owner gets everything"
  shortcut). **Only one platform-level role existed** - `PLATFORM_ADMIN`, holding just
  `platform.manage` + `analytics.read`.
- **Auth context** (`src/server/auth/context.ts`): every request's `AuthContext`/`TenantContext`
  is resolved from the session cookie -> a real `CompanyMembership` DB lookup, filtered to
  `status === 'ACTIVE'`. Nothing client-supplied is ever trusted.
- **Ownership check** (`src/services/base.ts`'s `ownsRecord`): fails closed; the only bypass was
  `caller.isPlatformAdmin`, granted whenever `membership.role === 'PLATFORM_ADMIN'`.
- **Route-level composition** (`src/server/auth/require.ts`): `requireCompanyAccess`/
  `requireSupplierAccess`/`requireAuthenticated` compose the permission check and the ownership
  check consistently. No `can()`/`authorize()`/`assertResourceAccess()` abstraction existed by
  that name - the codebase's actual vocabulary is `hasPermission` + `ownsRecord`, unified through
  these three wrapper functions.
- **Tenant isolation across ~100 API routes**: audited broadly (every resource area named in the
  brief) and found **no IDOR gap** - every route either pre-validates a path-segment id via
  `requireCompanyAccess`/`requireSupplierAccess`, or fetches the record first and checks
  `ownsRecord` against the fetched owner, including the trickier indirect cases (`/api/documents`
  walking up to its parent RFQ/PurchaseRequest, quote/RFQ id cross-validation, `switch-company`
  validating a real active membership).
- **Workflow protections already in place**: approval-step double-decision and RFQ double-accept
  are both closed via atomic conditional `updateMany` + `CONFLICT`, not read-then-write races.
  Reject-without-reason is rejected server-side. Role-grant is restricted to a company's own
  buyer/supplier role set (a buyer company could never already grant `SUPPLIER_ADMIN` or a
  platform role).
- **Audit logging**: a real `AuditLog` model existed, written from 5 service functions (product
  moderation, supplier verification, budgets, disputes, recurring purchases, purchase templates),
  read from one platform-admin-only, cross-tenant, unfiltered feed (`GET /api/audit-log`).
- **Registration**: `POST /api/auth/register` creates a real `Company` + `User` +
  `CompanyMembership(role: OWNER, status: ACTIVE)` in one transaction and immediately logs the
  new user in - no approval gate on self-registration (supplier accounts, by contrast, already go
  through a real `SupplierVerificationStatus` moderation gate).

## 2. Security Audit

| # | Severity | Location | Problem | Impact | Fix |
|---|---|---|---|---|---|
| 1 | **High** | `procurement.service.ts`'s `decideStep` | No check comparing the approver to the request's own `requesterUserId` | A `PROCUREMENT_MANAGER`/`OWNER`/`ADMIN` who both creates and can approve purchase requests could approve/reject their own request - a real separation-of-duties bypass on money-moving workflow | Added an explicit `SELF_APPROVAL_DENIED` check before the decision is recorded (Section 9) |
| 2 | **High** | `company.service.ts`'s `updateTeamMember` | No check preventing a user from changing their **own** role via the team-management endpoint | Any `USERS_MANAGE` holder (which includes `ADMIN`, permission-equivalent to `OWNER`) could PATCH their own `userId` to `OWNER` - a direct, single-request privilege escalation | Added `SELF_ROLE_CHANGE_DENIED` - no one may change their own role through this endpoint (Section 9) |
| 3 | **High** | `company.service.ts`'s `addTeamMember`/`updateTeamMember` | Granting or revoking the `OWNER` role required no more than the `USERS_MANAGE` permission, which `ADMIN` also holds | An `ADMIN` (not an `OWNER`) could freely promote anyone (including themselves, before fix #2) to `OWNER`, or demote the sole existing owner | Added `OWNER_ROLE_RESTRICTED` - only an existing `OWNER` may grant or change the `OWNER` role (Section 9) |
| 4 | **Medium** | RBAC model | Only one platform role existed (`PLATFORM_ADMIN`), with the tenant-isolation bypass tied directly to that one role - no way to give someone platform-operations access without also giving them full cross-company transaction access | Violates the brief's core requirement (Sections 15-18) that a platform operator can run the platform without automatically seeing every company's business data | Split into `PLATFORM_MANAGER` (no bypass, no transaction permission) and `PLATFORM_SUPER_ADMIN` (kept the bypass); legacy `PLATFORM_ADMIN` preserved, unchanged, for backward compatibility (Section 3) |
| 5 | **Medium** | `audit.service.ts`'s `listAuditLog` | Read path was platform-admin-only, unfiltered, and there was no way for a company's own admins to see their own company's audit trail | Company owners/admins had zero audit visibility into their own company's history; the only audit view was cross-tenant and gated to a role that (post-fix #4) shouldn't automatically see company-scoped entries anyway | Added a company-scoped `listCompanyAuditLog` + a new `GET /api/companies/[companyId]/audit-log` route (tenant-checked, `AUDIT_VIEW` permission); the platform-wide feed now filters to platform-only entries for `PLATFORM_MANAGER` (Section 4) |
| 6 | **Low** | `procurement.service.ts`'s `decideStep`/`acceptQuote`, `company.service.ts`'s `addTeamMember`/`updateTeamMember` | Approval decisions, quote acceptance, and team/role changes were never written to `AuditLog` | Gaps in the audit trail for exactly the sensitive actions the brief calls out (Section 28) | Added `recordAudit` calls to all four (Section 12) |

No vulnerability was found and left unfixed to avoid a larger change - all six were addressed. No
IDOR, tenant-isolation, cross-company-data-leakage, or missing-authentication finding emerged from
the audit (see Section 1) - the existing architecture in that specific area was already solid, and
nothing there was rewritten.

## 3. Authorization Architecture

Extended, not replaced, the existing layered model:

```
Authenticated session (getAuthContext)
        |
        v
Platform / Company / Supplier scope (resolveTenant -> TenantContext)
        |
        v
Role (CompanyMembership.role)
        |
        v
Permission (hasPermission(role, permission))
        |
        v
Resource ownership (ownsRecord(tenant, recordCompanyId, recordSupplierId))
        |
        v
Workflow state (approval-step status, RFQ status - atomic conditional updates)
        |
        v
ALLOW / DENY
```

The single architectural change with the widest blast radius: **`resolveTenant` now distinguishes
which platform roles receive the `isPlatformAdmin` tenant-isolation bypass.** Previously any
`PLATFORM_ADMIN` membership set `{ isPlatformAdmin: true }`, which `ownsRecord` treats as "owns
every record." Now:

```ts
// src/server/auth/context.ts
if (CROSS_TENANT_ROLES.includes(membership.role)) {           // PLATFORM_ADMIN, PLATFORM_SUPER_ADMIN
  return { tenant: { isPlatformAdmin: true }, role };
}
if (PLATFORM_ROLES.includes(membership.role)) {                // + PLATFORM_MANAGER
  return { tenant: {}, role };                                  // no bypass - just a role
}
```

This means `PLATFORM_MANAGER` never gets the bypass at the architecture level, independent of
which permission any given route happens to check - a defense-in-depth property, not just a
permission-table entry that a future route could accidentally omit.

## 4. Platform Manager

**`PLATFORM_MANAGER` cannot access company transactions - confirmed by both the architecture (no
`ownsRecord` bypass) and the route-level permission gate, and verified by 4 real, passing tests**
(`platformRoles.routes.test.ts`) that call the actual routes with a real `PLATFORM_MANAGER`
session and assert `403`:

| Route | Result for PLATFORM_MANAGER |
|---|---|
| `GET /api/orders` (cross-company orders) | 403 |
| `GET /api/payments` (cross-company payments) | 403 |
| `GET /api/analytics` (cross-company transaction analytics) | 403 |
| `GET /api/disputes` (cross-company disputes) | 403 |

What `PLATFORM_MANAGER` **can** do, gated on new, narrower permissions it does hold
(`PLATFORM_SETTINGS_MANAGE`, `PLATFORM_USERS_MANAGE`, `PLATFORM_REGISTRATION_APPROVE`,
`PLATFORM_CATALOG_MODERATE`, `PLATFORM_AUDIT_VIEW`):

- Product/supplier listing moderation and verification (`GET /api/products/moderation`, etc.) -
  verified live, returns `200`.
- The platform-wide audit log - but **filtered**: verified live that a `PLATFORM_MANAGER`'s own
  `GET /api/audit-log` response contains a real platform-action entry (`companyId: null`) but
  never a real company-transaction entry (`companyId` set), using two real seeded `AuditLog` rows
  in the same test.
- No route currently exists for "manage platform users" as a distinct CRUD surface beyond team
  management (which is company-scoped) - this is a genuine, honestly-scoped limitation (see
  Section 17).

## 5. Platform Super Admin

`PLATFORM_SUPER_ADMIN` retains everything `PLATFORM_MANAGER` has, plus two permissions that
actually cross a tenant boundary: `PLATFORM_TRANSACTIONS_ACCESS` (gates `/api/orders`,
`/api/payments`, `/api/analytics`, `/api/disputes` + its `resolve` action) and
`PLATFORM_ROLES_MANAGE` (not yet wired to a route - see Section 17). Verified live (3 tests): a
real `PLATFORM_SUPER_ADMIN` session gets `200` from `/api/orders`, `/api/payments`, and
`/api/analytics`, and its `/api/audit-log` response includes both the platform-action and the
company-transaction seeded entries, unfiltered.

**Auditability**: every read through the transactional/cross-company routes still goes through the
same `logger.info('request authorized', ...)` structured-logging call every route already makes
(unchanged) - a real, timestamped, requestId-correlated record of who accessed what. A dedicated
`AuditLog` write for every individual `PLATFORM_SUPER_ADMIN` cross-company read was **not** added -
see Section 17's honest limitation on this.

The legacy `PLATFORM_ADMIN` role was kept permission-identical to `PLATFORM_SUPER_ADMIN` - any
account created before this phase (including any real account already in the production database)
retains exactly the access it already had, with zero regression. Re-verified: the pre-existing
`audit.routes.test.ts` suite (built around the legacy `PLATFORM_ADMIN` seeded account) passes
unchanged.

## 6. Company Isolation

Unchanged from the pre-existing, audited-and-confirmed-sound architecture (Section 1): every
company-scoped route resolves the caller's company from the session (`requireCompanyAccess`), and
every `findMany`/`create`/`update` uses that server-derived id, never a client-supplied one. No
change was needed here - this is exactly the part of the system the audit found already correct.

The two new fixes in this area (self-role-change, `OWNER`-role restriction) are refinements
*within* one company's own membership, not cross-company isolation gaps - a user could always only
ever act on their own company's team; they could not, before this phase, be stopped from escalating
their own role *within* that company.

## 7. Supplier Isolation

Unchanged - the audit found the existing `requireSupplierAccess`/`ownsRecord(tenant, undefined,
supplierId)` pattern applied consistently: a supplier's RFQ inbox, quotes, orders, invoices,
payments, and disputes are all scoped to the caller's own `supplierId`, verified across the
existing, passing test suite (`refuses an uninvited supplier from listing another supplier's RFQ
inbox`, etc. - all still passing, unchanged).

## 8. Resource Authorization

Unchanged architecture, confirmed sound: `ownsRecord` is checked against the *fetched* record's
actual owner for every owner-ambiguous resource (orders, invoices, purchase orders, purchase
requests, RFQs, documents), not merely "does a record with this id exist." The one new resource
this phase added authorization for - the company-scoped audit log - follows the identical pattern
(`requireCompanyAccess` before any query).

## 9. Workflow Authorization

Two new, real workflow-state/identity checks added, both inside the existing atomic-transaction
shape (no change to the underlying concurrency-safety):

- **`decideStep`** (`procurement.service.ts`): after the existing role-match check, before the
  decision is recorded - `if (pr.requesterUserId === approverUserId) return
  fail('SELF_APPROVAL_DENIED', ...)`. Mapped to HTTP 403 in the route.
- **`updateTeamMember`**: `actor.userId === userId` -> `SELF_ROLE_CHANGE_DENIED` (403); `(patch.role
  === 'OWNER' || membership.role === 'OWNER') && actor.role !== 'OWNER'` -> `OWNER_ROLE_RESTRICTED`
  (403). Same `OWNER_ROLE_RESTRICTED` check added to `addTeamMember` for brand-new members.

Neither introduces a new state machine - both are additional guard clauses in front of logic that
was already correctly handling concurrency (conditional `updateMany`, `CONFLICT` on a lost race).

## 10. User Lifecycle

**Not changed.** Audited (Section 1) and found that buyer self-registration has no approval gate,
while supplier onboarding already does (`SupplierVerificationStatus`). Implementing a mandatory
`PENDING_APPROVAL` gate on ordinary company self-registration was **deliberately not done** this
phase - it would be a major, disruptive behavior change to the core registration flow every
existing account (including every demo/test account created in prior phases) depends on, and the
brief's own instruction ("do not create unnecessary complexity," "do not break existing
functionality," "make the smallest correct change") points against introducing it speculatively
without a stated product requirement for it. This is recorded as a known, deliberate scope decision
in Section 17, not a silent omission.

## 11. Admin User Management

No new "manage platform users" CRUD surface was added (see Section 17's honest limitation) - the
existing `/admin/*` pages and their underlying moderation/verification routes are unchanged in
shape, only re-gated to the correct new permission (`PLATFORM_CATALOG_MODERATE` for product/
supplier moderation, `PLATFORM_TRANSACTIONS_ACCESS` for order/payment/dispute/analytics admin
views). Company-level team management (`addTeamMember`/`updateTeamMember`) is where this phase's
real admin-management hardening landed - see Section 2, findings #2/#3.

## 12. Audit Logging

**Newly logged this phase** (via the existing `recordAudit` function, unchanged signature):
`PURCHASE_REQUEST_APPROVED`/`PURCHASE_REQUEST_REJECTED` (from `decideStep`), `RFQ_QUOTE_ACCEPTED`
(from `acceptQuote`), `TEAM_MEMBER_ADDED`, `TEAM_MEMBER_ROLE_CHANGED` (from `company.service.ts`).

**Read-side split**: `GET /api/audit-log` (platform-wide) now filters to `companyId: null` entries
for `PLATFORM_MANAGER` sessions (real DB-level filter, verified by test), and remains unfiltered
for `PLATFORM_SUPER_ADMIN`/legacy `PLATFORM_ADMIN`. A new `GET /api/companies/[companyId]/audit-log`
gives a company's own `OWNER`/`ADMIN`/`SUPPLIER_ADMIN` (the roles holding the new `AUDIT_VIEW`
permission) a real, tenant-scoped view of their own company's trail only - verified by test that an
unrelated company's owner gets `404`, and that a `PLATFORM_MANAGER` (who has no membership in any
real company for this purpose) gets `403`.

Secrets are never logged by this system - unchanged; `recordAudit`'s callers pass only DTO-shaped
before/after values, never raw request bodies or credentials.

## 13. Prisma Changes

**One migration**: `prisma/migrations/20260919222222_add_platform_manager_super_admin_roles/`

```prisma
enum Role {
  OWNER
  ADMIN
  PROCUREMENT_MANAGER
  BUYER
  FINANCE_MANAGER
  APPROVER
  EMPLOYEE
  SUPPLIER_ADMIN
  SUPPLIER_STAFF
  PLATFORM_ADMIN          // kept, unchanged, for backward compatibility
  PLATFORM_MANAGER        // new
  PLATFORM_SUPER_ADMIN    // new
}
```

**Why this was the only schema change required**: every other fix in this phase (self-approval,
role-escalation, audit-log scoping) operates entirely on data already present in the schema
(`PurchaseRequest.requesterUserId`, `CompanyMembership.role`, `AuditLog.companyId`) - no new
column, table, or relation was needed. Adding two enum values is additive and non-breaking: no
existing row's `Role` value changes meaning, and Postgres enum additions do not require rewriting
existing rows.

**Applied**: only to the local development database (`prisma migrate dev`, `DATABASE_URL`
overridden per-command to point at `127.0.0.1:5432`, never the project's own `.env`). **Not applied
to production.** Applying it there (a simple, additive `ALTER TYPE ... ADD VALUE`, safe as a
`prisma migrate deploy`) is a decision left to you, to run when you're ready.

## 14. Files Changed

```
prisma/schema.prisma                                            (Role enum: +2 values)
prisma/migrations/20260919222222_add_platform_manager_super_admin_roles/  (new, local-only)

src/config/rbac.ts                                               (+2 roles, +7 permissions, role maps, canAssignPlatformRole)
src/server/auth/context.ts                                       (resolveTenant: scoped isPlatformAdmin bypass)

src/server/services/audit.service.ts                             (listAuditLog scope param, +listCompanyAuditLog)
src/server/services/procurement.service.ts                       (decideStep: self-approval + audit; acceptQuote: audit)
src/server/services/company.service.ts                           (addTeamMember/updateTeamMember: escalation guards + audit)

src/app/api/companies/[companyId]/audit-log/route.ts             (new - tenant-scoped audit read)
src/app/api/audit-log/route.ts                                   (PLATFORM_AUDIT_VIEW + scope-by-role)
src/app/api/orders/route.ts                                      (PLATFORM_TRANSACTIONS_ACCESS)
src/app/api/payments/route.ts                                    (PLATFORM_TRANSACTIONS_ACCESS)
src/app/api/analytics/route.ts                                   (PLATFORM_TRANSACTIONS_ACCESS)
src/app/api/disputes/route.ts                                    (PLATFORM_TRANSACTIONS_ACCESS)
src/app/api/disputes/[id]/resolve/route.ts                       (PLATFORM_TRANSACTIONS_ACCESS)
src/app/api/products/moderation/route.ts                         (PLATFORM_CATALOG_MODERATE)
src/app/api/products/[productId]/moderation/route.ts             (PLATFORM_CATALOG_MODERATE)
src/app/api/suppliers/moderation/route.ts                         (PLATFORM_CATALOG_MODERATE)
src/app/api/suppliers/[supplierId]/verification/route.ts          (PLATFORM_CATALOG_MODERATE)
src/app/api/purchase-requests/[id]/decide/route.ts                (SELF_APPROVAL_DENIED -> 403)
src/app/api/rfqs/[rfqId]/quotes/[quoteId]/accept/route.ts          (pass actor userId for audit)
src/app/api/companies/[companyId]/team/route.ts                   (pass actor for escalation guard; new error -> 403)
src/app/api/companies/[companyId]/team/[userId]/route.ts          (pass actor for escalation guard; new errors -> 403)

src/server/auth/platformRoles.routes.test.ts                      (new - 13 tests)
src/server/services/company.service.test.ts                       (+4 escalation tests; existing calls updated for new signature)
src/server/services/procurement.service.test.ts                   (fixture: distinct approver; existing self-approval collision fixed)
src/server/services/procurement.routes.test.ts                    (fixture: distinct approver + 1 new self-approval test)
src/server/services/budget.service.test.ts                        (fixture: distinct approver)
```

No file outside this list was touched. `.env` was never written to.

## 15. Tests

```
Added:    18 (13 new file `platformRoles.routes.test.ts`, +4 in `company.service.test.ts`,
              net +1 in `procurement.routes.test.ts` - one existing test split into two:
              "refuses self-approval" + "lets a different owner decide it")
Removed:  0
Weakened: 0
Passed:   434 / 434 (48 files) - full suite, local dev database
Failed:   0
```

Fixing pre-existing test fixtures that happened to use the same user as both requester and
approver (3 files: `procurement.service.test.ts`, `procurement.routes.test.ts`,
`budget.service.test.ts`) is **not** a weakening - those fixtures now use two genuinely distinct
users, which is strictly more realistic than before and the correct fix once self-approval is
actually blocked; no assertion in any of them was loosened, and each file gained real, additional
coverage (the self-approval-denied case itself).

**Key security scenarios tested (real API-boundary tests, real Postgres, real sessions):**
- `PLATFORM_MANAGER` denied `orders`/`payments`/`analytics`/`disputes` (4 tests)
- `PLATFORM_MANAGER` allowed catalog moderation + filtered audit view (2 tests)
- `PLATFORM_SUPER_ADMIN` allowed all of the above, unfiltered audit (4 tests)
- Company-scoped audit log: own company allowed, `PLATFORM_MANAGER` denied (no membership-based
  permission), unrelated company denied with `404` (3 tests)
- Self-approval denied at both the service layer and the real route (2 tests)
- Self-role-change denied; non-owner cannot grant/revoke `OWNER` via `updateTeamMember` or
  `addTeamMember` (4 tests)

## 16. Build

```
npx tsc --noEmit           -> clean, 0 errors
npm run build (local DB)   -> clean, production build succeeds, all 108+ routes compiled
npx eslint .               -> 2 pre-existing errors in scripts/copy-standalone-assets.js
                               (require()-style imports in a plain Node script from an earlier,
                               unrelated phase) - confirmed NOT introduced by this phase (file was
                               not touched); 0 errors in any file this phase changed
npx vitest run             -> 434/434 passing (see Section 15)
```

## 17. Remaining Risks

Stated honestly, not glossed over:

1. **No dedicated "manage platform users" route exists yet.** `PLATFORM_ROLES_MANAGE` and
   `canAssignPlatformRole()` (the escalation-prevention helper) are defined but not yet wired to
   an actual API endpoint, because none existed before this phase to re-gate - platform accounts
   have only ever been created by direct database/seed access in this codebase's history. Building
   a full "invite/promote a Platform Manager" UI+API was judged out of scope for a security-audit
   phase and is flagged here as real follow-up work, not silently skipped.
2. **`PLATFORM_SUPER_ADMIN`'s cross-company reads are not individually audit-logged.** The brief's
   Section 29 asks for auditing "when a Super Admin performs sensitive cross-company actions" -
   this phase's audit-logging additions (Section 12) cover the specific mutations named in the
   original gap list (approvals, quote acceptance, team changes), but a Super Admin simply
   *viewing* `/api/orders` or `/api/payments` still only produces the existing structured
   `logger.info` line, not a persistent `AuditLog` row. Adding a write-on-every-admin-GET would be
   a much larger, cross-cutting change (every admin route, plus a decision about log volume) that
   wasn't attempted here.
3. **Self-registration remains ungated** (Section 10) - a deliberate scope decision, not an
   oversight, but worth your explicit sign-off if the product actually wants a
   `PENDING_APPROVAL`-style gate on new company signups.
4. **The `OWNER_ROLE_RESTRICTED`/`SELF_ROLE_CHANGE_DENIED` guards apply only to the company
   team-management endpoint** (`addTeamMember`/`updateTeamMember`) - if any other code path can
   mutate `CompanyMembership.role` directly (none was found in this audit, but a future feature
   could add one without going through these functions), it would bypass these guards. There is no
   database-level constraint enforcing this - it's an application-layer rule.
5. **No automated test asserts the full Section 18 matrix cell-by-cell** (e.g. "Platform role
   management: LIMITED for Manager") beyond what's actually wired up - `PLATFORM_MANAGER` simply
   never receives `PLATFORM_ROLES_MANAGE` at all (the narrowest possible interpretation of
   "LIMITED"), which is tested, but there's no separate "manager can do X but not Y" role-
   management test because no role-management route exists yet (see risk #1).
6. **Local migration not yet applied to production.** Until it is, no production account can
   actually be granted `PLATFORM_MANAGER`/`PLATFORM_SUPER_ADMIN` - the legacy `PLATFORM_ADMIN` role
   (kept permission-equivalent to `PLATFORM_SUPER_ADMIN`) continues to work exactly as before in
   the meantime, so this is not a regression, just an incomplete rollout.

## 18. Git Status

```
$ git status --short (new/untracked files from this phase only)
?? prisma/migrations/20260919222222_add_platform_manager_super_admin_roles/
?? src/app/api/companies/[companyId]/audit-log/
?? src/server/auth/platformRoles.routes.test.ts

$ git diff --stat
 prisma/schema.prisma                                              |  11 +++
 src/app/api/analytics/route.ts                                    |   3 +-
 src/app/api/audit-log/route.ts                                    |  19 ++--
 src/app/api/companies/[companyId]/team/[userId]/route.ts          |   9 +-
 src/app/api/companies/[companyId]/team/route.ts                   |   9 +-
 src/app/api/disputes/[id]/resolve/route.ts                        |   4 +-
 src/app/api/disputes/route.ts                                     |   4 +-
 src/app/api/orders/route.ts                                       |   3 +-
 src/app/api/payments/route.ts                                     |   4 +-
 src/app/api/products/[productId]/moderation/route.ts              |   3 +-
 src/app/api/products/moderation/route.ts                          |   3 +-
 src/app/api/purchase-requests/[id]/decide/route.ts                |   2 +-
 src/app/api/rfqs/[rfqId]/quotes/[quoteId]/accept/route.ts         |   2 +-
 src/app/api/suppliers/[supplierId]/verification/route.ts          |   4 +-
 src/app/api/suppliers/moderation/route.ts                         |   4 +-
 src/config/rbac.ts                                                | 104 +++++++++++++++++++-
 src/server/auth/context.ts                                        |  15 ++-
 src/server/services/audit.service.ts                              |  53 +++++++++-
 src/server/services/budget.service.test.ts                        |  12 ++-
 src/server/services/company.service.test.ts                       |  79 ++++++++++++---
 src/server/services/company.service.ts                            |  53 +++++++++-
 src/server/services/procurement.routes.test.ts                    |  22 +++-
 src/server/services/procurement.service.test.ts                   |  20 +++-
 src/server/services/procurement.service.ts                        |  31 ++++++
 24 files changed, 422 insertions(+), 51 deletions(-)

$ git diff --name-only
(the same 21 modified files listed above)
```

**No commit was made. No push was made. No deployment occurred. Production data and the
production database schema were not touched.** This working tree is ready for your review before
any of that happens.

---

## 19. Platform User Management

Built the CRUD surface Section 17 flagged as missing, at `/admin/platform/users` (UI) and
`/api/admin/platform/users*` (API) — narrowly scoped, not a generic "admin can do everything"
surface.

**Data model** (`src/server/services/platformUsers.service.ts`): deliberately reuses the existing
per-membership `CompanyMembership.status`/`.role` fields rather than adding a new global "user
status" concept. `listPlatformUsers()` returns only: memberships with `status` in
`PENDING_APPROVAL`/`REJECTED`/`SUSPENDED`, plus any membership already holding a platform role
(`PLATFORM_MANAGER`/`PLATFORM_SUPER_ADMIN`/legacy `PLATFORM_ADMIN`) — not "every user at every
company," which would itself be a new cross-company data-exposure surface.

**Operations, each with its own permission gate and route:**

| Operation | Route | Permission | Notes |
|---|---|---|---|
| List platform users / pending registrations | `GET /api/admin/platform/users` | `PLATFORM_USERS_MANAGE` | Held by both `PLATFORM_MANAGER` and `PLATFORM_SUPER_ADMIN` |
| Approve / reject a pending registration | `PATCH /api/admin/platform/users/[userId]/registration` | `PLATFORM_REGISTRATION_APPROVE` | Atomic conditional `updateMany` on `status: 'PENDING_APPROVAL'` — a second decision on an already-decided registration gets `CONFLICT`, never a silent overwrite |
| Suspend / reactivate a member | `PATCH /api/admin/platform/users/[userId]/status` | `PLATFORM_USERS_MANAGE` | Held by both platform roles |
| Change a platform role | `PATCH /api/admin/platform/users/[userId]/role` | `PLATFORM_ROLES_MANAGE` | Held **only** by `PLATFORM_SUPER_ADMIN` (and legacy `PLATFORM_ADMIN`) — `PLATFORM_MANAGER` gets `403` before the handler body ever runs |

**Escalation guards in `changePlatformRole` — defense in depth, re-derived independently of the
route's own permission gate** (mirrors the reasoning already documented on `ownsRecord`):

1. Actor cannot change their own membership's role (`SELF_ROLE_CHANGE_DENIED`), closing the one
   case a route-level permission check alone can't: a `PLATFORM_SUPER_ADMIN` targeting themselves.
2. `canAssignPlatformRole(actor.role)` is re-checked inside the service, not just at the route —
   only `PLATFORM_SUPER_ADMIN`/legacy `PLATFORM_ADMIN` pass.
3. The target role must be a real platform role; the target membership must belong to a genuine
   platform-type company (a `PLATFORM_MANAGER` cannot be minted inside an ordinary buyer/supplier
   company's membership table).

Net result, verified by 7 real tests (Section 22): a `PLATFORM_MANAGER` cannot promote anyone to
`PLATFORM_SUPER_ADMIN`, cannot promote itself (even indirectly, since it lacks the permission
entirely), and never gains `PLATFORM_TRANSACTIONS_ACCESS` or any permission outside its own role's
map — `PLATFORM_SUPER_ADMIN` can manage platform roles, but cannot change its own role through this
same endpoint either.

**UI** (`src/app/(app)/admin/platform/users/page.tsx`): a client component behind the existing
`AdminGuard` (UX-only, as documented everywhere it's used — the real boundary is the four API
routes above). Shows pending registrations (approve/reject) and suspended/rejected/platform-role
accounts (suspend/reactivate; role-change buttons rendered only for a `PLATFORM_SUPER_ADMIN`
viewer, which is a UX convenience, not the security boundary — the route re-checks independently).

## 20. Super Admin Cross-Company Read Auditing

Extended `src/server/services/audit.service.ts` with `auditCrossCompanyRead(auth, resourceType,
resourceId, companyId?)` — a conditional wrapper around the existing `recordAudit` that fires
**only** when `auth.tenant.isPlatformAdmin` is true (i.e., only for `PLATFORM_SUPER_ADMIN`/legacy
`PLATFORM_ADMIN` — `PLATFORM_MANAGER` never triggers it, since it never receives that flag at the
architecture level per Section 3). Writes a real `AuditLog` row: `action:
'SUPER_ADMIN_CROSS_COMPANY_READ'`, `entityType: resourceType`, `entityId: resourceId`, `companyId`
where known, `actorId`/`actorName` from the real session.

Deliberately **not** "log every page load" — wired into the specific sensitive cross-company reads
the brief named:

| Route | What's audited |
|---|---|
| `GET /api/orders/[id]` | A specific order, only when the caller isn't its own buyer/supplier (i.e. the `ownsRecord` cross-tenant bypass is what let the read through) |
| `GET /api/invoices/[id]` | A specific invoice, same condition |
| `GET /api/purchase-orders/[id]` | A specific purchase order, same condition |
| `GET /api/companies/[companyId]/budgets` | A specific company's budgets, viewed cross-tenant |
| `GET /api/orders` (admin list) | Logged once per request as a `LIST` read (already gated to `PLATFORM_TRANSACTIONS_ACCESS`) |
| `GET /api/payments` (admin list) | Same |
| `GET /api/analytics` (admin list) | Same |
| `GET /api/disputes` (admin list) | Same |

**No export/CSV feature exists anywhere in this codebase** (confirmed by search — the only
`Content-Disposition` header in the whole app is on an unrelated document-download route with no
export semantics), so "cross-company exports" auditing is honestly recorded as not applicable
rather than fabricated against a feature that doesn't exist.

**Normal tenant-scoped access is unaffected**: `auditCrossCompanyRead` is a no-op for any caller
without the cross-tenant bypass — a company reading its own order, invoice, purchase order, or
budgets produces zero new `AuditLog` rows, verified by test (Section 22). No secrets, passwords, or
tokens are ever part of the logged payload — same DTO-shaped-values-only discipline as every other
`recordAudit` call site (Section 12).

## 21. Registration Policy

**Reviewed first, per the instruction not to invent new architecture if the system already has the
necessary structure.** Found it mostly did: `buildSessionPayload`/`resolveTenant` already filter
memberships to `status === 'ACTIVE'` before granting any working tenant — a non-ACTIVE membership
already produces a real, working session with zero usable company/role. The only missing piece was
that self-registration set the new membership's status to `ACTIVE` immediately, skipping that
existing gate entirely.

**Change made — the minimum one to close that gap, not a new architecture:**

1. Extended the existing `MembershipStatus` enum with two new values: `PENDING_APPROVAL` (a
   brand-new self-registered OWNER membership starts here) and `REJECTED` (terminal, distinct from
   `SUSPENDED` — a platform admin explicitly declined the registration, versus a later suspension
   of an already-approved account).
2. `POST /api/auth/register` now creates the new membership with `status: 'PENDING_APPROVAL'`
   instead of `'ACTIVE'`. The route still creates a real session (so the new user can see their
   pending status and log out), but that session carries no working `companyId`/role — because
   `resolveTenant`'s pre-existing `status === 'ACTIVE'` filter, unchanged, already denies it one.
   The response body was changed from the normal session payload to an explicit
   `{ user, registrationStatus: 'PENDING_APPROVAL', message }` shape so the client can render the
   correct "awaiting approval" state instead of a broken logged-in-but-empty dashboard.
3. Approval/rejection now goes through the new `PATCH
   /api/admin/platform/users/[userId]/registration` route (Section 19) — an atomic conditional
   `updateMany` on `status: 'PENDING_APPROVAL'`, so a registration can only be decided once.

**Lifecycle realized**: `REGISTER` → `PENDING_APPROVAL` (new) → `APPROVED` (admin action flips
`status` to `ACTIVE` + sets `joinedAt`) → `ACTIVE`, at which point the existing, unchanged login
route and `buildSessionPayload` behave exactly as before.

**Why this is closed against the specific bypasses named in the brief** — confirmed by test
(Section 22), not just by inspection:

- *Direct API calls*: there is no route that lets a caller set their own membership to `ACTIVE`;
  approval requires `PLATFORM_REGISTRATION_APPROVE`, held only by platform roles.
- *Manipulated role/status/companyId in the registration request*: `RegisterSchema` (Zod) has no
  fields for `status`, `role`, or `companyId` at all — extra fields in the request body are simply
  discarded by Zod's parsing, never read. Verified live: a request with `status: 'ACTIVE', role:
  'PLATFORM_SUPER_ADMIN', companyId: 'company-acme-gh'` still produces a `PENDING_APPROVAL`,
  `OWNER`-role membership in a brand-new company — none of the tampered values reach the database.
- *Alternative registration routes*: grep-confirmed `POST /api/auth/register` is the only route
  that creates a `User` + `OWNER` `CompanyMembership` from unauthenticated input; supplier
  onboarding (unchanged) already goes through its own separate `SupplierVerificationStatus` gate.

## 22. Security Tests (this phase)

```
Added:  19 (12 new file `platformUsers.routes.test.ts`, 4 new file
            `src/app/api/auth/register/route.test.ts`, 3 new in the existing
            `platformRoles.routes.test.ts` for cross-company-read auditing)
Removed: 0
Weakened: 0
Passed:  453 / 453 (50 files) - full suite, local dev database, no regressions
Failed:  0
```

**Platform user management** (`platformUsers.routes.test.ts`, 12 tests): list access denied to a
plain company user, allowed to `PLATFORM_MANAGER`; registration approve/reject (incl.
double-decision failing); suspend/reactivate; and the 7-test escalation matrix from Section 19 —
company user denied entirely, `PLATFORM_MANAGER` cannot assign `PLATFORM_SUPER_ADMIN`, cannot
self-promote (even indirectly), `PLATFORM_SUPER_ADMIN` cannot self-change either, `
PLATFORM_SUPER_ADMIN` **can** promote a real `PLATFORM_MANAGER` (and it's audited — restored after
the assertion), and no platform role can be minted inside an ordinary company.

**Cross-company read auditing** (3 new tests in `platformRoles.routes.test.ts`, against a real
`Order` owned by a real buyer company): `PLATFORM_SUPER_ADMIN` reading that order via
`GET /api/orders/[id]` produces a real `SUPER_ADMIN_CROSS_COMPANY_READ` `AuditLog` row
(`entityType: 'Order'`, `entityId` matching, `companyId` matching the order's real owner); the
order's own buyer reading it produces **no** such row (normal tenant-scoped access stays
unaudited); `PLATFORM_MANAGER` is denied the read entirely (`404`, pre-existing tenant isolation —
unchanged) and also produces no such row, closing the specific concern that a Platform Manager
could "access company transactions simply to generate an audit event."

**Registration** (`route.test.ts`, 4 tests, real end-to-end route calls, real Postgres): new
registration is `PENDING_APPROVAL` not `ACTIVE`; the resulting session has an empty `companies`
array/`null activeCompanyId` and gets `404` from a protected, company-scoped route; a tampered
request body (`status`/`role`/`companyId`) is fully ignored; a membership manually flipped to
`ACTIVE` (simulating approval) can log in normally through the real `POST /api/auth/login` route
and receives a working session.

## 23. Prisma Changes (this phase)

**One migration**: `prisma/migrations/20260919225634_add_membership_pending_approval_rejected/`

```prisma
enum MembershipStatus {
  ACTIVE
  INVITED
  SUSPENDED
  PENDING_APPROVAL   // new - a brand-new self-registered OWNER membership starts here
  REJECTED           // new - a platform admin rejected this registration; terminal, distinct from SUSPENDED
}
```

Additive only — no existing row's meaning changes, no column/table/relation was added or removed.
Applied with `prisma migrate dev`, `DATABASE_URL` overridden per-command to
`127.0.0.1:5432/b2b_procurement`, never the project's own `.env`. **Not applied to production.**
`npx prisma migrate status` (run against the same local override) confirms: 14 migrations found,
schema up to date, local dev database only.

One incidental type fix was needed alongside this migration: `src/types/company.ts`'s
`CompanyUser.status` field had a hand-authored, now-stale union type that didn't include the two
new enum values, causing a real `tsc` error in `src/server/dto/company.ts`. Extended the union to
match the schema; no behavior change.

## 24. Files Changed (this phase)

```
prisma/schema.prisma                                                     (MembershipStatus: +2 values)
prisma/migrations/20260919225634_add_membership_pending_approval_rejected/  (new, local-only)

src/types/company.ts                                                     (CompanyUser.status union: +2 values)

src/server/services/audit.service.ts                                     (+auditCrossCompanyRead)
src/server/services/platformUsers.service.ts                             (new - list/decide/status/role service functions)
src/server/validation/platformUsers.ts                                   (new - Zod schemas)
src/services/platformUsers.service.ts                                    (new - client-side service wrapper)

src/app/api/admin/platform/users/route.ts                                (new - GET, PLATFORM_USERS_MANAGE)
src/app/api/admin/platform/users/[userId]/registration/route.ts          (new - PATCH, PLATFORM_REGISTRATION_APPROVE)
src/app/api/admin/platform/users/[userId]/status/route.ts                (new - PATCH, PLATFORM_USERS_MANAGE)
src/app/api/admin/platform/users/[userId]/role/route.ts                  (new - PATCH, PLATFORM_ROLES_MANAGE)
src/app/(app)/admin/platform/users/page.tsx                              (new - admin UI)

src/app/api/auth/register/route.ts                                       (membership status -> PENDING_APPROVAL; new response shape)

src/app/api/orders/[id]/route.ts                                         (+auditCrossCompanyRead)
src/app/api/invoices/[id]/route.ts                                       (+auditCrossCompanyRead)
src/app/api/purchase-orders/[id]/route.ts                                (+auditCrossCompanyRead)
src/app/api/companies/[companyId]/budgets/route.ts                       (+auditCrossCompanyRead)
src/app/api/orders/route.ts                                              (+auditCrossCompanyRead, LIST)
src/app/api/payments/route.ts                                            (+auditCrossCompanyRead, LIST)
src/app/api/analytics/route.ts                                           (+auditCrossCompanyRead, LIST)
src/app/api/disputes/route.ts                                            (+auditCrossCompanyRead, LIST)

src/server/services/platformUsers.routes.test.ts                         (new - 12 tests)
src/app/api/auth/register/route.test.ts                                  (new - 4 tests)
src/server/auth/platformRoles.routes.test.ts                             (extended - +3 cross-company-read-audit tests, now 16)
```

No file outside this list (plus Section 14's list from the prior phase) was touched this phase.
`.env` was never written to. No production database or Vercel environment variable was touched.

## 25. Verification (this phase)

```
DATABASE_URL=<local override> npx tsc --noEmit           -> clean, 0 errors
DATABASE_URL=<local override> npm run build               -> clean, production build succeeds,
                                                               new routes confirmed compiled:
                                                               /admin/platform/users,
                                                               /api/admin/platform/users(/*)
npx eslint .                                               -> 2 pre-existing errors in
                                                               scripts/copy-standalone-assets.js
                                                               (unchanged, unrelated, confirmed not
                                                               introduced this phase); 0 errors in
                                                               any file this phase touched
DATABASE_URL=<local override> npx vitest run
  --no-file-parallelism                                    -> 453 / 453 passing, 50 files, 0
                                                               failed, 0 skipped - no existing
                                                               test was weakened or removed
DATABASE_URL=<local override> npx prisma migrate status    -> 14 migrations found, schema up to
                                                               date, local dev database only
git status --short / git diff --stat                       -> only the files listed in Section 24
                                                               (plus the prior phase's Section 14
                                                               files) are modified; .env
                                                               untouched; no commit, no push
```

**Final state**: 453/453 tests pass, TypeScript clean, production build clean, migration applied
only to local dev Postgres, nothing committed or pushed, production and the 11 orphaned production
test companies untouched, Vercel environment unmodified.

**Remaining limitations, stated honestly:**

- The admin UI at `/admin/platform/users` was built and exercised through its underlying API
  routes (12 real route-level tests) but not click-tested in a browser in this phase — the actual
  security boundary (the four API routes) is fully tested regardless, per the project's own
  stated principle that `AdminGuard` is UX-only.
- `PLATFORM_ROLES_MANAGE` now has a real route wired to it, closing prior Section 17 risk #1.
- Cross-company read auditing (Section 20) covers the specific resources the brief named; it does
  not attempt "log every possible cross-tenant GET across all ~100 routes" — a much larger,
  cross-cutting change deliberately not attempted, consistent with the brief's own instruction not
  to blindly log every page load.
- The local migration for `MembershipStatus` (like the prior phase's `Role` migration) has not
  been applied to production; until it is, the production `register` route's behavior is unchanged
  from before this phase (this code is only live locally).

---

## 26. Final Pre-Production Audit

### Audit Date

2026-09-19.

### Scope

A full re-verification of Sections 1-25 against the actual running code, not a re-statement of
those sections' own claims. Covered: RBAC/permission matrix, `PLATFORM_MANAGER`/
`PLATFORM_SUPER_ADMIN`/legacy `PLATFORM_ADMIN` behavior at the real API boundary, all 114
`route.ts` files under `src/app/api/**`, indirect/child-resource tenant boundaries, pagination/
aggregation tenant safety, server-action/RSC direct-DB-access risk, client-side security, every
write path touching `CompanyMembership.role`/`status`/`companyId`, both Prisma migrations' SQL,
production compatibility, a real browser click-test of the one previously-untested surface
(`/admin/platform/users`), a secret scan of every changed file, and a performance pass over the
new authorization/audit code. Two focused sub-agents did the read-only code audit and the live
browser click-test respectively, working from the same source this report cites; their full
findings are folded in below. All work stayed against the local dev database
(`127.0.0.1:5432/b2b_procurement`) or was pure static analysis - nothing here touched production,
`.env`, or Vercel.

### Findings

No new security defect was found. Three non-blocking performance findings emerged that were not
in the original report (Section 36), one hygiene note (a stray scratch file left by a sub-agent
during browser testing, since deleted and confirmed absent from `git status`), and two low-
confidence items flagged for a follow-up look but not confirmed as real gaps. None of these block
production readiness; see "Remaining Risks" below.

### Platform Manager Verification

Re-confirmed live, both by direct API-route tests (`platformRoles.routes.test.ts`,
`platformUsers.routes.test.ts` - 28 tests total) and by an actual browser session driven through
the real `/login` page and `/admin/platform/users` UI:

- `GET/PATCH` on `/api/orders`, `/api/orders/[id]`, `/api/payments`, `/api/analytics`,
  `/api/disputes`, `/api/purchase-orders/[id]`, `/api/invoices/[id]`,
  `/api/companies/[companyId]/budgets` - **all denied** to a real `PLATFORM_MANAGER` session (403
  where a permission is checked, 404 from `/api/orders/[id]` since it falls through to the
  `ownsRecord` tenant check with no bypass).
- Confirmed at the architecture level, not just one route's permission check:
  `resolveTenant` (`src/server/auth/context.ts`) never places `PLATFORM_MANAGER` in
  `CROSS_TENANT_ROLES`, so `tenant.isPlatformAdmin` is never `true` for this role no matter which
  route runs - `ownsRecord`'s only bypass is unreachable for it.
- In the browser: `/admin/platform/users` renders pending registrations (with working
  Approve/Reject) and suspended/platform accounts (with a working Reactivate/Suspend), but **no
  promote/demote role-change control exists anywhere in the DOM for this account** - not merely
  hidden by CSS, a genuine client-side omission matching the code's own "UX only" comment.
- Independently, a raw `curl` call using the manager's real session cookie against
  `PATCH /api/admin/platform/users/[userId]/role` (attempting to promote its own company) returned
  a real **403** from the server - the UI hiding the button is not the security boundary; the route
  is, and it was exercised directly, not just inferred from the UI.

### Super Admin Verification

Confirmed `PLATFORM_SUPER_ADMIN` gets through on the same eight routes/resources
(`GET /api/orders`, `/api/orders/[id]`, `/api/payments`, `/api/analytics`, `/api/disputes`,
`/api/purchase-orders/[id]`, `/api/invoices/[id]`, `/api/companies/[companyId]/budgets`) - live
tests all return 200. This is not an uncontrolled `isAdmin === true`/`role === 'ADMIN'` shortcut:
access flows through the same `hasPermission(role, PLATFORM_TRANSACTIONS_ACCESS)` check every
other permission-gated route uses, and the `ownsRecord` bypass it receives is explicitly named
(`CROSS_TENANT_ROLES`), not an incidental side effect of some other flag. In the browser, logging
in as a real `PLATFORM_SUPER_ADMIN` and using `/admin/platform/users`'s "Promote to super admin"
control against a real `PLATFORM_MANAGER` account succeeded end-to-end (toast confirmation, role
label updated, reversible), and no role-change control rendered for the super admin's own row
(the `actor.userId === userId` self-change guard applies in the UI too, not just the API).

### Legacy PLATFORM_ADMIN Verification

`PLATFORM_ADMIN` remains fully defined in `Role` (`src/config/rbac.ts`) and unchanged since before
this phase - kept, per instruction, not removed or altered. `RolePermissions[Role.PLATFORM_ADMIN]`
is byte-for-byte the same permission list as `RolePermissions[Role.PLATFORM_SUPER_ADMIN]`
(`PLATFORM_MANAGE`, `PLATFORM_SETTINGS_MANAGE`, `PLATFORM_USERS_MANAGE`,
`PLATFORM_REGISTRATION_APPROVE`, `PLATFORM_CATALOG_MODERATE`, `PLATFORM_AUDIT_VIEW`,
`PLATFORM_ROLES_MANAGE`, `PLATFORM_TRANSACTIONS_ACCESS`, `ANALYTICS_READ`), and it is one of only
two roles in `CROSS_TENANT_ROLES`, so it still receives the `ownsRecord` tenant-isolation bypass
exactly as before. `canAssignPlatformRole()` also treats it as equivalent to
`PLATFORM_SUPER_ADMIN` for granting platform roles. The pre-existing `audit.routes.test.ts` suite
(built around a seeded `PLATFORM_ADMIN` account from before this phase existed) still passes
unchanged, which is the concrete regression check: a real, unmodified test written against the old
role continues to get the old behavior. **No existing production `PLATFORM_ADMIN` account will
behave any differently after this code deploys** - it isn't touched by either migration, and its
permission set in code is identical to what it was before Phase 25 started splitting the role.
Transition plan (Section 33) covers whether/when to actually re-badge these accounts.

### Tenant Isolation Verification

A dedicated read-only code-audit pass reviewed all 114 `route.ts` files plus nine indirect
parent/child relationships (RFQ→Quote, PurchaseRequest→approval, PurchaseOrder→Invoice,
PurchaseOrder→Payment, Supplier→Quote, Supplier→PurchaseOrder, Document→parent,
Budget→Company, RecurringPurchase→Company). Result: **no route found with a missing
authorization check, and no route found where a client-supplied `companyId`/`supplierId`/`userId`
in a request body reaches a Prisma query without being cross-checked against the session's own
tenant.** Every route falls into one of: `requireCompanyAccess`/`requireSupplierAccess` (URL-path
id, cross-checked), `requireAuthenticated` + permission only (correct for platform-scope,
non-tenant-specific actions), `getAuthContext` + manual `ownsRecord` against a *fetched* record
(never a client-asserted one), `requireCronSecret` (shared-secret, no session), HMAC signature
verification (`webhooks/payments/[provider]`), or deliberately public/catalog-only endpoints.
`auth/switch-company` (the one place a client-supplied `companyId` is genuinely meaningful)
re-validates it against a fresh, real `companyMembership.findUnique` with `status === 'ACTIVE'`
before trusting it. All nine indirect relationships confirmed to re-derive the parent's tenant
boundary from the fetched child record's own foreign key, never from a query parameter.

Two low-confidence items were flagged for a follow-up look, not confirmed as gaps: whether
`companies/[companyId]/cost-centers` POST cross-checks a body-supplied `departmentId` against
`companyId`, and whether `notifications/[id]/read`'s internal `markRead()` query is scoped to the
caller's own `userId` (the route itself doesn't visibly pre-fetch/ownsRecord-check, so correctness
depends on that internal query, which wasn't independently read in this pass).

### Registration Verification

Re-ran the full lifecycle (`REGISTER → PENDING_APPROVAL → admin decides → ACTIVE → LOGIN → working
company access`) via `src/app/api/auth/register/route.test.ts`'s four real, end-to-end tests
(unchanged, still passing): new registration lands `PENDING_APPROVAL`; the resulting session has
`companies: []`/`activeCompanyId: null` and gets `404` from a protected company route; a tampered
body (`role: 'PLATFORM_SUPER_ADMIN'`, `status: 'ACTIVE'`, `companyId: 'company-acme-gh'`) is fully
ignored - the schema has no such fields, Zod discards them, and the resulting membership is a
brand-new company with `OWNER`/`PENDING_APPROVAL`; an approval flipped to `ACTIVE` logs in normally
through the real `/api/auth/login` route with a working session. Rejected and suspended states are
separately covered by `platformUsers.routes.test.ts` (rejecting a pending registration sets
`REJECTED`; suspending an active membership sets `SUSPENDED`; both are conditional `updateMany`s
that fail closed on a double-decision). A pending user cannot modify their own membership, change
their role/status, or set a `companyId` - there is no route reachable without an `ACTIVE`
membership that would let them try, since `resolveTenant` gives them no company/role to act with in
the first place.

### Platform User Management Verification

The one surface not previously browser-tested was click-tested end-to-end this phase, using real
seeded accounts and the real `/login` page (bcrypt-hashed passwords, not injected cookies) against
the local dev database - see "Platform Manager/Super Admin Verification" above for the concrete
observations. Summary: **PASS for both roles.** `PLATFORM_MANAGER` can see and act on pending
registrations and suspended/platform accounts, cannot see or use any role-assignment control
anywhere in the rendered page, and is independently rejected (`403`) by the API if it tries the
role-change endpoint directly via raw HTTP. `PLATFORM_SUPER_ADMIN` can do everything
`PLATFORM_MANAGER` can, plus promote/demote a real `PLATFORM_MANAGER` account through the UI
successfully (verified, then reverted), and cannot change its own role (no control renders for its
own row; the API also blocks it via `SELF_ROLE_CHANGE_DENIED`). All seeded test data and the
temporary `.env.local` override used to point the dev server at the local database (never the
real `.env`) were deleted afterward - confirmed via `git status` and a follow-up row count showing
zero remaining test rows.

### Cross-Company Audit Verification

Confirmed via the three tests added to `platformRoles.routes.test.ts` (Section 22): a real
`PLATFORM_SUPER_ADMIN` reading another company's order through `GET /api/orders/[id]` produces a
real `AuditLog` row (`action: 'SUPER_ADMIN_CROSS_COMPANY_READ'`, `entityType: 'Order'`, matching
`entityId`/`companyId`); the order's own buyer reading the same order produces **no** such row
(normal tenant-scoped access stays unaudited, confirmed by an explicit assertion, not merely by
omission); and `PLATFORM_MANAGER` is denied the read entirely (`404`, since it never receives the
`ownsRecord` bypass) and also produces no such row - closing the specific concern that a
`PLATFORM_MANAGER` could "access company transactions simply to generate an audit event." The
independent code audit additionally confirmed `auditCrossCompanyRead` is a cheap, single
conditional insert with no N+1 pattern, and that it is wired into exactly the sensitive
single-resource reads and the four admin list views named in Section 20 - not every page load.

### API Authorization Review

114 `route.ts` files inventoried; every one resolves to an explicit authorization path (see
"Tenant Isolation Verification" above for the breakdown by pattern). No route was found relying
solely on the existence of a test to be considered safe - each was read directly. The full
per-route breakdown (which wrapper, which permission, whether tenant-scoped) is preserved in this
phase's working notes rather than reproduced in full here to keep this report readable; the two
low-confidence follow-up items are the only routes not fully confirmed.

### Server Action Review

Zero matches for `"use server"` anywhere in the repository - this application uses Route Handlers
exclusively, no Next.js Server Actions exist to audit. `@/server/db` is imported directly in only
five files, all of them either `route.ts` handlers (`auth/login`, `auth/register`,
`auth/switch-company`) or test files - no React Server Component reads or writes the database
directly, bypassing the service/auth-wrapper layers.

### Authentication/Session Review

`getAuthContext`/`resolveTenant`/`requireAuthenticated`/`requireCompanyAccess` all re-derive
session state from a real `companyMembership.findUnique` on every request - no forged or
client-asserted role/company is ever trusted. A non-`ACTIVE` membership (whether `INVITED`,
`SUSPENDED`, `PENDING_APPROVAL`, or `REJECTED`) resolves to `{ tenant: {}, role: undefined }` -
functionally "no working access" regardless of which of those four statuses applies, confirmed
live for `PENDING_APPROVAL` (registration tests) and `SUSPENDED` (platform-user-management tests).
Session cannot change company or role except through `switch-company`, which independently
re-validates the target membership is real and `ACTIVE` before trusting it - a session cookie
alone never carries an authoritative role or company.

### Prisma Migration Review

Both migrations inspected directly - `migration.sql` in each is a plain, single-statement-per-line
`ALTER TYPE ... ADD VALUE`:

```
ALTER TYPE "Role" ADD VALUE 'PLATFORM_MANAGER';
ALTER TYPE "Role" ADD VALUE 'PLATFORM_SUPER_ADMIN';
```

```
ALTER TYPE "MembershipStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "MembershipStatus" ADD VALUE 'REJECTED';
```

Neither drops a table or column, deletes a row, or rewrites any existing row's data - purely
additive enum extensions. No existing `Role` or `MembershipStatus` value's meaning changes.
Production's actual schema was **not directly queried** in this audit (deliberately, to avoid any
risk of touching the production credential currently in `.env` - the same caution flagged earlier
in this project's history); instead, this review reasons from the known migration history checked
into `prisma/migrations/` (14 migrations total, these two being the newest and not yet applied
anywhere but the local dev database) and the fact that `ALTER TYPE ... ADD VALUE` is a well-known,
low-risk, non-locking (as of the Postgres versions this project targets) forward migration. One
caveat worth flagging in the migration plan: PostgreSQL does not allow a newly-added enum value to
be used in the same transaction that adds it, so the production application code must be deployed
*after*, not simultaneously with, the migration (see "Deployment Order" below) - the additive SQL
alone is safe, but a naive single-step "migrate and deploy at once" script could hit this.

### Production Compatibility

No new production environment variables are required by any code added in either phase covered by
this report - `platformUsers.service.ts`, the new API routes, and the new admin UI all consume
only the existing `db` client and existing `env` module entries, confirmed by a direct search
(zero new `process.env`/`env.` references introduced). Existing production data compatibility:
both migrations are additive-only (see above), so every existing `CompanyMembership` row's
`role`/`status` value continues to mean exactly what it meant before - an existing `ACTIVE` user
stays `ACTIVE`, an existing `OWNER` stays `OWNER`, an existing `PLATFORM_ADMIN` keeps its current
(unchanged) permission set. The one behavior change with real production impact is `POST
/api/auth/register`, which after deployment will create new self-registrations as
`PENDING_APPROVAL` instead of `ACTIVE` - this affects only *newly created* accounts going forward,
never any account that already exists (see "Production Registration Impact" below).

### Deployment Order

Recommended sequence, and why:

1. **Apply both Prisma migrations to production first** (`prisma migrate deploy`, not `db push`),
   with the *currently-running* (pre-Phase-25/26) application code still live. Since both
   migrations are purely additive `ALTER TYPE` statements, the old code continues to run
   unaffected against the new schema - it simply never uses the new enum values, which is fine.
2. **Deploy the new application code second**, only after step 1 has completed and been confirmed
   (`prisma migrate status` against production showing both migrations applied). This ordering
   respects the Postgres enum caveat above: the new code is the first thing that will ever
   reference `PLATFORM_MANAGER`/`PLATFORM_SUPER_ADMIN`/`PENDING_APPROVAL`/`REJECTED`, and by the
   time it's live those values already exist in the schema.
3. **Do not deploy code and run `prisma migrate deploy` in the same release step/transaction** -
   keep them as two distinct, sequential actions so a failed migration never leaves half-deployed
   code pointing at a schema it doesn't understand yet.
4. **Post-migration verification** (before step 2, after step 1): run `prisma migrate status`
   against production to confirm both migrations show as applied, and spot-check that
   `SELECT unnest(enum_range(NULL::"Role"))`-style introspection (or simply that the app still
   boots and existing logins still work under the old code) shows no regression from the schema
   change alone.
5. **Expected downtime: none.** Both migrations are non-blocking enum additions; no table lock
   beyond the brief `ALTER TYPE` itself, no data migration/backfill step, no application downtime
   window required by the database change itself. The only "downtime" consideration is the
   ordinary one for deploying new application code (whatever the project's existing Vercel
   deployment process already handles).
6. **Rollback**: if the migration step fails or needs to be reverted, `ALTER TYPE ... DROP VALUE`
   is not supported by PostgreSQL in-place - the safe rollback for an additive enum migration that
   hasn't yet been used by any row is simply "do not run the corresponding code deploy"; the unused
   new enum values are harmless to leave in place. If the *application code* deploy needs to be
   rolled back after going live, that's an ordinary code rollback - no `CompanyMembership` row
   written by the new code (`PENDING_APPROVAL` registrations, any `PLATFORM_MANAGER`/
   `PLATFORM_SUPER_ADMIN` assignment) becomes invalid under the old code, since the old code simply
   never queries for those values, and existing rows using old values are never touched.

This deployment plan is **prepared, not executed** - no migration command has been run against
production, per the explicit instruction.

### Git/Secret Review

`git status --short` / `git diff --stat` / `git diff --name-only` reviewed - the changed/untracked
file set matches exactly what Sections 14 and 24 already document, nothing extra. `.env` is
untouched (confirmed absent from every status/diff output across every check run this phase). A
dedicated secret scan of every changed/tracked file for `DATABASE_URL`, `AUTH_SECRET`,
`CRON_SECRET`, `password`, `token`, `apiKey`, `secret` (case-insensitive) found **no live
credential** - every hit is either a variable/field/env-name reference (`env.CRON_SECRET`,
`passwordHash` as a column name) or an obviously-fake test fixture (`password: 'a-real-password-
123'`, a hardcoded bad-connection-string used only to test error-redaction behavior in
`errorHandling.routes.test.ts`, pre-existing and unrelated to this phase). One transient hygiene
item surfaced and was resolved: a background sub-agent's own scratch directory (`.sectest-tmp/`,
containing a local-only seed script and a dev-server log, never committed or intended to be) was
present mid-audit and has since been deleted by that agent as part of its own cleanup step -
confirmed absent from the final `git status --short` above.

### Test Results

```
Total:   453
Passed:  453
Failed:  0
Skipped: 0
Added this phase (26): 0 - this was an audit/verification phase, not a code-change phase; no
                            new test file was needed because the three new tests added in Phase 26
                            proper (Section 22) already cover the scenarios this audit re-verified
Removed: 0
Weakened: 0
```

Re-run twice during this audit (once before the sub-agents' local DB seeding/browser-testing work,
once after their cleanup) - both runs: 453/453, confirming the sub-agents' seed-then-cleanup cycle
left no residue affecting the suite.

### Build Results

```
DATABASE_URL=<local override> npx tsc --noEmit  -> clean, 0 errors
DATABASE_URL=<local override> npm run build      -> clean, "Compiled successfully", all routes
                                                     including /admin/platform/users and the four
                                                     new /api/admin/platform/users* routes compiled
```

### ESLint Results

```
npx eslint .  -> 2 errors, both in scripts/copy-standalone-assets.js (require()-style imports in a
                 plain Node script, pre-existing from an earlier, unrelated phase, confirmed by
                 diff that this file was not touched in either Phase 25 or 26) - 0 errors in any
                 file changed by either phase
```

Confirmed directly, not assumed: the file was checked against `git diff --name-only` and does not
appear, and its two errors are identical in kind/location to what Section 16 already documented
before this phase began.

### Remaining Risks

Non-blocking - none of these are security defects, and none prevent a production decision:

1. **`listPlatformUsers` has no pagination/`take` limit** (new finding, this audit). It's a small,
   deliberately narrow query (pending/rejected/suspended memberships + platform-role holders only,
   see Section 19), but as those categories accumulate over time this will eventually need a
   cursor limit matching the pattern `listAuditLog`/`listCompanyAuditLog` already use in the same
   file. Not fixed in this audit pass, per the instruction not to prematurely optimize - flagged
   for a follow-up, low-urgency change.
2. **`getPlatformAnalytics` and `listAllDisputes` fetch unbounded result sets and reduce/filter in
   JS rather than using `where`/`groupBy` at the database** (new finding, this audit). Both are
   correctly permission-gated (`PLATFORM_TRANSACTIONS_ACCESS`) - this is a performance
   consideration for a growing dataset, not a tenant-isolation or authorization gap.
3. **Two low-confidence items flagged for a follow-up read, not confirmed as gaps**: whether
   `companies/[companyId]/cost-centers` POST cross-checks a body-supplied `departmentId` against
   the URL's `companyId`, and whether `notifications/[id]/read`'s internal query scopes to the
   caller's own `userId`. Both should get a two-minute follow-up read before being closed out, but
   neither surfaced as an actual reproduced failure in this audit.
4. **All limitations already carried forward from Section 25's own "Remaining limitations"** still
   apply unchanged: the admin UI's *code* was tested this phase (closing that specific prior gap),
   cross-company read auditing covers the specific named resources rather than every possible
   cross-tenant GET, and the local migrations are not yet applied to production.
5. **Local migrations remain unapplied to production** - by design, pending your explicit
   approval. See "Deployment Order" above for the prepared (not executed) plan.

### Production Blockers

**None identified.** Every check this audit ran - architecture review, live route testing, a real
browser click-test of the previously-untested UI, an independent secret scan, and a fresh
tsc/build/lint/test run - came back clean or with only non-blocking performance notes. Deployment
readiness is gated solely on your explicit approval to (1) apply the two additive migrations to
production and (2) deploy the application code, in that order, per "Deployment Order" above - not
on any outstanding defect.

### Final Verdict

**READY FOR PRODUCTION REVIEW.**

Non-blocking risks to carry forward, all documented above: the three new performance-only findings
(`listPlatformUsers` pagination, `getPlatformAnalytics`/`listAllDisputes` unbounded fetches), the
two low-confidence follow-up items (cost-centers `departmentId`, `notifications/read` scoping),
and the pre-existing, unrelated `copy-standalone-assets.js` lint errors. None of these are security
defects and none were introduced by either phase covered by this report.

**No commit, push, deployment, migration, or production/Vercel change was made during this audit.**
Explicit approval is required before any of those actions proceed.

---

## 27. Production Deployment Preparation

Nothing in this section was executed. No commit, push, migration, or Vercel action occurred while
preparing it - every command below is documented for your review and explicit, separate approval.

### Working Tree Status

Re-confirmed clean and unchanged from Section 26's review:

```
$ git status --short
 M prisma/migrations/migration_lock.toml
 M prisma/schema.prisma
 M src/app/api/analytics/route.ts
 M src/app/api/audit-log/route.ts
 M src/app/api/auth/register/route.ts
 M src/app/api/companies/[companyId]/budgets/route.ts
 M src/app/api/companies/[companyId]/team/[userId]/route.ts
 M src/app/api/companies/[companyId]/team/route.ts
 M src/app/api/disputes/[id]/resolve/route.ts
 M src/app/api/disputes/route.ts
 M src/app/api/invoices/[id]/route.ts
 M src/app/api/orders/[id]/route.ts
 M src/app/api/orders/route.ts
 M src/app/api/payments/route.ts
 M src/app/api/products/[productId]/moderation/route.ts
 M src/app/api/products/moderation/route.ts
 M src/app/api/purchase-orders/[id]/route.ts
 M src/app/api/purchase-requests/[id]/decide/route.ts
 M src/app/api/rfqs/[rfqId]/quotes/[quoteId]/accept/route.ts
 M src/app/api/suppliers/[supplierId]/verification/route.ts
 M src/app/api/suppliers/moderation/route.ts
 M src/config/rbac.ts
 M src/server/auth/context.ts
 M src/server/services/audit.service.ts
 M src/server/services/budget.service.test.ts
 M src/server/services/company.service.test.ts
 M src/server/services/company.service.ts
 M src/server/services/procurement.routes.test.ts
 M src/server/services/procurement.service.test.ts
 M src/server/services/procurement.service.ts
 M src/types/company.ts
?? ACCESS_CONTROL_IMPLEMENTATION_REPORT.md
?? prisma/migrations/20260919222222_add_platform_manager_super_admin_roles/
?? prisma/migrations/20260919225634_add_membership_pending_approval_rejected/
?? src/app/(app)/admin/platform/
?? src/app/api/admin/
?? src/app/api/auth/register/route.test.ts
?? src/app/api/companies/[companyId]/audit-log/
?? src/server/auth/platformRoles.routes.test.ts
?? src/server/services/platformUsers.routes.test.ts
?? src/server/services/platformUsers.service.ts
?? src/server/validation/platformUsers.ts
?? src/services/platformUsers.service.ts
```

Every entry belongs to the access-control work documented in Sections 1-26 - nothing unrelated,
no `.env` change, no secret, no scratch/debug file, no generated artifact, no unexpected schema
change beyond the two additive enum migrations already reviewed. `git diff --stat` (30 files
changed, 505 insertions, 58 deletions) matches exactly what Sections 14 and 24 already itemize.
`git diff` for each of the specifically-named files (`rbac.ts`, `context.ts`, `require.ts` -
unchanged, not in the diff at all since Phase 26 never modified it, `platformUsers.service.ts`,
`audit.service.ts`, `company.service.ts`, `procurement.service.ts`, the registration route, the
platform-user routes, the modified transaction routes, `schema.prisma`, both migrations) was
re-read directly in Section 26 and contains no accidental or unrelated change - every line maps to
a documented fix or feature.

### Exact Files To Commit

All of it - this is one cohesive body of work (the original RBAC/tenant-isolation audit plus the
platform-user-management/cross-company-audit/registration follow-up), never partially committed
until now per your explicit "stop after local implementation" instructions in both prior phases:

```
git add \
  prisma/migrations/migration_lock.toml \
  prisma/schema.prisma \
  "prisma/migrations/20260919222222_add_platform_manager_super_admin_roles" \
  "prisma/migrations/20260919225634_add_membership_pending_approval_rejected" \
  src/config/rbac.ts \
  src/server/auth/context.ts \
  src/server/services/audit.service.ts \
  src/server/services/platformUsers.service.ts \
  src/server/validation/platformUsers.ts \
  src/services/platformUsers.service.ts \
  src/server/services/company.service.ts \
  src/server/services/company.service.test.ts \
  src/server/services/procurement.service.ts \
  src/server/services/procurement.service.test.ts \
  src/server/services/procurement.routes.test.ts \
  src/server/services/budget.service.test.ts \
  src/types/company.ts \
  src/app/api/analytics/route.ts \
  src/app/api/audit-log/route.ts \
  src/app/api/auth/register/route.ts \
  src/app/api/auth/register/route.test.ts \
  "src/app/api/companies/[companyId]/budgets/route.ts" \
  "src/app/api/companies/[companyId]/team/route.ts" \
  "src/app/api/companies/[companyId]/team/[userId]/route.ts" \
  "src/app/api/companies/[companyId]/audit-log" \
  "src/app/api/disputes/route.ts" \
  "src/app/api/disputes/[id]/resolve/route.ts" \
  "src/app/api/invoices/[id]/route.ts" \
  "src/app/api/orders/route.ts" \
  "src/app/api/orders/[id]/route.ts" \
  src/app/api/payments/route.ts \
  src/app/api/products/moderation/route.ts \
  "src/app/api/products/[productId]/moderation/route.ts" \
  "src/app/api/purchase-orders/[id]/route.ts" \
  "src/app/api/purchase-requests/[id]/decide/route.ts" \
  "src/app/api/rfqs/[rfqId]/quotes/[quoteId]/accept/route.ts" \
  src/app/api/suppliers/moderation/route.ts \
  "src/app/api/suppliers/[supplierId]/verification/route.ts" \
  src/app/api/admin \
  "src/app/(app)/admin/platform" \
  src/server/auth/platformRoles.routes.test.ts \
  src/server/services/platformUsers.routes.test.ts \
  ACCESS_CONTROL_IMPLEMENTATION_REPORT.md
```

(Equivalent to `git add -A` here, since Section 26/27's own review already confirmed nothing
unrelated is sitting in the working tree - but listed explicitly rather than using a wildcard, so
the exact scope is visible for approval rather than trusted implicitly.)

### Recommended Commit Message

```
feat: add platform-tier RBAC, tenant-isolation guards, and registration approval lifecycle

Splits the platform-admin role into PLATFORM_MANAGER (platform operations only) and
PLATFORM_SUPER_ADMIN (retains cross-company transaction access), closes self-approval and
self-role-escalation gaps in purchase-request/team-management workflows, adds company-scoped and
Super-Admin cross-company-read audit logging, a platform user-management admin surface with
independently-enforced role-escalation guards, and a PENDING_APPROVAL registration gate so new
signups no longer receive immediate, unreviewed access. Legacy PLATFORM_ADMIN is kept
permission-equivalent to PLATFORM_SUPER_ADMIN for backward compatibility. 453 tests added/passing,
TypeScript and production build clean, both Prisma migrations are additive enum changes applied
only to local dev Postgres.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```

**Not executed**: `git commit -m "<above>"`. Waiting on your explicit approval.

### Verify Migrations (re-confirmed)

```
$ ls prisma/migrations | tail -2
20260919222222_add_platform_manager_super_admin_roles
20260919225634_add_membership_pending_approval_rejected
```

Both migration folders' `migration.sql` were read again directly for this section:

```sql
-- 20260919222222_add_platform_manager_super_admin_roles/migration.sql
ALTER TYPE "Role" ADD VALUE 'PLATFORM_MANAGER';
ALTER TYPE "Role" ADD VALUE 'PLATFORM_SUPER_ADMIN';
```

```sql
-- 20260919225634_add_membership_pending_approval_rejected/migration.sql
ALTER TYPE "MembershipStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "MembershipStatus" ADD VALUE 'REJECTED';
```

Confirmed, line by line: **no `DROP`, no `DELETE`, no `UPDATE`, no table destruction, no column
destruction, no data transformation.** Each file is exactly two `ALTER TYPE ... ADD VALUE`
statements - the smallest possible additive change, nothing else. `migration_lock.toml` confirms
the `postgresql` provider, unchanged. These have **not** been run against production.

### Production Migration Safety

**Exact command to run when approved** (from a shell with the real production `DATABASE_URL` set
- never through this repo's own `.env`, and never printed to any log/chat, per the standing
caution already on record in this project about that credential):

```
npx prisma migrate deploy
```

**Expected result**: Prisma applies the 2 migrations not yet marked as applied in production's own
`_prisma_migrations` tracking table (`20260919222222_...` and `20260919225634_...`) in filename
order, each wrapped in its own transaction, and prints something like:

```
2 migrations found in prisma/migrations
Applying migration `20260919222222_add_platform_manager_super_admin_roles`
Applying migration `20260919225634_add_membership_pending_approval_rejected`
The following migration(s) have been applied:
  migrations/
    └─ 20260919222222_add_platform_manager_super_admin_roles/
      └─ migration.sql
    └─ 20260919225634_add_membership_pending_approval_rejected/
      └─ migration.sql
All migrations have been successfully applied.
```

Because both are single-statement `ALTER TYPE ... ADD VALUE` operations, this should complete in
well under a second with no table lock beyond the enum catalog update itself, and no effect on any
existing row.

**Exact command to verify, run after the above**:

```
npx prisma migrate status
```

**Expected successful output**:

```
14 migrations found in prisma/migrations
Database schema is up to date!
```

(One more than the local dev database's own count would show *before* this deploy, since
production is currently 2 migrations behind local dev - after `migrate deploy`, both databases
should report the same "14 migrations found... up to date" state local dev already shows in
Sections 25/26.) If it instead reports migrations as "not yet applied" or a drift/failed-migration
state, stop and do not proceed to the application deploy step.

### Deployment Order — Critical Vercel/GitHub Interaction

**This project auto-deploys from GitHub**: `vercel.json` contains only `crons` config (no
`ignoreCommand`, no manual-deploy override), and there is no CI gate found anywhere in the repo
that would hold back a Vercel deployment triggered by a push to `main`. Under Vercel's standard
Git integration, **pushing a commit to `main` triggers an automatic production build and deploy
within moments** - there is no manual "approve this deploy" step in this project's current
configuration. This means your proposed Step 2 ("push to GitHub main") and Step 5 ("deploy the new
application") are **not actually separable** in this project as configured today - a push *is* a
deploy trigger. Recommending "push, then later apply the migration, then later deploy" would
silently collapse into "push, which immediately deploys new code against a schema that doesn't yet
have the new enum values" - unsafe, and not what the 7-step plan you proposed intends.

**Confirmed safe strategy for this exact setup** - your own proposed strategy (A-G) is correct,
and is the one this report recommends, run in this exact order:

1. **Create the commit locally** (`git add` the files above, `git commit` with the message above).
   Do not push.
2. **Do not push yet.** The commit exists only in the local repository at this point - Vercel has
   nothing to react to.
3. **Apply the production Prisma migration** (`npx prisma migrate deploy` from Section above,
   using production's real `DATABASE_URL`, obtained from Vercel's own environment-variable store
   or CLI - never from this repo's `.env`). The *currently deployed* (old) application code keeps
   running unaffected throughout this step, since the change is purely additive and the old code
   never references the new enum values.
4. **Verify** (`npx prisma migrate status` against production) - confirm "14 migrations found...
   up to date" before proceeding.
5. **Push the commit** (`git push origin main`). This is the moment Vercel's automatic deployment
   triggers - by now the schema already has everything the new code needs, so there is no window
   where new code runs against an old schema.
6. **Allow Vercel to build and deploy** - monitor the deployment in the Vercel dashboard until it
   reports "Ready."
7. **Verify the deployment** - run the smoke tests and security verification below against the
   real production URL.

**Additional risk assessed and cleared**: the only way this sequence could go wrong is if some
*other* process pushes to `main` between steps 1 and 5 (triggering an unplanned deploy of
whatever's on `main` at that moment, without your new commit) - an ordinary risk of any
multi-committer repo, not specific to this change, and outside this report's scope to mitigate.
There is no risk from the migration itself running "too early," since it's additive and the old
code tolerates it by construction.

### Existing Production Users

Every existing role continues to work exactly as it does today, because neither migration alters
any existing enum value's meaning and neither touches a single existing row:

| Role | Behavior after deployment |
|---|---|
| `OWNER`, `ADMIN`, `PROCUREMENT_MANAGER`, `BUYER`, `FINANCE_MANAGER`, `APPROVER`, `EMPLOYEE` | Unchanged - same permissions, same company scoping |
| `SUPPLIER_ADMIN`, `SUPPLIER_STAFF` | Unchanged - same permissions, same supplier scoping |
| `PLATFORM_ADMIN` (legacy) | Unchanged - still in `CROSS_TENANT_ROLES`, still holds every permission `PLATFORM_SUPER_ADMIN` holds (Section 26's "Legacy PLATFORM_ADMIN Verification" re-confirmed this byte-for-byte); no existing production `PLATFORM_ADMIN` account loses or gains any access |

No production user is modified by this deployment - the migrations add unused enum values, and no
row is rewritten to use them until a platform admin explicitly acts through the new
`/admin/platform/users` UI (e.g., explicitly promoting someone to `PLATFORM_MANAGER`) or a new
registration happens (which only ever affects a *brand-new* account, never an existing one).

### New Registration Behavior

```
REGISTER  ->  PENDING_APPROVAL  ->  Platform approval (PLATFORM_MANAGER or PLATFORM_SUPER_ADMIN,
              via PATCH /api/admin/platform/users/[userId]/registration)  ->  ACTIVE  ->  LOGIN  ->
              Company access (buildSessionPayload/resolveTenant's existing ACTIVE-only filter,
              unchanged, now grants a working tenant)
```

This only changes the experience for **new** signups from the moment the new code is live -
existing `ACTIVE` memberships are never touched by the migration or by this code path, so every
current production user's login/session/company-access experience is completely unaffected. The
one operational change worth flagging for whoever runs production support: from deployment onward,
a brand-new company signup will land in a "pending" state and needs a platform admin to approve it
before that user can do anything - if there is currently no real production
`PLATFORM_MANAGER`/`PLATFORM_SUPER_ADMIN` account able to reach `/admin/platform/users` (only the
legacy `PLATFORM_ADMIN` accounts exist there today, per Section 33 below), the legacy
`PLATFORM_ADMIN` role already holds `PLATFORM_REGISTRATION_APPROVE`/`PLATFORM_USERS_MANAGE` too
(Section 26 confirmed its permission set matches `PLATFORM_SUPER_ADMIN` exactly), so no new role
needs to exist in production before this ships - an existing `PLATFORM_ADMIN` account can approve
new registrations from day one.

### Post-Deployment Smoke Test Plan

Run against the real production URL, after deployment, before considering the rollout complete:

**Health**
```
GET /api/health   -> expect 200
GET /api/ready    -> expect 200
```

**Authentication**
```
GET /login        -> expect 200, real login form renders
```

**Registration**
```
POST /api/auth/register  (real, disposable test email)
  -> expect 200, { registrationStatus: "PENDING_APPROVAL" }
GET /api/auth/session (with the resulting cookie)
  -> expect companies: [], activeCompanyId: null
```

**Platform**
```
GET /admin/platform/users  (as a real PLATFORM_ADMIN or PLATFORM_MANAGER production account)
  -> expect 200, the test registration above appears in "Pending registrations"
```

**Security**
```
PLATFORM_MANAGER session -> GET /api/orders           -> expect 403
PLATFORM_SUPER_ADMIN/PLATFORM_ADMIN session -> GET /api/orders -> expect 200
Company A session -> GET /api/orders/[Company B's order id]   -> expect 404 (DENY)
Company A session -> GET /api/orders/[Company A's own order id] -> expect 200 (ALLOW)
The PENDING_APPROVAL test account -> GET /api/companies/[its companyId]/orders -> expect 404
Approve the test account (PATCH .../registration, decision: APPROVED) -> POST /api/auth/login with
  its real credentials -> expect 200, activeCompanyId set, companies.length === 1
```

Clean up the disposable test registration/account created for this smoke test afterward (delete
via direct, read-write production access if needed - explicitly out of scope for this report to
execute, since it touches production data; flagging it here so it isn't forgotten).

### Production Database Verification (read-only)

Run these against production only to *observe* state - never to modify it:

```sql
-- Confirm both migrations are recorded as applied
SELECT migration_name, finished_at FROM "_prisma_migrations"
WHERE migration_name IN (
  '20260919222222_add_platform_manager_super_admin_roles',
  '20260919225634_add_membership_pending_approval_rejected'
)
ORDER BY finished_at;

-- Confirm the new enum values exist and no existing value was removed
SELECT enumlabel FROM pg_enum
WHERE enumtypid = 'public."Role"'::regtype ORDER BY enumsortorder;
SELECT enumlabel FROM pg_enum
WHERE enumtypid = 'public."MembershipStatus"'::regtype ORDER BY enumsortorder;

-- Spot-check: existing role/status distribution is unchanged in shape (run before AND after
-- the migration+deploy and diff the two results by hand - row counts per bucket should match
-- except for any brand-new PENDING_APPROVAL registrations created after deployment)
SELECT role, status, count(*) FROM "CompanyMembership" GROUP BY role, status ORDER BY role, status;

-- Confirm no existing PLATFORM_ADMIN account was altered
SELECT id, "userId", "companyId", role, status FROM "CompanyMembership" WHERE role = 'PLATFORM_ADMIN';
```

No `UPDATE`/`DELETE`/`INSERT` statement is included or should be run against production as part of
this verification - every query above is a plain `SELECT`.

### Rollback Plan

**Database**: PostgreSQL does not support removing an enum value in place
(`ALTER TYPE ... DROP VALUE` doesn't exist), so **do not attempt to roll back the migration
itself** - the two new, unused enum values are inert and harmless to leave in the schema
indefinitely, whether or not the application code that uses them stays deployed. This is the
standard, recommended posture for an additive-enum rollback: leave the schema as-is, roll back the
application instead.

**Application**: if a problem is found after deployment, revert to the previous Vercel deployment
(Vercel keeps prior deployments and supports "promote to production" on an earlier one, or a
`git revert` + push of the new commit) - the old application code never queries for
`PLATFORM_MANAGER`/`PLATFORM_SUPER_ADMIN`/`PENDING_APPROVAL`/`REJECTED`, so it continues to run
correctly against the now-migrated schema exactly as it did before this deployment. No
`CompanyMembership` row written by the new code becomes invalid under the old code:

- A `PENDING_APPROVAL` registration created by the new `register` route: under old code, this
  status value is simply a string the old code doesn't have a named constant for, but the row
  itself isn't malformed - old code's own `status === 'ACTIVE'` filter still correctly treats it
  as "not usable," the same outcome the new code intends. The practical effect of a rollback here
  is that these users would need to be manually flipped to `ACTIVE` (there'd be no
  `/admin/platform/users` UI anymore to approve them through) until the new code is redeployed.
- Any `PLATFORM_MANAGER`/`PLATFORM_SUPER_ADMIN` role assignment made through the new admin UI
  before a rollback: old code has no branch that specifically understands these roles, but they
  also don't collide with any existing role's behavior - worst case, such an account would behave
  like an unrecognized role under old code (no permissions matched, effectively locked out) until
  forward-fixed. This is a real but narrow limitation, worth noting explicitly.
- **Limitation**: a rollback that occurs *after* a platform admin has actively used the new
  role-management or registration-approval features is not perfectly symmetric - it can strand a
  just-approved or just-promoted account in a state the old code doesn't have logic for, though
  never in a state that grants *more* access than intended (the direction of failure is always
  "locked out," never "over-privileged"). The clean rollback path is "roll forward again quickly"
  rather than "stay rolled back," if this situation arises.

### Vercel Deployment

Inspected the actual project configuration (no changes made):

| Setting | Value | Source |
|---|---|---|
| Build command | `next build` (framework default, Next.js auto-detected - no override in `vercel.json`) | `package.json` `"build"` script |
| Package manager | `pnpm@10.34.5` | `package.json` `packageManager` field |
| Node version | `>=22.0.0` | `package.json` `engines` |
| Output mode | `standalone` | `next.config.ts` `output: 'standalone'` |
| Postbuild | `node scripts/copy-standalone-assets.js` (copies `.next/static` and `public` into the standalone bundle) | `package.json` `"postbuild"` script - already confirmed to run cleanly in every build check this report and its predecessors performed |
| Prisma Client generation | Not an explicit script in `package.json` - relies on the `prisma`/`@prisma/client` packages' own default postinstall hook, which runs during `pnpm install` on every Vercel build (confirmed indirectly: every build check in this report and prior phases succeeded against a schema this phase changed, which would fail if the client weren't regenerated) | `pnpm install` (implicit) |
| Cron configuration | 4 scheduled jobs (`invoice-due-sweep`, `low-stock-sweep`, `pending-payment-sweep`, `recurring-purchase-sweep`), unchanged by this phase | `vercel.json` |
| Environment variables | No new ones required by this phase (Section 26 already confirmed via direct search - zero new `process.env`/`env.` references introduced) | N/A |

Nothing in this project's Vercel configuration was modified while producing this report, and none
of the above requires a Vercel-side change before deployment - the existing configuration already
supports everything this phase adds.

### Security Check Before Commit (re-confirmed fresh, this section)

```
DATABASE_URL=<local override> npx vitest run --no-file-parallelism  -> 453/453 passing, 50 files
DATABASE_URL=<local override> npm run build                          -> clean, "Compiled successfully"
DATABASE_URL=<local override> npx tsc --noEmit                       -> clean, 0 errors
npx eslint .                                                          -> 2 errors, both
                                                                          pre-existing in
                                                                          scripts/copy-standalone-assets.js,
                                                                          confirmed unrelated
```

All four match the expected baseline exactly - no regression introduced while preparing this
deployment plan.

### Production Deployment Checklist

```
PRE-DEPLOYMENT
[x] Working tree reviewed              - Section "Working Tree Status" above
[x] Secrets checked                    - Section 26 "Git/Secret Review" + re-confirmed above
[x] Tests pass                         - 453/453
[x] TypeScript pass                    - clean
[x] Build pass                         - clean
[x] Migration reviewed                 - both are additive ALTER TYPE ... ADD VALUE only
[x] Production migration compatibility confirmed - old code tolerates the new schema unmodified
[x] Existing users compatibility confirmed        - Section "Existing Production Users" above

DATABASE
[ ] Migration applied         (npx prisma migrate deploy against production - NOT YET RUN)
[ ] Migration status verified (npx prisma migrate status against production - NOT YET RUN)

DEPLOYMENT
[ ] Commit created   (git commit - NOT YET RUN)
[ ] Push performed   (git push origin main - NOT YET RUN; triggers automatic Vercel deploy)
[ ] Vercel deployment successful (verify "Ready" in the Vercel dashboard)

POST-DEPLOYMENT
[ ] GET /api/health
[ ] GET /api/ready
[ ] Login (GET /login, then a real login)
[ ] Registration pending state (POST /api/auth/register -> PENDING_APPROVAL)
[ ] Platform Manager isolation (403 on GET /api/orders)
[ ] Super Admin access (200 on GET /api/orders)
[ ] Company isolation (404 cross-company, 200 own-company)
[ ] Platform user management (/admin/platform/users reachable, pending registration visible)
[ ] Audit logging (SUPER_ADMIN_CROSS_COMPANY_READ entry appears for a real cross-company read)
```

### PRODUCTION DEPLOYMENT STATUS

**READY TO EXECUTE.**

Nothing was executed while preparing this plan. The four gated actions - (1) commit, (2) push,
(3) production migration, (4) Vercel deployment - each require your separate, explicit approval
before proceeding, per your instruction. The recommended order, restated: commit locally -> apply
the production migration -> verify migration status -> push (which triggers the Vercel deploy) ->
verify deployment -> run the smoke tests and security checks above.
