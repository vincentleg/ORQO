# ORQO V2 — Phase 13 Implementation Report: Production Deployment & Readiness

**Status:** Stages A–D complete. Checkpoint A approved. **Stage F complete** (isolated ORQO Test project). **Stopped before the hosting/deployment checkpoint** (Stage G). Stages G–K have not started.

Status tags:

| Tag | Meaning |
|---|---|
| **IMPL** | Implemented |
| **LOCAL** | Verified locally |
| **ISOLATED** | Requires the isolated test project |
| **PROD-CONFIG** | Requires production configuration |
| **HUMAN** | Requires human action |
| **DEFERRED** | Not built in this phase |

## 1. Baseline

- `main` = `origin/main` = `50e5603` (Phase 12 merge), clean.
- Branch `phase-13-production-deployment`.
- No external resource was created, no external database was touched, and no provider was called.

## 2. Preflight summary (Stage A)

| Area | Classification | Outcome |
|---|---|---|
| Auth / CSRF / redirects / headers (Phase 12) | READY | Unchanged |
| App-layer tenancy + RLS design | READY | Unchanged |
| Live RLS / DB / HTTP / E2E | NEEDS EXTERNAL SERVICE + HUMAN | Runner built; Checkpoint A |
| Sign-up link built from request `Origin`/`Host` (fallback `http://localhost:3000`) | NEEDS CODE | **Fixed** (`ORQO_SITE_URL`) |
| Cookies without `Secure` | NEEDS CODE | **Fixed** (HTTPS-aware) |
| CSP beyond anti-framing | NEEDS CODE | **Report-only policy added**, not enforced |
| HSTS | NEEDS CONFIGURATION | Provided by Vercel on HTTPS; verify after deploy. Not added in code (redundant) |
| Runtime portability | READY | No Bun-only APIs and no filesystem writes in runtime code |
| Plain Node build | NOT VERIFIABLE LOCALLY | Node.js is not installed here; verify on the first Vercel preview |
| Long routes (`maxDuration` 120–150 s) | NEEDS CONFIGURATION | The hosting plan must allow ≥150 s |
| Observability gaps (denials, agent failures, auth aggregates) | NEEDS CODE | **Fixed** |
| External observability backend | DEFERRED / HUMAN | Not configured |
| Backups / PITR / restore drill | HUMAN | Runbook §8 written; not performed |
| Supabase Auth production settings + custom SMTP | HUMAN | Documented |
| Destructive-test fallback to `.env.local` | NEEDS CODE | **Fixed** (isolated runner) |
| Data export / deletion / retention | DEFERRED (before external customers) | Documented (§9) |
| Indexes | READY | Audited; no gap (§8) |

## 3. Code changes (Stage B)

**1. Canonical site URL** (`src/lib/server/site.ts`, `src/app/actions/auth.ts`) — IMPL, LOCAL.

- `ORQO_SITE_URL` must be an https origin with no path, query or credentials. Loopback http is accepted for a local production build.
- In production a missing or invalid value refuses sign-up with "This is not available on this deployment yet." (new `errors.unavailable`, EN/FR). It never falls back to request headers or localhost.
- In development the fallback is a loopback request origin or `http://localhost:3000`.

**2. Secure cookies** (`site.ts`; `actions/workspace.ts`, `server/i18n.ts`, `supabase/server.ts`, `supabase/proxy.ts`) — IMPL, LOCAL (unit).

- `secureCookies()` is true in production unless the configured site is loopback http.
- When unconfigured in production it is also true (fail safe).
- It applies to the workspace and locale cookies and to the Supabase SSR session cookies (`cookieOptions.secure`). The other Supabase defaults are unchanged.

**3. Report-only CSP** (`next.config.ts`, `src/app/api/csp-report/route.ts`, `src/lib/server/csp-report.ts`) — IMPL, LOCAL.

- **Policy:** `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self'; worker-src 'self' blob:; manifest-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; report-uri /api/csp-report`.
  - Dev only adds `'unsafe-eval'` and the `ws:` HMR socket.
- **Derived from the real frontend:**
  - Next.js inline bootstrap scripts and React style attributes, so `'unsafe-inline'` (no nonces);
  - fonts self-hosted by `next/font`;
  - no direct browser call to Supabase or providers;
  - no third-party scripts, frames or images.
