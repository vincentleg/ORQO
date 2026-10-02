# ORQO V2 — Security & Privacy Model (as implemented, Phase 12)

This document describes the controls that **exist in the code today**. Anything not implemented is listed under *Known limitations* or *Deferred production controls*. Status tags:

- **IMPL**: implemented.
- **TESTED**: covered by automated tests that ran.
- **NOT LIVE**: not verified against a live service.
- **DEFERRED**: not built yet.

## 1. Trust boundaries

```
Browser (untrusted) ──HTTPS──► Next.js server (trusted)
  │                               ├─ proxy.ts         (session refresh; a convenience redirect, not a boundary)
  │                               ├─ Server Components / Server Actions / Route Handlers
  │                               │    each re-verifies identity + membership
  │                               ├─ Supabase client acting AS THE USER  ──► PostgreSQL (RLS on every table)
  │                               ├─ Paid providers (OpenRouter, Brave)  ──► only after plan/quota/budget gates
  │                               ├─ Public web fetcher (SSRF-guarded)   ──► official company sites
  │                               └─ Neo4j HTTPS Query API (optional, derived data)
  └─ /demo: in-browser deterministic demo, separate route tree, no account, no production data
```

Web content, model output, browser-supplied ids and form fields are **untrusted input**. They can never change policy, permissions, plan, stage or autonomy.

## 2. Authentication (IMPL, TESTED)

- **Supabase Auth with email and password.** Identity is verified server-side with `auth.getUser()` (a round-trip to the Auth server), never read from the unverified cookie payload (`src/lib/server/auth/context.ts`).
- **API clients** may use `Authorization: Bearer <access token>`. The token is verified the same way.
- **Pages:** `requirePageAuth` / `requireWorkspace` redirect to `/login` when signed out. `proxy.ts` only refreshes the cookie and redirects for convenience; if it fails, it fails open, because every page and route re-verifies.
- **Errors are categorized:** `unauthenticated` (401) and `forbidden` (403), with fixed messages. Internal details are logged with a request id and never echoed.
- **Post-login redirects** accept only same-site relative paths (`safeNextPath`):
  - Phase 12 closed a confirmed open-redirect bypass that used control characters (`/%09/evil.example`);
  - **TESTED** at unit level and by a local production-server smoke test.
- **No fallback:** an authentication failure never falls back to the demo or to another workspace.

## 3. Organizations, membership and roles (IMPL, TESTED unit; NOT LIVE for RLS)

- **Roles:** `viewer < member < admin < owner`. The active workspace comes from a cookie that is a **preference only**: membership is re-checked on every request.
- **Every server action and API route** authenticates, then calls `requireMembership(db, user, orgId, minRole)` before touching organization data.
- **Static inventory test (Phase 12)** in `src/lib/server/hardening.test.ts`. It fails if:
  - a v1 route handler lacks `requireAuth`;
  - a mutating route lacks the CSRF guard;
  - a server action reaches organization data without auth and membership.
- **Repositories** filter `organization_id` on every query. A Phase 12 scan of all `.from()` calls found the only exceptions to be user-scoped tables (memberships, profiles) and inserts whose rows carry `organization_id`.
- **RLS:**
  - enabled on **all 28 tables**;
  - helper functions are `SECURITY DEFINER` with an empty `search_path`;
  - child tables reference parents through `(organization_id, id)` composite foreign keys, so a row can never point at another organization's row;
  - missing rows and RLS denials are indistinguishable to callers (no enumeration).
- **NOT LIVE:** the live RLS / tenant-isolation suites (`tests/db/rls-isolation.test.ts`, `tests/http/*`) exist but were not run in Phase 12. They are destructive and the only configured project holds real data (see §12).

## 4. Server / client boundary and secrets (IMPL, TESTED)

- **Browser-exposed variables:** only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (designed to be public; RLS protects data). This is tested.
- **No privileged credential at runtime:** the app never reads `SUPABASE_SECRET_KEY` or `SUPABASE_DB_URL`. Only tests and operator scripts do (tested by static scan).
- **Server-only provider credentials:** `OPENROUTER_API_KEY`, `BRAVE_API_KEY` and `NEO4J_*`. They are read only through `serverConfig()` / the graph config, and `publicStatus` exposes booleans only.
- **`.env*` files are git-ignored** except `.env.example` (placeholders).
- **Errors and logs never print provider bodies or secrets:**
  - OpenRouter errors carry the HTTP status only (Phase 12);
  - Neo4j errors are reduced to safe categories (Phase 10);
  - log lines go through `errorSummary()` redaction (Phase 12).

