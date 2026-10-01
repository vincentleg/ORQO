# ORQO V2 — Phase 5 Implementation Report

## 1. Status

**Complete, with one provider limitation — and one data-loss incident during testing (§33).**

- Discover answers *"Which companies should my company investigate, and why?"* through the Prospecting Agent, a real Phase 4 agent. The flow is plan → candidates → dedup → verification → mechanism qualification → critic → priority → next action.
- No web-search provider is configured in this environment. The **web-search candidate source is implemented and tested with fixtures only**.
- The working, demonstrable source is the **workspace-knowledge** source, labeled everywhere as *"not live web discovery"*.
- No paid provider was called. The branch is not pushed and not merged.

## 2. Baseline

`main` @ `ce91ccd` (Merge Phase 4). The working tree was clean.

## 3. Branch

`phase-5-discover-prospecting`

## 4. Discover product model

Each surface answers one question:

| Surface | Question |
| --- | --- |
| Search | "I know the company. Analyze it." (unchanged, Free) |
| Discover | "I know what business I want. Find companies." (Pro / operator preview) |
| Network | "I know this company. Remember it." |

The value is in qualification. Every surfaced company shows:

- why it was discovered;
- the concrete mechanism;
- what you contribute;
- evidence on its side;
- Why now (or *not established*);
- what ORQO doesn't know;
- the next validation question;
- the priority and its explicit reasons.

Rejected and unverified companies are listed with reasons.

## 5. Prospecting Agent

The Prospecting Agent in `AGENT_REGISTRY` is now `available`.

| Property | Value |
| --- | --- |
| Plan | Pro (or `ORQO_AGENT_PREVIEW_ORGS`) |
| Tier and parent | specialist, reports to Sales |
| Capabilities | prospect_discovery (+ company_research, business_relevance, opportunity_qualification for display) |
| Mission type | `discover_companies` only |
| Autonomy | 0–2, default 1. Execute is not granted |
| Models | none |

Its tool allow-list is exactly the `prospect_discovery` capability's tools. It has **no** deep research and **no** `evaluate_business_relevance` (qualification goes through `qualify_candidate`). No other agent became executable.

## 6. Discovery mission

`discover_companies` uses `DiscoverCompaniesInput`, a strict zod schema. Its fields:

- `intent`: profile, customers, suppliers, technology_partners, channels or market_entry;
- an optional `objective` (≤ 200 characters, control characters and markup stripped, used only as concepts and search words, never as instructions);
- an optional `geography` and `market`;
- `source`: workspace_knowledge or web_search;
- `maxResults` (1–5);
- `reevaluate`.

The plan, tools, budget, autonomy, organization and limits cannot be passed in: the schema is strict, and forged fields are tested.

## 7. Discovery plan

`buildDiscoveryPlan` in `src/lib/discovery/plan.ts` is pure and deterministic.

- **Mechanisms.** The intent or the workspace's partnership goals select from the Phase 3 mechanisms `build_for`, `regional_deployment`, `sought_capability`, `channel` and `combined_offer`. `segment_customer` is excluded: a shared segment is context, not a mechanism.
- **Feasibility.** A mechanism enters the plan only if the own profile supports it. Otherwise `unsupported` names the missing field.
- **Output.** The plan lists:
  - target characteristics;
  - concepts (lexicon keys);
  - ≤ 2 sanitized queries;
  - exclusions;
  - required evidence;
  - unknowns that matter;
  - profile gaps.
- **No company names.** Nothing is hardcoded and no name enters the plan (tested).

## 8. Candidate sourcing

`CandidateSource` is provider-independent. It returns minimal records: name, URL, hint, source.

| Source | Behaviour |
| --- | --- |
| `workspace_knowledge` | Stored analyses plus Network companies with a website. Internal, free, labeled as not live discovery |
| `web_search` | Wraps the Phase 3 `WebSearchProvider` (Brave adapter): ≤ 2 queries, 8 results each. Failed queries are skipped; their usage is still recorded |

**Snippets are hints, never evidence.** This is tested: evidence links only to retrieved official pages.

## 9. Provider status

| Provider | Status |
| --- | --- |
| Workspace knowledge | ✅ Live in the product. Used in DB, HTTP and E2E tests |
| Brave (web candidates) | ✅ Adapter wired. **Not configured; fixtures and mocks only** |
| Exa | ❌ Not integrated (not faked) |
| Official-site verification | ✅ Reuses the Phase 3 Basic analysis. Not exercised live in Phase 5 |

