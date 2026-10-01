# ORQO V2 — Phase 4 Implementation Report

## 1. Status

**Complete.**

- The agent infrastructure (registry, capabilities, tools, autonomy, approvals, missions, runs, orchestrator, budgets, audit) is implemented and enforced server-side.
- Two real agent paths run end to end:
  - the **Research Agent**, which reuses Phase 3;
  - the **Partnership Manager**, which explains stored analysis only.
- No paid provider was called. The branch is ready for human review; it is not pushed and not merged.

## 2. Baseline

`main` @ `70f1b30` (Merge Phase 3). The working tree was clean.

## 3. Branch

`phase-4-agent-infrastructure`

## 4. Agent architecture

```
POST …/agents/missions (JSON, same-origin)
  auth → membership → role (member+) → authoritative plan | operator preview → agent status
  → mission contract (strict zod) → autonomy in agent range
  → create_agent_mission RPC (idempotency key, 1 active run/org, window quota) → NDJSON stream
Orchestrator (fixed step plan, deterministic routing)
  each tool call: registry permission → autonomy → input schema → policy precheck
                  → approval → budget reservation → execute → output schema → ledger
  tools → Phase 3 research entry point (prepare/run) | stored intelligence | analyzeRelevance (rules + critic)
  result → contract check → agent_runs.result
```

- **Pure layer: `src/lib/agents/`** (ESLint domain boundary): registry, tools metadata, policy, state machine, budget, contracts.
- **Server layer: `src/lib/server/agents/`**: gate, orchestrator, tools, repository, model policy, observability.

**LangGraph and MCP were not added.**

- A fixed, bounded step plan with a database-enforced state machine needed no graph runtime.
- `executeRun` takes injected `RunStore` and tools, so a graph engine can replace the plan later.
- The tool shape (id, schemas, cost and risk classes, network flag, approval rule) is MCP-compatible. No MCP connectivity was built.

## 5. Agent Registry

`AGENT_REGISTRY` in `src/lib/agents/registry.ts` is version-controlled. It defines the 12 Phase 2 agents with stable ids. Each definition carries:

- tier and parent (Orchestrator → Partnership / Sales managers → specialists);
- entitlement feature, from which the required plan comes;
- status, capabilities and an explicit tool allow-list;
- the mission types it accepts;
- its autonomy range and default;
- model task classes, execution limits, and input/output contracts.

| Agent | Status | Plan | Autonomy |
| --- | --- | --- | --- |
| Research Agent | available | Pro | 0–2 (default 1) |
| Partnership Manager | available | Business | 0–2 (default 1) |
| The other 10 | coming soon | Phase 2 plans | none: no tools, no missions, zero limits |

`src/lib/entitlements/agents.ts` now derives from the registry, so there is a single definition. Nothing is stored in the database: definitions stay in code.

## 6. Capability model

There are 11 capabilities. Each one maps to tools.

- Implemented: `company_research`, `company_understanding`, `evidence_synthesis`, `business_relevance` and `opportunity_qualification`.
- The other six have no tools yet, so nothing can run them.

Agents are granted capabilities, and a tool must belong to the mission's capability **and** be on the agent's allow-list.

## 7. Tool Registry

Six real tools are registered. Each has metadata, strict input and output schemas, and a server implementation.

| Tool | Cost class | Network | Approval | Min autonomy |
| --- | --- | --- | --- | --- |
| read_workspace_company, read_network_company, read_stored_research | internal | no | never | 0 |
| evaluate_business_relevance (Phase 3 rules + critic) | none | no | never | 0 |
| official_site_research (Phase 3 Basic) | external_free | yes (≤ 5 requests) | never | 1 |
| deep_company_research (Phase 3 Deep) | variable | yes (≤ 10 requests, ≤ 2 model calls) | below Execute | 2 |

Tool access is denied in four cases (unit-tested):

- an unregistered tool, including names like `constructor` and `send_email`;
- a capability the agent was not granted;
- a tool outside the capability;
- a tool not on the agent's allow-list.

Every denial is written to the ledger.

## 8. Autonomy model

| Level | Behaviour |
| --- | --- |
| **0 Observe** | Read tools only. Never fetches the web. The result has no next action. |
| **1 Recommend** | May run official-site research and recommend. |
| **2 Prepare** | May also request deep research, which always needs approval. |
| **3 Execute** | Modelled, but granted to no agent. A request for it is refused (`autonomy_not_allowed`), even with preview. |

## 9. Approval model

