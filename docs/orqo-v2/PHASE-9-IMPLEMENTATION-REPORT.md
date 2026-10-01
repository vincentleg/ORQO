# ORQO V2 — Phase 9 Implementation Report

## 1. Status

**Complete, pending human browser review.**

- Agents is now presented as the workspace's AI business development team: an organization derived from the registry, the real status of each agent, what can run today, a deterministic mission planner and real run history.
- No new table, no migration, no new executable agent, no new tool, no model call and no provider call.
- The DB/HTTP/E2E suites were **not run** (safety guard, §19).
- Nothing was pushed or merged. Phase 10 has not started.

## 2. Objective

Turn the Phase 4 agent infrastructure into an organization that the user can understand. It answers:

- who exists and who coordinates whom;
- what each agent is responsible for;
- what each agent can read and use, and what it cannot do;
- what autonomy applies;
- what really runs today;
- how a mission decomposes into steps;

without inventing any autonomy.

## 3. Baseline

- Branch `phase-9-agent-organization`.
- Merge base and `main`: `f032157` (Merge Phase 8). The working tree was clean and no Phase 9 work existed.

## 4. Architecture

```
src/lib/agents/registry.ts       (single source; + slot, + technical_fit capability)
src/lib/agents/permissions.ts    NEW  tool → access (read / write_internal / write_external), data domains, withheld private fields
src/lib/agents/organization.ts   NEW  pure: agentAccess, displayStatus, autonomyCeiling, organizationView,
                                       agentPermissions, capabilityOwner, MISSION_TEMPLATES, planMission, collaboratorsOf
src/lib/server/agents/gate.ts         agentCatalogAccess now delegates to organizationAccess (server plan + preview + role)
src/components/orqo/agent-organization.tsx  NEW  organization, runnable-now, planner, agent overview, permissions
src/components/orqo/agents.tsx        AgentCard / status badge / run table meta
src/app/workspace/agents/page.tsx, [agentId]/page.tsx  reworked
```

- **Pure layer:** `organization.ts` and `permissions.ts` have no imports from `@/lib/server`. A test asserts this, along with the absence of `fetch`, `executeRun` and `createMission`.
- **Authority:** the execution chain is unchanged: auth → membership → role → `getEntitledPlan` or operator preview → `decideMission` → RPC → orchestrator, which decides every tool call.

## 5. Registry and hierarchy

- **No duplicate registry.** `AGENT_REGISTRY` remains the only definition. `entitlements/agents.ts` is still a projection of it (tested).
- **`slot: "core" | "custom"`** separates the custom-agent slot from core specialists. Previously the custom slot was rendered as a stray "direct report" of the orchestrator.
- **New `technical_fit` capability** is declared with **no tools** and granted to the planned Technical Agent. It exists so that the planner can route technical-fit steps honestly.
- **Hierarchy**, derived from parent links by `organizationView()`:
  - Orchestration: Orchestrator.
  - Management:
    - Partnership: coordinates Relationship, Research, Signal, Technical and Market.
    - Sales: coordinates Prospecting, Follow-up and Event.
  - Specialists: the eight specialists.
  - Custom: Custom agents.
- **Tests:** every agent appears exactly once, and the parent/child relationships are tested.

## 6. Truthful status (bug fixed)

**The bug.** Before this phase, `agentCatalogAccess` reported a coming-soon agent on an insufficient plan as `locked`. Its card then offered "Upgrade to Pro", but upgrading would not have made it run.

**The fix.** The pure `agentAccess` now returns:

| State | Meaning |
| --- | --- |
| `executable` (plan) → **Available** | runs on the workspace's plan |
| `executable` (preview) → **Preview** | runs through the server-side operator preview |
| `locked` → required plan | built, but not on this plan; the upgrade CTA appears only here |
| `coming_soon` | on every plan and in preview, with "Planned for {plan}" shown as information |
| `disabled` | switched off |
| `role` | the user's role cannot start missions |

