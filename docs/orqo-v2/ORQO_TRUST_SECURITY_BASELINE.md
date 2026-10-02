# ORQO trust, privacy & security baseline (Phase 17A.3)

## 1. Scope, date, baseline

- **Date:** 2026-10-02. **Branch:** `phase-17-autonomous-bd-organization`, started at `bb1f129` (Phase 17A + 17A.1 + 17A.2). Production is still Phase 16 (`main` = `555f72d`), and nothing in this checkpoint touched it.
- **Method:** code and schema review focused on the questions below; adversarial tests against the isolated ORQO Test project (`scripts/isolated-test.ts`); static invariants in `security:check`. No provider was called, and no web research was done.
- **What this is not:** a certification, a penetration test by a third party, or a statement of GDPR compliance. It records engineering facts and readiness.

## 2. Threat model (tied to code)

| Actor | Main threat | Control in code |
|---|---|---|
| Anonymous attacker | Reach workspace data or cost-bearing routes | `requireAuth` on every page, action and API (`src/lib/server/auth/context.ts`); RLS denies the `anon` role; `proxy.ts` is only a convenience redirect |
| Member / viewer | Write beyond role; escalate role | RLS with `private.has_org_role`; role changes only via `set_member_role` (admin+, no self-change, owner protected); viewer write tests |
| Member of org A vs org B | IDOR / cross-tenant read or write | Every repository query filters `organization_id` **and** RLS enforces membership; ids validated as UUID; cross-tenant ids return 404/empty (no enumeration) |
| Malicious researched website | SSRF, prompt injection, XSS | `url-safety.ts` (shape + DNS + every redirect hop), size/time/redirect caps; untrusted delimiters + `neutralizeUntrusted`; quotes verified verbatim; React text only, `http(s)`-only links |
| Malformed provider response | Corrupt records, widen actions | Strict zod schemas with bounded arrays and strings; unknown keys stripped; unverifiable claims dropped |
| Developer / configuration error | Secret leak, wrong DB, paid spend | `server-only` markers; only two `NEXT_PUBLIC_` values; `.env*` ignored; destructive suites refuse non-Test projects; invalid budget means no paid spend; kill switch |
| Runaway agent | Unbounded calls, cost, scope creep | Registry-only agents and tools; AuthorityContract frozen per run; tripwires; per-run cost/call envelopes and rolling org ceiling enforced in the database (`reserve_provider_spend`); agent quota 30 runs/24h; one concurrent run |
| Compromised browser / session | Act as the user | Supabase-verified identity (`auth.getUser`); Secure, SameSite=Lax cookies; CSRF rule; no destructive or external actions exist |
| Duplicate / replayed request | Double spend, duplicate records | Idempotency keys on missions and spend reservations (reused reservations are refused); unique Track key; single-use provider permits |

**Trust boundaries:** Browser → Next server (`requireAuth`, CSRF) → Postgres (RLS, SECURITY DEFINER checks) → research network (`url-safety`) → provider gate (`provider-gate.ts`: authority, entitlement, kill switch, ledger, permit) → external provider. On the agent side: CEO → Agent Registry → AuthorityContract → tool authorization (orchestrator) → tool.

## 3. Security boundaries and implemented controls

