# ORQO V2 — Phase 12 Implementation Report: Hardening / Security / Privacy / Recovery / Audit / Observability / Evaluations / Performance / Cost controls

Status tags:

- **IMPL**: implemented.
- **TESTED**: automated test ran and passed.
- **NOT LIVE**: not verified against a live external service or database.
- **DEFERRED**: not built in Phase 12.

## 1. Executive summary

Phase 12 audited the real implementation of Phases 1–11 against the Phase 12 brief, fixed every confirmed issue it found, and added regression protection:

- a static boundary inventory;
- a deterministic semantic evaluation suite;
- safe observability;
- a paid-provider kill switch;
- web security headers;
- SSRF and logging hardening.

**Findings.** No CRITICAL or HIGH vulnerability was found. Two **MEDIUM** issues were confirmed and fixed:

1. an open redirect after sign-in (control-character bypass);
2. four cookie-authenticated mutating routes missing the CSRF guard.

Five LOW hardening gaps were also fixed.

**Not verified live.** The main remaining risk is *verification*, not code: live RLS / tenant isolation, live providers and live Neo4j could not be exercised, because the only configured Supabase project holds real data and no isolated test project exists. That is the first Phase 13 prerequisite.

No migration, no new dependency, no product feature, no provider call and no database write.

## 2. Baseline and branch

