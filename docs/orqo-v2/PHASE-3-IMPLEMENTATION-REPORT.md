# ORQO V2 — Phase 3 Implementation Report

## 1. Status

**Complete, with one provider limitation.**

- Search runs a real, evidence-based company analysis end to end: resolve → official sources → structured understanding → comparison with your own company → opportunities that passed the critic.
- No paid provider credentials exist in this environment (no Brave, OpenRouter, Exa or Firecrawl keys). The paid **Deep research** path is therefore implemented and tested with mocks only.
- The branch is ready for human review. It is not pushed and not merged.

## 2. Baseline

`main` @ `59d0806` (Merge Phase 2 shell and design system). The working tree was clean at the start.

## 3. Branch

`phase-3-web-intelligence`

## 4. Architecture implemented

```
Browser ──POST /api/v1/organizations/:org/research (JSON, same-origin)──▶ route
  route: auth → membership (member+) → entitlement (authoritative plan / operator preview)
         → provider configured → cache reuse → start_research_run RPC (atomic quota + concurrency)
  stream (NDJSON, real stages) ◀── runCompanyResearch(deps, input)   [RunBudget hard limits]
         resolve → robots.txt + official pages (SSRF-safe) → [deep: Brave + 3rd-party pages]
         → deterministic extraction → [deep: model extraction, quotes verified]
         → [deep: model hypotheses] → deterministic critic
  persist: sources (+authority) · company_intelligence · evidence_items · usage_events · research_runs
Search page (server) reads the stored result and recomputes relevance against the CURRENT own profile.
```

- **`src/lib/intelligence/`** (pure, under the ESLint domain boundary): types and zod schemas, HTML reader, bilingual concept lexicon, deterministic extraction, relevance rules plus critic, and model I/O contracts.
- **`src/lib/server/research/`**: the server side.
  - URL safety and the fetcher.
  - Provider interfaces and adapters.
  - Limits, quotas and model policy.
  - The budget, the service, the policy gate and the repositories.

## 5. Search flow

1. The user types a name, a domain or a URL. `parseSearchQuery` (Phase 2) normalizes it.
2. The page checks the Network (by domain or name), then looks for **stored intelligence** for this workspace (by domain, else by folded name).
3. **No stored result:**
   - an *Analyze {target}* card explains exactly what will happen ("official website only, no AI model, no paid provider");
   - it shows the remaining daily allowance and a **Run company analysis** button.
   - Deep research appears as a locked **Pro** card.
4. **While running:** the UI lists the stages the server actually streams: Resolving → Finding authoritative sources → Reading → Structuring evidence → Comparing with {own} → Evaluating. There are no timers.
5. **Result.** The page shows these sections:
   - **Header:** name, website, researched-at (UTC), source count, mode, a stale badge, and Add to Network or "In your Network since…".
   - **What they do.**
   - **Why {target} could matter to {own}:** the opportunities, hypotheses to validate, a possible-competitor insight, and the ideas that were rejected.
   - **Next best action.**
   - **Unknowns and own-profile gaps.**
   - **Evidence and sources** (collapsed).
6. **Name inputs:**
   - **Basic** tries exactly one inferred `{name}.com` and accepts it only if the homepage identifies as that company and is not a parked domain. It is labeled "Website inferred from the name — check".
   - **Deep** resolves through search. When several sites match, it shows the candidates instead of guessing.
   - A Network company's stored website is always preferred.

## 6. Web research layer

| Piece | Implementation |
| --- | --- |
| Provider abstraction | `WebSearchProvider`, `ModelProvider`, `PageFetcher` interfaces; business logic depends only on these |
| Brave | `braveSearchProvider`. The legacy `braveSearch` now delegates to it, so there is one implementation |
| OpenRouter | `openRouterModelProvider` over the existing `structuredCompletion`, which now accepts `max_tokens`, requests `usage: {include: true}`, returns provider usage, and raises `CompletionError` (with usage) on invalid output |
| Official site | `createPageFetcher`: manual redirects, re-validated each hop; http(s) only; no credentials; 1.5 MB / 8 s per page; HTML only; `robots.txt` honoured (our agent or `*`) |
| Model policy | `modelFor(task)`: `extraction` and `reasoning`, from `ORQO_MODEL_EXTRACTION` / `ORQO_MODEL_REASONING` (default: the existing low-cost `ORQO_DISCOVERY_MODEL`). This is a seam, not the Phase 4 router |
| Exa / Firecrawl | **Not integrated** (no need demonstrated and no credentials). The interfaces are the seam |