Without a provider, the web option is disabled in the UI with *"discovery provider is not configured"*. The server fails with `provider_not_configured` before any approval or call.

## 10. Funnel

1. **Stage 1, cheap.** One source → normalization, deduplication, exclusions, Network and stored-research attachment, rejection memory → ≤ 12 candidates. Known companies come first.
2. **Stage 2, narrow.** ≤ 6 verified (stored research reused first, then ≤ 3 new governed official-site analyses) → qualification → critic → ≤ 5 presented.

There is no recursion and no self-expansion.

## 11. Deduplication

- **Identity** is the registrable domain: `www.`, subdomains and `co.uk`-style suffixes are handled.
- **Same company, other domain:** the same normalized name on the same root label is also treated as one company.
- **Merging:** duplicates add hits and hints.
- **Excluded:** the own company; directory, social, media, marketplace and `.gov`/`.edu`/`.mil` hosts.
- **Network:** an existing Network company is attached and shown as *"Already in your Network since…"*, not as new.

## 12. Verification

A candidate is presented only on verified official-source evidence: stored Phase 3 research, or a new governed Basic analysis. That analysis keeps its SSRF protection, robots.txt handling, quota and hard limits.

| Situation | Outcome |
| --- | --- |
| Research fails | `identity_unverified` (rejected) |
| The analyzed site is another domain | `identity_unverified` (rejected) |
| Observe autonomy | Unverified: `observe_only` |
| Verification limit reached | Unverified: `verification_limit` |
| Quota refusal | Unverified: `verification_refused` (partial result) |
| Under 45 s of run time left | Unverified: `budget` (partial result) |

## 13. Qualification and critic

- **`qualifyCandidate`** runs the unchanged `analyzeRelevance` (Phase 3 rules + critic), restricted to the plan's mechanisms. An explicit objective may keep a passing mechanism that sits outside the workspace's declared goals; it is flagged and never ranked High.
- **Evidence floor:** to qualify, at least one substantive FACT is required (a full sentence or a named product). Slogans alone give *weak* at most.
- **`criticizeCandidate`** (the discovery critic):

  | Check | Outcome |
  | --- | --- |
  | Geography mismatch | `outside_geography` |
  | Market mismatch | `outside_market` |
  | Regional mechanism, target already in the region | `region_already_covered` |
  | Source says nothing about the region or market | Kept; recorded as **UNKNOWN**, not a mismatch |

  It also flags competitor risk.

## 14. Prioritization

There are no scores. Tiers: **High priority / Worth investigating / Weak — insufficient evidence**.

They derive from explicit dimensions, each shown in the UI as "Why this priority":

- mechanism accepted or gaps;
- corroboration;
- alignment with partnership goals;
- dated timing;
- the number of open questions;
- competitor risk.

High requires all of: corroborated evidence, alignment, no competitor risk and non-limited confidence. The order is deterministic.

## 15. Evidence discipline

- FACT and INFERENCE labels come from Phase 3 claims, with excerpt, source link and "Stated by the company".
- UNKNOWN fields and validation keys are listed as "What ORQO does not know".
- Assumptions come from the Phase 3 rule templates.
- Nothing is inferred from snippets.

## 16. Why now discipline

Why now is shown only from dated, sourced strategy FACTs (Phase 3 `whyNowClaimIds`). Otherwise it reads *"Not established — no dated evidence."* Both cases are tested, and dated timing ranks first among equals.

## 17. Rejections

There are 12 explicit reasons, each attached to a stage:

| Stage | Reasons |
| --- | --- |
| Sourcing | duplicate, own company, not a company site, previously rejected |
| Verification | identity unverified |
| Qualification | no concrete mechanism, insufficient evidence, category overlap only, relationship not aligned, outside geography, outside market, region already covered |

The UI lists them; the funnel line shows exact counts.

**Rejection memory (implemented simply, no schema):**

- substantive rejections are read from this organization's recent completed Prospecting results;
- they are remembered for 30 days;
- a newer analysis re-opens a company;
- "Re-evaluate" overrides the memory;
- the earlier reason and date are shown.

