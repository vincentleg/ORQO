# ORQO V2 — Phase 1 Implementation Report

| | |
| --- | --- |
| **Phase** | 1 — SaaS Foundation (Supabase · Auth · Organizations · RLS · Persistence) |
| **Date** | 2026-09-30 |
| **Branch** | `phase-1-saas-foundation` (from `main` @ `1be66d6`; not merged, not pushed) |
| **Supabase** | Development project (Postgres 17.11), reached through `NEXT_PUBLIC_SUPABASE_URL` / session pooler |
| **Status** | Complete. Every Definition of Done item has executable evidence (§15), with the limitations listed in §16 |

---

## 1. Executive summary

ORQO now has a production side built on Supabase.

- **Access chain:** user → Supabase Auth → organization (workspace) → membership + role.
- **Database:** Postgres with RLS on every table.
- **Server layer:** loads authoritative state from the database and runs the **unchanged** ORQO engine on it.

The hackathon demo keeps working unchanged under `/demo`. It still uses browser-local state and needs no account.

What is proven by tests against the real project:

- **Tenant isolation.** User B cannot SELECT, UPDATE, DELETE, or INSERT rows claiming to belong to Organization A, in any of the 10 tenant tables. The rows are also invisible to anonymous callers, cannot be moved between organizations, and cannot reference another organization's rows (72 isolation tests, §9).
- **Server-authoritative evaluation.** `POST /api/v1/organizations/:org/relationships/:rel/evaluate` takes no state from the browser. The same data evaluated by the demo engine and by the production pipeline yields the same opportunity, field for field.
- **The engine was not rewritten.** `src/lib/engine`, `src/lib/domain`, `src/lib/data`, `src/lib/graph` and `src/lib/store.ts` are byte-identical to the baseline. The 9 original engine tests pass unmodified.
- **Demo preserved.** The manual demo E2E (21 checkpoints) and the Auto Demo E2E (3 scenarios plus replay, pause, exit, restart and refresh) pass with zero console errors.
- **FR/EN foundation.** Canonical locales, typed catalogs, a persisted profile preference, and all new screens in both languages.

---

## 2. Files changed

**Moved (history preserved with `git mv`), demo pages → `src/app/demo/`:** `page.tsx`, `network/`, `connect/`, `opportunities/`, `signals/`, `agent/`, `not-found.tsx`. Link targets now go through `demoHref()`. No behavior changed.

**Modified:**

| File | Change |
| --- | --- |
| `src/app/layout.tsx` | Root layout is minimal; `<html lang>` comes from the request locale. The demo shell moved to `src/app/demo/layout.tsx` |
| `src/components/shell.tsx`, `agent-profile.tsx`, `consent.tsx`, `match-overlay.tsx`, `network-bits.tsx`, `proposal.tsx` | Demo links prefixed with `/demo`. `Logo` extracted to `components/logo.tsx` |
| `src/lib/autodemo/runner.ts` | The runner maps scenario paths to `/demo`. Scenario data is unchanged |
| `src/app/demo/connect/[relationshipId]/page.tsx` | Live AI label says "sign in to use" when a key exists but the visitor is signed out |
| `src/app/api/{discover,research,graph,status}/route.ts` | Paid and write routes require sign-in; body size limits; no upstream error text returned (§14) |
| `src/lib/server/config.ts` | `publicStatus` reports `ai.signInRequired` |
| `next.config.ts` | Temporary 307 redirects from the old demo URLs to `/demo/...` |
| `eslint.config.mjs` | Domain-layer import boundary rule |
| `package.json`, `bun.lock` | 2 dependencies; new scripts; `typecheck` runs `next typegen` first (as the Next 16 docs recommend) |
| `scripts/e2e-demo.ts`, `scripts/e2e-autodemo.ts` | Entry URL is now `BASE_URL + "/demo"`. Assertions unchanged |
| `README.md`, `.env.example` | Updated (names and placeholders only) |

**Added:**