| Area | State | Evidence |
|---|---|---|
| Authentication | IMPLEMENTED | Identity comes only from `auth.getUser()` (server-verified, never decoded locally); email confirmation required (`tests/db/auth.test.ts`); expired or missing session → 401 or redirect to `/login` |
| Redirects | IMPLEMENTED | `safeNextPath` refuses `//`, `\`, control or whitespace characters and foreign origins (unit-tested); confirmation `next=//evil` → `/workspace` |
| Session cookies | IMPLEMENTED | Supabase SSR cookies: Secure in production unless an `http:` site is configured (`secureCookies`), SameSite=Lax, path `/`. The org/locale cookies are also HttpOnly. Supabase auth cookies are readable by JavaScript by Supabase's design. |
| Logout | IMPLEMENTED | `signOut` server action ends the Supabase session. Access tokens already issued stay valid until they expire (Supabase JWT model). |
| CSRF | IMPLEMENTED | `assertSameOriginJson`: JSON content type required (forces a CORS preflight cross-site) and a present Origin must equal the host. **17A.3:** also applied to the two legacy routes `/api/discover` and `/api/graph`. Server actions use Next's built-in origin check. |
| Tenancy / IDOR | IMPLEMENTED | `tests/db/trust-baseline.test.ts` matrix: 9 tables × owner / viewer / other org / anonymous reads, plus 6 forged cross-tenant writes. Existing `rls-isolation`, `tenancy` and HTTP 404 tests. |
| Role escalation | IMPLEMENTED | Direct `UPDATE` of memberships, organizations, entitlement, authority or spend is refused; entitlement and Internal status come only from server environment variables; authority is written once (immutable trigger); spend rows are select-only for users |
| XSS / output | IMPLEMENTED | No `dangerouslySetInnerHTML` or `innerHTML` (static test); all text rendered by React; every data-driven `href` is `http(s)`-constrained by a DB check or zod `z.url({protocol:/^https?$/})`; external links use `rel="noopener noreferrer nofollow"` |
| SSRF | IMPLEMENTED | Only http(s); no credentials in URLs, no IP literals, no non-default ports, no internal suffixes; DNS must resolve to public addresses only (v4 and v6, including mapped, 6to4 and Teredo forms); each redirect hop re-validated; redirect, size, time and content-type caps. *Residual:* DNS rebinding between check and connect is not pinned (LOW; documented since Phase 12). |
| Secrets | IMPLEMENTED | Only `.env.example` and `.env.test.example` are tracked; there are no credential-shaped values in tracked files (connection strings in examples and tests are placeholders); `.env.orqo-production` is git-ignored; secret-bearing modules carry `server-only` (static test) |
| Provider gate | IMPLEMENTED | The only code that uses transports is `provider-gate.ts` (static test); permits are WeakMap-registered and single-use; order of checks: authority → tenancy/run binding → kill switch → entitlement → task/model tier → network → money (DB reservation) → credentials |
| Agent governance | IMPLEMENTED | Registry-only agents and tools (consistency test); no shell, SQL, arbitrary network or self-modification tool exists; `deriveChild` never widens; terminal run states enforced by trigger; tripwires audited. **17A.3:** a stored authority is re-verified against the server's own rebuild before an approved run resumes. |
| Headers | IMPLEMENTED | `X-Frame-Options: DENY`, enforced `frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`, `nosniff`, `strict-origin-when-cross-origin`, Permissions-Policy, COOP same-origin, `poweredByHeader:false` |
| CSP | PARTIAL (by design) | Full policy in **Report-Only**; it needs `'unsafe-inline'` for scripts until nonces exist. Reports are capped at 16 KB and 60/min; only the directive and blocked origin are logged. Enforcement remains deferred. |
| HSTS | PRODUCTION PROCESS | Not set by the app; provided by the HTTPS host (Vercel). Verify on each release. |
| Error disclosure | IMPLEMENTED | `toErrorResponse`: known `AppError`s give a stable code and message; anything else → `internal` "Unexpected server error." with a request id, no stack or SQL; logs keep error names and categories only (`hardening.test.ts`) |

## 4. Resource and abuse bounds

| Operation | Class | Bound |
|---|---|---|
| Research | RATE LIMITED | Basic 20 / Deep 3 per org per 24h (in the DB, `start_research_run`); one concurrent run; pages, bytes, redirects and time capped |
| Agent missions | RATE LIMITED + IDEMPOTENT | 30 runs per org per 24h, one concurrent run, idempotency key (`create_agent_mission`) |
| Paid provider calls | BOUNDED | Run envelope ($0.50 research / $0.25 prospecting), call count, rolling 30-day org ceiling (≤ $1000), per-call reservation, all inside one locked DB transaction |
| CSP report | RATE LIMITED | 16 KB, 60/min per instance |
| CEO question | BOUNDED | 500 characters, deterministic parser, stored data only |
| Request bodies | BOUNDED | zod strict objects with max lengths and arrays (e.g. relationship values ≤ 3 × 40); legacy routes 512 KB |
| Company creation | UNBOUNDED (LOW) | Cheap, RLS-scoped to the caller's own org; no per-org cap |
| Authentication | RATE LIMITED (Supabase) | Supabase Auth rate limits; mapped to `auth.rateLimited` |

## 5. Privacy / data inventory (engineering facts)

| Category | Source | Purpose | Scope | Deletion | Export | Retention |
|---|---|---|---|---|---|---|
| Account identity (email, display name, language) | Sign-up | Sign-in, attribution | User (`auth.users`, `profiles`) | Supabase Auth deletion; app references become `set null` | None in-app | None defined |
| Organization & membership | User | Tenancy | Org | Cascade from organization | None | None |
| Own-company profile / Business DNA | User + own website | Matching | Org | Cascade | None | None |
| Companies, contacts (name, role, professional email, profile URL) | User entry | Network memory | Org | Cascade; per-record archive/delete in UI | None | None |
| Relationships, validations, relationship answers | User | Assessment | Org | Cascade; validations append-only | None | None |
| Research runs, evidence excerpts, intelligence | Public websites (official site; search when enabled) | Evidence-backed analysis | Org | Cascade | None | None |
| Opportunities, tracked opportunities | Derived + user | Work | Org | Cascade | None | None |
| Events, signals | User / public | Context | Org | Cascade | None | None |
| Agent missions, runs, steps, tool calls, approvals, authority | System | Execution and audit | Org | Cascade | None | None |
| Usage events, provider spend | System | Cost control | Org (admin-read) | Cascade | None | None |
| Audit events | Triggers / governance | Accountability | Org (admin-read), append-only | Cascade with organization | None | None |

