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
bun run dev          # http://localhost:3000
```

Other scripts:

| Command | What it does |
| --- | --- |
| `bun run build` / `bun run start` | Production build / serve |
| `bun run test` | Engine tests: the whole demo story as assertions |
| `bun run e2e` | Headless walk-through of the full demo (needs `bunx playwright install chromium` once and the dev server running). Screenshots land in `.screenshots/`, and it fails on any console error |
| `bun run typecheck` / `bun run lint` | TypeScript / ESLint |

Everything works with **no environment variables**. See [`.env.example`](.env.example) for optional integrations. Put secrets in `.env.local`, which git ignores.

**Reset demo** (bottom of the sidebar) restores the initial network. Demo state persists in `localStorage`.

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
  lib/server/        server-only: config, OpenRouter, Neo4j repository, Brave research
  app/               Next.js App Router pages + API routes
```

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
| **OpenRouter** | LLM gateway for Opportunity Discovery | **Working.** Connect Agents → *Live AI* (enabled when `OPENROUTER_API_KEY` is set). JSON-schema output validated with zod. The model may cite only capability/need IDs that exist in the graph; evidence is rebuilt server-side from those IDs, and the same deterministic critic judges the result. Verified with `google/gemini-3.8-flash` (~20 s). Falls back to the deterministic engine on any error, and says so in the UI. |
| **Neo4j** | Relationship / Opportunity / Outcome graph | **Implemented, not verified** (no credentials were available). `lib/server/graph/repository.ts` MERGEs nodes and edges through the Neo4j HTTPS Query API. The UI never depends on it. Without credentials, *Sync graph* writes to the in-memory repository. |
| **Brave Search** | Public company research, future signal monitoring | **Implemented, not verified** (no key). `GET /api/research?company=…` searches Brave, then OpenRouter extracts capabilities/needs, each citing a search result; uncited items are dropped. Not wired into the UI yet. |
| Band | Agent-to-agent messaging | Not integrated. Agents exchange state in-process today; `ResearchProvider` and the discovery override in `evaluateRelationship` are the seams for remote agents. |
| Merge.dev / Plaud | CRM sync / meeting capture → outcomes | Future. `Outcome` records are the intended landing point. |

## What's simulated

The companies, people, sources and the +6-month signal are fictional demo data, flagged `simulated: true` and labelled in the UI. There is no authentication, calendar or CRM integration. *Schedule meeting* records a lifecycle change only.
