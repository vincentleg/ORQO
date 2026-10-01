# ORQO

**Opportunity Relationship Qualification & Orchestration** — an autonomous business development network.

> You meet the person. ORQO finds the business.

Every professional gets a Business Agent. When two people connect, their agents research both companies, reason **bilaterally** (representing both sides, not selling one to the other), test concrete business structures, and let a **critic** try to reject every idea. What survives is a concrete opportunity — with evidence, assumptions, unknowns, risks and a next step — not a compatibility score. Relationships persist: when a new signal arrives months later, ORQO re-evaluates dormant relationships and searches the network for the company that closes the gap.

LinkedIn maps who you know. ORQO discovers what you can build together.

---

## Run it

Requires [Bun](https://bun.sh) ≥ 1.2 (no Node.js needed; Next.js runs on the Bun runtime).

```bash
bun install
bun run dev          # http://localhost:3000   → production app entry
                     # http://localhost:3000/demo → the interactive demo (no account)
```

Other scripts:

| Command | What it does |
| --- | --- |
| `bun run build` / `bun run start` | Production build / serve |
| `bun run test` | Unit tests: the engine (the whole demo story as assertions), i18n, auth flows, DB ↔ engine mapping. No network |
| `bun run test:db` | Integration tests against the Supabase project in `.env.local`: auth, organizations/roles, **cross-tenant RLS isolation**, persistence, schema. Creates and deletes throwaway users |
| `bun run test:http` | Server authorization over HTTP (needs a running server, `BASE_URL` defaults to `http://localhost:3100`). `ORQO_TEST_LIVE_AI=1` adds one real OpenRouter call |
| `bun run db:status` / `bun run db:migrate` | List / apply the SQL migrations in `supabase/migrations/` using `SUPABASE_DB_URL` |
| `bun run e2e` | Headless walk-through of the full demo (needs `bunx playwright install chromium` once and the dev server running). Screenshots land in `.screenshots/`, and it fails on any console error |
| `bun run e2e:app` | Headless walk-through of the production app: sign in, first workspace, the six spaces, company profile, Search → company analysis (one real Basic analysis of `E2E_ANALYSIS_DOMAIN`, default `gigaio.com`; official site only, no paid provider) → Add to Network, locked Pro agent → Plans, FR/EN, sign out (`BASE_URL` defaults to `http://localhost:3100`) |
| `bun run e2e:agents` | Headless walk-through of the Agents space (Phase 4): preview catalog, a Research Agent mission over stored research (no web fetch, no provider), run detail, a failed run, an approval rejected from the UI, the Partnership Manager, FR, and the locked Free state. Needs the server started with `ORQO_AGENT_PREVIEW_ORGS=<E2E_AGENT_PREVIEW_ORG>` (default `a4a4a4a4-0000-4000-8000-000000000004`). The same id in `AGENT_PREVIEW_ORG` enables the preview block of `test:http` |
| `bun run e2e:discover` | Headless walk-through of Discover (Phase 5) over the workspace-knowledge source (fictional stored research; no web fetch, no provider) |
| `bun run typecheck` / `bun run lint` | TypeScript / ESLint |

**Destructive-test safety (after the Phase 5 incident, see `docs/orqo-v2/PHASE-5-IMPLEMENTATION-REPORT.md`).** `test:db`, `test:http` and every `e2e*` script create and delete data, so they refuse to start unless `ORQO_DESTRUCTIVE_TESTS_PROJECT` equals the Supabase project ref of both `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_DB_URL`. Use a **dedicated test project**, never one holding real workspaces. Suites only delete organizations the database proves this run created (creator = this run's test user, no other member, never a configured preview org). Preview blocks use a **synthetic** org id from `TEST_PREVIEW_ORG` (reserved `7e570000-` namespace, default `7e570000-0000-4000-8000-000000000001`); start the test server with `ORQO_AGENT_PREVIEW_ORGS=<that id>`. A real preview org id is refused, and the old `AGENT_PREVIEW_ORG` / `E2E_AGENT_PREVIEW_ORG` variables are rejected.

The demo works with **no environment variables**. The production app (accounts, workspaces) needs the Supabase variables in [`.env.example`](.env.example). Put secrets in `.env.local`, which git ignores.

**Reset demo** (bottom of the sidebar) restores the initial network. Demo state persists in `localStorage` and is separate from production data. Pre-Phase-1 demo URLs (`/network`, `/signals`, …) redirect to `/demo/…`.

---

## Auto Demo (for recording)

Click **▶ PLAY DEMO** in the top bar (next to the demo clock). Choose a scenario and a pace, then press **PLAY DEMO**. The real app plays itself: it navigates, connects agents, gives consent, fast-forwards, re-evaluates and creates the 3-way opportunity through the same handlers the buttons use, always on the deterministic engine with no external calls.

| Scenario | Story | Standard pace |
| --- | --- | --- |
| **European Edge AI Expansion** (primary) | Connect → opportunity → private consent → Business Match → brief → +6 months → re-evaluation → network search → 3-way graph | ~1:55 |
| Dormant Relationship Becomes Valuable | Critic says "no strong opportunity yet" → signal meets its watch conditions → qualified opportunity | ~0:48 |
| Multi-Company Opportunity Graph | A strong deal missing distribution → network search → SecureChannel joins → 3-way graph | ~0:37 |

- **Controls** (bottom center; they auto-hide and reappear when you move the mouse): Pause/Resume, Skip, Restart, Exit. Keyboard: `Space` pause, `R` restart, `→` skip, `Esc` exit.
- **Paces:** Brisk (0.72×), Standard, Relaxed (1.3×). *Full-width layout* hides the sidebar.
- **During playback**, demo-only controls (the step pill, Reset, the perspective switch) are hidden. Each run starts by resetting the demo state.
- **The run ends** on the final state with a closing line, and holds there until you Replay, choose another scenario, or Exit. It never auto-resets.
- **Scenarios are data:** see [`src/lib/autodemo/scenarios.ts`](src/lib/autodemo/scenarios.ts). The runner is in `runner.ts`; pages expose their existing handlers through `useDemoHandler`.

`bun run e2e:autodemo` plays all three scenarios, a replay, pause/resume, exit, restart and refresh, and fails on any console error.

---

## Demo script (≈3 minutes)

The pill at the top-left always shows the next step.

1. **Overview.** Maya Chen (EdgeVision, US edge-AI software) met Lukas Brandt (EuroCompute, German hardware integration) at Embedded World six months ago. Nothing happened since. Note that her other relationships were already evaluated, and the critic concluded *"No strong opportunity yet"* for all of them.
2. **Connect agents** → watch the analysis sequence: understanding both companies, mapping capabilities→needs, bilateral reasoning, testing structures (OEM ✓, distribution ✗, customer merged), and critic qualification.
3. **Opportunity discovered: European Edge AI Appliance Partnership.** Open it to see why it exists and why now, what each side brings, the structure, and the evidence (fact / inference / assumption, with agent-only detail redacted for the other side). Also shown: unknowns, questions, risks and the critic's 9 checks.
4. **Interested** as Maya → her response is sealed. **View as Lukas** → Interested → **It's a Business Match.**
5. **Meeting brief:** objective, agenda, key questions, stakeholders, next actions, and time slots in PT and CET.
6. **Signals → FAST FORWARD +6 MONTHS.** Simulated signal: *EdgeVision announces expansion into Germany and Western Europe.*
7. **Re-evaluate.** Two of four relationships are affected. The dormant SecureChannel relationship (Sophie Laurent, met at The AI Conference) meets both watch conditions the critic left behind → **NEW OPPORTUNITY FOUND**, showing what changed and why it wasn't strong enough before. The OEM deal is strengthened (moderate → strong evidence).
8. **Multi-company discovery.** The appliance deal has no European enterprise distribution, and EdgeVision's need is now critical. ORQO scans the network (Kestrel ✗, Atlas ✗, SecureChannel ✓).
9. **Network → CREATE 3-WAY OPPORTUNITY.** *European Edge AI Appliance Program*: EdgeVision software, EuroCompute build/certify/deploy, SecureChannel distribution. The graph updates live.

---

## Architecture

```
src/
  lib/domain/        types.ts (graph-first data model), taxonomy.ts (shared capability/need tags)
  lib/data/seed.ts   demo network — all sources flagged simulated: true
  lib/engine/        pure, deterministic, isomorphic (runs in browser, server and tests)
    research.ts        1 RESEARCH          company understanding; ResearchProvider interface
    context.ts         2 BILATERAL         capability ↔ need alignment in both directions, disclosure rules
    patterns.ts        3 DISCOVERY         structure library: OEM appliance, channel distribution, customer
    critic.ts          4 CRITIC            9 checks → PASS / WEAK / REJECT, evidence-based confidence, watch conditions
    orchestration.ts   5 ORCHESTRATION     private consent, Business Match, meeting brief, lifecycle + outcomes
    reevaluation.ts    6 RE-EVALUATION     apply signal, find affected relationships, re-run, explain deltas
    network.ts           GRAPH             multi-company discovery for urgent capability gaps
    pipeline.ts          evaluate → commit; stage reports drive the UI's analysis sequence
  lib/graph/elements.ts  one graph projection shared by the UI and Neo4j
  lib/i18n/          locales (en, fr), typed catalogs, translator, locale negotiation
  lib/server/        server-only: config, OpenRouter, Neo4j repository, Brave research,
                     supabase/ (clients), auth/ (session, flows), repositories/ (RLS-scoped data access),
                     orqo/ (DB rows ⇄ engine World adapter, server-side evaluation)
  app/               Next.js App Router: production pages (/, /login, /signup, /onboarding),
                     /workspace (the ORQO shell: Search home, discover, network, intelligence, agents,
                     dashboard, company, plans, settings), /demo (the hackathon demo), /api/v1, legacy demo API routes
  components/orqo/   production design system (light): primitives, shell, plan/locked states, patterns
  lib/entitlements/  Free/Pro/Business presentation model (features, agents, plan comparison) — not billing
  lib/intelligence/  Phase 3, pure: HTML reader, concept lexicon, deterministic extraction (fact/inference/unknown),
                     own-vs-target relevance rules + critic, model I/O contracts (untrusted-content isolation)
  lib/server/research/ Phase 3, server: SSRF-safe fetcher, providers (Brave, OpenRouter), limits/quotas/model
                     policy, research service, policy gate, repositories (runs, intelligence, evidence, usage)
  lib/agents/        Phase 4, pure: Agent Registry, capabilities, Tool Registry metadata, autonomy/approval policy,
                     run state machine, agent budget, mission and result contracts
  lib/server/agents/ Phase 4, server: orchestrator, tool implementations (over Phase 3 research), entitlement gate,
                     task-based model policy, run repository, observability hooks
supabase/migrations/ version-controlled schema, RLS policies and RPCs (applied with bun run db:migrate)
tests/               unit/, db/ (real Supabase), http/ (running server), support/
```

The domain layer (`lib/domain`, `lib/engine`, `lib/graph`, `lib/i18n`, `lib/entitlements`, `lib/search`, `lib/intelligence`, `lib/agents`) may not import React, Next, Supabase or server code; ESLint enforces this. See [`docs/orqo-v2/PHASE-1-IMPLEMENTATION-REPORT.md`](docs/orqo-v2/PHASE-1-IMPLEMENTATION-REPORT.md) for the SaaS foundation (tenancy, RLS, auth) and [`PHASE-2-IMPLEMENTATION-REPORT.md`](docs/orqo-v2/PHASE-2-IMPLEMENTATION-REPORT.md) for the product shell, design system and plan presentation, and [`PHASE-3-IMPLEMENTATION-REPORT.md`](docs/orqo-v2/PHASE-3-IMPLEMENTATION-REPORT.md) for web intelligence, the evidence store and the research cost policy, and [`PHASE-4-IMPLEMENTATION-REPORT.md`](docs/orqo-v2/PHASE-4-IMPLEMENTATION-REPORT.md) for the agent infrastructure (registry, missions, runs, orchestrator, approvals).

**Nothing is hard-coded to the demo.** Opportunities come from pattern tests over the typed graph. The critic decides what surfaces. Watch conditions, which the critic writes when it holds an idea back, decide which relationships a signal re-opens. The 3-way program is composed from two parent opportunities whose gaps complement each other. `bun run test` asserts the whole story, including the negative cases: a marketing-copy need is rejected, a stale exploratory need is weak, and no network search runs while a gap is only exploratory.

### Honesty rules built into the model

- Every claim is labelled **fact**, **inference** or **assumption**, with a source. Demo sources are labelled *Simulated* in the UI.
- Confidence is qualitative (strong / moderate / limited) and derived from literal counts of facts, inferences and assumptions plus critic checks. There are no percentages.
- There are 5 visibility levels (public / network / connection / agent-only / private). Agent-only needs drive reasoning, but the counterparty only sees an approved disclosure sentence.
- Consent is private until everyone is interested. A decline is never revealed to the other side.

### Data model (graph-first)

`Person —WORKS_AT→ Company —OFFERS→ Capability`, `Company —NEEDS→ Need`, `Person —MET→ Person` (relationship with encounter, status and evaluation history), `Company —PARTICIPATES_IN→ Opportunity`, `Opportunity —DERIVED_FROM→ Opportunity`, `Company —EMITTED→ Signal —AFFECTS→ Relationship`. Capabilities and needs carry evidence, source, visibility and timestamps. Outcomes record every lifecycle transition with a reason, which seeds the Outcome Graph.

---

## Integrations — status

| Service | Role | Status |
| --- | --- | --- |
| **Supabase** | Postgres, Auth, RLS (production app) | **Working, tested** against the development project: migrations, sign-in/out, email-confirmation tokens, organizations/roles, cross-tenant isolation (`bun run test:db`). |
| **Official websites** | Company analysis (Search) | **Working, tested live** (Phase 3). Direct retrieval of a few official pages, with SSRF checks on every hop, robots.txt, size/time limits. No vendor and no API cost. |
| **OpenRouter** | LLM gateway for Opportunity Discovery and Deep research | **Adapter implemented; not configured in this environment.** Deep research (Phase 3) uses it for entitled workspaces only, with mocked tests. The legacy demo *Live AI* now also needs `ORQO_DEMO_LIVE_PROVIDERS=on`. Earlier behavior: Connect Agents → *Live AI* (enabled when `OPENROUTER_API_KEY` is set **and the user is signed in**, since every call spends credits). JSON-schema output validated with zod. The model may cite only capability/need IDs that exist in the graph; evidence is rebuilt server-side from those IDs, and the same deterministic critic judges the result. Verified with `google/gemini-3.8-flash` (~20 s). Falls back to the deterministic engine on any error, and says so in the UI. |
| **Neo4j** | Relationship / Opportunity / Outcome graph | **Implemented, not verified** (no credentials were available). `lib/server/graph/repository.ts` MERGEs nodes and edges through the Neo4j HTTPS Query API. The UI never depends on it. Without credentials, *Sync graph* writes to the in-memory repository. |
| **Brave Search** | Deep research discovery, future signal monitoring | **Adapter implemented, not verified live** (no key). One shared adapter (`lib/server/research/providers.ts`) serves Deep research and the legacy `GET /api/research` (off unless `ORQO_DEMO_LIVE_PROVIDERS=on`). |
| Exa / Firecrawl | Semantic discovery / crawling | **Not integrated.** The provider interfaces are the seam; nothing claims these integrations. |
| Band | Agent-to-agent messaging | Not integrated. Agents exchange state in-process today; `ResearchProvider` and the discovery override in `evaluateRelationship` are the seams for remote agents. |
| Merge.dev / Plaud | CRM sync / meeting capture → outcomes | Future. `Outcome` records are the intended landing point. |

## What's simulated

In the demo, the companies, people, sources and the +6-month signal are fictional data, flagged `simulated: true` and labelled in the UI. The demo has no accounts; *Schedule meeting* records a lifecycle change only. The production app has accounts and workspaces but no calendar or CRM integration yet.