**Minimization:** evidence stores bounded excerpts, not entire pages; there is no raw provider response, prompt, header or token storage; audit and observability record ids, codes and categories, never prompts or keys (`hardening.test.ts`); model outputs are bounded structured fields (claims with verbatim quotes, hypotheses with a mechanism, assumptions and questions). **No hidden reasoning or chain-of-thought is requested, stored or shown.** Trade-off: full contact details are kept because they are the user's own CRM-like memory.

**Export:** NOT IMPLEMENTED (no account or organization export). **Deletion:** every organization foreign key is `on delete cascade` (0 exceptions), so deleting an organization row removes all tenant data, including its audit trail. There is **no user-facing organization- or account-deletion flow**, and deleting an auth user sets 27 attribution columns to null and cascades 2. Complete erasure has not been proven (backups, logs and the provider side are out of scope). **Retention:** no explicit retention rule exists for any category.

## 6. Data-protection readiness matrix (not a compliance claim)

| Control | Status |
|---|---|
| Data inventory | IMPLEMENTED (this document; keep current) |
| Minimization | PARTIAL (excerpts, no raw payloads; no retention limits) |
| Access control | IMPLEMENTED |
| Tenant isolation | IMPLEMENTED |
| Security of processing | IMPLEMENTED for the app; PRODUCTION PROCESS for hosting |
| Provenance | IMPLEMENTED (fact / inference / hypothesis / unknown with sources) |
| Export / portability | NOT IMPLEMENTED |
| Correction | PARTIAL (users edit companies, contacts and validations; no correction request flow) |
| Deletion / erasure | PARTIAL (cascade exists; no self-service flow; backups not addressed) |
| Retention | NOT IMPLEMENTED; BUSINESS/LEGAL decision on periods |
| Auditability | IMPLEMENTED for consequential actions |
| Subprocessors / providers | BUSINESS/LEGAL (Supabase, Vercel; OpenRouter routes to model vendors; Brave) |
| International transfers | BUSINESS/LEGAL (depends on regions and provider routing) |
| Consent (technical) | NOT APPLICABLE YET (no tracking or marketing cookies; only functional cookies) |
| Privacy notice | BUSINESS/LEGAL |
| Incident process | PARTIAL (runbook below; notification duties are BUSINESS/LEGAL) |

## 7. Known gaps (deferred, none blocks 17B)

1. MEDIUM — no data export or self-service org/account deletion; required before external customer launch.
2. MEDIUM — no retention periods (evidence, audit, usage/spend, runs); needs a business/legal decision.
3. MEDIUM — restore never tested; Production PITR off and scheduled backups not visible to tooling (WAL archiving on). BACKUP EXISTS: partially evidenced. RESTORE TESTED: **no**.
4. LOW — CSP still Report-Only with `'unsafe-inline'` (needs nonces).
5. LOW — SSRF DNS-rebinding window between check and connect (no IP pinning).
6. LOW — no per-org cap on company records.
7. LOW — `bun audit` needs registry access; it is a point-in-time check.
8. INFO — `/api/graph` (legacy demo) keeps one in-memory graph per server process, shared by every signed-in user; nothing reads it back from another user.
9. INFO — an approved run whose server rebuild no longer matches its snapshot (e.g. the Internal budget environment changed in between) is closed fail-safe and recorded as an `authority_modification` tripwire.

## 8. Provider / subprocessor data boundary

Once paid providers are enabled, ORQO can send:
- **OpenRouter extraction:** the target name and bounded excerpts of public pages (per-source character cap), inside untrusted delimiters.
- **OpenRouter reasoning:** the own-company profile fields (name, summary, offerings, segments, markets, geographies, sought capabilities, partnership goals) plus the target's verified claims.
- **Brave:** search query strings derived from the mission (objective, geography, market).

Never sent: user identity, emails, contacts, relationship answers, other companies, credentials or organization ids. The payload is built from explicit fields (`model-io.ts`), never from whole objects. Today, Production and Test have providers off (no keys, kill switch, entitlement).

## 9. Incident mini-runbook