- **States:** `not_required`, `required`, `approved`, `rejected`, `expired` (24 h).
- **Requesting:** `request_agent_approval` atomically moves the run to `waiting_for_approval` and creates the approval row.
- **Deciding:** `decide_agent_approval` is **admin-only**. It refuses decided approvals and expires stale ones. Members have **no grant** on `agent_approvals` and cannot write `approval_state`.
- **Resuming:** a run resumes only when the database row says `approved` (enforced by a trigger). The tool comes from the approval row, and entitlements are re-checked.
- **Policy precheck:** it runs **before** approval, so ORQO never asks a human to approve something policy would refuse. Example: deep research without a deep entitlement is refused, not queued for approval.
- **Scope:** no high-impact tool (email, CRM…) exists yet, but the gate is ready for one.

## 10. Missions

`agent_missions` stores:

- organization, creator (trigger-forced) and agent;
- mission type and capability;
- a server-built objective;
- strict structured input (a `{query}` or `{companyId}` target, depth, refresh);
- autonomy and status;
- result summary, failure reason and timestamps;
- an idempotency key.

There are two mission types: `analyze_company` and `explain_opportunities`. There is no free-form task engine.

## 11. Runs and state machine

- **Run states:** `queued → running → completed | failed | waiting_for_approval`; `waiting_for_approval → running | cancelled | failed`; `queued → cancelled | failed`.
- **Enforcement:** the transitions are enforced both in `state.ts` and by the `enforce_agent_status` trigger.
  - A run's identity, autonomy and limits are immutable.
  - Finished runs are final, and finished steps are immutable.
- **Running runs cannot be cancelled.** Runs are synchronous inside one request and cannot really be interrupted, so the system does not pretend otherwise.
- **What a run records:**
  - initiator, organization, agent, mission and capability;
  - tool calls (outcome, cost class, network flag, linked `research_run_id`, duration);
  - budget counters, duration, the validated result and the error code;
  - provider usage through `usage_events.agent_run_id`.
- **Not recorded:** chain-of-thought. Steps record operations and results only.

## 12. Orchestrator

`executeRun` in `src/lib/server/agents/orchestrator.ts`:

- **Routing** (`MISSION_ROUTES`) is deterministic and model-free.
- **Fixed step plan:**
  1. load_workspace_context
  2. resolve_target
  3. retrieve_existing_research
  4. run_research (Research Agent only)
  5. evaluate_relevance
  6. produce_result
- **Failures:** business failures end in a persisted, safe failure code. Unexpected errors log a name and a truncated message only.
- **Steps:** each step is streamed to the UI as it really happens.

## 13. First real agent path: Research Agent

Mission: "Analyze this company for my workspace".

- **Reuse:** fresh stored research is reused. Stale or missing research, or an explicit refresh, calls `official_site_research`. That tool goes through `prepareResearch`/`runPreparedResearch`.
- **Shared code path:** this governed entry point was extracted from the Phase 3 route, which now uses it too. Authorization, quota, cache window, SSRF protection, robots.txt and `RunBudget` are therefore identical.
- **Relevance:** evaluation calls the unchanged `analyzeRelevance` (mechanism rules + critic).
- **Result:**
  - target, research reused or new, evidence counts;
  - opportunities and hypotheses (relationship, verdict, confidence, claim ids, validation keys);
  - rejected count, unknowns, own-profile gaps;
  - the next action: the Phase 3 validation question, now in pure `lib/intelligence/wording.ts`.
- **No duplicated business logic.**

**Second path: Partnership Manager.** `explain_opportunities` uses stored analysis only. It has no research tools; without stored analysis it fails with `research_required`.

**Partnership Manager scope (deliberate).**

- It demonstrates a **second deterministic agent path over stored intelligence**: a different agent, capability, tool allow-list, plan and step plan, running on the same infrastructure.
- It **intentionally reuses the same opportunity/qualification primitives** as the Research Agent (`analyzeRelevance`, critic, validation questions). Its result therefore looks very similar.
- **Richer partnership structuring is deferred.** Future behavior may include:
  - a proposed partnership mechanism;
  - each party's role;
  - validation conditions and risks;
  - qualification questions;
  - a recommended next commercial action.

  None of this is implemented in Phase 4.

**Evidence references in run results.** Opportunities list up to 3 cited statements: a short quoted excerpt (or the statement) and the source page title, linked to the source URL. Internal claim ids are no longer shown. Labels are resolved from the stored evidence **only when it is the exact snapshot the run used** (same intelligence id and research timestamp), because claim ids are per snapshot. If the analysis was refreshed since the run, the page shows "Supported by N cited statements" with a link to the full analysis.

## 14. Context assembly