An exhaustive test runs every plan × preview flag × role × agent. It proves that `executable` holds exactly when `decideMission` accepts the agent's missions.

## 7. Agent detail

`/workspace/agents/[id]` now renders for **every** agent, not only executable ones:

- **Header and status:** role and purpose, status badge, plan, and a note for locked or planned agents. A locked agent "cannot run, even through the API".
- **Responsibilities:** three explicit, bounded responsibilities each (EN/FR). Agents that are not built show them under **"Planned responsibilities"**.
- **Team:**
  - reports to;
  - coordinates (for managers);
  - works with: agents that own other steps of the same structured missions, derived from mission templates.
- **Autonomy:** each level is marked Allowed, Above this agent's maximum, or "Not granted to any agent" (Execute), with the ceiling for this workspace.
- **What you can ask it today:** real mission types, and only when executable.
- **Product links:** where its work appears (Search, Discover, Network, Intelligence or Events) and the missions it takes part in, which open the planner.
- **Permissions card** (§8).
- **The mission form**, when executable. It is the existing Phase 4/5 form, unchanged.
- **Recent runs:** real rows only.

Prompts, internal tool ids and secrets are not shown. A render test asserts that tool ids do not appear as text.

## 8. Tool model and data permissions

`TOOL_PERMISSIONS: Record<ToolId, …>` gives every registered tool metadata (the test enforces completeness):

- **access:**
  - `read`;
  - `write_internal`: only `official_site_research` and `deep_company_research`, which save the analysis and its evidence;
  - `write_external`: **none exist** (tested).
- **data domains:** organization profile, Network companies, stored analysis, public web, paid web search, discovery memory, relationship context, follow-ups, signals, events.
- **withheld private fields:**
  - `read_relationship_context` withholds contact channels, private notes and interaction contents;
  - `read_event_context` withholds event preparation notes, contact channels and interaction contents.

  These were written from the actual tool output schemas. Tool payloads were **not** widened.

`agentPermissions(agent)` derives **only from the agent's granted tools**:

- **Can read:** the domains.
- **Can save in this workspace:** stored analysis, for Research.
- **Can use:** each tool's access and cost class, and whether it needs an admin's approval.
- **Cannot:**
  - act externally (send, book or post);
  - modify contacts, interactions, follow-ups or events;
  - execute on its own;
  - read contact details, notes or interaction contents;
  - spend without approval, or use paid providers at all.
- **Never receives:** the private fields.

Planned agents show "No tool is granted". Their already-built read seams are listed separately as "prepared — not granted until it is built".

## 9. Autonomy and ceiling

- The levels are unchanged: 0 Observe, 1 Recommend, 2 Prepare, 3 Execute.
- **Ceiling:**
  - an executable agent's ceiling is the registry maximum (2 for all three executable agents);
  - an agent that is not executable has no ceiling.
- **Execute is granted to no agent.** A test asserts that every `autonomy.max` is below 3. `decideMission` refuses autonomy 3 even under preview (tested again here).
- The existing mission forms only offer levels from min to max. The server re-checks.

## 10. Configuration

**Not implemented (deliberate).**

- Per-organization preferences (a default autonomy or enable/disable) would need a new table, RLS and a migration applied to the development Supabase project, which also holds the real workspace. Its DB tests cannot run here (§19).
- The value of such preferences was low compared with that risk.
- The UI does not present any configuration it cannot honour.

## 11. Missions, planning and routing

- **No new persistent mission model.** Phase 4 `agent_missions` and `agent_runs` remain the records of real work.
- **Planner:** `planMission(template, access)` is pure, deterministic, model-free and side-effect-free.
- **Missions:** seven structured missions, each an ordered list of required capabilities. Free text is not parsed.
  - research a company;
  - find companies;
  - review Network changes;
  - review follow-ups;
  - prepare an event;
  - map a market;
  - assess technical fit.
- **Routing (`capabilityOwner`):**
  1. the agent of a `MISSION_ROUTES` entry for that capability;
  2. otherwise the first core specialist that holds it;
  3. otherwise the first core agent that holds it.

  Every capability used has exactly one owner (tested).