- **Enforcement unchanged:** the enforced anti-framing CSP is as before. The new policy is **report-only**.
- **Report endpoint:** unauthenticated by nature. It keeps only the directive and the blocked **origin** or keyword (never page URL, path, query or sample), caps at 60/min per process and 16 KiB, and always returns 204.
- **`report-to` was tried and removed:** with it, Chromium ignored `report-uri`, and its Reporting API delivery could not be verified. `report-uri` alone was verified end to end (§5).

**4. Isolated test-environment runner** (`scripts/isolated-test.ts`, `tests/support/isolated-env.ts`, `tests/support/env.ts`, `.env.test.example`, `package.json` scripts `test:isolated`, `test:isolated:check`, `.gitignore`) — IMPL, LOCAL (unit + refusal path). See `ISOLATED-TEST-ENVIRONMENT.md` §3 for the full safety list:

- only `.env.test.local`;
- `bun --no-env-file`;
- the existing guard;
- refusal on the real project ref or a reused credential;
- synthetic orgs only;
- explicit blanking of every known variable;
- paid providers forced off;
- the server in a temporary env-less worktree;
- port-in-use refusal;
- no printing.

`bun run test:isolated:check` with no `.env.test.local` refuses (exit 2). **Not run against any database.**

**5. Observability** (`http.ts` `recordDenial`, `agents/http.ts`, research route, `auth/page.ts`, `actions/auth.ts`, `agents/orchestrator.ts`, `observability.ts`) — IMPL, LOCAL.

| Event | Fields |
|---|---|
| `request.refused` | 401/403/429/503 refusals: route label + category, e.g. `unauthenticated`, `plan_required`, `quota_exhausted`, `unavailable`. No ids, user or input |
| `auth.page_redirect` | Signed-out page access, aggregate only |
| `auth.sign_in` | Failure category only (e.g. `invalidCredentials`), never the email |
| `agent.run` | succeeded / failed, run id, agent id, duration, failure code |
| `csp.report_only_violation` | Directive + blocked origin |

- The new whitelisted field is `target` (a constant label or origin).
- `errorCategory` now prefers a denial `reason`.
- The sink is stdout (`[orqo:op]`), which the hosting platform's logs capture. No external backend.

**6. Index audit:** no change (§8).

**Files changed:**

- `.env.example`, `.env.test.example` (new), `.gitignore`, `next.config.ts`, `package.json`;
- `scripts/isolated-test.ts` (new);
- `src/app/actions/{auth,workspace}.ts`;
- `src/app/api/csp-report/route.ts` (new);
- `src/app/api/v1/organizations/[organizationId]/research/route.ts`;
- `src/lib/i18n/messages/{en,fr}.ts`;
- `src/lib/server/{csp-report.ts (new), site.ts (new), http.ts, i18n.ts, observability.ts}`;
- `src/lib/server/agents/{http.ts, orchestrator.ts}`;
- `src/lib/server/auth/page.ts`;
- `src/lib/server/supabase/{server,proxy}.ts`;
- tests: `src/lib/server/production.test.ts` (new), `src/lib/server/hardening.test.ts`, `src/lib/server/agents/orchestrator.test.ts`, `tests/unit/isolated-env.test.ts` (new);
- `tests/support/{env.ts, isolated-env.ts (new)}`;
- docs (§10).

## 4. Proposed items not implemented, and why

- **HSTS in application code:** Vercel already sends HSTS on HTTPS. Adding it would be redundant and would mis-fire on local http production review. Verify after deployment.
- **Nonce-based CSP:** it forces dynamic rendering of every page. No demonstrated blocker requires it, since the report-only policy shows 0 violations without nonces.
- **CSP `report-to` / `Reporting-Endpoints`:** removed, because it suppressed `report-uri` in Chromium and its delivery was not verifiable.
- **New health endpoint:** `/api/status` already serves liveness (booleans only). A DB-probing health check was not justified.
- **New indexes / migration:** none needed (§8).
- **External observability, per-user quotas, pagination, data export/deletion:** deferred (§9, §11).

## 5. Verification (Stage C) — all local; no external database, no provider

