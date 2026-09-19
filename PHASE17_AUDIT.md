# Phase 17 Audit — Production Security & Scalability Validation

Performed before any implementation, per the phase brief's Step 0. Every finding below was checked directly against the repository and a live database connection at the time of writing (2026-09-16, continuing the same session as Phase 16 — the working tree still carries Phase 16's uncommitted changes; `git log` confirms `adc92d9` "Phase 15: ..." is still `HEAD`, and Phase 16's report/audit files are present but uncommitted).

Baseline confirmed live: `npx vitest run --no-file-parallelism` → **41 files / 326 tests / 326 passed / 0 failed**, matching the brief's stated baseline exactly.

## Finding 1 — No `middleware.ts`; Next.js 16 renamed it to `proxy.ts`, and one already exists

- **Evidence**: `src/proxy.ts` exists (not `middleware.ts` — Next 16 deprecated that file name; confirmed via `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`, line 11: "The `middleware` file convention is deprecated and has been renamed to `proxy`"). The existing `proxy.ts` generates a per-request `x-request-id`/`X-Request-Id` and is scoped via `matcher: '/api/:path*'` — it currently never runs on page (HTML) requests at all.
- **Risk**: A CSP nonce must be generated per request and attached to the HTML response the browser renders — this can only happen in `proxy.ts` (or a Server Component that reads per-request context). The existing proxy doesn't touch page routes, so no nonce infrastructure exists today.
- **Affected files**: `src/proxy.ts`, `next.config.ts` (current static `Content-Security-Policy-Report-Only` header, which cannot carry a per-request value).
- **Recommended action**: Extend `proxy.ts`'s matcher to also cover page routes, generate a nonce there, forward it via a request header, and move CSP header generation into the proxy (per-request) instead of `next.config.ts`'s static `headers()` (build-time, same value on every response).
- **Phase 17 scope**: Yes — this is section 4's primary task.

## Finding 2 — Nonce-based CSP requires every matched page to render dynamically; this app currently prerenders ~20 pages as static

- **Evidence**: Fresh `npm run build` output shows `○ /dashboard`, `○ /orders`, `○ /budgets`, `○ /catalog`, `○ /purchase-requests`, `○ /notifications`, `○ /team`, `○ /login`, `○ /register`, and 12 more marked `○ (Static) prerendered as static content`. Per Next's own CSP guide (`content-security-policy.md`, "Static vs Dynamic Rendering with CSP"): "When you use nonces in your CSP, **all pages must be dynamically rendered**... Static optimization and Incremental Static Regeneration (ISR) are disabled... No CDN caching... Higher hosting costs." The root layout (`src/app/layout.tsx`) reads no per-request API today (no `headers()`/`cookies()` call) — this app's entire "logged-in" experience is a static HTML shell that fetches everything client-side via `AuthProvider`/`useAsyncData`, which is *why* so many authenticated pages are static today.
- **Risk**: Naively broadening the proxy matcher to all pages and reading `headers()` in the root layout to get the nonce would force every one of those ~20 pages into per-request SSR — a real, non-trivial performance/hosting-cost trade-off for the whole app, not just a config toggle.
- **Affected files**: `src/app/layout.tsx`, every page currently marked `○`.
- **Recommended action**: Implement the nonce plumbing, then **measure** the actual before/after render behavior live (not assume) before deciding whether to accept the dynamic-rendering trade-off site-wide or keep Report-Only. This is exactly the brief's own instruction: "If safe nonce propagation cannot be achieved... document why" — the honest path is to build it, verify it, and report the real trade-off rather than assume it's fine or assume it's a blocker.
- **Phase 17 scope**: Yes — directly addressed in the CSP section below with live evidence.

## Finding 3 — No historical CSP reports exist to classify

- **Evidence**: `/api/csp-report` (added in Phase 16) only logs via the structured `logger` to stdout — no persistent store. No long-running server process has been kept alive since Phase 16 to accumulate real browser traffic against it.
- **Risk**: None — this is expected for a dev-only environment with no real traffic.
- **Recommended action**: Per section 4.1's own instruction, proceed from direct application inspection (what inline scripts actually exist) rather than inventing violation data.
- **Phase 17 scope**: Yes, informationally — documented, not fabricated.

## Finding 4 — The admin Audit Log page reads a `localStorage`/demo-data mock, never the real, already-populated `AuditLog` table