- The context is minimal: own profile, one target reference and one stored analysis. A `companyId` is resolved through `read_network_company` within the run's organization (RLS plus an organization filter).
- An unknown or foreign id fails with `target_not_found`.
- Tool outputs are strict-schema data. Control flow never reads web or model text.
- There is no vector memory or global "AI memory": context is structured business data only.

## 15. Entitlements

- **Server chain:**
  1. auth
  2. membership (404 for non-members)
  3. role
  4. `getEntitledPlan` (still Free for all) **or** `ORQO_AGENT_PREVIEW_ORGS`
  5. agent status
  6. contract
  7. autonomy
  8. the RPC guard
- **Client trust:** the browser's plan or lock state is never used.
- **Free:** every agent is plan-locked (Research → Pro, Partnership → Business). No zero-cost exception was added. Search's Phase 3 Basic analysis is unchanged.
- **Preview:**
  - it is a server-side environment allow-list, not a plan;
  - it does **not** grant deep research (that still needs `ORQO_RESEARCH_PREVIEW_ORGS` and configured providers);
  - quotas, limits and approvals still apply.

## 16. Budgets

- **Per-agent limits:** tool calls, model calls, external requests, retries (0), duration, and an optional reported-cost ceiling.
- **Reservation:** each tool's worst case is **reserved before it runs**. Exhaustion is a controlled `budget_exhausted` outcome, and the tool does not run.
- **Nested research** keeps its Phase 3 `RunBudget` as a second layer.
- **Operator limits:** at most 1 active run per organization (stale after 180 s) and 30 runs per organization per 24 h. These are not commercial quotas.

## 17. Model policy

- **`selectModel(task)`** maps four task classes (`extraction`, `synthesis`, `business_reasoning`, `critique`) to provider, model, tier and output ceiling.
- **Configuration** comes from `ORQO_MODEL_*`. The single default is the existing low-cost model, and the most expensive model is never chosen automatically.
- **Research** `modelFor` delegates to this policy.
- **No new model calls:** agents declare model tasks, and the only model use is inside Phase 3 Deep research, whose outputs are already schema-validated and quote-verified.

## 18. Usage and cost integration

- **Ledger:** this phase reuses `usage_events` and adds an `agent_run_id` column (same-organization FK). Research invoked by an agent attributes usage to both runs.
- **Tool-call ledger:** links `research_run_id`.
- **Costs:** only provider-reported values are shown, and the run page shows cost to admins only (RLS). Nothing is estimated.

## 19. Audit and observability

- **Audit trigger:** `audit_agent_event` appends to `audit_events`. It stores ids and codes only, never payloads. Events:
  - `agent_mission.created`;
  - `agent_run.queued`, `.started`, `.resumed`, `.waiting_for_approval`, `.completed`, `.failed`, `.cancelled`;
  - `agent_tool.called` (actor_type `agent`);
  - `agent_approval.requested`, `.approved`, `.rejected`, `.expired`.
- **Observability:** an `AgentObserver` hook interface exists, with a no-op default.
- **Langfuse is not integrated.** The database run history is the system of record.

## 20. Database changes

**Migration `20261002090000_phase4_agent_infrastructure.sql`** (additive, applied to the development project). It adds:

- five tables: `agent_missions`, `agent_runs`, `agent_run_steps`, `agent_run_tool_calls` and `agent_approvals`;
- `usage_events.agent_run_id`;
- triggers for the state machine, step finality, `created_by`, immutable ownership and audit;
- four RPCs: `create_agent_mission`, `request_agent_approval`, `decide_agent_approval` and `cancel_agent_run`;
- indexes for the time lists, active-run guard and run lookups.

**Security properties:**

- RLS is default-deny: viewers read; members get column-scoped updates.
- The tool-call ledger is append-only.
- `anon` and `service_role` hold no privileges.

**Rollback:** `supabase/rollbacks/20261002090000_phase4_agent_infrastructure.down.sql` (manual, destructive for Phase 4 data). It was exercised in development (rollback, then re-apply). No historical migration was modified.

## 21. Security

Each item below is proven by tests.

- Anonymous → 401.
- Another organization → 404 on create, list and run detail. B cannot read, update or delete A's rows in all five tables.
- Cross-organization step, tool-call and usage inserts are refused (23503).
- Viewer → 403 `role`.
- Free → 403 `plan_required`, with no mission created.
- Forged `plan`, `budget`, `tools`, `organizationId`, `approved`, unknown mission or agent, or out-of-range autonomy → 400. Autonomy 3 is refused even with preview.
- Members cannot alter autonomy, limits or `approval_state`, cannot approve, and cannot resume a waiting run.
- Approval decisions are admin-only. Cancelling needs the starter or an admin.
- Invalid tool output fails the run and saves nothing.
- Injected instructions in stored evidence do not change the tool sequence, approvals or autonomy, and leak no foreign organization id or secret name.
- Credentials stay server-only, and no secret is printed or tracked (diff scanned).