| Check | Result |
|---|---|
| `bun test src tests/unit` | **461 pass, 0 fail** (35 files): 448 from Phase 12, plus Phase 13 production tests (8), isolated-env planner (4) and the agent-run observability test (1) |
| `bun run typecheck` | Clean |
| `bun --bun eslint src scripts tests next.config.ts` | Clean |
| `bun run build` (Bun) | Succeeded (includes `/api/csp-report`) |
| Plain Node `next build` | **Not verifiable locally:** Node.js is not installed, and none was installed. Verify on the first Vercel preview |
| Production-server smoke (`next start`, `ORQO_SITE_URL=http://localhost:3001`) | Enforced headers unchanged; `Content-Security-Policy-Report-Only` present; no `'unsafe-eval'` in production; `/api/csp-report` 204 with sanitized logging (query stripped) |
| CSP report-only browser check (headless Chromium, existing Playwright) | **0 violations, 0 console errors** on `/`, `/login`, `/signup`, `/login?next=%2F%09%2Fevil.example`, `/workspace` (→ login), `/demo`, `/demo/network`, `/demo/opportunities`, `/demo/signals`, `/demo/agent`, `/demo/connect/r-maya-lukas`, including clicking demo controls |
| CSP positive control | A deliberately injected external image produced a `report:img-src` violation, delivered via `report-uri` and logged as `img-src` + origin only |
| Safe E2E (demo only, read-only, `BASE_URL=http://localhost:3001`) | `e2e:demo` **passed**, no console errors; `e2e:autodemo` **passed**, no console errors |
| Isolated runner refusal | `bun run test:isolated:check` without `.env.test.local` → REFUSED, exit 2 |

**Not run (by design until Checkpoint A):** `test:db`, `test:http`, `e2e:app`, `e2e:agents`, `e2e:discover`, `e2e:network`. Live Neo4j / OpenRouter / Brave were also not run.

**Authenticated workspace pages under the report-only CSP** were not browser-checked (no test account without the isolated project). That is planned in Stage F via `e2e:app`.

**Side note:** saving `next.config.ts` made the operator's running dev server (port 3000) restart its worker automatically, which is standard Next.js behavior. The dev server parent process was not touched.

## 6. Environment and secrets

See `PRODUCTION-ENVIRONMENT-MATRIX.md`:

- every variable, public vs server, required vs optional, failure behavior, cost and capability;
- `SUPABASE_SECRET_KEY` and `SUPABASE_DB_URL` are never part of the app deployment;
- `ORQO_SITE_URL` was added to `.env.example` (placeholder).

## 7. Provider safety

Re-verified unchanged from Phase 12 (tested):

- OpenRouter/Brave are server-only and are reached only after the research/agent gates (role, entitlement, provider configured, atomic quota/concurrency, per-run budget);
- explicit timeouts, no retries, status-only errors, kill switch.

Neo4j is optional and derived, uses constant parameterized Cypher, is organization-scoped, has 4/15 s timeouts and category errors, and safely degrades to a preview.

**Recommendation:** launch with `ORQO_PROVIDERS_KILL_SWITCH=on` and no provider keys.

## 8. Performance / index audit

Hot queries checked against the migrations' indexes and unique constraints:

- companies by org;
- contacts / interactions / follow-ups / network events by (org, company[, time]);
- signals by (org[, company], first_seen);
- event targets by (org, event | company);
- intelligence by (org, domain | name);
- research runs by (org, mode, started);
- agent runs / steps / tool calls / approvals / usage by (org, run);
- opportunity participants by (org, company);
- audit by (org, time).

**Every pattern is covered.** The apparent duplicate on `contacts` is a partial unique index (one primary contact).

**Remaining, non-blocking:**

- company lists are capped at 1000 with no pagination;
- the company page builds the bounded workspace projection on every view;
- the graph rebuild throttle and last-error state are per instance (serverless). This only matters once Neo4j is configured.

## 9. Data categories and lifecycle

**Categories** (detail in `SECURITY-PRIVACY-MODEL.md` §6):

- public evidence;
- workspace profile;
- private relationship memory (contacts with channels and notes, interactions, follow-ups, event preparation);
- derived records (opportunities, signals, agent runs, usage);
- audit (column names only);
- operational logs (`[orqo:op]`: whitelisted, redacted fields, no business text, so logs do not become a second private-data store).

**Before real external customers (HUMAN / DEFERRED):**