## 18. Network integration

`addDiscoveredCompany` (a server action plus a server function) works as follows:

- **Allowed:** member+ only.
- **What can be added:** only a company presented in the **stored** result of this organization's Prospecting run.
- **No duplicates:** a company already in the Network under the same domain is reused.
- **Provenance:** `external_ref = discover:<run id>:<domain>`, unique per organization, so a double submit keeps one row.

It is never automatic. Both DB and E2E tests prove there is no duplicate.

## 19. Entitlements and Free

- **Free:**
  - Discover shows a locked Pro card pointing to Search (which stays free);
  - the API refuses with `403 plan_required` **before** any mission, tool or provider, for both sources (tested).
- **Operator preview:** `ORQO_AGENT_PREVIEW_ORGS` makes Discover executable. It grants **no paid spend**.
- **Paid web search:** needs a plan that includes deep research (or `ORQO_RESEARCH_PREVIEW_ORGS`), a configured provider, Prepare autonomy and an admin approval. The entitlement and configuration precheck runs **before** the approval request.
- **Client trust:** the client's plan is never trusted.

## 20. Budgets

**Prospecting limits:**

| Limit | Value |
| --- | --- |
| Tool calls | 28 |
| External requests | 17 (2 search + 3 × 5 official-site) |
| Model calls | 0 |
| Retries | 0 |
| Duration | 130 s |

**Discovery limits:** 2 queries, 8 results per query, 12 candidates, 6 verified, 3 new analyses, 5 results.

Worst cases are reserved before each call (Phase 4 `AgentBudget`). A test checks that the worst case fits the limits. Running out of time or verification allowance gives a labeled **partial result**; any other exhaustion is a controlled `budget_exhausted`.

## 21. Usage and cost

- Web-search usage is written to `usage_events` with `agent_run_id` and a null `research_run_id`. Verification usage keeps the Phase 3 path (research run + agent run).
- Provider-reported cost only: Brave reports none, so `null` is stored.
- The tool-call ledger records cost class `variable` for web search.

## 22. Security

Each item below is tested:

- Anonymous → 401.
- Wrong organization → 404.
- Viewer → 403 `role`.
- CSRF and foreign Origin refused.
- Free → 403 before anything is created.
- Forged top-level plan, budget, tools, organization, approval or preview → 400.
- Forged mission input (plan, tools, budget, `maxResults`, unknown source or intent) → 400.
- Autonomy 3 → 400 even with preview.
- Recommend autonomy cannot reach the paid tool (`tool_denied`).
- Unregistered tools (`send_email`) and deep research are denied for this agent.
- Cross-tenant: runs, knowledge, rejection memory and Add to Network cannot cross organizations (RLS + organization filters; B sees nothing of A).
- SSRF: unchanged (verification goes only through the Phase 3 fetcher). Non-http and IP URLs are refused as candidates.
- Prompt injection in page text changes no verdict, priority, tool sequence, approval or autonomy.
- Provider secrets stay server-only. Without an injected gateway the tools have no paid path.
- The diff was scanned: no secrets.

## 23. Database

**No migration.**

- Missions, runs, steps, tool calls and results reuse the Phase 4 tables. `DiscoveryResult` is contract-checked and kept within the existing 64 KB result limit.
- Provenance uses `companies.external_ref`.
- Usage uses the existing nullable `usage_events.research_run_id`.

## 24. UI and i18n

- **Discover page:**
  - the question;
  - intent chips;
  - objective, geography and market;
  - source (with a truthful web state);
  - result count, autonomy and re-evaluate;
  - live server steps;
  - the result (plan, funnel, companies, next action, rejected, unverified);
  - history.
- **Prospecting Agent page:** the same form, the definition and recent runs.
- **Run page:** renders discovery results.
- **Free:** locked.
- **Languages:** FR and EN. The validation question is worded in the viewer's language at render time.

## 25. Tests