- **Each step records:**
  - the capability, the agent and the routing rule;
  - the reason ("Selected because this mission needs …");
  - the workspace status and required plan;
  - `runnable`: the agent is executable **and** a real mission type exists for that capability;
  - an approval boundary, read from tool policy;
  - a suggested handoff to the next step.
- **Lead:** the lowest common non-specialist in the reporting chains of the step agents. For example, the Partnership Manager for "research a company", and the Orchestrator (coming soon) for cross-team missions.
- **The UI states:**
  - "N of M steps can run in this workspace";
  - "Only available steps can run. ORQO does not chain steps automatically";
  - "You review every result and decide. ORQO never sends messages."
- **Limits:**
  - hard cap `MAX_PLAN_STEPS = 6`;
  - no repeated capability;
  - the planner never calls an agent, so there is no recursion or loop.
- **How runnable steps launch:** they link to the agent's existing mission form. Nothing auto-runs.
- **Delivery:** a plain GET form (`/workspace/agents?mission=…#plan`), rendered on the server. There is no API endpoint and no client JavaScript. Unknown values such as `constructor` are ignored (tested).

## 12. Handoffs

- **Suggested only.** Handoffs are computed between consecutive plan steps (from, to, capability) and labelled "(suggested)".
- They are **not persisted** and do not mean that a run happened, a provider was called or a record changed. ACCEPTED/COMPLETED states were not implemented, because nothing executes handoffs.

## 13. Execution behavior

- **Unchanged:** the real paths are still the Research Agent (`analyze_company`), the Partnership Manager (`explain_opportunities`) and the Prospecting Agent (`discover_companies`). The orchestrator, tools, budgets, approvals and RPC guard are untouched.
- **Run history, real telemetry only:** each row shows its autonomy, the approval state when it is not `not_required`, and model calls when `counters.modelCalls > 0`. No cost or token numbers are estimated. Cost stays admin-only on the run page, as before.

## 14. Entitlements and operator preview

- **Plans:** `FEATURES` and the plan semantics are unchanged. No prices or quotas were invented.
- **Preview** is still `ORQO_AGENT_PREVIEW_ORGS`, resolved on the server. It shows **Preview**, never Available. It cannot unlock coming-soon agents (tested for 7 agents) and does not affect tool permissions, approvals or budgets.
- **Phase 7/8 seams:** `signalReasoningDecision` and `eventAgentDecision` are untouched. The Signals, Event, Follow-up and Relationship agents stay coming soon, with no tools and no missions (tested).

## 15. Public/private boundary

- The organization UI shows **descriptions** of data domains, never data.
- Tool payloads are unchanged.
- The private fields that are withheld are listed explicitly and are covered by tests.

## 16. Security

- **Trusted vs untrusted:** agent organization, permissions and templates are code, which is trusted policy. The planner's only input is a template id validated against an own-property allow-list, plus the server's access map. Web content, tool results and models cannot reach it, so they cannot change permissions, autonomy, routing or approvals.
- **No new routes or server actions.**
- **No change to RLS, grants or the database.**

## 17. Cost controls

- Planning makes no network, database (beyond the existing page reads), model or provider call. This includes the Free path.
- Budgets, quotas, approvals and the 1-active-run / 30-runs-per-24 h guard are unchanged.

## 18. Schema and migrations

**None.**

## 19. Tests

| Check | Result |
| --- | --- |
| `bun run typecheck` | ✅ |
| `bun run lint` | ✅ 0 problems |
| `bun run test` (unit) | ✅ **329 / 329** (+32, including 3 from the review fix in §19b) |
| `bun run build` | ✅ (initial delivery; not re-run for the presentation-only review fix) |

**New pure tests: `src/lib/agents/organization.test.ts` (23).**