- **A. Suspected secret leak:** (1) identify the credential type and the exposure path without copying the value; (2) rotate it at the provider (Supabase secret key, OpenRouter, Brave) and update Vercel env through the owner; (3) redeploy; (4) review usage, audit and provider dashboards for the exposure window; (5) record the timeline in a release/incident note.
- **B. Suspected cross-tenant access:** (1) capture the request ids and user; (2) query `audit_events`, `usage_events` and research/agent runs for the orgs involved (read-only); (3) if confirmed, disable the route (deploy a guard or roll back in Vercel); (4) add a failing tenant test, fix it, and run the trust matrix; (5) assess notification duties (BUSINESS/LEGAL).
- **C. Runaway provider spend:** (1) set `ORQO_PROVIDERS_KILL_SWITCH=on` (the gate re-checks it before every send); (2) remove the org from `ORQO_INTERNAL_ORGS` or lower `ORQO_INTERNAL_BUDGET_USD`; (3) inspect `provider_spend` by run; (4) revoke or rotate the provider key if spend continues; (5) add a regression test for the path.
- **D. Compromised researched page / injection:** (1) find the research run and evidence ids; (2) confirm no tool, authority or approval change (agent run detail, tripwire audit); (3) remove the poisoned intelligence (re-analyze or delete the record); (4) add the content as a red-team fixture; (5) block the domain if needed.
- **E. Broken Production deployment:** (1) promote the previous Vercel deployment (instant rollback); (2) if a migration was involved, apply the matching `supabase/rollbacks/*` script only after a snapshot (`RECOVERY-RUNBOOK.md`); (3) run the release smoke checks; (4) write the cause into the release document.

## 10. Release security checklist

| # | Check | Type |
|---|---|---|
| 1 | `bun run security:check` (boundary, governance, gate, registry, SSRF, auth flows, guards, dependency audit) | AUTOMATED |
| 2 | `bun run typecheck`, `bun run lint`, `bun run build` | AUTOMATED |
| 3 | `bun test src tests/unit` | AUTOMATED |
| 4 | Isolated DB suites incl. `trust-baseline`, `rls-isolation`, `tenancy`, `governance` | AUTOMATED (ORQO Test) |
| 5 | Isolated HTTP suites incl. CSRF, 401/404, governance | AUTOMATED (ORQO Test) |
| 6 | Relevant `e2e:*` for touched surfaces | AUTOMATED (ORQO Test) |
| 7 | New tables: RLS on, select/insert policies by role, grants minimal, audit trigger if consequential | OWNER (review) |
| 8 | New SECURITY DEFINER functions: `set search_path = ''`, role check inside, input validation | OWNER (review) |
| 9 | Migration additive-first, rollback script written and validated on ORQO Test | OWNER |
| 10 | No `.env*` beyond the examples; no new `NEXT_PUBLIC_` value | AUTOMATED |
| 11 | New provider path goes through `provider-gate.ts` only | AUTOMATED |
| 12 | New agent or tool registered, permissioned, with authority needs (consistency test) | AUTOMATED |
| 13 | New mutation route calls `requireAuth` + `assertSameOriginJson` + strict zod | OWNER (review) + HTTP test |
| 14 | New external content rendered as text; links `http(s)` only | AUTOMATED (static) + review |
| 15 | Kill switch state and Internal org list as intended | PRODUCTION-ONLY |
| 16 | Provider keys present only where intended | PRODUCTION-ONLY |
| 17 | Internal budget ceiling value reviewed | PRODUCTION-ONLY |
| 18 | Backup state confirmed (WAL archiving / snapshot) before migrating | PRODUCTION-ONLY |
| 19 | Migration applied to Production only with `--confirm=<ref>` | PRODUCTION-ONLY |
| 20 | Rollback target (previous Vercel deployment id) recorded | PRODUCTION-ONLY |
| 21 | Post-deploy smoke: login, Work, company page, headers present (incl. HSTS) | PRODUCTION-ONLY |
| 22 | CSP report volume reviewed (no new violation class) | PRODUCTION-ONLY |
| 23 | No secret value in release documents or logs | OWNER |
| 24 | This baseline updated if auth, data, agents, network, providers, mutations or external actions changed | OWNER |

## 11. Future-phase regression rule

Every phase that changes **AUTH, DATA, AGENTS, NETWORK, PROVIDERS, MUTATIONS or EXTERNAL ACTIONS** must, in the same phase:
1. add or update the matching regression test (tenant matrix row, CSRF row, gate bypass case, registry entry, SSRF case or red-team fixture);
2. keep `bun run security:check` green and extend it only with fast, deterministic tests;
3. update §3–§8 of this document when a boundary, data category or provider payload changes;
4. never add an external action (email, message, purchase, signature, CRM write) without an explicit human approval step bound to the run's authority and audited.