## 7. Providers actually implemented and tested

| Provider | Implemented | Tested |
| --- | --- | --- |
| Official website retrieval | ✅ | ✅ **Live** (gigaio.com, §18), plus fixtures |
| Brave Search | ✅ adapter | Mocks only (no `BRAVE_API_KEY`) |
| OpenRouter | ✅ adapter | Mocks only (no `OPENROUTER_API_KEY`) |
| Exa, Firecrawl | ❌ | — |

## 8. Evidence and provenance model

- **`sources`** (reused). A new `authority` column: `official | third_party | search_result`. Sources are upserted per organization by `external_ref = web:<url>`, so a refresh updates `retrieved_at` and creates no duplicates.
- **`evidence_items`** (new; this is the normalized Evidence Store deferred by Phase 1). There is one row per claim:
  - `field`, `statement`, a **short verbatim `excerpt`** (≤ 300 characters; never a page copy), and `epistemic`;
  - `method`: structured_data, page_metadata, page_text, navigation or model_extraction;
  - `concepts` and `self_described`;
  - a composite FK to a **same-organization** source. The database refuses a FACT without a source.
- **`company_intelligence`** (new). The current analysis per organization and domain: resolution, language, unknowns, the source map, model hypotheses (deep only) and `researched_at`.
- **Each claim answers:** what the claim is, where it came from (URL), when it was retrieved, whether it is direct or derived, the source's authority, and which company it concerns.
- **Search snippets are never primary evidence.** A `search_result` source cannot support a critic check.

## 9. Company understanding

`extractTargetProfile` is deterministic and quotes everything it uses.

- **FACT (the company describing itself, flagged "Stated by the company"):**
  - JSON-LD Organization: name, description, founding date, address;
  - meta and OG description;
  - product and solution names from site navigation;
  - customer statements;
  - dated strategy statements (news page, or this or last year).
- **INFERENCE:** categories (offering type, technologies, industries, customer types, geographies, business model) detected from the company's own sentences, each carrying the sentence it was inferred from.
- **Visible needs:** "Runs a partner program" and "Is recruiting", as inferences.
- **UNKNOWN:** every field without evidence is listed. Nothing is filled to complete the UI.
- **Data minimization:**
  - sentences about individuals (biographies, degrees, careers, pronoun-led sentences) are never processed or quoted;
  - form, select and CTA content is ignored.
- **Deep mode:**
  - a model also extracts claims, but a claim is kept **only if its quote is found verbatim in the cited source**; unverifiable claims are dropped, not downgraded;
  - up to 2 retrieved third-party pages are added as `third_party` sources.

## 10. Business relevance and opportunity analysis

- **Own-company context.** The Company profile is now editable, with focused fields:
  - offerings, target customers, markets, geographies and what you are looking for;
  - **partnership types wanted**, chosen from the 9 relationship types.

  The analysis uses the real persisted profile. If the profile is insufficient, it returns `own_profile_missing` and lists the gaps ("Add your target markets…"). It never infers a strategy.
- **Deterministic rules** over a generic, customer-agnostic lexicon:

  | Rule | Relationship | Fires when |
  | --- | --- | --- |
  | segment_customer | customer | The target operates in a segment you sell to |
  | sought_capability | supplier | The target offers what you are looking for (concept or literal phrase) |
  | channel | channel | The target is a distributor or reseller with reach in your segment or region |
  | complementary | technology / integration partner | Same segment or technology, with complementary offer types |
  | oem_build | OEM / ODM | You manufacture; they sell hardware |

  A *possible competitor* insight appears when offers overlap.
- **Why now** is attached only from **dated, sourced strategy statements** that touch the opportunity's drivers or your markets. Otherwise it says "Not established".
- **Each opportunity shows:**
  - title and relationship type;
  - why it could make sense (labeled INFERENCE);
  - what each side brings: your profile fields, and the target's quoted evidence with source numbers;
  - why now;
  - assumptions and questions to validate;
  - the recommended next step;
  - the critic checks and a qualitative confidence.