## 5. CSRF and web application basics (IMPL, TESTED)

**State-changing JSON routes** call `assertSameOriginJson`: they require `application/json` and refuse a foreign `Origin`.

- Phase 12 added it to the four routes that lacked it: `POST /api/v1/organizations`, `PATCH /api/v1/me`, `POST …/companies` and `POST …/relationships/:id/evaluate`.
- Server Actions use Next.js's built-in origin check.
- Supabase cookies are `SameSite=Lax`.

**Headers** (`next.config.ts`, every route):

- `X-Frame-Options: DENY`;
- `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- `Permissions-Policy` (camera, mic, geolocation, payment and usb off);
- `Cross-Origin-Opener-Policy: same-origin`;
- `X-Powered-By` removed.

**DEFERRED:** a script/style CSP with nonces, and HSTS. Both need deployment configuration (Phase 13).

**Phase 13 updates (IMPL, TESTED locally):**

- **Report-only CSP:** a full `Content-Security-Policy-Report-Only` policy (`default-src 'self'`, `connect-src 'self'`, …). It found 0 violations across `/`, `/login`, `/signup` and the `/demo` pages, and reports go to `/api/csp-report`, sanitized to the directive and blocked origin and rate-capped. It is **not enforced** yet.
- **Secure cookies:** application and Supabase session cookies are `Secure` on HTTPS production deployments (`src/lib/server/site.ts`).
- **Canonical origin:** the sign-up confirmation link uses `ORQO_SITE_URL`, never request headers.
- **HSTS:** expected from the hosting platform (Vercel). It must be verified after deployment and is **NOT VERIFIED** yet.

## 6. Public vs private data

| Class | Examples | Where it may appear |
|---|---|---|
| **Public evidence** | Claims extracted from official/independent pages (statement, short excerpt, source URL, authority, FACT/INFERENCE/…) | Search analysis, Phase 11 "Evidence", graph (references only, no excerpts) |
| **Workspace profile** | Own offerings, segments, geographies, goals | Search reasoning, Phase 11 "your profile" evidence |
| **Private relationship memory** | Contacts (email, phone, profile URL, notes), interactions (summary, outcome), follow-up descriptions, event prep notes and "why" | The Network/Events screens of that workspace **only** |
| **Minimized relationship context** | Stage, counts, last interaction day, primary contact **name**, event name/status | Phase 11 "Relationship · private context", graph company attributes (no names of contacts) |
| **Audit** | Action, actor id, target id, **changed column names** (never values), role changes | `audit_events`, read-only for members |

**Never read into derived or agent outputs:** contact channels, notes, interaction bodies, follow-up descriptions, event preparation notes and the "why" text. This holds for:

- the graph projection (column-level exclusion, tested);
- Phase 11 briefs (tested);
- the agent read seams `read_relationship_context` and `read_event_context` (tested; the Phase 12 evaluation E10 runs the real repository function over private rows).

## 7. Agents (IMPL, TESTED)

**Authority chain** (`src/lib/server/agents/gate.ts`):

1. user;
2. membership and role;
3. **authoritative plan** (`getEntitledPlan`, always Free until billing exists) or the operator preview list;
4. agent entitlement;
5. mission contract and autonomy;
6. atomic quota, idempotency and concurrency (`create_agent_mission` RPC);
7. per-call tool permission, approval and budget (orchestrator).

**Other agent rules:**

- **Locked agents stay locked:** coming-soon agents are not executable on any plan, and a *prepared* permission (e.g. `read_opportunity_graph`) is not a granted tool.
- **No outward-facing tools exist:** no tool can send email or messages, book meetings, or create/qualify opportunities. Unknown tools are refused (`tool_not_registered`, tested).
- **Hard limits per run:** tool calls, duration and research calls (`AgentBudget`). Failure isolation: a failed run is recorded as failed, never as a fabricated result.

## 8. Providers and cost gates (IMPL, TESTED; NOT LIVE)

**Research gate** (`src/lib/server/research/policy.ts`):

1. membership (member+);
2. entitlement;
3. provider configured;
4. **atomic quota + concurrency** RPC;
5. `RunBudget` (queries, pages, model calls, deadline; **no retries**);
6. usage ledger.

The gate covers both modes:

- **Basic** (Free): official website only, no paid provider reachable.
- **Deep**: Pro or the operator preview list.

**Other cost controls:**

- **Legacy demo routes** (`/api/discover`, `/api/research`) are off unless `ORQO_DEMO_LIVE_PROVIDERS=on`. Authentication and that switch both precede any provider call (static test).
- **Kill switch (Phase 12):** `ORQO_PROVIDERS_KILL_SWITCH=on` makes OpenRouter and Brave read as unconfigured, so every gate fails closed through its normal path (tested). `ORQO_LIVE_AI=off` still disables OpenRouter alone.
- **Timeouts:** OpenRouter 45 s (or the caller's), Brave per call, page fetches capped. No automatic retries.
- **Live status:** no paid provider is configured in this environment. No live provider call was made in Phase 12.

## 9. Web research / SSRF (IMPL, TESTED)

**Request shape:**

- http(s) only;
- no credentials;
- default ports only;
- no IP literals;
- no internal or special-use names.

**Resolution and responses:**

- Every resolved address must be public unicast. Loopback, private, link-local/metadata, CGNAT, multicast, reserved, ULA, IPv4-mapped/NAT64 and (Phase 12) 6to4-wrapped private and Teredo addresses are all refused.
- Redirects are followed manually, and each hop is re-validated.
- Sizes, content types and timeouts are capped. robots.txt is respected.

**Residual risk:** DNS rebinding between the check and the connection (documented; a pinned-address transport is future work).

## 10. Opportunity Graph (IMPL, TESTED; Neo4j NOT LIVE)

- **Derived only:** PostgreSQL stays canonical, and Neo4j holds a per-organization projection that can be rebuilt from PostgreSQL.
- **Queries:**
  - every Cypher statement is a constant with parameters, matched on `organizationId`;
  - interpolated tokens come from closed maps only;
  - reads are bounded (depth, nodes and rows) and time out after 4 s.
- **Rebuild:**
  - admin only, throttled;
  - the marker is written last, so an interrupted rebuild reads as stale;
  - Phase 12 records each rebuild attempt as an operation event, and a denied caller's requested org id is not recorded.
- **Degradation:** unconfigured or unavailable Neo4j shows a truthful status and a preview computed from PostgreSQL. Other pages are unaffected.

## 11. Audit and observability

**Audit (IMPL):**

- `audit_events` is written by triggers on business tables and agent tables.
- Authenticated users get `SELECT` only, so it is append-only and immutable for users.
- Metadata holds changed **column names**, not values, plus role transitions.

**Observability (IMPL, Phase 12):** `src/lib/server/observability.ts` emits whitelisted operation events (operation, outcome, duration, provider, model, sanitized category, ids, usage) for:

- OpenRouter calls;
- Brave calls;
- graph rebuilds.

Free text is redacted (secrets, tokens, emails, phones, URL queries) and capped. A failing sink never breaks an operation. Agent runs keep their DB run history (steps, tool calls, usage) as the system of record.

**Not built:**

- **DEFERRED:** an external tracing/metrics backend, alerting and dashboards (Phase 13).
- **Not audited in the database:** graph rebuilds (no DB write path) and the settings that affect execution (environment variables). Both are operator-level.

## 12. Known limitations

**Not verified:**

- **Live tenant isolation / RLS:** not verified in Phase 12 (no isolated destructive-test project). Statically and unit verified only.
- **Live providers and Neo4j:** never live-tested.

**Missing controls:**

- **No per-user quotas:** quotas are per organization (atomic). There is no organization-level spend budget in currency, only run counts and per-run hard limits.
- **Graph runtime state:** throttle and last-error state are in process memory only.
- **Data rights:** no data export or deletion tooling for end users, and no retention policy enforcement (see the Recovery runbook and the Phase 12 report).
- **Session lifetime and MFA:** these are Supabase project settings, not verified here.

## 13. Deferred production controls (Phase 13)

- **Browser hardening:** HSTS, and a nonce-based script/style CSP.
- **Infrastructure security:**
  - managed backups/PITR verification;
  - secret rotation procedure;
  - WAF/rate limiting at the edge;
  - an auth rate-limit review on the Supabase project.
- **Monitoring:** production log/trace sink, alerting on `[orqo:op]` failures and provider spend.
- **Isolated test project:** create one and run the DB/HTTP/E2E suites (RLS, tenancy, agents, research) against it.
- **GDPR operations:** DPA/processor list, retention schedule, export and deletion flows.