**Residual (as in Phase 3):**

- Members can append rows to their own organization's ledgers, and can write run status or results within valid transitions.
- Calling `create_agent_mission` directly only creates queued rows that count against the caller's quota. Nothing executes outside the route.

## 22. Tests

| Check | Result |
| --- | --- |
| `bun run typecheck` / `lint` | ✅ 0 errors / 0 problems (`lib/agents` added to the domain boundary) |
| `bun run test` (unit) | ✅ **123 / 123** (Phase 3: 84; +39). Covers: registry, hierarchy, entitlement metadata, mission and tool policy, state machine, budget, strict contracts. The orchestrator (in-memory store and fake tools) covers: Phase 3 reuse, cache reuse, stale refresh, Observe, the deep approval and resume, the deep precheck refusal, research refusal, Network reference, own profile missing, the Partnership path, budget exhaustion, malformed output, the injection boundary and model policy |
| `bun run test:db` | ✅ **143 / 143** (+12). Covers: idempotency, 6 concurrent → 1 run, quota, transitions and immutability, approval authority, expiry, reject, cancel rights, RLS on 5 tables, cross-organization FKs, append-only ledger, grants, the orchestrator end to end over stored research, and audit events |
| `bun run test:http` | ✅ **41 / 41** (Phase 3's 32 plus 9 agent refusal and read tests). With `AGENT_PREVIEW_ORG`, the agent file runs **14 / 14**: streamed real steps, reuse, an idempotent replay that never runs twice, deep refused before approval with 0 usage, Observe failure, and the Partnership paths |
| `bun run build` | ✅ |
| `bun run e2e:agents` (new) | ✅ No console errors. 13 screenshots: preview catalog, mission form, completed run, failed run, Partnership run, approval waiting and then rejected from the UI, recent runs, FR catalog, FR run, FR form, Free locked catalog, Free locked agent |
| `bun run e2e:app` | ✅ Covers Search, the Phase 3 analysis, profile, Network, locked agents → Plans, and FR/EN |
| `bun run e2e` (manual demo) / `e2e:autodemo` | ✅ / ✅ after hardening one pre-existing locator, described below |

**Auto Demo locator fix.** The Phase 3 report flagged this locator as timing-sensitive, and it failed twice here. It is a strict-mode collision between the finale text and Next's route announcer, which reads the page title. The locator now targets the heading role. It is a test-only change; the demo code is unchanged.

## 22b. Human product review

**Phase 4 passed manual product review** on the development app with operator preview, on target GigaIO.

| Run | Outcome | Duration | Tool calls | External requests | Model calls |
| --- | --- | --- | --- | --- | --- |
| Research Agent manual run | ✅ Completed | 6.3 s | 3 / 8 | 0 | 0 |
| Partnership Manager manual run | ✅ Completed | 4.4 s | 3 / 6 | 0 | 0 |

- **Research Agent:** stored Phase 3 research was reused, and the bounded web-research step was correctly skipped. Business relevance and the critic ran. The result, opportunities, unknowns and Next Best Action were displayed.
- **Partnership Manager:** stored analysis was reused, with no web-research step. The result and run history were displayed correctly.
- **No paid provider** was used in either run.
- **Inspected manually:** run steps, tool-call history, budget display, provider and cost display, and the Agents preview UX.

**Review polish pass afterwards (small):**

- raw evidence ids replaced by cited statements (§13);
- the Partnership Manager scope documented (§13);
- this review record added.

## 23. Provider calls

**No paid provider was called.** Brave and OpenRouter remain unconfigured.

The only external traffic was the existing `e2e:app` regression: one free official-website Basic analysis of gigaio.com, re-run because the research route was refactored. Every agent test and E2E used stored research or fixtures.

## 24. UI

- **Agents page:**
  - registry-driven hierarchy;
  - a catalog showing each agent's real state (Available / Preview / plan-locked / Coming soon / Members only);
  - capabilities, autonomy range and plan;
  - a preview notice and recent runs.
- **Agent page:**
  - definition (capabilities, tools with cost class, autonomy, plan, reports to);
  - a mission form: target or Network company, depth, autonomy with help text, summary, live streamed steps;
  - a single idempotency key per mission.
- **Run page:**
  - status, timings and budget used;
  - approval panel (admins approve or reject; starter or admin cancels);
  - failure reason, result, next action, unknowns and gaps;
  - a link to the full analysis;
  - steps (operations only), tool calls, and providers/cost.
- **Free** keeps its locked cards with no mission form.
- **Languages:** FR and EN.

## 25. Known limitations

- **Synchronous runs:** runs execute inside one HTTP request (≤ 150 s), and a running run cannot be cancelled. A process crash leaves a run `running`; it stops blocking after 180 s but is not auto-failed.
- **Approve → resume is untested live:** it is only reachable with deep entitlement and configured providers, which do not exist here. It is covered by unit tests and DB RPC tests; the UI covers reject.
- **Partial persistence:** a database failure between step writes can leave a run with partial steps. The run is then marked failed when possible.
- **Approval flow for preview organizations:** deep research for a preview organization also needs `ORQO_RESEARCH_PREVIEW_ORGS` and an `OPENROUTER_API_KEY`. Without them, the precheck refuses it before any approval.
- **Duration:** about 3–7 s against the remote development database, dominated by run, step and tool-call writes.
- **Admin self-approval:** an admin may approve their own run, as the budget holder.
- **Phase 3 limitations still apply:** non-transactional intelligence save, DNS rebinding, and member-writable ledgers.
- **Development overlay:** in `bun run dev`, the Next.js development badge still shows "1 Issue" during manual review. This matches the previously deferred development/browser issue, and it was not investigated here. The production-build E2E runs (`e2e:agents`, `e2e:app`, `e2e`, `e2e:autodemo`) report no console errors, but **the development environment is not claimed to be warning-free**.
- **Evidence labels after a refresh:** when a stored analysis is refreshed after a run, that run's result shows only an evidence count and a link to the current analysis. Earlier snapshots are not versioned.
- **Partnership Manager depth:** it reuses the Research Agent's qualification primitives; richer partnership structuring is deferred (§13).

## 26. Deferred work

- **Phase 5+:** Discover/Prospecting, Network and Follow-ups, Signals, Events, editable agent organization and custom agents, Opportunity Graph/Neo4j.
- **Not built in Phase 4:**
  - LangGraph and MCP connectivity;
  - a Langfuse integration;
  - background or durable runs and a job queue;
  - high-impact external action tools (email, CRM, meetings);
  - Execute autonomy;
  - billing-backed `getEntitledPlan`;
  - a service-side Cost Ledger with spend ceilings;
  - model-backed critique.

## 27. Main files changed

- **New, pure:** `src/lib/agents/{types,contracts,registry,tools,policy,roles,state,budget}.ts` (+ tests), `src/lib/intelligence/wording.ts`.
- **New, server:**
  - `src/lib/server/agents/{config,gate,service,orchestrator,tools,repository,model-policy,observability,http}.ts` (+ tests);
  - `src/lib/server/research/execute.ts`.
- **New routes:** `src/app/api/v1/organizations/[organizationId]/agents/{missions,runs,runs/[runId],runs/[runId]/cancel,approvals/[approvalId]}`.
- **New pages:** `src/app/workspace/agents/[agentId]`, `src/app/workspace/agents/runs/[runId]`.
- **New UI components:** `src/components/orqo/{agents,mission-runner}.tsx`.
- **Modified:**
  - Agents page and research route (now over `execute.ts`);
  - `research/{config,repository}.ts`, `repositories/companies.ts` (`getCompany`);
  - `entitlements/{plans,agents}.ts`, the i18n catalogs, `components/orqo/analysis.tsx`;
  - `eslint.config.mjs`, `.env.example`, `README.md`, `package.json` (`e2e:agents`).
- **Database:** the migration and rollback above.
- **Tests and scripts:**
  - `tests/db/agents.test.ts`, `tests/http/agents.test.ts`, `tests/db/schema.test.ts`;
  - `scripts/e2e-agents.ts`, `scripts/e2e-app.ts` (Free check), `scripts/e2e-autodemo.ts` (locator).

The engine, the domain layer and the demo are unchanged.

## 28. Commits

`git log 70f1b30..phase-4-agent-infrastructure`:

1. `94d8c2f`: agent infrastructure, migration, routes, UI, tests.
2. `cfae92e`: this report.
3. The review polish pass: evidence references, Partnership Manager scope, manual review record.

## 29. Phase 5 readiness

Ready. Discover/Prospecting can:

- add a `prospect_discovery` tool set and a Prospecting Agent definition;
- add a mission type with its contract and route;
- reuse the gate, orchestrator, approvals, budgets, ledgers and run UI unchanged.

Before paid agents ship:

- `getEntitledPlan` must read real subscriptions;
- runs should move to background execution with a durable queue;
- usage should be written by a service-side Cost Ledger with spend ceilings.