- `main` = `36eb9210e6216ae1628cc58ad6d5849e67a1f30d` (Phase 11 merge; the requested "a1f30d" is this SHA's suffix). `origin/main` is identical, and the tree was clean.
- Work happened on branch **`phase-12-hardening`**, created from that commit. Not merged.

**Configured in this environment** (presence checked, values never printed):

- Supabase URL, publishable key, secret key and DB URL;
- `ORQO_AGENT_PREVIEW_ORGS`.

**Implemented but unconfigured:**

- OpenRouter, Brave and Neo4j;
- research preview orgs;
- the destructive-test project ref.

**Absent:** Exa, Firecrawl, Langfuse.

## 3. Hardening audit matrix

Classification: Confirmed vulnerability (VULN) / Hardening opportunity (HARD) / Missing verification (VERIF) / Accepted or deferred risk (ACCEPT).

| # | Area | Finding | Sev. | Class | Outcome |
|---|---|---|---|---|---|
| A1 | Auth | `safeNextPath` allowed `/\t/evil.example`; URL parsers strip TAB, so login / auth callback / confirm redirected off-site | MEDIUM | VULN | **Fixed**, TESTED (unit + local runtime) |
| A2 | Auth | Identity verified server-side (`getUser`), never from cookie payload; failures → 401 / login, never demo | INFO | — | Verified |
| A3 | Auth | `proxy.ts` fails open on refresh errors | INFO | ACCEPT | Pages/routes re-verify; documented |
| T1 | Tenancy | All 28 tables have RLS; composite same-org FKs; every repository query org-filtered (scan) | INFO | — | Verified statically |
| T2 | Tenancy | Live RLS / cross-tenant isolation suites not runnable (no isolated project) | HIGH | VERIF | **Requires isolated environment** (Phase 13) |
| T3 | Tenancy | Server actions/routes rely on a repeated pattern with no regression guard | LOW | HARD | **Static inventory test added** (mutation-checked) |
| Z1 | AuthZ | `POST /organizations`, `PATCH /me`, `POST …/companies`, `POST …/evaluate` lacked `assertSameOriginJson` (SameSite=Lax mitigates) | MEDIUM | VULN | **Fixed**, TESTED |
| Z2 | AuthZ | Plan → entitlement → quota → budget chain enforced server-side for research and agents; operator preview explicit env list | INFO | — | Verified (existing tests) |
| P1 | Providers | No single stop for all paid providers (`ORQO_LIVE_AI` covered OpenRouter only) | LOW | HARD | **Kill switch added**, TESTED |
| P2 | Providers | OpenRouter non-2xx error embedded 200 chars of the provider body (may reach logs) | LOW | VULN | **Fixed** (status only), TESTED |
| P3 | Providers | Timeouts present; no automatic retries; legacy routes off by default | INFO | — | Verified (+ static test) |
| W1 | SSRF | 6to4 (`2002::/16`) wrapping a private IPv4 and Teredo (`2001:0::/32`) treated as public | LOW | HARD | **Fixed**, TESTED |
| W2 | SSRF | DNS rebinding between check and connect | LOW | ACCEPT | Documented residual (pinned transport = future) |
| G1 | Graph | Org-scoped constant Cypher, bounded reads, derived/rebuildable | INFO | — | Verified (Phase 10 tests) |
| G2 | Graph | Rebuild throttle / last error in process memory | LOW | ACCEPT | Deferred (Phase 13, multi-instance) |
| PR1 | Privacy | Error logs printed raw `e.message` (could contain emails, tokens, query strings) | LOW | HARD | **Fixed** via `errorSummary` redaction at 12 sites |
| PR2 | Privacy | Graph / Phase 11 / agent seams exclude private CRM content; audit stores column names only | INFO | — | Verified (+ evaluation E10) |
| PR3 | Privacy | No export/deletion tooling, no retention enforcement | MEDIUM | ACCEPT | Documented; Phase 13 / compliance work |
| C1 | Cost | Per-org atomic quotas, concurrency guard, per-run hard limits, usage ledger | INFO | — | Verified (existing tests) |
| C2 | Cost | No per-user quota; no currency spend budget per org | LOW | ACCEPT | Deferred (no billing) |
| O1 | Ops | Company lists had no explicit row bound (platform default cap only) | LOW | HARD | **Explicit bound (1000)**; pagination deferred |
| O2 | Ops | No structured operational events | MEDIUM | HARD | **Observability foundation added**, TESTED |
| H1 | Web | No security headers; `X-Powered-By` exposed | MEDIUM | HARD | **Headers added**, TESTED (unit + runtime); script CSP/HSTS deferred |
| D1 | Demo | `/demo` isolated (separate tree, in-memory graph, no account) | INFO | — | Verified (`/demo` 200 in runtime smoke) |

## 4. Confirmed vulnerabilities fixed

1. **A1 open redirect.** `safeNextPath` now:
   - refuses every control or whitespace character (C0, DEL, NBSP, Unicode separators, BOM) and paths over 2 KiB;
   - re-resolves the path against a fixed origin and requires the same origin.

   Regression tests cover TAB/LF/CR/NUL/NBSP/LS/BOM variants. In a local production run, `/login?next=%2F%09%2Fevil.example` renders `next=/workspace`.
2. **Z1 CSRF guard.** Added to the four routes. The static test now fails if any mutating v1 handler lacks the guard, or reads the body before it.
3. **P2 provider body in errors.** OpenRouter errors are now `OpenRouter HTTP <status>`; the body is cancelled, never read into messages.

## 5. Authentication hardening

- Verified: server-side identity, fixed error categories, no demo fallback, privileged keys never read at runtime (static test).
- Fixed: A1. **TESTED.**

## 6. Multi-tenancy / RLS / IDOR

**Verified statically and in unit tests:**

- every server action and API handler authenticates and checks membership before organization data (inventory test);
- every repository query is org-filtered;
- child ids are resolved within the organization;
- RLS is enabled on all 28 tables, with composite same-org foreign keys;
- RLS denials are indistinguishable from missing rows.

The Phase 12 evaluation E10 runs the real `readRelationshipContext` against a fake database and asserts the `organization_id` filter on every table.

**NOT LIVE:** `tests/db/rls-isolation.test.ts`, `tests/db/tenancy.test.ts` and `tests/http/*` (the cross-tenant IDOR checks over HTTP) exist and were **not run** (see §24).

## 7. Input validation

The existing zod validation at every boundary was confirmed: uuids, enums, lengths, a 64 KiB JSON limit, a strict mission/tool schema, locale, URL shape and graph `{ companyId: uuid }`.

**Added:** the `next` path validation above. No framework change.

## 8. SSRF / web safety

The existing guard was confirmed (scheme, credentials, ports, names, resolution, per-hop redirects, size and time caps, robots).

**Added:**

- the 6to4/Teredo checks;
- a regression table for IPv6 literals, trailing dots, short/octal IPv4, userinfo, `metadata.google.internal`, `.local`, `file:`/`gopher:`/`ftp:`/`javascript:`, non-default ports, and a public name resolving to a 6to4-wrapped metadata address.

**TESTED.**

## 9. Provider safety

| Provider | Implemented | Configured here | Live-tested | Timeout | Retries | Error hygiene |
|---|---|---|---|---|---|---|
| OpenRouter | Yes | No | No | 45 s default / caller deadline | None | Status only (Phase 12) |
| Brave | Yes | No | No | Per call (run deadline) | None | `Brave HTTP <status>` |
| Official-site fetcher | Yes | n/a (no key) | Not in Phase 12 | Per page + run deadline | None | Categories |
| Neo4j | Yes | No | No | 4 s read / 15 s write | None | Safe categories |
| Supabase | Yes | Yes | Only via local runtime smoke (unauthenticated, read-only) | Platform | — | `fromDbError` codes |

- **Kill switch:** `ORQO_PROVIDERS_KILL_SWITCH=on` hides both paid providers from `serverConfig()`, so research, agents, legacy routes and status all fail closed (TESTED with a fetch trap).
- **Order of checks:** paid calls happen only after the research/agent gates; legacy routes check auth, then the operator switch, then the provider (static test).

## 10. Plan / entitlement / quota / budget enforcement

The existing chain was verified:

1. `requireMembership`;
2. role;
3. `getEntitledPlan` (always Free; no billing);
4. operator preview list (explicit environment variable, deep research and agents only);
5. provider configured;
6. atomic quota + concurrency RPC;
7. per-run `RunBudget` / `AgentBudget`;
8. usage ledger.

A direct endpoint call cannot bypass UI locks, because the UI's availability is presentation only (existing tests). No billing, no pricing, and the operator preview is unchanged.

## 11. Usage / cost controls

**Present:**

- per-organization quotas (research basic 20/24 h, deep 3/24 h, agents 30/24 h; atomic);
- concurrency guard;
- per-run limits (queries, pages, model calls, tool calls, duration);
- no retries;
- explicit timeouts;
- usage recorded with provider-reported cost.

**Added:** the global paid-provider kill switch.

**DEFERRED:** per-user quotas and a currency budget per organization. Both need billing and plan data.

## 12. Agent execution security

The existing controls were verified and remain tested:

- entitlement, executable status and autonomy are decided server-side;
- coming-soon agents are not executable;
- prepared permissions are not grants;
- tools come from a closed registry, so an unknown tool such as `send_email` is refused;
- the read seams are minimized;
- hard per-run limits apply;
- a failure is recorded as failed.

No new tool or permission was added. The E10 evaluation proves `read_relationship_context` excludes contact channels, notes and bodies, and filters by organization.

## 13. Privacy / data minimization

**What ORQO stores:**

- **Public evidence:** claims, short excerpts, source URLs.
- **Workspace profile.**
- **Private relationship memory:** contacts with channels and notes, interactions, follow-ups, event preparation.
- **Derived records:** opportunities, signals, graph projection, agent runs, usage, audit.

The public/private split, the minimization rules and the remaining compliance work are documented in `SECURITY-PRIVACY-MODEL.md`.

**Phase 12 change:** log redaction (PR1).

**DEFERRED:** export and deletion flows, a retention schedule, the processor list.

## 14. Audit trail

**Verified:**

- trigger-written `audit_events` on business and agent tables;
- users get SELECT only (immutable for users);
- metadata holds changed **column names**, never values, plus role changes.

**Not added:** graph rebuild and environment-level settings changes are not in `audit_events`. There is no DB write path for them, and an app-level audit insert would need a migration/RPC. The rebuild is now recorded as an operation event instead.

**Live immutability:** asserted by `tests/db` suites, which were **not run**.

## 15. Observability

`src/lib/server/observability.ts` is new:

- **Events:** whitelisted fields (operation, outcome, duration, org/run ids validated as ids, provider, model, sanitized category, retries, usage).
- **Redaction:** Bearer tokens, JWTs, Supabase/sk- keys, `password=` / `token=`, URL credentials, emails, phone numbers, URL query strings. Text is capped.
- **Pluggable sink:** the default is one structured `[orqo:op]` log line.
- **Failure-safe:** recording never throws.
- **`errorSummary()`** is used by every server log site that previously printed raw messages.

**Wired into:**

- OpenRouter and Brave calls (provider, model, duration, outcome, `http_<status>` / `timeout` category);
- graph rebuilds (a denied caller's requested org id is not recorded).

**TESTED.** **DEFERRED:** a production sink/tracing backend (Langfuse or OpenTelemetry), metrics and alerting.

## 16. Error handling / degradation

The existing behavior was verified, with tests from earlier phases plus Phase 12 provider-failure tests:

- **Neo4j unconfigured or down:** graph preview, with a truthful status.
- **Graph or opportunity-record failure on the company page:** a local notice.
- **Provider failure:** a controlled `unavailable` or failed run, and stored analyses stay intact.
- **Kill switch:** fail closed.
- **Malformed configuration:** an explicit `unavailable/config` state.
- **DB errors:** mapped to safe codes, never a demo or other-tenant fallback.
- **Unauthenticated API:** 401 (runtime smoke).

## 17. Recovery readiness

See `RECOVERY-RUNBOOK.md`:

- PostgreSQL is the only authoritative store; Neo4j and in-process state are derived;
- the schema is migration-driven (8 migrations, 7 rollback scripts) and Phase 12 added no migration;
- the graph rebuild procedure and provider outage behavior;
- the test-data guard;
- Phase 13 backup/PITR prerequisites.

**No backup was verified.**

## 18. Evaluation / regression suite

`src/lib/evaluations/semantics.test.ts` holds 11 deterministic cases on fictional data, end to end through the real engines, with a network trap and no LLM judge:

| Case | Principle |
|---|---|
| E1 | No forced opportunity |
| E2 | FACT / INFERENCE / ASSUMPTION / UNKNOWN preserved |
| E3 | Explicit demand vs product evidence |
| E4 / E5 | Neither timing nor relationship establishes demand |
| E6 | Incompatible goal |
| E7 | Build/integration compatibility |
| E8 | Unsupported stays unqualified |
| E9 | Next action targets the critical unknown |
| E10 | Private data excluded from graph, brief and agent read context |
| E11 | No cross-tenant context |
| E12 | Deterministic, provider-free and reproducible |

Detailed behavior stays in the per-module tests; nothing was duplicated or removed.

## 19. Performance findings

**Inspected:** query bounds (scan), graph neighborhood/candidate bounds, provider timeouts, per-render work.

**Bounds in place:**

- Network memory, signals, events, agent runs and opportunity records are bounded;
- the graph is bounded (Phase 10 caps).

**Added:** an explicit 1000-row bound on the two company list queries (previously only the platform default).

**Known, accepted for now:**

- the company page builds the bounded workspace projection on every view;
- there is no pagination on company lists;
- the Search card computes the Phase 11 support state per candidate (≤ 8, pure and cheap).

Nothing else showed a demonstrated risk, so no premature optimization was done.

## 20. Configuration / dependency hardening

- No new dependency. `bun.lock` is unchanged.
- Browser-exposed variables are limited to the two public Supabase values (tested).
- **New variable:** `ORQO_PROVIDERS_KILL_SWITCH`, documented in `.env.example` with a placeholder.
- **Dead or optional variables noted:**
  - `BAND_API_KEY` is only reported as a status boolean (no integration);
  - `OPENROUTER_MODEL` and `BRAVE_SEARCH_API_KEY` are legacy aliases.

  Both are harmless and were left for compatibility.
- The `.env.local*` backup files present locally are git-ignored.

## 21. Web / security headers

The headers listed in the security model §5 apply to every route, and `X-Powered-By` is removed. They were verified in a local production run.

There is deliberately no script/style CSP and no HSTS: they need nonces and the HTTPS deployment (Phase 13).

## 22. Demo isolation

`/demo` is verified:

- separate route tree, no account;
- deterministic in-browser world;
- in-memory graph mirror only;
- legacy live routes off by default.

The production flows never read demo fixtures. `/demo` returns 200 in the local runtime smoke.

## 23. Test matrix

| Area | Evidence | Status |
|---|---|---|
| Unit + business logic + Phase 11 regressions | `bun test src tests/unit`: **448 pass, 0 fail** (33 files) | TESTED |
| Auth / redirect | `flows.test.ts` (+1 test) + runtime smoke | TESTED |
| Server authorization inventory | `hardening.test.ts` static scans (mutation-checked: removing a guard fails the test) | TESTED |
| Tenant scope (non-mutating) | Repository filter scans, evaluation E10/E11, existing Phase 10/11 isolation tests | TESTED |
| Entitlements / agent permissions | Existing `plans.test`, `agents.test`, `organization.test`, `orchestrator.test` | TESTED |
| Provider failure / kill switch | `hardening.test.ts` (fetch trap + fakes) | TESTED |
| SSRF | `research.test.ts` + `hardening.test.ts` edge table | TESTED |
| Graph privacy/scoping | Phase 10 tests + E10/E11 + rebuild denial event | TESTED |
| Audit | Static review; live immutability only in `tests/db` | NOT LIVE |
| Usage/cost | Existing budget/quota tests + kill switch | TESTED |
| Error states | Existing degradation tests + provider failure tests | TESTED |
| Demo | Runtime smoke (`/demo` 200) + existing demo unit tests | TESTED (no browser) |
| TypeScript / lint / build | `bun run typecheck` clean · `eslint src next.config.ts` clean · `next build` succeeded | TESTED |
| Local runtime smoke | `next start`: headers present, `/workspace` → 307 login, hostile `next` neutralized, unauthenticated JSON POST → 401, `text/plain` POST → 400 | TESTED (unauthenticated, read-only) |

## 24. Tests not run and why

- **`test:db`, `test:http`, `e2e:*`** (RLS isolation, tenancy, auth, persistence, agents, research, discover, events, network, signals, HTTP IDOR):
  - `ORQO_DESTRUCTIVE_TESTS_PROJECT` is unset;
  - the only configured Supabase project contains real workspaces;
  - the safety guard (`tests/support/safety.ts`) refuses to run, and it was **not bypassed**.
- **Live Neo4j:** not configured; no safe isolated instance.
- **Live OpenRouter / Brave:** not configured, and paid calls were not approved.
- **Browser E2E / manual review:** not performed by the implementer (human checklist in §29).

## 25. External integrations actually live-tested

**None.** The local runtime smoke reached only the configured Supabase project's Auth API, with unauthenticated, read-only requests: no sign-in, no data read, no write.

## 26. Known limitations

- **No live verification of RLS / tenant isolation, provider behavior or Neo4j.**
- **Graph runtime state:** throttle and last-error are in-process; the company page projection is computed per view.
- **Company lists:** no pagination (explicit 1000-row bound).
- **Missing controls:**
  - no per-user quota and no currency budget;
  - no export, deletion or retention tooling;
  - no production observability sink or alerting.
- **SSRF:** the DNS rebinding residual remains.
- **Headers:** script CSP and HSTS are not yet set.
- **Audit gaps:** graph rebuilds and environment settings are not in `audit_events`.
- **Phase 10/11 items unchanged:**
  - no SaaS UI for structured capability/need records;
  - graph candidate decisions are not persisted;
  - no canonical opportunity creation path.
- **Browser dev "1 Issue" overlay:** not investigated (`devIndicators: false`; no repository evidence it originates from ORQO). Unrelated and non-blocking.

## 27. Deferred Phase 13 items

1. **Isolated test project:** create an isolated Supabase test project, set `ORQO_DESTRUCTIVE_TESTS_PROJECT`, and run every DB/HTTP/E2E suite (RLS, IDOR, audit immutability).
2. **Backups:** enable and restore-test backups/PITR, and set the RPO/RTO.
3. **Browser hardening:** HSTS and a nonce-based CSP, tested in the hosting environment.
4. **Monitoring:** a production sink for `[orqo:op]`, plus alerting on provider failures, spend and 5xx.
5. **Secret rotation:** a procedure, plus a review of edge rate limiting and Supabase auth settings (session lifetime, MFA).
6. **Graph durability:** durable graph throttle/error state for multi-instance hosting.
7. **Data rights:** export, deletion and a retention schedule. Per-user quotas once billing exists.
8. **Live provider tests:** live OpenRouter/Brave/Neo4j tests in a budget-capped staging environment, with explicit approval.

## 28. Rollback strategy

- Phase 12 is code and documentation only. There is no migration and no data change.
- **To roll back:** revert the Phase 12 commits, or don't merge `phase-12-hardening`.
- **Individual controls:** the kill switch is opt-in (unset = previous behavior). The headers live in `next.config.ts` and can be removed alone if a deployment-specific conflict appears.

## 29. Human review checklist (fictional workspace; do not modify real data)

1. Sign in normally. The workspace loads, and the language and workspace switches work.
2. Signed out, open `/workspace/network`. You are redirected to `/login?next=…`.
3. Open `/login?next=%2F%09%2Fevil.example` and sign in. You land on `/workspace`, **not** an external site.
4. **Search (Free):** analyze a fictional or public official site in Basic mode. The analysis appears, and Deep research shows plan or unavailable messaging.
5. **Phase 11:** the GigaIO-like case still shows **Partly supported**, "Someone needs it — Not established", and the outsourcing question first.
6. **Network company page:** the relationship next action plus Opportunity intelligence render.
7. **Opportunity graph:** the truthful "Graph preview — Neo4j not configured" state, with no rebuild button.
8. **Intelligence** (signals) and **Events** pages load and behave as before.
9. **Agents:** locked and coming-soon states are unchanged, and nothing runs without entitlement.
10. **Plans** page: entitlement messaging is unchanged.
11. **FR ⇄ EN** on the pages above.
12. **`/demo`:** loads and runs its deterministic flow.
13. **Optional, operator only:** with `ORQO_PROVIDERS_KILL_SWITCH=on`, a preview workspace's Deep research shows "not available on this deployment". Unset the switch afterwards.
14. **DevTools → Network:** responses carry `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy`, and there is no `X-Powered-By`.

## 30. Phase 13 readiness recommendation

**Ready to *begin* Phase 13 planning, conditionally.** The code-level boundaries are in place and regression-protected, and no CRITICAL or HIGH code vulnerability is open.

Production use with real customers should wait until Phase 13 delivers:

- an isolated test project, with the DB/HTTP/E2E suites passing (live RLS, IDOR and audit verification, finding T2);
- verified backups/PITR;
- HSTS/CSP in the hosting environment;
- production monitoring.

## Final human browser review — PASSED

**Setup.** The review used the Phase 12 production build (`next start`, port 3001, built from the reviewed code), signed in as the fictional **Northstar Systems** workspace.

**Strictly read-only:**

- no business-data form was submitted;
- no agent mission was started;
- no graph rebuild was triggered;
- no paid provider was invoked;
- no new research was run (stored analyses only).

The reviewer's only state change was the language preference, which was switched FR → EN → back.

| Step | Area | Result |
|---|---|---|
| 1 | Sign-in and authenticated workspace | **PASS** — fictional workspace and production shell load normally |
| 2 | Redirects | **PASS** — `/workspace/network` while signed out → login → back to `/workspace/network`. The hostile `/login?next=%2F%09%2Fevil.example` → sign-in → `/workspace` (neutralized) |
| 3 | Search, Free deterministic flow | **PASS** — stored GigaIO official-site analysis loads without re-running. Fact/Inference provenance and sources visible. Deep research locked behind Pro, with no runnable paid-provider action |
| 4 | Phase 11 opportunity presentation | **PASS** (see below) |
| 5 | Network and company detail | **PASS** (see below) |
| 6 | Opportunity Graph, Neo4j unconfigured | **PASS** (see below) |
| 7 | Intelligence | **PASS** (empty state) — truthful "No signals yet". Both creation paths explained as provider-free. Continuous monitoring Pro-locked, Signals Agent coming soon, nothing runs in the background. Signal-card fields are covered by the unchanged Phase 7 render tests (no signal exists, and none was created for review) |
| 8 | Events | **PASS** — Fictional Infrastructure Summit: details, Before/During/After lifecycle, counts (2 targets, 1 met, 1 missed, 1 interaction, 1 open follow-up), target priorities/statuses, preparation labelled Private, targets remain Network companies, no automatic contact creation |
| 9 | Agents | **PASS** (see below) |
| 10 | Plans / entitlements | **PASS** — Free current; Pro/Business presented as future upgrades. No pricing, checkout or fake upgrade. Messaging consistent with the feature locks |
| 11 | FR / EN | **PASS** — "Partiellement étayée", "Preuves de ce que fait GigaIO", "Un besoin existe — Non établi", the French weak Opportunity-intelligence state and "Aperçu du graphe — Neo4j non configuré". No problematic mixed language in the Phase 11/12 areas. Language restored to English |
| 12 | `/demo` | **PASS** — loads without sign-in. The dark deterministic demo renders, Demo 1/8 "Connect two agents" is available, the fictional graph/relationships/agent activity render, and it stays isolated from the workspace |
| 13 | Navigation / smoke | **PASS** — Search, Discover, Network, company detail, Opportunity Graph, Intelligence, Events, event detail, Agents, Partnership Agent detail, Plans, Company and Settings all navigable. No broken navigation, unexpected redirect, crash or error banner |
| 14a | Production runtime check | **PASS** (see below) |
| 14b | Development "1 Issue" overlay | **PASS / non-blocking** (see below) |

**Step 4 — Phase 11 opportunity presentation (GigaIO).**

- The Integration partner candidate shows **Partly supported**, with no "Confidence:" label.
- "Evidence of what GigaIO does" is separated from demand.
- "Someone needs it — Not established" appears as a caution.
- Fits your goals is satisfied; timing is not established; outsourcing remains an assumption.
- The first validation question and the Next Best Action both target in-house vs external partner.
- Nothing claims the opportunity is qualified, confirmed or created.

**Step 5 — Network and company detail (Fictional Quill Ltd).**

- Header and stage are correct, and the relationship Next Best Action is intact.
- Opportunity intelligence shows the truthful weak state, naming the missing analysis and capability/need evidence.
- All company cards render.
- The public/private separation holds: private interaction content appears only in the private Activity section, and there is no contact email or phone in Opportunity intelligence.
- Nothing is fabricated.

**Step 6 — Opportunity Graph, Neo4j unconfigured.**

- "Graph preview — Neo4j not configured", computed from workspace records. No connected/synced/healthy claim and no build action.
- Counts and map render, and Fact/Inference/Assumption semantics are visible.
- Private CRM content is excluded.
- There is no fabricated candidate, and "a connection is not an opportunity" is stated.

**Step 9 — Agents and permissions.**

- No agent can run on Free: Research and Prospecting require Pro, Partnership requires Business, and the unfinished agents are Coming soon.
- "Read the Opportunity graph" is listed under *prepared* read access, not as a granted permission.
- Restrictions are shown: no external outreach, writes, private contact/interaction data, autonomous execution or paid providers.
- No operator preview is active, and no run was created.

**Step 14a — production runtime check (port 3001).** Verified by the implementer, read-only and unauthenticated:

- Signed-out workspace routes return 307 → `/login?next=…`; `/demo` and `/login` return 200.
- Every response carries the Phase 12 headers (`X-Frame-Options: DENY`, minimal CSP, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP), with no `X-Powered-By`.
- A headless Chromium run (the existing Playwright install) on all routes showed **0 console errors, 0 uncaught page errors and 0 CSP violations**.
- The server log covering the reviewer's authenticated session showed no errors or warnings.

**Step 14b — development "1 Issue" overlay (dev server, port 3000).**

- A fresh headless session on `/`, `/login`, `/demo` and `/workspace` reports **0 issues and 0 console errors**.
- The dev log's two historical entries were both forwarded by an already-open tab:
  1. A transient build error (`analysis.tsx:221` duplicate `support`) from an intermediate Phase 11 edit, fixed before commit `0de56bf`. Current code typechecks, lints, builds and passes all tests.
  2. A browser-side `unhandledRejection: [object Error]` with no message or stack, which is not reproducible.
- Classified as a **stale, non-reproducible development-overlay state, not a Phase 12 regression**.

**Observation (pre-existing, not Phase 12).** The signed-out redirect keeps the path but drops the query string (`?view=graph` → `next=/workspace/network`), because `proxy.ts` encodes only the pathname. This is a candidate for a later small fix.

**Result: the Phase 12 human browser review is PASSED.** No product code changed after the review; only this report was updated.

## Commits

On `phase-12-hardening`, on top of `36eb921`:

- `f2edb23` Phase 12: hardening implementation and tests
- `1424581` Phase 12: security/privacy model, recovery runbook, implementation report
- Phase 12 report: record final human review (documentation only)

Pushed to `origin/phase-12-hardening` after the final human review. Not merged into `main`. Phase 13 has not started.