- The hierarchy is derived; there are no duplicates.
- Manager/specialist links are correct.
- Status matches `decideMission` exhaustively.
- Coming soon is never shown as locked.
- On Free, everything is locked.
- Preview cannot unlock an agent that is not built.
- The viewer gets the role state.
- Ceiling: Execute is never granted, and autonomy 3 is refused under preview.
- Every tool has permission metadata.
- Read vs write: no external write, and writes never touch relationship domains.
- Withheld private fields are correct.
- Permissions come from granted tools only.
- Fake outbound tools are refused.
- Routing is deterministic and every capability has an owner.
- Plans are bounded, have no repeats, and refuse unknown or prototype templates.
- The event plan marks 3 of 5 steps unavailable.
- On Free, no step is runnable.
- Mission types are mapped and approval boundaries are set.
- The planner purity check passes.
- Collaborators are correct.
- The Phase 7/8 agents are still not executable.

**New render tests: `src/components/orqo/agent-organization.test.tsx` (6).**

- Each agent is rendered exactly once.
- On Free, nothing is runnable and only 3 upgrade CTAs appear.
- Preview shows Preview, never Available.
- The planner shows honest counts and labels and uses a GET form.
- The permissions card is human-readable, lists withheld fields, and shows no tool ids.
- Planned agents render correctly.
- Every label exists in EN and FR.

**Regressions:** all existing unit suites pass unchanged, including:

- Phase 6 Next Best Action and Safari due dates;
- Phase 7 signals and relevance;
- Phase 8 events;
- the Phase 4/5 orchestrator and discovery.

## 19b. Human-review correction

The human review, on a fictional Free workspace, found two truthfulness ambiguities. Both are fixed **in presentation only**. Tool grants, entitlements, operator preview, approvals and server checks are unchanged.

1. **Agent detail tools.**
   - **Problem:** a locked Research Agent listed its tools under "Can use / Peut utiliser", which could read as usable now.
   - **Fix:** the section title now depends on the server-computed access:
     - "Can use" only when the agent is executable for this workspace;
     - otherwise "Tools granted when execution is authorized" / "Outils accordés lorsqu'il est autorisé à s'exécuter". This covers locked, coming soon, disabled and viewer role.
2. **Planner blocker priority.**
   - **Problem:** on Free, the Prospecting and Research steps showed both "Needs Pro" and "Paid tools in this step wait for an admin's approval". This implied that approval could make them run.
   - **Fix:** each step now carries one primary `blocker`, in priority order:
     1. `coming_soon` (not built);
     2. `disabled`;
     3. `plan` (entitlement);
     4. `role`;
     5. `no_mission`.
   - The approval note (`approvalBoundary`) is shown only when the step has no blocker, i.e. it is entitled and runnable (plan or preview).
   - The real approval requirement is still enforced by `decideTool` and is tested as unchanged.

**Tests added:**

- a locked agent and a viewer see the "when authorized" title in EN and FR, while an executable agent keeps "Can use" with its real tools;
- on Free, the event plan shows 2 plan blockers and 3 coming-soon blockers, and no approval text;
- in preview, the 2 runnable steps show the approval gate;
- coming soon wins on Business and in preview;
- the viewer role blocks before approval;
- `decideTool` still requires approval for deep research and web search.

## 20. Not run

**Suites not run:**

- `test:db`
- `test:http`
- `e2e:agents`
- `e2e:app`
- `e2e:discover`
- the other `e2e:*` scripts

**Reason:** `.env.local` points at the Supabase project that holds the real workspace, and the Phase 5 guard refuses these suites there. The guard was not bypassed.

**Script update:** `scripts/e2e-agents.ts` now expects the Orchestrator and the Signal Agent to be `coming_soon` under preview (it previously expected `locked` for the Orchestrator).

**Live browser check:** none was done. It would need a sign-in against that project.

## 21. External calls

**None.** No Brave, OpenRouter or website fetch. Nothing ran beyond local typecheck, lint, unit tests and build.

## 22. Database writes

**None.**

## 23. Known limitations