- **Display:** at most 3 opportunities and 3 hypotheses. "No credible opportunity identified yet" is a first-class result.
- **Freshness:** relevance is **recomputed at render** against the current own profile. Editing the profile updates the analysis without new research or cost.

## 11. Critic and quality gate

The critic reuses the validated philosophy (pass / weak / reject, qualitative confidence, no percentages) without touching `src/lib/engine`. These checks apply to rule candidates and model candidates alike:

| Check | Fail or warn when |
| --- | --- |
| target_evidence | No retrieved, non-snippet source supports it → **reject** |
| own_context | Your profile does not support it → **reject** |
| specificity | Only generic concepts (AI, software, cloud, platform…) or generic wording ("synergies", "both use AI", "collaborate to create…", "win-win") → **reject** |
| mechanism | It does not say what each side brings → **reject** |
| goal_fit | Your goals are unset, or this relationship type is not among them → warn |
| corroboration | Only one supporting statement → warn |
| timing | Informational only. Never inflates or penalizes |

**Verdict:** any fail → reject. Two or more warnings → weak (hypothesis). Otherwise → pass.

**Confidence:**

- **strong** requires no warnings, timing evidence and an independent source, so Basic (official-site-only) analyses top out at **moderate**;
- **limited** applies otherwise.

Model hypotheses are untrusted: invented claim ids are dropped, and a hypothesis without real evidence is rejected (tested).

## 12. Free / paid cost policy (Phase 3)

| Mode | Plans | What it can reach | Allowance |
| --- | --- | --- | --- |
| **Company analysis (Basic)** | All, including Free | Official website only: robots.txt plus ≤ 4 pages. **No search API, no model.** `deps.search` and `deps.model` are `null` by construction in the route | 20 runs / organization / 24 h |
| **Deep research** | Pro+ (`search.deepResearch`) | Brave (≤ 2 queries), ≤ 5 official and ≤ 2 third-party pages, OpenRouter (≤ 2 calls, ≤ 4k output tokens each) | 3 runs / organization / 24 h |

- **No workspace is entitled to Deep research yet.** There is no billing, and `getEntitledPlan()` returns `free`.
- The only exception is the operator allowlist `ORQO_RESEARCH_PREVIEW_ORGS`. It is not billing, grants no plan, and keeps the same quota and limits.
- A Free user therefore **cannot trigger any variable-cost provider call**.
- **Pre-existing cost hole closed.** The legacy demo routes `/api/discover` and `/api/research` let any signed-in (that is, any signed-up) user spend OpenRouter and Brave credits. They now require `ORQO_DEMO_LIVE_PROVIDERS=on` (default off), and `/api/status` reflects that.
- All values are central in `src/lib/server/research/config.ts`. No pricing was invented.

## 13. Server-side variable-cost protection

The chain, enforced in the route **before any provider is reached** (`policy.ts` + RPC):

1. **CSRF:** JSON content type is required, and the `Origin` must match the host.
2. `requireAuth`, verified with the Supabase Auth server.
3. `requireMembership` under RLS. Non-members get **404**, so organizations cannot be enumerated.
4. Role must be **member** or above (viewers get **403 `role`**).
5. **Entitlement.** `getEntitledPlan` is a new, authoritative seam, separate from the presentational `getPresentedPlan`, plus the operator preview list. Otherwise **403 `plan_required`**.
6. **Provider configured.** Otherwise **503 `providers_unconfigured`**.
7. **Cache reuse.** A fresh result returns `{status: "cached"}` with no run. A refresh within 24 h returns **409 `refresh_too_soon`**.
8. **`start_research_run` RPC** (`SECURITY DEFINER`, pinned `search_path`, per-organization advisory lock):
   - it re-checks member+;
   - it refuses a second concurrent run (**409 `busy`**);
   - it counts the window quota (**429 `quota_exhausted`**);
   - it then inserts the run.

   Members cannot insert, delete, back-date or re-mode runs (no grants). Calling the RPC directly only creates rows that count against the caller.