- **Database:** `supabase/migrations/*.sql` (3), `supabase/rollbacks/*.down.sql` (2), `scripts/db-migrate.ts`.
- **Supabase and auth:** `src/proxy.ts`, `src/lib/server/supabase/{config,server,proxy,types}.ts`, `src/lib/server/auth/{context,flows,page}.ts`.
- **Server core:** `src/lib/server/{errors,http,i18n}.ts`, `src/lib/server/tenancy/roles.ts`, `src/lib/server/repositories/{tenancy,companies,network}.ts`, `src/lib/server/orqo/{schemas,world,evaluate}.ts`.
- **i18n:** `src/lib/i18n/{config,translate,negotiate}.ts`, `messages/{en,fr}.ts`.
- **Pages, actions and API:**
  - Pages: `src/app/{page,not-found}.tsx`, `login/`, `signup/`, `onboarding/`, `workspace/`, `demo/layout.tsx`.
  - Auth routes: `auth/{callback,confirm}/route.ts`.
  - Server Actions: `actions/{auth,workspace}.ts`.
  - API: `api/v1/**`.
- **Components and helpers:** `src/components/{logo.tsx,saas/forms.tsx,saas/frame.tsx}`, `src/lib/demo-path.ts`.
- **Tests:** `src/lib/i18n/i18n.test.ts`, `src/lib/server/auth/flows.test.ts`, `tests/unit/`, `tests/db/`, `tests/http/`, `tests/support/`, `scripts/e2e-app.ts`.

---

## 3. Dependencies added / removed

| Package | Version | Why |
| --- | --- | --- |
| `@supabase/supabase-js` | ^2.117.2 | Data API, Auth, RPC |
| `@supabase/ssr` | ^0.12.7 | Cookie-based sessions for Next.js server code |

No dependency was removed. No i18n library was added: the Phase 1 needs (locales, typed catalogs, interpolation, fallback, negotiation) are about 80 lines. A library can replace this in Phase 2 behind the same `createTranslator` API. No Supabase CLI or Docker was installed: migrations are applied with Bun's built-in SQL client (§4).

---

## 4. Supabase architecture