| Suite | Result |
| --- | --- |
| `typecheck` / `lint` | ✅ / ✅ (`lib/discovery` added to the domain boundary) |
| Unit `bun run test` | ✅ **159/159** (+36). Fixture cases A–J, plan, dedup, memory, qualification, critic, priority, contract, registry, policy, orchestrator (workspace, Observe, infeasible, verification cap, time budget, quota refusal, memory, injection, Why now, web: denied, unconfigured, not entitled, approval → resume, usage attribution) |
| `test:db` | ✅ **148/148** (+5, `tests/db/discover.test.ts`): end to end over stored research under RLS, run history, memory isolation, Add to Network provenance and no duplicates, forged and cross-tenant adds |
| `test:http` | ✅ **52 pass, 1 skipped (pre-existing), 0 fail** (+6, `tests/http/discover.test.ts`, preview block run) |
| `build` | ✅ |
| `e2e:discover` (new) | ✅ No console errors, 10 screenshots |
| `e2e:agents` | ✅ Updated: Prospecting is now executable in preview. **One failure in a chained run; it passed on immediate rerun and on a repeat of the same sequence. Cause not identified** (the output was truncated) |
| `e2e` (demo) / `e2e:autodemo` | ✅ / ✅ — `/demo` untouched |
| `e2e:app` | **Not re-run**: it makes a live gigaio.com fetch. Search code is unchanged, and the Search page is covered by `e2e:discover` over stored research |

Two Phase 4 assertions that encoded "Prospecting is coming soon" were updated to Phase 5 semantics.

## 26. Provider calls

**Zero external provider calls.** No Brave, no OpenRouter, no live website fetch: every test and E2E used fictional stored research or fixtures.

## 27. Manual and browser validation

Headless browser (`e2e:discover`), checking:

- the form, with the web option disabled and explained;
- real step progress;
- qualified companies with evidence;
- Why now present or unknown;
- the Network marker;
- the plan and rejected sections;
- Add to Network, then *"Already in your Network"*, with one row;
- history;
- the Prospecting Agent page and the run page;
- the Search regression;
- FR;
- Free locked.

Screenshots: `.screenshots/discover-*.png`. **A human product review has not been done yet.**

## 28. Known limitations

- **Web discovery** is unproven against a live provider. Approve → resume is unit-tested only.
- **Workspace-knowledge source:** it ranks companies ORQO already knows; it does not find new ones. This is labeled.
- **Runs are synchronous** (≤ 130 s). The verification of a new analysis needs 45 s of headroom, so slow sites lead to partial results.
- **Rejection memory** reads only the last 10 Prospecting runs within 30 days.
- **Stored results are snapshots:** the stored result keeps the run-language validation text; the UI re-words it from the key.
- **Name-based dedup** across different domains only applies to the same root label.
- **The "FREE" workspace badge** also shows under operator preview (pre-existing presentation).

## 29. Deferred work

- Exa or other semantic sources.
- Model-assisted query generation and synthesis.
- Background or durable discovery runs.
- Contact discovery.
- A dedicated decision table for rejection memory.
- "Added from Discover" shown on the Network page.
- Billing-backed entitlements.
- Phase 6+ (Network intelligence, follow-ups, Signals, Events, custom agents, Neo4j).

## 30. Main files

- **New, pure:** `src/lib/discovery/{types,plan,candidates,qualify,fixtures}.ts` (+ test).
- **New, server:**
  - `src/lib/server/agents/discovery.ts` (+ test);
  - `src/lib/server/discovery/{sources,knowledge,network}.ts`.
- **New UI:**
  - `src/components/orqo/{discover-form,discovery-result}.tsx`;
  - `src/app/actions/discover.ts`;
  - the Discover page.
- **Modified:**
  - agents `types`, `registry`, `tools`, `contracts`, `budget`;
  - the server `orchestrator`, `tools`, `service`;
  - `relevance.ts` (exports only);
  - `research/repository.ts` (nullable research run on usage);
  - `plans.ts`;
  - the EN/FR catalogs;
  - the agent and run pages, `agents.tsx`;
  - `eslint.config.mjs`, `package.json` (`e2e:discover`).
- **Tests and scripts:** `tests/db/discover.test.ts`, `tests/http/discover.test.ts`, `scripts/e2e-discover.ts`; updates to `tests/http/agents.test.ts`, `scripts/e2e-agents.ts` and two unit tests.

## 31. Commits

`git log ce91ccd..phase-5-discover-prospecting`:

1. `97033b6`: the implementation, tests and this report.
2. The test-safety fix after the incident (§33).

## 32. Phase 6 readiness

**Ready.**

- **Network intelligence** can read the `discover:` provenance and the Prospecting results.
- **Follow-ups** can consume `nextAction` and the validation keys.