9. **`RunBudget` hard limits** for every page, query and model call, plus a run deadline (40 s Basic / 110 s Deep). There are no retries and no unbounded loops.

The client button is never the boundary. The tests call the route directly (§17).

## 14. Usage and cost recording

- **`usage_events`** (append-only; readable by **admin+**): organization, user (`created_by`, trigger-forced), research run, provider, service or model, operation (`web_search`, `extraction`, `reasoning`), success, provider-reported `units` (queries and results; prompt and completion tokens), and `cost_usd` **only when OpenRouter returns it**. Costs are never estimated.
- Failed provider calls are recorded too, because they may still bill.
- **`research_runs.counters`** records the hard-limit accounting for every run, including free ones: search queries, official and third-party pages, model calls, bytes, and warnings.

## 15. Caching and reuse

- **Identity:** one current analysis per (organization, normalized domain), also found by folded name. A Network company's website resolves name searches.
- **Fresh** (< 7 days): reused automatically, by the page and by the route. Nothing is spent.
- **Stale** (> 7 days): shows a "May be outdated" badge.
- **Refresh:** allowed once the result is at least 24 h old ("Refresh available from {date}"). It counts against the allowance.
- **Display:** the UI always shows "Researched {date} UTC · N sources · mode" and that the analysis is saved and reused. Nothing old is presented as current.

## 16. Security: SSRF, prompt injection, tenancy, privacy

- **SSRF (`url-safety.ts`):**
  - http(s) only, no credentials, ports 80/443 only;
  - no IP literals in any notation;
  - no `localhost`, `.local`, `.internal`, `.lan`, `.arpa`, `.test`… or single-label hosts;
  - DNS resolution must yield **only public unicast** addresses. Loopback, RFC 1918, link-local (cloud metadata `169.254.169.254`), CGNAT, multicast, reserved, IPv6 ULA/link-local and IPv4-mapped forms are refused;
  - every redirect hop is re-validated, with at most 3 redirects.
  - **Residual:** DNS rebinding between check and connect (the HTTP client re-resolves). This is documented; a pinned-address transport is future work.
- **Prompt injection (`model-io.ts`):**
  - trusted instructions live only in the system message;
  - web content sits only inside `<untrusted_source>` blocks, with delimiter look-alikes neutralized;
  - the model has no tools, and its output is schema-validated;
  - quotes are verified verbatim and claim ids are checked;
  - every hypothesis passes the deterministic critic.
  - **Basic mode has no model at all**, so page text is inert data.
  - Nothing a page says can change permissions, budgets, tenants or persistence.
- **Tenancy:**
  - all 4 new tables have `organization_id`, RLS default-deny, composite same-organization FKs, immutable ownership and forced `created_by` triggers;
  - `anon` and `service_role` hold no privileges.
- **Privacy:** company data only. Biography and person sentences are dropped, and contact data is not collected.
- **Rendering:**
  - excerpts render as text;
  - source links are validated `http(s)` with `rel="noopener noreferrer nofollow"`.
- **Secrets:** credentials stay server-only. No secret is printed or tracked, and `.env.example` holds names only.

## 17. Database changes

**Migration `20261001090000_phase3_web_intelligence.sql`** (forward-only, additive, applied to the development project). It changes:

- `companies`: `offerings`, `customer_segments`, `sought_capabilities`, `partnership_goals`, with size and allowed-value checks;
- `sources`: adds `authority`;
- new enums `research_mode` and `research_status`;
- new tables `research_runs`, `company_intelligence`, `evidence_items` and `usage_events`, with indexes on the quota, name and intelligence lookups;
- the `start_research_run` RPC;
- the grants and RLS policies.

**Rollback:** `supabase/rollbacks/20261001090000_phase3_web_intelligence.down.sql` (manual; destructive for Phase 3 data, as documented). No historical migration was modified.

## 18. Tests and results