- **Static planner:** it covers seven fixed missions. It does not interpret free-text objectives.
- **No automatic execution:** planning does not execute or chain steps. Multi-agent execution, persisted missions/steps and accepted/completed handoffs are deferred.
- **No configuration:** per-organization agent settings (default autonomy, enable/disable) are not implemented (§10).
- **No custom-agent creation:** custom agents remain a planned slot.
- **Plan-based ceiling:** the autonomy ceiling does not yet depend on the plan. For example, a Pro workspace may choose Prepare even without deep-research entitlement. The deep-research precheck still refuses it before any approval, as in Phase 4.
- **Fixed collaborators:** "Works with" is derived from mission templates, not from observed runs.
- **Phase 4/5 limitations still apply:** synchronous runs, member-writable ledgers, and the "FREE" badge under preview.

## 24. Human browser review (fictional workspace; no provider spend)

Use a **new** fictional account and workspace, for example "Northwind Test Labs". Do not use INFODIP.

1. **Agents (Free).**
   - The header reads "Your AI business development team", with the truth note.
   - "What can run today" shows the empty message.
2. **Organization.**
   - It shows Orchestration → Management (Partnership coordinates Relationship · Research · Signal · Technical · Market; Sales coordinates Prospecting · Follow-up · Event) → 8 Specialists → Custom.
   - Every agent appears once.
3. **Status on Free.**
   - Research and Prospecting show **Pro**, and Partnership shows **Business**, with "Upgrade to …" leading to Plans.
   - All the others show **Coming soon · Planned for …**, with **no** upgrade button.
4. **Research Agent detail.**
   - Role, three responsibilities, reports to Partnership Agent, and works with.
   - Status: locked, with the note that it "cannot run, even through the API".
   - Autonomy: "Not executable here".
   - Can read, Can save (stored analyses), Can use (with "Needs an admin's approval" on deep research), Cannot (✕ list), Never receives.
5. **Event Agent detail.**
   - "Planned responsibilities", the planned note and "No tool is granted".
   - Prepared read access is shown as not granted.
   - "What you can ask it today: Nothing yet."
6. **Planner.**
   - Choose "Prepare my targets for an event" → Show the plan.
   - Expect 5 steps (Event, Prospecting, Research, Relationship, Follow-up), each with a reason, status and a suggested handoff.
   - Expect "0 of 5 steps can run" on Free.
   - Expect the "Only available steps can run" and "never sends messages" notes.
   - The URL is `?mission=prepare_event#plan`. In DevTools there is no XHR or fetch.
7. **Other missions.** Try "Research a company" (lead: Partnership Agent) and "Assess technical fit" (Technical: Coming soon).
8. **FR.** Switch to FR and repeat steps 1 and 6: "Votre équipe IA de développement commercial", "Afficher le plan", "Nécessite Pro".
9. **Preview workspace** (only if a fictional workspace is already on `ORQO_AGENT_PREVIEW_ORGS`; do not add INFODIP).
   - Research, Prospecting and Partnership show **Preview**, never Available, and appear under "What can run today".
   - The event plan says "2 of 5 steps can run".
   - Research detail shows "Maximum in this workspace: Prepare", with Execute shown as "Not granted to any agent".
10. **Phase 5 regression** (preview only). Run a Prospecting mission over workspace knowledge (no web source). It completes as before, and its run row shows autonomy and no model calls.
11. **Phase 7/8 regression.**
    - The Intelligence Signals Agent status line and the Events Event Agent card are unchanged.
    - Both agents show Coming soon on Agents.
12. **Recent runs.** Only real runs are shown. A new workspace shows "No agent has run in this workspace yet."
13. **No outreach.** No control anywhere sends, schedules or posts.

## 25. Commits

On `phase-9-agent-organization`:

1. `d0f709b`: Phase 9: Agent Organization (code, tests, i18n, e2e expectation).
2. `d258783`: this report.
3. `Phase 9 review: clarify agent tools and planner blockers`: the human-review correction (§19b).

Not pushed. Not merged. Phase 10 has not started.