- **Evidence**: `src/app/(app)/admin/audit/page.tsx` calls `auditLogService.listEntries()` from `src/services/audit-log.service.ts` — a `MockAuditLogService` that returns `[...demoAuditEntries, ...readCreated()]` where `readCreated()` reads `window.localStorage`. Meanwhile `src/server/services/audit.service.ts#recordAudit` writes real rows to the `AuditLog` Postgres table, and a live count shows **920 real rows already present** (`db.auditLog.count()` → 920). No API route anywhere exposes `db.auditLog.findMany` (`grep -rln "auditLog" src/app/api` → no matches).
- **Risk**: This is a real correctness/visibility bug, not just a missing pagination feature — platform admins looking at "Audit log" today see fabricated demo data plus whatever they've personally appended to their own browser's `localStorage`, never the real audit trail the rest of the system has been faithfully recording since at least Phase 6. It also means every real audit event this session's own testing has generated (920 and counting) is currently invisible in the UI.
- **Affected files**: `src/services/audit-log.service.ts`, `src/app/(app)/admin/audit/page.tsx`, `src/server/services/audit.service.ts` (needs a `listAuditLog` function), needs a new route.
- **Recommended action**: Wire a real, platform-admin-only, cursor-paginated `GET /api/audit-log` backed by the real table (920 rows already qualifies as "high-volume, growing" under section 12's own test), replace the client mock, add pagination security tests.
- **Phase 17 scope**: Yes — this is squarely what section 12 asks to check ("determine whether dedicated list endpoints currently exist... if they already exist and are high-volume, implement appropriate cursor pagination"). The endpoint's *client-visible contract* already exists (the page, the service interface); what's missing is the real backend wiring, which is a prerequisite for pagination, not a new business feature.

## Finding 5 — Negotiation messages are correctly bounded by design; do not paginate

- **Evidence**: `listNegotiationMessages(rfqId, quoteId)` is scoped to a single RFQ+quote pair (one negotiation thread between one buyer and one supplier over one quote), not a global feed. Live count: 4 rows total across the whole database. Structurally this can never grow into a "browse everything" list — it's a chat thread, and the existing UI already fetches "the whole thread" the same way any chat UI would.
- **Risk**: None.
- **Recommended action**: Leave unchanged. Documented as **Category B** (bounded by construction, not by luck).
- **Phase 17 scope**: No action — explicitly the brief's own "do not invent unnecessary endpoints/pagination" case.

## Finding 6 — `listProducts`/`listSuppliers` remain genuinely low-volume; Phase 16's deferral still holds

- **Evidence**: Live counts: **11 products, 5 suppliers** total in the database. Both routes (`GET /api/products`, `GET /api/suppliers`) are public, unauthenticated, filter-driven catalog browses — not per-tenant unbounded growth like orders/purchase-requests.
- **Risk**: Low at current and realistically foreseeable demo-data scale. A real production catalog could eventually need pagination, but nothing in this repository's actual data justifies it today.
- **Recommended action**: Leave unpaginated this phase; re-confirmed with live data rather than assumed from Phase 16's prior (also-verified) conclusion. Documented as **Category B**.
- **Phase 17 scope**: No code change — evidence re-confirmed live per section 11's instruction to re-run the audit, not just cite the old one.

## Finding 7 — Webhook resilience is already solid; no gap found

- **Evidence**: `src/app/api/webhooks/payments/[provider]/route.ts` + `webhook.service.ts#processPaymentWebhook`: HMAC-SHA256 signature verified over raw bytes (`verifyWebhookSignature`), rejects with 401 on missing/invalid signature, rate-limited by IP+provider, and `payload.eventId` is checked against a unique `(provider, providerEventId)` constraint before any state change — the event-id check happens *after* first looking up the real payment by its own reference (documented reason: replay-outside-idempotency-window protection). A recognized-but-already-processed event and an unrecognized reference both return `200` (correct — a real gateway retries on non-2xx, and there's nothing this app can do differently on retry for a payment it never created).
- **Risk**: None found.
- **Recommended action**: Re-verify via the existing test suite and one live duplicate-webhook-delivery check; no code change expected.
- **Phase 17 scope**: Verification only (section 17).

## Finding 8 — Cron authentication is fail-closed and constant-time; no gap found

- **Evidence**: `requireCronSecret` (`src/server/auth/require.ts`) rejects with 401 whenever `CRON_SECRET` is unset (`expected.length > 0` is part of the validity check) or the provided header doesn't match, using `crypto.timingSafeEqual` — same pattern as the webhook secret. `runDueSchedules` (the sweep itself) already has an atomic-claim mechanism confirmed unchanged since Phase 16.
- **Risk**: None found.
- **Recommended action**: Re-verify via existing tests + one live double-invocation check; no code change expected.
- **Phase 17 scope**: Verification only (section 18).

## Finding 9 — Environment variable handling is already correct; no gap found

- **Evidence**: `src/server/env.ts` reads every server env var exactly once, `required()` throws loudly at first access for `DATABASE_URL`/`AUTH_SECRET` (and rejects the literal placeholder `"CHANGE_ME"`), optional secrets (`PAYMENT_WEBHOOK_SIGNING_SECRET`, `CRON_SECRET`, mobile-money credentials) default to empty and the *consuming* route/service fails closed instead. `.env.example` documents every variable with no real secret values committed. No `NEXT_PUBLIC_`-prefixed secret exists (`grep -rn "NEXT_PUBLIC_" .env.example` → none), so nothing server-secret can leak into the client bundle.
- **Risk**: None found.
- **Recommended action**: Produce the classified checklist section 22 asks for (Required/Optional/Dev-only/Prod-only/Secret/Public), as documentation — no code change expected.
- **Phase 17 scope**: Documentation only.

## Finding 10 — Rate limiting: coverage is complete for sensitive mutations; still explicitly single-instance/in-memory

- **Evidence**: Every sensitive mutation route uses either `enforceRateLimit` (procurement writes, payments, webhooks, negotiation, RFQ creation) or the lower-level `checkRateLimit`/`recordAttempt` pair (login, which needs "only count failures" semantics `enforceRateLimit` doesn't support). `src/server/auth/rate-limit.ts` remains a single in-memory `Map`, documented as such in its own top-of-file comment — no instance-coordination exists.
- **Risk**: None new. Still correctly deferred (not yet needed at single-instance scale) — re-confirmed, not re-implemented.
- **Recommended action**: Document the exact migration boundary to a Redis-backed limiter (the four functions `checkRateLimit`/`recordAttempt`/`clearAttempts`/`enforceRateLimit` are the entire surface a swap would need to change) without installing Redis, per the brief's explicit instruction not to install it speculatively.
- **Phase 17 scope**: Documentation + a couple of load-style tests confirming the existing limiter behaves correctly under rapid repeated calls; no architecture change.

## Finding 11 — No load-testing tool is installed; none should be added speculatively

- **Evidence**: `package.json` devDependencies contain no `autocannon`/`k6`/`artillery`. Installing one only to run it once this phase is a new dependency for a single use.
- **Risk**: N/A.
- **Recommended action**: Write a small, disposable Node measurement script (using the platform's own `fetch` + `performance.now()`, no new dependency) that issues real HTTP requests against the real standalone server and records real latency percentiles — not a permanent addition to the repo, not a fabricated number.
- **Phase 17 scope**: Yes — the measurement mechanism for section 5-9.

## Finding 12 — Docker remains unavailable in this environment

- **Evidence**: `which docker` / `docker --version` → command not found. Same as documented in Phase 14/16.
- **Risk**: N/A — cannot be resolved from within this session.
- **Recommended action**: Do not claim Docker was tested. Review the `Dockerfile` against the now-more-mature standalone build process and document remaining risk honestly.
- **Phase 17 scope**: Documentation only (section 21's own explicit fallback path).

## Summary of Phase 17 implementation scope

| Area | Action |
|---|---|
| CSP nonce | Implement, live-verify, decide enforce vs. report-only from real evidence |
| Audit log | Wire real backend + cursor pagination (genuine bug found, in-scope per §12) |
| Products/suppliers pagination | No change — re-confirmed low volume |
| Negotiation messages pagination | No change — correctly bounded by design |
| Performance/load testing | New disposable ~1000-row fixture + measurement script + query plans |
| Webhook/cron/env/rate-limit | Verification + documentation, no architecture change (all already correct) |
| Docker | Documentation only — still unavailable |
| Security regression battery | New consolidated test pass across auth/tenant/input/rate-limit/headers |