| Check | Result |
| --- | --- |
| `bun run typecheck` | ✅ 0 errors |
| `bun run lint` | ✅ 0 problems (the domain boundary now covers `lib/intelligence`) |
| `bun run test` (unit) | ✅ **74 / 74** (Phase 2: 38; Phase 3: +36). Covered: HTML reader; concepts; extraction with fact/inference/unknown; privacy, form and CTA filters; name verification and parked domains; relevance (opportunities, `none`, `own_profile_missing`, why-now only from dated evidence); critic rejection of generic, unsupported and one-sided ideas; untrusted model hypotheses; delimiter neutralization; quote verification; SSRF shapes, addresses and DNS; redirect, size, type and timeout handling; robots.txt; RunBudget; the service (Basic bounded with **no paid call even when providers are passed in**; Deep bounded, with usage recorded and an invented claim dropped; ambiguity; every failure state); the Brave adapter |
| `bun run test:db` (real Supabase) | ✅ **131 / 131**. Phase 3 adds 16 and the schema suite +2: round trip; source and evidence replacement without duplicates; own-profile update by member, refused for viewer and for an invalid goal; **B cannot read, update or delete A's rows in all 4 new tables**; B cannot insert rows claiming Org A; anon reads nothing and cannot call the RPC; cross-organization source citation refused (23503); unsourced FACT refused (23514); ledger append-only and admin-only; no anon or service_role grants; RPC refuses non-members and viewers; **6 concurrent starts → exactly 1 run**; window quota enforced (54000), with runs undeletable, unbackdatable and not re-modable |
| `bun run test:http` (`next start`) | ✅ **32 / 32**. Phase 3 adds 9: anonymous 401; CSRF (form content type 400, foreign Origin 403); cross-organization 404; viewer 403; **Free deep 403 `plan_required`, no run created**; invalid input 400; **quota 429**; cache hit without a new run, early refresh 409; **end-to-end SSRF** (`localtest.me` → 127.0.0.1 ⇒ streamed `site_blocked`, run recorded as failed, 0 usage events) |
| `bun run build` | ✅ 35 routes |
| `bun run e2e:app` | ✅ No console errors. The Phase 2 path, plus: profile editing; the failure state (non-existent host → "could not be reached", no analysis rendered); locked Deep research; **real analysis of gigaio.com** with streamed stages, opportunities, evidence and unknowns; stored-result reuse with refresh deferred; Add to Network → Network; French analysis |
| `bun run e2e` (manual demo) | ✅ Passed, no console errors |
| `bun run e2e:autodemo` | ✅ Passed. ⚠️ It failed 3 times in a row right after `e2e:app`, on a Playwright strict-mode collision with Next's route announcer (`getByText` matched both the finale heading and the announcer). The demo code is byte-identical to baseline. The baseline build also passes, and the branch build passed on rerun: a pre-existing timing-sensitive locator, not a regression. Hardening the locator is left to review |

## 19. Real provider smoke test