| Client | Key | Where | Used for |
| --- | --- | --- | --- |
| `createSupabaseServerClient()` | publishable | Server Components, Server Actions, Route Handlers (`server-only`) | Acts as the signed-in user from the session cookie; RLS applies |
| `createSupabaseTokenClient(token)` | publishable + user JWT | API route handlers | API callers using `Authorization: Bearer`; RLS applies |
| `refreshSession()` in `src/proxy.ts` | publishable | Proxy (Next 16's replacement for middleware) | Refreshes session cookies; convenience redirect for protected pages |
| *Browser client* | — | **Not created** | All auth runs through Server Actions; no browser code talks to Supabase |
| *Admin / service-role client* | — | **Not used by the application** | Nothing at runtime needs to bypass RLS. `SUPABASE_SECRET_KEY` is read only by the tests (Auth admin API) |

- **Service role has no table privileges.** It has none on Phase 1 tables (migration `20260930140000`), so even a leaked secret key cannot read tenant tables through the Data API.
- **Migrations.** `supabase/migrations/*.sql` are applied by `bun run db:migrate` (`scripts/db-migrate.ts`):
  - Each migration runs in its own transaction.
  - Bookkeeping uses `supabase_migrations.schema_migrations`, the Supabase CLI's table, so `supabase db push` remains possible later.
  - A migration edited after it was applied is refused.
  - There is no reset command, and connection details are never printed.
- **Applied:**
  1. `20260930120000_phase1_saas_foundation`: schema, RLS, RPCs, triggers.
  2. `20260930130000_opportunity_participant_position`: preserves contribution order.
  3. `20260930140000_revoke_service_role_table_privileges`.
- **Connectivity verified (values never printed):** Auth settings 200; REST 200 with both keys; Auth admin 200; Postgres 17.11 as `postgres`.

---

## 5. Database schema

The minimum justified by current ORQO behavior plus SaaS/security needs. Every tenant table has a UUID primary key, `organization_id NOT NULL`, timestamps, and indexes on the org-scoped lookups used. Children reference parents through **composite `(organization_id, id)` foreign keys**, so a row can never point at another organization's row. Content-derived engine ids are kept separately (`engine_key`, `external_ref`) and are never primary keys.

| Table | Purpose | Maps from (engine) |
| --- | --- | --- |
| `profiles` | Display name, `locale` (FR/EN preference); created by trigger on sign-up | — |
| `organizations` | Tenant / workspace; `default_locale` | — |
| `organization_memberships` | user ↔ org with `org_role` (`viewer < member < admin < owner`); unique per pair; multiple memberships per user supported | — |
| `audit_events` | Append-only trail written by triggers; changed column *names* only, never values | `AgentActivity` / `Outcome` precursor |
| `companies` | External companies (+ `is_own_company`, at most one per org); objectives and constraints as validated JSON | `Company` |
| `company_capabilities`, `company_needs` | Facets with tags, visibility, intensity, disclosure and evidence; evidence may cite only same-org sources (trigger) | `Capability`, `Need`, `EvidenceRef` |
| `sources` | Provenance (kind, label, url, retrieved_at, `simulated`) | `Source` |
| `contacts` | People (no email stored: data minimization) | `Person` |
| `relationships` | Two contacts, encounter, status, visibility | `Relationship` + `Encounter` |
| `analysis_runs` | Append-only engine evaluations: trigger, outcome, rejected hypotheses, **watch conditions**, stage reports | `Evaluation` (precursor of V2 `agent_runs`) |
| `opportunities` | Full opportunity: why exists / why now, structure, FACT/INFERENCE/ASSUMPTION evidence, critic, confidence, stage, history; unique `(organization_id, engine_key)` | `Opportunity` |
| `opportunity_participants` | Company, role, contributions, position | `roles` + `Contribution` |

**Deliberately deferred:**

| Concept | Why it is deferred |
| --- | --- |
| Consents / Business Match | Needs the cross-organization sharing design (Decision B), §17 |
| Signals | No production producer until Phase 7; the engine handles "no signals" |
| Meeting briefs | Phase 6 |
| Multi-company proposals | Phase 10 |
| Normalized evidence table | Evidence Store, Phase 3 |
| Agents, missions, follow-ups | Their own phases |

Enums mirror the TypeScript unions, and a test fails if they drift (§15).

---

## 6. Authentication implementation

| Flow | Implementation | Evidence |
| --- | --- | --- |
| Sign up | `/signup` → Server Action → `signUp` with locale/name metadata and `emailRedirectTo=/auth/callback?next=/onboarding`. With Confirm Email ON the user sees "check your email". Existing emails get the same response (no account enumeration) | Unit (fake auth client). Not submitted against real SMTP, see §16 |
| Email confirmation | `/auth/callback` (PKCE `code`, default Supabase template) and `/auth/confirm` (`token_hash`, custom template) | HTTP test: generated token → 307 to `/onboarding` with a session cookie; invalid token → `/login?error=confirm`, no session |
| Sign in | `/login` → Server Action → `signInWithPassword`; provider errors mapped to translated message keys; `next` limited to same-site paths | DB tests + browser E2E (correct and wrong password) |
| Unconfirmed users | Rejected with "confirm your email" | DB test against the real project (Confirm Email ON) |
| Session persistence | `@supabase/ssr` cookies, refreshed in `src/proxy.ts` | E2E: reloads stay signed in |
| Protected routes | Proxy redirects `/workspace` and `/onboarding` to `/login?next=…`; each page and action also verifies with `getUser()` (proxy is not the boundary) | E2E + HTTP (307) |
| Authenticated server access | `requireAuth(request)`: cookie or Bearer, verified by the Auth server | HTTP tests (401 without, 200 with, 401 invalid token) |
| Sign out | `signOut({ scope: "local" })` | DB test: refresh token revoked; E2E: protected page redirects afterwards |

Password recovery and OAuth were not implemented (not required, and OAuth isn't configured).

---

## 7. Organization / membership model

- A new user creates their first workspace at `/onboarding` via RPC `create_organization`, and becomes **owner**. There is a limit of 20 organizations per user as a cheap abuse guard.
- **Membership is the only proof of access.** `requireMembership(db, userId, organizationId, minRole)` reads the caller's membership *under RLS*. An organization id from the browser is only a lookup key, and non-members get `not_found` (no enumeration).
- Roles change only through RPC `set_member_role`:
  - admin+ only;
  - nobody changes their own role;
  - only owners grant or revoke `owner`;
  - non-members get the same error as unprivileged members.

  Direct INSERT/UPDATE on memberships is impossible: there is no privilege and no policy.
- The active workspace is a preference cookie, re-validated on every request. Multi-membership switching exists in the workspace header.
- Invitations and a member-management UI are deferred. The schema supports multiple members, and the tests add members through the owner database connection.

---

## 8. RLS policy model

- RLS is **enabled on all 13 public tables**, default deny. `anon` has **no** table privileges, and `service_role` has **none** on Phase 1 tables.
- Helpers live in the `private` schema, which the Data API doesn't expose:
  - `private.has_org_role(org, min_role)` and `private.shares_organization_with(user)`;
  - both are `SECURITY DEFINER` with `search_path = ''`, which avoids recursive RLS on memberships;
  - execute is granted only to `authenticated`.

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| domain tables (8) | viewer+ of the row's org | member+ (WITH CHECK) | member+ | member+ |
| `analysis_runs` | viewer+ | member+ | — (append-only) | — |
| `organizations` | viewer+ | RPC only | admin+ (name, default_locale columns only) | — |
| `organization_memberships` | viewer+ | RPC only | RPC only | — |
| `audit_events` | admin+ | triggers only | — | — |
| `profiles` | self, or users sharing an org | trigger only | self (display_name, locale columns only) | — |

**Triggers:**

- `organization_id`, `id` and `created_by` are immutable (a member of two organizations cannot move rows between them).
- `created_by` is forced to `auth.uid()`.
- `updated_at` is maintained automatically.
- Evidence must cite a same-org source.
- Audited tables write `audit_events`.

All definer functions pin `search_path` (tested).

---

## 9. Cross-tenant security test results

**Suite:** `tests/db/rls-isolation.test.ts`, run against the **real** development project through the **Data API as real signed-in users**. Row contents were verified with an md5 fingerprint over the owner database connection, not through the attacker's filtered view.

**Setup:**

- User A creates Org A, imports a two-company fixture through the production repositories, and runs a real server-side evaluation. That fills **all 10 tenant tables**.
- User B owns Org B.

**For each of `companies`, `sources`, `company_capabilities`, `company_needs`, `contacts`, `relationships`, `analysis_runs`, `opportunities`, `opportunity_participants`, `audit_events`:**

| Check | Result |
| --- | --- |
| Positive control: A reads all of Org A's rows | ✅ 10/10 |
| B `SELECT` by id and by `organization_id = A` returns nothing | ✅ 10/10 |
| B `UPDATE`: 0 rows affected, fingerprint unchanged | ✅ 10/10 |
| B `DELETE`: 0 rows removed, fingerprint unchanged | ✅ 10/10 |
| B `INSERT` with `organization_id = A` rejected with `42501`, fingerprint unchanged | ✅ 10/10 |

**Plus:**

| Check | Result |
| --- | --- |
| B cannot read, rename or join Org A; cannot read A's profile | ✅ |
| B cannot run the evaluation on A's relationship (via A's or B's org id): `not_found`; no run written | ✅ |
| A member of both orgs cannot move a row between them (immutable `organization_id`) | ✅ |
| A cannot attach a capability to B's company (composite FK, `23503`) | ✅ |
| A cannot cite B's source as evidence (trigger) | ✅ |
| `created_by` cannot be forged | ✅ |
| The audit trail is append-only, even for the owner | ✅ |
| Anonymous role: no rows readable and INSERT rejected with `42501` on all 13 tables | ✅ 13/13 |

**Total: 72 / 72 passed.**

Role and RPC abuse (self-promotion, admin → owner, non-member role changes, viewer writes) is covered by `tests/db/tenancy.test.ts` (15 / 15), and cross-tenant HTTP access by `tests/http/api.test.ts` (§15).

---

## 10. Server/client boundary

- **Production API (`/api/v1`)** receives **intent only**:

  | Endpoint | Purpose |
  | --- | --- |
  | `GET` / `POST /organizations` | List / create |
  | `GET` / `POST /organizations/:org/companies` | List / create companies |
  | `POST /organizations/:org/relationships/:rel/evaluate` | Body must be `{}`; a body carrying `world` is rejected with 400 (tested) |
  | `GET` / `PATCH /me` | Profile and language |

  Each handler authenticates, checks membership and minimum role, validates input with zod (64 KB cap), loads from Postgres, and returns the minimum response with `Cache-Control: private, no-store`.
- **Evaluation pipeline:** `evaluateRelationshipForOrganization` → `loadRelationshipSnapshot` (RLS-scoped reads, with org filters as a second layer) → `buildEvaluationWorld` (pure adapter) → **unchanged** `evaluateRelationship` + `commitEvaluation` → idempotent upsert on `(organization_id, engine_key)` → append `analysis_runs`. Production uses **real time**; the demo keeps its demo clock.
- **Server Actions** re-verify the user and membership on every call (Next's docs note they are public POST endpoints).
- **Demo (legacy)** routes still accept the client-side demo world; that data is fictional. They are now auth-gated and size-limited, and they're clearly separated from production (§12, §14).
- **No database queries in React components:** pages call repositories; client components only call Server Actions.
- **Domain boundary:** ESLint forbids `lib/domain`, `lib/engine`, `lib/graph` and `lib/i18n` from importing React, Next, Supabase, server code, the store or components. A probe file confirmed the rule fires.

---

## 11. Persistence migration

- Production data now lives in Postgres. The demo's `localStorage` store (`orqo-demo`) is untouched and remains the demo's only persistence. The two never mix.
- **Adapter, not rewrite:** `src/lib/server/orqo/{schemas,world}.ts` decode rows into the existing domain types and map engine output back to rows. The schemas are typed `z.ZodType<DomainType>` plus exhaustiveness checks, so the database shape and `types.ts` cannot silently drift.
- **Demo fixtures are never inserted into user workspaces.** Tests import them into throwaway organizations through a test-only sink, which are deleted afterwards. There is no production seed.
- **Evidence of equivalence:**
  - Unit: rows → World → engine reproduces the demo engine's result exactly.
  - DB: the opportunity, reloaded in a new session, matches the engine's result field for field.
  - Re-evaluation updates the same row and keeps the lifecycle stage.
  - Critic hold-backs persist with watch conditions.

---

## 12. Demo preservation

- The demo lives at **`/demo`**, with no authentication and the same `localStorage` key, so existing browser state carries over.
- The demo shell moved into `app/demo/layout.tsx`, and all demo links go through `demoHref`.
- Auto Demo scenario *data* is unchanged; only the runner maps paths.
- Old URLs (`/network`, `/signals`, `/opportunities/*`, `/agent/*`, `/connect/*`) redirect temporarily to `/demo/*`.

| Suite | Result |
| --- | --- |
| Manual demo E2E | ✅ All 21 checkpoints: connect, bilateral analysis, opportunity, critic, private consent → Business Match, brief, fast-forward, re-evaluation, 3-way graph, route sweep; no console errors |
| Auto Demo E2E | ✅ Scenario 1 (115.7 s) + replay (113.4 s), Scenario 2 (55.4 s incl. pause), Scenario 3 (37.5 s), exit + reset, restart, refresh + replay; no console errors. Timings match the Phase 0 baseline |

The only visible demo change: the Live AI toggle now requires sign-in (the label says so), and failure notices no longer quote upstream error text.

---

## 13. i18n foundation

- **Locales:** `LOCALES = ["en", "fr"]`, `DEFAULT_LOCALE = "en"` (`src/lib/i18n/config.ts`). They mirror the database domain `locale_code`, and a test checks this.
- **Catalogs:** `messages/en.ts` is the reference shape; `fr.ts` must `satisfies Messages`, so a missing key is a compile error. `MessageKey` gives compile-time key checking.
- **Translator:** `createTranslator(locale)` interpolates `{var}` and falls back to English, then to the key.
- **Negotiation:** profile preference → `orqo-locale` cookie (mirrors the profile) → `Accept-Language` (q-values) → default.
- **Persistence:** `profiles.locale`; set at sign-up from the chosen language; changeable in the workspace; read by `GET /api/v1/me`.
- **Coverage:** every new production screen is translated FR/EN, and `<html lang>` follows the locale. The legacy demo stays English (wrapped in `lang="en"`), as scoped.
- **Evidence:** 8 unit tests, DB tests for persistence and constraints, HTTP test for the API, and the browser E2E (FR switch persists across reload).

---

## 14. Security changes

| Phase 0 finding | Status |
| --- | --- |
| C1 unauthenticated cost-bearing routes | Fixed: `/api/discover`, `/api/research` and `POST /api/graph` return 401 unless signed in (tested) |
| C2 client-authoritative state | Fixed for production: `/api/v1` loads state from Postgres and rejects state in the body (tested). Legacy demo routes keep client demo data, now auth-gated |
| C3 browser-only persistence | Fixed for production (Postgres); the demo stays local by design |
| H3 consent privacy UI-only / impersonation | Demo-only now; production has real identities. Production consent is deferred (§17) |
| H6 derived/sequential ids | Production uses UUIDs; engine keys are stored separately |
| M3 shallow request validation | zod at every production boundary; size limits on legacy routes |
| M5 upstream error text to clients | Fixed: safe messages only; details logged server-side with a request id |

**Additional hardening:**

- Least-privilege grants: no `anon` privileges; no `service_role` privileges on Phase 1 tables; column-level UPDATE grants on `profiles` and `organizations`.
- `search_path`-pinned definer functions in a non-exposed schema.
- Open-redirect protection on `next` parameters.
- Session cookies refreshed in the proxy.
- Audit trail for organizations, memberships (including role changes with the previous role) and domain objects.

**Secret handling:**

- No value appears in client bundles: a scan of `.next/static` for the secret key, DB URL, DB password, publishable key and OpenRouter key found none.
- `.env.local` is git-ignored and uncommitted, and all test and migration output passes through redaction.
- **Incident (setup):** before Phase 1 work started, a diagnostic script crashed and printed the then-current database password into the agent session output. It was disclosed immediately, and the owner rotated the password before work resumed. No credential is in the repository or its history.

**Not done:** general rate limiting is deferred to Phase 12 (only body-size limits and the 20-organization cap exist). This is not a production security certification.

---

## 15. Test matrix

| # | Area | Command | Result |
| --- | --- | --- | --- |
| A | Install / lockfile | `bun install` (2 packages added; lockfile committed) | ✅ |
| B | TypeScript | `bun run typecheck` (typegen + tsc) | ✅ 0 errors |
| C | Lint | `bun run lint` (incl. domain boundary rule) | ✅ 0 problems |
| D/E | Unit + original engine tests | `bun run test` | ✅ 26/26 (engine 9/9 unmodified, i18n 8, auth flows 6, DB↔engine mapper 3) |
| F | Production build | `bun run build` | ✅ 26 routes + proxy |
| G | Manual demo E2E | `BASE_URL=http://localhost:3100 bun run e2e` | ✅ 21/21, no console errors |
| H | Auto Demo E2E | `BASE_URL=http://localhost:3100 bun run e2e:autodemo` | ✅ all scenarios and controls, no console errors |
| I | Authentication | `tests/db/auth.test.ts`, HTTP confirm tests, `e2e:app` | ✅ 6/6 + 3/3 + browser flow |
| J | Organizations / memberships | `tests/db/tenancy.test.ts` | ✅ 15/15 |
| K | RLS tenant isolation | `tests/db/rls-isolation.test.ts` | ✅ 72/72 |
| L | Persistence | `tests/db/persistence.test.ts` + mapper unit tests | ✅ 8/8 + 3/3 |
| M | i18n foundation | unit + DB + HTTP + `e2e:app` (FR switch) | ✅ |
| N | Server authorization | `tests/http/api.test.ts` against `next start` | ✅ 24/24 (includes one real OpenRouter call via `ORQO_TEST_LIVE_AI=1`) |
| — | Schema structure | `tests/db/schema.test.ts` (RLS on all tables, no anon/service_role grants, definer search_path, enums = TS unions, all migrations applied) | ✅ 12/12 |
| — | Production app E2E | `bun run e2e:app` | ✅ 7/7 checkpoints, no console errors |

`bun run test:db` totals **113 / 113** across 5 files. The test users are deleted afterwards (0 remain in the project). No existing test was deleted or weakened. The two demo E2E scripts changed only their entry URL, because the demo moved to `/demo` (Decision C).

---

## 16. Known limitations

1. **Evaluation writes are sequential, not one transaction.** The opportunity upsert is idempotent, so a retry converges, but a mid-way failure can leave the run unrecorded. Transactional RPC or job idempotency comes in Phase 4.
2. **The production UI is minimal:** auth, onboarding, workspace (companies, members, language). Contacts, relationships and evaluation are API-only until Phase 2.
3. **Production evaluation is deterministic only.** Live AI remains a demo feature (signed-in users).
4. **Closed 26-tag taxonomy** still limits real-company reasoning (Phase 3).
5. Objectives, constraints and evidence are stored as validated JSON rather than normalized tables (Evidence Store, Phase 3).
6. **No invitations or member-management UI**; no password reset; no OAuth; no soft delete or trash; no general rate limiting.
7. **Real sign-up was not submitted automatically**, to avoid sending mail to fake addresses. The sign-up call is unit-tested with a fake client; confirmation is tested with generated tokens.
8. **Confirmation links from the default email template** use the PKCE `/auth/callback` flow, which works only in the browser that signed up. The cross-browser `/auth/confirm` flow needs a template change (§18).
9. **Deleting an auth user** cascades their memberships and can leave an organization without an owner. Ownership transfer and deletion workflows come in Phase 12.
10. **The proxy fails open** if Supabase is unreachable. Pages and routes still deny access themselves.
11. **Legacy demo routes** (`/api/discover`, `/api/graph`) still accept client-side demo worlds. The Neo4j mirror remains a global, demo-only namespace (Phase 10).
12. **All routes now render dynamically**, including demo pages that were static before, because the root layout reads the locale. The impact is negligible; the demo is a client-side app.
13. **`public.rls_auto_enable`** is a Supabase-managed function that existed before Phase 1 and is executable by `anon`. It was left untouched and is not part of ORQO's schema.
14. **`OPENROUTER_API_KEY` is still only an exported shell variable**, not in `.env.local`.

---

## 17. Deferred items

| Item | Target |
| --- | --- |
| Cross-organization bilateral consent / shared opportunity space (Decision B) | Designed in a later phase (6 or 11). Not implemented, and no RLS exception was created. Hook: participants are same-org companies today; cross-org work will go through an explicit sharing entity with per-field disclosure based on the existing 5-level `Visibility` model and mutual opt-in |
| Search-first shell, six spaces, light design, full UI localization, Company/Account settings | Phase 2 |
| Removing the temporary legacy demo redirects | Phase 2 (when those paths become product spaces) |
| Web providers, Evidence Store, open taxonomy, Model Gateway | Phase 3 |
| Agents, orchestration, `agent_runs` / `tool_runs`, observability | Phase 4 |
| Contacts/meetings UI, communications, follow-ups, Action Inbox, invitations | Phases 5–6 |
| Signals ingestion (engine re-evaluation already persists watch conditions) | Phase 7 |
| Neo4j production projection, multi-company proposals | Phase 10 |
| Rate limiting, soft delete, export/erasure, backups/restore drills, CI | Phase 12 (CI could be added sooner if you want it) |

---

## 18. Manual Supabase / dashboard actions still required

No dashboard setting was changed.

1. **Needed before real users can confirm sign-up:** in Authentication → URL Configuration, set **Site URL** (e.g. `http://localhost:3000` for development) and add `http://localhost:3000/auth/callback` and `http://localhost:3000/auth/confirm` to **Redirect URLs**, plus the production equivalents later. Otherwise confirmation links fall back to the Site URL and the session code is not exchanged.
2. **Recommended:** change the "Confirm signup" email template to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`, so confirmation works from any browser or device.
3. **Recommended before inviting real users:** configure **custom SMTP**. Supabase's built-in mailer is heavily rate-limited.
4. Optional: raise the project's minimum password length to 8 to match the app's own rule.
5. Confirm the **backup / PITR** plan for this project (needed by Phase 12, not blocking).

Confirm Email is **ON**, as detected, and was left unchanged.

---

## 19. Environment variables required (names only)

| Name | Scope | Used by |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | App (server-side clients, proxy) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public (RLS-protected) | App |
| `SUPABASE_SECRET_KEY` | **secret, operator only** | Integration tests (Auth admin API). Not read by the app |
| `SUPABASE_DB_URL` | **secret, operator only** | `bun run db:migrate`, integration-test setup/verification |
| `OPENROUTER_API_KEY`, `ORQO_DISCOVERY_MODEL`, `ORQO_LIVE_AI` | secret / config | Demo Live AI (unchanged) |
| `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, `NEO4J_DATABASE` | secret / config | Demo graph sync (unchanged, unconfigured) |
| `BRAVE_API_KEY` | secret | `/api/research` (unchanged, unconfigured) |
| `BASE_URL`, `ORQO_TEST_LIVE_AI` | test only | HTTP and E2E scripts |

---

## 20. Rollback strategy

- **Code:** nothing is merged. Discard or revert the `phase-1-saas-foundation` branch; `main` @ `1be66d6` is untouched.
- **Database:** `supabase/rollbacks/*.down.sql` are manual, destructive, development-only scripts. They drop the Phase 1 objects and remove the bookkeeping rows. The service-role revoke deliberately has no rollback, because restoring it would widen access. Take a backup first; the runner never executes rollbacks.
- **Partial rollback:** the demo does not depend on Supabase. With the Supabase variables removed, the proxy fails open and `/demo` works unchanged. Production pages then report accounts as unavailable.

---

## 21. Recommended Phase 2 entry conditions

- [ ] Review and approve this branch, then merge it to `main` (squash or keep commits).
- [ ] Complete dashboard action §18.1 (redirect URLs), and ideally §18.2–3, then test one real sign-up with a real inbox.
- [ ] Decide on CI now: typecheck, lint, unit and build on every PR; DB/HTTP suites against a dedicated test project.
- [ ] Decide the Phase 2 i18n approach: keep the in-house translator or adopt a library behind `createTranslator`.
- [ ] Confirm that Phase 2 replaces the temporary legacy-demo redirects and whether `/demo` stays public.
- [ ] Decide when the cross-organization sharing design (Decision B) is scheduled.
- [ ] Move `OPENROUTER_API_KEY` into `.env.local` if Live AI should work from any terminal.
- [ ] Keep the baseline green: `test`, `test:db`, `test:http`, `e2e`, `e2e:autodemo`, `e2e:app`, `build`.