- an account deletion path (today: an operator deletes the Supabase Auth user, and memberships cascade);
- a workspace deletion path (today: the schema cascades `on delete cascade` from `organizations`; no UI and no operator runbook with audit yet);
- export of a workspace's data;
- a retention schedule for `audit_events`, `usage_events`, research evidence and logs;
- a processor list (Supabase, Vercel, optional OpenRouter/Brave/Neo4j) and a DPA.

**Proposal for discussion, not implemented:** an operator-only, audited workspace deletion procedure (SQL runbook) before onboarding external customers.

## 10. Documentation

- **Created:**
  - `PRODUCTION-DEPLOYMENT-RUNBOOK.md` (pre-deploy, deploy, post-deploy, rollback, CSP enforcement);
  - `ISOLATED-TEST-ENVIRONMENT.md` (Checkpoint A);
  - `PRODUCTION-ENVIRONMENT-MATRIX.md`.
- **Updated:**
  - `RECOVERY-RUNBOOK.md` (§8 restore drill, §9 secret compromise, §10 emergency provider stop);
  - `SECURITY-PRIVACY-MODEL.md` (Phase 13 controls).

## 11. Not claimed

The following have **not** occurred:

- live RLS verification;
- verified backups or restore;
- production deployment;
- production HSTS;
- a plain Node build;
- live provider verification;
- external observability;
- CSP enforcement.

## 12. Stage F — isolated verification (ORQO Test)

**Isolated project safety:**

- The ORQO Test project was created by the operator, empty.
- `.env.test.local` was filled through local hidden macOS input dialogs: no value passed through chat or logs, and the file is git-ignored.
- `bun run test:isolated:check` **PASSED** (offline): guard passed, the test project (masked `****xplh`) is distinct from the real project, no reused credential, paid providers forced off.
- Every Stage F command ran through the isolated runner: `.env.test.local` only, `bun --no-env-file`, an env-less temporary worktree for the app server, port 3100.

**Migrations:**

- Initial status: 8 of 8 pending (empty project).
- Applied in order: `20260930120000_phase1_saas_foundation`, `…130000_opportunity_participant_position`, `…140000_revoke_service_role_table_privileges`, `20261001090000_phase3_web_intelligence`, `20261002090000_phase4_agent_infrastructure`, `20261003090000_phase6_network_memory`, `20261004090000_phase7_company_signals`, `20261005090000_phase8_events`.
- Final status: **8 of 8 applied**, re-confirmed read-only at the end.

**Results:**

| Suite | Result |
|---|---|
| `tests/db` (schema, RLS isolation, tenancy, auth, persistence, research, network, signals, events, agents, discover, test-safety) | **183 pass, 0 fail** (12 files) |
| `tests/http` (API, cross-tenant IDOR, research, agents, discover) | **52 pass, 1 skip, 0 fail** (4 files). The skip is the opt-in live OpenRouter block (`ORQO_TEST_LIVE_AI`), forced off by design |
| `e2e:app` | **PASS**, no console errors: redirect, onboarding, six spaces, profile, Search, failure state, **one real Basic analysis of `gigaio.com`** (public pages, no paid provider), evidence, Add to Network, locked agents, Plans, FR, wrong password, signed-out `/demo` |
| `e2e:network` | **PASS** (10 steps) |
| `e2e:discover` | **PASS** (10 steps; providers off, so workspace/Network sources only) |
| `e2e:agents` | **PASS** (13 steps: preview runs, failure, approval wait/reject, FR, Free locked) |

`e2e` and `e2e:autodemo` (demo-only, no database) passed in Stage C. No `e2e:events` script exists; event flows are covered by `tests/db/events.test.ts`.

**Report-only CSP on authenticated pages:** the E2E browser runs fail on any console error, and Chromium reports report-only violations as console errors. All four suites passed, so **no report-only CSP violation occurred on the authenticated workspace pages they visited**.

**Cross-tenant isolation (live, passing tests):**

- **Database / RLS:**
  - "org B cannot read, update or delete org A's agent rows; anon reads nothing";
  - "B cannot attach steps, tool calls or usage to A's runs";
  - "B can neither read, add to, nor edit A's contacts";
  - "B sees none of A's interactions, follow-ups or history, and cannot change them";
  - "a row in Organization A cannot reference Organization B's company (composite foreign key)";
  - "evidence in Organization A cannot cite Organization B's source";
  - "Organization A has rows in every tenant table";
  - "every table in the public schema has RLS enabled" (now actually asserted, see below);
  - "anon and service_role hold no privileges on any public table".