**One** controlled target, gigaio.com (the prompt's example), **official-site retrieval only**. This is the only provider path that exists here.

| | Result |
| --- | --- |
| Providers | Direct HTTPS to gigaio.com (no vendor) |
| Operations | 1 robots.txt + 4 pages (`/`, `/about-us/`, `/products/`, `/news/`); ≈ 2.0 MB; ≈ 0.4–1.2 s |
| Model / cost | None / $0. No paid provider was called |
| Outcome | ✅ Name *GigaIO*. A quoted self-description (Gryf portable AI supercomputer). Products from navigation: Gryf, Manticore, Accelerator, Compute, Network and Storage Sleds. Inferred technologies: composable infrastructure, AI infrastructure, HPC, edge, rugged. Industries: defense & intelligence, energy, media. A partner program. Dated partnership news (Mushroom Networks). Unknowns: business model. Geography became unknown after the biography filter removed person-derived noise |
| Analysis vs a sample rugged-server / ODM own profile | 3 opportunities passed the critic: **supplier** (composable infrastructure / AI infrastructure sought), **OEM / ODM** (you manufacture, they sell hardware), **integration partner** (limited; goal not set). Plus a possible-competitor insight on rugged servers. No timing claimed |

The smoke run first exposed navigation chrome, form options and team biographies leaking into claims. These were fixed and covered by tests before the final run. The E2E then repeated the same single-site analysis (this is free).

**Brave and OpenRouter: not smoke-tested.** No credentials are configured. Nothing claims they work live.

## 20. Known limitations

- **Deep research is unverified live.** It is unavailable to every workspace until billing exists, or an operator adds the organization to `ORQO_RESEARCH_PREVIEW_ORGS` and configures `OPENROUTER_API_KEY` (and optionally `BRAVE_API_KEY`).
- **Basic name-only resolution** tries only `{name}.com`. Other TLDs, or names whose domain differs, need the website. The UI says so.
- **Lexicon-based Basic analysis** is deliberately conservative. It understands only concepts in the generic lexicon (≈ 60, EN/FR), and literal own-profile phrases. Niche offerings may yield "No credible opportunity identified yet" until a deep run or a richer lexicon.
- **DNS rebinding** residual risk (§16).
- **Persistence is not transactional.** `saveIntelligence` runs as several statements. A failure mid-save marks the run failed but may leave evidence partially replaced; the next run repairs it. An RPC transaction is future work.
- **Usage ledger trust.** Members can append their own rows. They cannot alter or delete them, and it only affects their own organization. A service-side writer belongs to the future Cost Ledger.
- **Stale run rows.** A run whose process dies stays `running` until 150 s pass, then stops blocking.
- **Dates** show in UTC.
- **Synthesis language.** Basic synthesis is localized through templates (EN/FR). Quoted evidence stays in the source's language.

## 21. Deferred Phase 4+ work

Not built, by design:

- **Phase 4:** agent registry, orchestration and LangGraph; the full Model Router.
- **Later phases:**
  - Prospecting, Discover and Signals monitoring;
  - background or scheduled research, events;
  - Follow-up, email and CRM integration;
  - a Neo4j production graph;
  - Stripe, subscriptions and authoritative plans;
  - the full Cost Ledger with budgets and kill switches;
  - Exa and Firecrawl adapters;
  - people and contact enrichment;
  - the relationship timeline.

## 22. Main files changed

- **New, pure:** `src/lib/intelligence/{types,concepts,html,extract,relevance,model-io,fixtures}.ts`, plus tests.
- **New, server:**
  - `src/lib/server/research/{types,config,url-safety,fetcher,budget,providers,service,policy,repository}.ts`, plus tests;
  - `src/app/api/v1/organizations/[organizationId]/research/route.ts`.
- **New, UI:** `src/components/orqo/{analysis,research-runner}.tsx`.
- **Modified:**
  - `src/app/workspace/page.tsx` (Search), `src/app/workspace/company/page.tsx`, `src/app/actions/workspace.ts`, `src/components/saas/forms.tsx`;
  - `src/lib/server/{ai/openrouter,config,entitlements,http}.ts`, `src/lib/server/repositories/companies.ts`, `src/lib/server/research/brave.ts`;
  - `src/app/api/{discover,research}/route.ts`, `src/lib/entitlements/plans.ts`, `src/lib/i18n/messages/{en,fr}.ts`, `eslint.config.mjs`.
- **Database:** `supabase/migrations/20261001090000_phase3_web_intelligence.sql`, `supabase/rollbacks/…down.sql`.
- **Tests and scripts:** `tests/db/research.test.ts`, `tests/http/research.test.ts`, `tests/db/schema.test.ts`, `scripts/e2e-app.ts`.
- **Docs:** `.env.example`, `README.md`, this report.

The engine (`src/lib/engine`, `src/lib/domain`) and the demo are unchanged.

## 23. Commits

See `git log 59d0806..phase-3-web-intelligence`:

1. The research layer, evidence store, policy, UI and tests.
2. Extraction quality and privacy filters, regression updates, E2E, docs and this report.

## 24. Phase 4 readiness

Ready. Phase 4 can build on:

- **Provider interfaces** (`WebSearchProvider`, `ModelProvider`, `PageFetcher`) as the `web.search`, `web.crawl` and `web.extract` tools;
- **`modelFor(task)`** as the Model Router seam;
- **The authorization chain** (`authorizeResearch` → `start_research_run` → `RunBudget` → `usage_events`), the template for every agent run;
- **`research_runs`** as the precursor of `agent_runs`;
- **The critic and `model-io` contracts**, so agent output stays untrusted, verified and gated.

Before any paid agent ships:

- `getEntitledPlan` must read real subscriptions;
- the usage ledger should move to a service-side writer with budgets.