**Before paid discovery ships:**

- configure and live-test one search provider on a preview workspace;
- billing-backed entitlements;
- background runs.

## 33. Incident: development workspace deleted by a test run

**What happened.** On 2026-10-01 at about 03:44 UTC, during Phase 5 HTTP testing, the real development workspace `8c153dad-a537-49f2-abda-88c7deb857d1` (the INFODIP workspace used for the Phase 4 manual review) was deleted.

**Root cause.**

- The preview blocks of `tests/http/{agents,discover}.test.ts` and `scripts/e2e-{agents,discover}.ts` took a fixture organization id from an environment variable (`AGENT_PREVIEW_ORG` / `E2E_AGENT_PREVIEW_ORG`).
- They ran an unconditional `delete from public.organizations where id = <that id>` through the owner database connection (RLS does not apply), recreated the org for the test, and `cleanupTestData` removed it afterwards.
- During Phase 5 testing, that variable was set to the first id of the app's real `ORQO_AGENT_PREVIEW_ORGS`. Nothing distinguished preview authorization from fixture identity, nothing verified ownership before deleting, and the tests run against the same Supabase project as the real workspace.
- Phase 4 had used a dummy id (`a4a4a4a4…`), so the defect stayed latent.

**Affected data.** All rows linked by `ON DELETE CASCADE` to the organization:

- memberships;
- companies, including the own-company profile, plus their capabilities and needs;
- contacts, relationships, opportunities and participants, analysis runs;
- sources, research runs, company intelligence and evidence;
- usage events and audit events;
- agent missions, runs, steps, tool calls and approvals.

The user account and profile survived.

**Recovery limitation.**

- The project is on the Supabase Free plan, with no scheduled backups or point-in-time recovery.
- Autovacuum has since reclaimed the deleted tuples, and the audit rows were cascade-deleted with the organization.
- No local artifact holds a copy beyond fragments in earlier session notes. The data is **not recoverable** and must be recreated manually.

**Safeguards implemented.**

1. **Environment authorization** (`tests/support/safety.ts`, enforced when `tests/support/supabase.ts` is imported, so every DB/HTTP suite and every E2E script):
   - destructive suites refuse to run unless `ORQO_DESTRUCTIVE_TESTS_PROJECT` equals the project ref of both `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_DB_URL`;
   - the old `AGENT_PREVIEW_ORG` / `E2E_AGENT_PREVIEW_ORG` variables are rejected.
2. **Fixture identity ≠ preview authorization:**
   - the preview fixture comes from `TEST_PREVIEW_ORG`, must be in the reserved `7e570000-` namespace, and is refused if it appears in the repository's real `ORQO_AGENT_PREVIEW_ORGS` / `ORQO_RESEARCH_PREVIEW_ORGS`;
   - the test server is started with that synthetic id only.
3. **Ownership is proven in the database before any delete:**
   - `deleteOrganizationIfTestOwned` deletes only if the organization was created by one of **this run's** test users (email with the unpredictable run id; admin-only `app_metadata.orqo_test_run`);
   - it must have no member outside them, must not be a configured preview organization, and must carry the `[orqo-test:<run>]` name marker for synthetic orgs;
   - the conditions are repeated inside the `DELETE` itself;
   - anything unproven aborts, and nothing is deleted.
4. **Shared cleanup:** `cleanupTestData` now targets only this run's users and their organizations, and aborts as a whole if any such organization is preview-configured or has a non-test member.
5. **No unconditional deletes remain:** the four suites create the synthetic org through `createSyntheticPreviewOrg` (a leftover is removed only after proven ownership).
6. **Regression tests:**
   - `tests/unit/test-safety.test.ts` (environment, legacy variables, preview ≠ fixture, reserved namespace);
   - `tests/db/test-safety.test.ts`: a real-like org, a forged marker, a foreign member and a preview-configured org are never deleted (checked inside always-rolled-back transactions); an invalid id aborts; a synthetic org is cleaned up; cleanup is limited to this run.

**Recommendation.** Before production, create a **dedicated Supabase test project**, used only for `test:db`, `test:http` and `e2e*`, and authorize destructive tests only for its ref. Keep real workspaces, even development ones, in a project the test suites never point at. Enable backups on any project holding real data.
