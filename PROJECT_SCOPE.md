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
| Testing | Vitest — **32 test files, 220 tests**, run against a real dev Postgres instance (not mocked) |
| Icons | lucide-react |

No ORM-agnostic abstraction, no GraphQL layer, no separate backend service — Next.js's own API routes (`src/app/api/**/route.ts`) are the entire backend, **83 route files** as of this writing.

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
| Procurement | Purchase requests, configurable multi-step approval rules (admin-defined, by spend band/role), purchase orders, spending limits, budgets, purchase templates, recurring/scheduled purchases | — | — |
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
- **Docker**: a multi-stage `Dockerfile` + `output: 'standalone'` exist and were reviewed against the standard Next.js pattern, but **never actually run** — `docker` isn't installed in the development environment this was built in.

## 6. Security posture (what's been specifically checked, not just assumed)

- Tenant isolation is exercised by dedicated tests per domain: "company A can't read/write company B's records," "a supplier can't touch a competitor's product," "an uninvited supplier can't see a competing quote," etc.
- Every role-granting action (adding a team member, changing someone's role) validates the target role belongs to the *target company's own side of the marketplace* server-side — the concern being a buyer-side `USERS_MANAGE` holder using it as a path to grant `SUPPLIER_ADMIN` or even `PLATFORM_ADMIN`.
- Webhook and cron endpoints fail closed while unconfigured, verified with constant-time comparison (no timing side-channel on a guessed secret).
- Production-mode behavior (not just `next dev`) was explicitly verified: secure cookie flags only appear when `NODE_ENV=production`, confirmed via a real `next build && next start` + live cookie inspection.

## 7. Testing

- **220 tests / 32 files**, entirely at the service and API-route boundary against a real Postgres database — no service-layer mocking. Client-side/UI-only components are not unit-tested (this codebase's own convention); those changes are instead verified live against a running instance (see below).
- Every new feature added this session was also **live-verified** against a running production build (`next build` + `NODE_ENV=production next start`) using real HTTP requests and, for UI flows, a real browser session — not just "tests pass."

## 8. Known rough edges worth an outside eye on

- The client-side `catalog.service.ts` still carries a legacy "mirror the server response into a localStorage-backed runtime cache" bridge for a few not-yet-fully-migrated read paths (documented in-file); it's been patched twice this session for real bugs it caused (a cold-cache blank-page regression on 8 pages, fixed by embedding data directly on the session instead of relying on the cache being warm).
- `CompanyMembership.department` is a free-text string, not a foreign key to the real `Department` table — the Team page's department picker now surfaces real department names as options, but nothing enforces they stay in sync if a department is later renamed or removed.
- No soft-delete/undo on most destructive actions (removing a department/cost center/branch is immediate).
- The invoice-pay UI has no client-generated idempotency key of its own (the *server* now refuses a second charge attempt while one is already pending for the same invoice, closing the practical double-charge risk, but the defense is server-side only).

## 9. Suggested angles for the external review

If you're pasting this into ChatGPT (or another model) for a second opinion, the most useful things to ask it to focus on are probably:

1. Does the tenant-isolation model (never trust a client-supplied ID, re-derive everything from the session, generic 404 on mismatch) have any gaps this description doesn't surface?
2. Is the "fail closed while unconfigured" pattern for webhooks/cron actually sufficient, or does it need rate limiting / replay protection on top?
3. Given no file storage exists, is data-URI-in-a-database-column an acceptable long-term choice for avatars, or should it be flagged as tech debt now before more "upload a file" features get built the same way?
4. Any concerns with cookie-based session-per-browser (not per-tab) as a design choice, versus token-based multi-session support?
5. Is the mobile-money payment gateway abstraction (real for MTN, spec-following-but-unverified for the other two, simulated when unconfigured) a reasonable way to ship a payments feature without real merchant credentials, or does it risk shipping something that looks more finished than it is?