- **Server / API (consistent with RLS):**
  - "another organization's id in the URL is not proof of access: 404, nothing written";
  - "another organization → 404 (create, list, run detail)";
  - "approval decisions: non-admin 403, other organization 404";
  - "another tenant cannot evaluate the relationship";
  - "a non-member gets the same answer as an unprivileged member: no organization enumeration";
  - "anonymous 401 · other organization 404 · viewer 403 · CSRF refused";
  - CSRF non-JSON → 400, foreign Origin → 403.
- **Fixtures:** synthetic users and organizations only (`[orqo-test:` names, reserved `7e570000-` preview organization). No real business data.

**Failures found and corrected (all TEST or TEST-ENVIRONMENT; no product code changed):**

| # | Where | Class | Cause | Minimal fix |
|---|---|---|---|---|
| 1 | `tests/db/schema.test.ts` RLS test | B test bug | Hand-ordered table list mis-sorted (`company_signals` before `company_needs`). The failing `toEqual` also stopped the RLS-flag assertion from running | Compare sorted sets in JS; the RLS-flag assertion now runs and passes |
| 2 | `tests/db/network.test.ts` contacts | B test bug | Contact edits are full replacements (the edit form always submits every field); the test omitted `email` and expected it to persist | Pass `email` like the UI; assertion unchanged |
| 3 | `scripts/isolated-test.ts` | C runner | Turbopack refuses a `node_modules` symlink pointing outside the project root | APFS copy-on-write clone (`cp -c`), no network. Isolation unchanged |
| 4 | `scripts/e2e-app.ts` Agents heading | B stale (Phase 9) | `<h1>` is now "Your AI business development team" ("Agents" is the eyebrow) | Expected heading updated |
| 5 | `scripts/e2e-app.ts` Network lookup | B stale (Phase 6) | Rows show the company name, not the domain | Network filter `?q=<domain>` (matches website) and **exactly one** row |
| 6 | `scripts/e2e-network.ts` due date | B stale (Phase 7/8) | The empty due-date field is an ORQO button that reveals the native input | Click the control, then fill the native date input |
| 7 | `scripts/e2e-network.ts` next action | B race | The title text was already present before the save | Wait for `data-kind="follow_up"`, then assert |
| 8 | `scripts/e2e-network.ts` add-to-Network | B race / stale | The transient "Added…" message unmounts on revalidation; Search label is now "Already in your Network" | Wait for the durable label; database checks unchanged |
| 9 | `scripts/e2e-discover.ts` agent page | B stale (Phase 9) | The detail page shows responsibilities, not capability labels | Assert responsibilities, plus no locked/planned note (executable in preview) |
| 10 | `scripts/e2e-agents.ts` step 13 | B stale (Phase 9) | "Available with Pro" is on the catalog card; the detail page has no card | Assert it on the catalog card; on the detail page assert the locked note and "Plan: Pro" |

None of these weakens RLS, the isolation guard or an assertion's intent. The DB/HTTP/E2E suites had not run since the Phase 5 incident, which explains the drift.

**Provider and network activity:**

- No OpenRouter, Brave or Neo4j call (kill switch on, keys blank, opt-in live-AI test off).
- External traffic was limited to:
  - the ORQO Test Supabase project (database and Auth API);
  - `gigaio.com` public pages (one Basic analysis in `e2e:app`, read-only).
- The existing ORQO project and `.env.local` were not used.

**Still unverified after Stage F:**

- plain Node build;
- production HSTS;
- backups/restore drill;
- live providers;
- production deployment;
- CSP enforcement.

**Local regression after the fixes:** `bun test src tests/unit` 461 pass, 0 fail; typecheck clean; lint clean. No product code changed, so no rebuild was needed. The isolated server was built 6 times from the same product code without error.

## 13. Next: hosting checkpoint (Stage G)

Approve the creation of a Vercel project and a production Supabase project (or decide which project hosts production), following `PRODUCTION-DEPLOYMENT-RUNBOOK.md`. Nothing has been created or deployed.

## Commits

On `phase-13-production-deployment`:

- `207e0a5` Phase 13 Stages B–D: production readiness (local) and documentation
- Phase 13 Stage F: isolated ORQO Test verification and test corrections

Not pushed. Not merged.
