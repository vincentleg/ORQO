# ORQO V2 — Phase 17B Handoff (Mission Engine)

**What 17B does:** ORQO can delegate resumable, multi-step work to agents. A mission is a deterministic plan of steps; each delegating step is ONE ordinary agent run (Phase 4 run system, Phase 17A authority). Free capabilities only: Research Basic and Prospecting over stored/known candidates. No web search, no Deep Research, no paid provider, no new UI.

## 1. State
| | |
|---|---|
| Baseline | `2ebab72` (Phase 17A.3), branch `phase-17-autonomous-bd-organization`, local only: **not pushed, not deployed** |
| Migration | `20261009090000_phase17b_mission_engine` ("AX 17B"), with rollback `supabase/rollbacks/20261009090000_phase17b_mission_engine.down.sql` |
| Where applied | **ORQO Test only** (`****xplh`). The rollback was validated there (tables, column, functions and migration record removed), then the migration was re-applied. Production and Dev untouched |
| Phase 17C | **Not started** |

## 2. Recovery boundary (read in this order)
1. **Contracts** — `src/lib/missions/` (pure): `types.ts`, `state.ts`, `contracts.ts`, `findings.ts`, `recovery.ts`, `golden.ts`.
2. **Executor** — `src/lib/server/missions/executor.ts` (store and child runner injected), `repository.ts` (RPC wrappers, `dbMissionStore`).
3. **Child runs** — `src/lib/server/missions/children.ts` (`dbChildRunner`).
4. **APIs** — `src/lib/server/missions/service.ts`, `http.ts`, routes under `src/app/api/v1/organizations/[organizationId]/missions/`.

## 3. Contracts and templates
**Templates (version 1), strict inputs:**

| Template | Input | Steps (seq) |
|---|---|---|
| `research_company` | `{ target: {query} \| {companyId} }` | `research` (10, child run, required) → `compile` (20) |
| `prospect_known_candidates` | `{ intent, objective?, geography?, market?, maxResults? }` | `prospect` (10, child run, required) → `compile` (20) |
| `prospect_and_research` | same + `researchTop` (1–3, default 2) | `prospect` (10) → `research_top` (20, fan-out) → `research_top_N` (21…, optional child runs, added by the fan-out) → `compile` (30) |

**Rules:**
- **Deterministic:** the same template, version and input always give the same plan (`planMission`).
- **Free-only children:** `freeChildInput` accepts only `analyze_company` with `depth: basic` (no refresh) and `discover_companies` with `source: workspace_knowledge` (no re-evaluation). A caller cannot pass steps, a contract, an envelope, a budget, tools, a source, a depth or an organization (strict schemas).
- **Frozen contract:** `missions.contract` holds the template, version, autonomy (1), the envelope (`$0`, network `official_sites`, no paid provider, no web search, no deep research), limits and initial steps. It is immutable (trigger).
  - Before executing, the server rebuilds the contract from the stored template and input and requires equality (`contractMatches`). A mismatch is refused (403) and audited as tripwire `authority_modification`.
- **Step verification:** every claimed step is re-verified (`verifyStep`). A contract step must be identical. Any other step must be an optional Research Basic child inside its fan-out's seq gap (`seq+1 … seq+max`). A forged step fails as `invalid_step` with a tripwire, and no child run is started.
- **Lifecycle:**
  - Missions: `planned → running → completed | failed | cancelled`. A planned mission can also go to `cancelled` or `failed`.
  - Steps: `pending → leased → completed | failed | skipped | cancelled`. A leased step can also go back to `pending` (release, retryable failure, expired lease).
  - Database triggers mirror `state.ts`, and finished records are immutable.

## 4. Lease-based execution (executor)
`executeMissionSlice` runs a loop: claim → verify → dispatch (child run | fan-out | compile) → complete. One call is a **bounded slice**: any number of internal steps, but at most **one child run** (a child run executes synchronously, up to about 130 s, so one fits in a request).

**Ownership and expiry:**
- `claim_mission_step` takes the mission row lock and leases the next pending step: `lease_owner` is a random per-slice UUID, the lease lasts 200 s, and `attempt` is incremented.
- The lease outlives any request that holds it (route `maxDuration` is 150 s). So an expired lease always means its executor stopped.

**Fencing:**
- `complete_mission_step` and `attach_mission_child_run` require the same `lease_owner` **and** `attempt`.
- A stale holder's completion is *rejected* (`lease_lost`) and records nothing.
- A completion for a mission that is no longer running is rejected (`mission_cancelled` / `mission_failed`).

**Recovery:** every claim first returns expired leases to `pending` (`recoveries + 1`). The previous attempt's run is then handled by `childAction`:

| Previous run | Action |
|---|---|
| none | start a new run |
| `completed` | **adopt** its stored, contract-checked result (the work never runs twice) |
| `failed` / `cancelled` (unreported) | report that failure (retry policy below) |
| `queued`, created by this user | **resume** it (set its authority if missing, then execute) |
| `queued` by someone else, `running`, `waiting_for_approval` | close it as `interrupted`, then start a new run |

**Retries and failures:**
- Attempts are bounded: `max_attempts = 2` per step. An exhausted step fails as `attempts_exhausted`, unless its last run completed (that run is adoptable).
- Only transient failures are retried: `internal`, `interrupted`, `research_failed`.
  - A reported retryable failure clears the step's run, so the next attempt starts a fresh run.
  - Deterministic failures (`target_not_found`, `own_profile_missing`, `research_refused`, `plan_required`…) fail the step at once.
- A failed **required** step fails the mission, and its pending steps are skipped. A failed optional fan-out child leaves the mission running; the summary lists it.

**Busy, errors and concurrency:**
- **Busy:** if another agent run of the workspace is in progress (the Phase 4 one-concurrent-run guard), the step is released **without** consuming an attempt (`state: busy`).
- **Unexpected error:** the step is released with its attempt consumed (bounded), and the slice returns `error`.
- **Concurrent executors:** exactly one claims; the others get `in_progress`.

**Idempotency:**
- Mission creation: unique `(organization, created_by, idempotency_key)`.
- Child run creation: Phase 4 idempotency, with a key derived in SQL from `(step, attempt)` and shaped as a version-8 UUID. The run is linked to its step **in the same transaction** (`agent_runs.mission_step_id`, immutable once set).
- Findings: unique `(mission, finding_key)`, so recording them twice is a no-op.

## 5. Child runs
They use the existing architecture, unchanged: `create_agent_mission` (idempotency, one concurrent run, 30 runs/24h quota) → `set_agent_run_authority` → `executeRun` with `TOOL_IMPLEMENTATIONS`.

**Before each start or resume:**
- the child is **re-authorized** against current role and entitlement (`authorizeMission`);
- its authority is built by the server: registry ∩ entitlement ∩ `FREE_ENVELOPE` (`maxCostUsd 0`, `maxProviderCalls 0`, `maxChildRuns 0`, network `official_sites`);
- it must pass `isFreeAuthority`: no money, no provider, no `public_search`, no variable-cost tool. Otherwise a `privilege_expansion` tripwire is raised;
- an already stored authority must equal the rebuild (otherwise an `authority_modification` tripwire).

**Out of reach by construction:**
- The discovery gateway of a child has **no web source**.
- `deep_company_research` and `search_web_candidates` are absent from the authority (network too low), and the orchestrator trips `unauthorized_tool` before any call.

**Shape:** children are depth-0 runs linked to their step. `parent_run_id` / `deriveChild` delegation (17A) is still reserved for agent→agent delegation; a mission is not itself an agent run.

## 6. Findings
`mission_findings`: `mission_id`, `step_id`, `agent_run_id` (the step's run; `null` for compile), `finding_key`, `kind`, `subject_domain`, `payload` (≤ 8 KB). Derived deterministically from contract-validated results (`findings.ts`), never from raw web or model text.

| Kind | Key | Payload (main fields) |
|---|---|---|
| `company_analysis` | `analysis:<domain>` | name, intelligenceId, researchedAt, mode, analysisStatus, opportunities and hypotheses (relationship, rule, verdict, confidence, validation), unknowns, evidence counts, nextAction kind |
| `prospect` | `prospect:<domain>` | rank, name, website, priority, relationship, rule, confidence, aligned, networkCompanyId, intelligenceId, evidenceCount, unknowns, nextQuestion |
| `prospecting_summary` | `prospecting:<step>` | status, partialReason, source, objective, funnel, counts, nextAction kind |
| `profile_gap` | `gap:own_profile` | missing own-profile fields |
| `mission_summary` | `summary` | step counts, failed steps, findings by kind, top 5 prospects, analyses, gaps |

**Fan-out** (`planFanout`): the best non-weak prospects of the named step (priority, then discovery rank), capped by `researchTop` (≤ 3).

## 7. Cancellation
`cancel_mission` (creator or admin):
- pending and leased steps → `cancelled`;
- queued child runs (and waiting-for-approval ones, with their approvals) → `cancelled`;
- a **running** child run cannot be interrupted: it finishes, but its completion is rejected, so no finding is recorded from it (`running_runs` is returned).

Executing a cancelled mission returns `state: cancelled` and does nothing. A second cancel → 409.

## 8. APIs
Under `/api/v1/organizations/:org/missions`:

| Method | Route | Purpose | Who | Notes |
|---|---|---|---|---|
| POST | `/missions` | create (plan) | member + agent entitlement for every delegated agent | strict body `{template, input, idempotencyKey}`. 201, or 200 with `reused: true`. Refusals: 401 / 403 `role` / 403 `plan_required` / 400 / 404 / 409 `busy` (≥ 3 active missions) / 429 (20 per 24h) |
| GET | `/missions` | list | viewer+ | |
| GET | `/missions/:id` | inspect | viewer+ | mission, progress counts, steps (status, attempt, recoveries, lease expiry, child run, error, result), findings. The contract is never echoed |
| POST | `/missions/:id/execute` | execute or resume one slice | member | `state` ∈ `completed`, `failed`, `cancelled`, `in_progress`, `yielded`, `busy`, `lease_lost`, `error`, plus executed steps and the detail. `maxDuration` 150 s |
| POST | `/missions/:id/cancel` | cancel | creator or admin | 409 when already finished |

**Every mutation:** `requireAuth` + `assertSameOriginJson` (CSRF) + strict zod. Cross-tenant and unknown ids → 404.

## 9. Schema ("AX 17B")
**Tables** (RLS on; select for viewer+; **no insert, update or delete grant**; anon and service_role get nothing):
- `missions`: the plan of record. Audited: `mission.created`, `.started`, `.completed`, `.failed`, `.cancelled`.
- `mission_steps`: lease columns, `attempt` / `max_attempts`, `recoveries`, `child_run_id`.
- `mission_findings`

**Column:** `agent_runs.mission_step_id`.

**Functions** (SECURITY DEFINER, `search_path = ''`, member check inside):
- `create_mission`: advisory lock, idempotency, ≤ 3 active, ≤ 20 per 24h, step validation;
- `claim_mission_step`;
- `attach_mission_child_run`;
- `complete_mission_step`;
- `release_mission_step`;
- `cancel_mission`.

**Private helpers:** `valid_mission_step`, `fail_mission`, `settle_mission`. **Triggers:** state machines, immutability of the contract and step definitions, run→step link.

## 10. Golden missions
`src/lib/missions/golden.ts` defines the world: own profile `SERVICES_OWN`, plus stored analyses of `strong.example`, `peer.example` and `injected.example`.

| # | Scenario | Expected |
|---|---|---|
| 1 | Research a known company | `research:completed`, `compile:completed`; findings `analysis:strong.example`, `summary`; 1 child run |
| 2 | Prospect from known candidates | `prospect`, `compile` completed; `prospect:strong.example`, `prospecting:prospect`; `peer.example` never a prospect; 1 run |
| 3 | Prospect, then research the top 2 | `prospect`, `research_top`, `research_top_1`, `research_top_2`, `compile` all completed; 3 runs |
| 4 | Required child fails deterministically | `research:failed:research_refused`, `compile:skipped`, mission `failed` / `step_failed` |

**Where they run:**
- in memory with the real orchestrator (`executor.test.ts`);
- in the database with real RPCs, children and tools (`tests/db/missions.test.ts`);
- over HTTP: scenarios 1–3, plus the deterministic failure via an unknown Network `companyId` → `target_not_found` (`tests/http/missions.test.ts`).

## 11. Tests (exact results)
| Suite | Result |
|---|---|
| Unit `bun test src tests/unit` | **683 pass**, 0 fail (47 files). New: `src/lib/missions/missions.test.ts` (13) and `src/lib/server/missions/executor.test.ts` (17: 4 golden + fan-out, crash mid-run, adopt after crash, queued resume, bounded attempts, transient vs deterministic retry, optional failure, busy, fencing, concurrent executors, cancel between slices and mid-run, tampered step) |
| DB (ORQO Test) | **262 pass**, 0 fail (18 files). New: `tests/db/missions.test.ts` (21: 4 golden with free-authority and attribution checks, no spend, audit, idempotency, authorization matrix, no direct writes and immutability, tampered contract and step, queued resume, stale-running interrupt, adopt, fencing, concurrent claims, busy, cancellation ×4). Extended: `trust-baseline` (3 tables in the read matrix, 3 forged inserts), `schema` (table list) |
| HTTP (isolated server) | **91 pass**, 0 fail (7 files). New: `tests/http/missions.test.ts` (11: 401 on all routes, CSRF on all mutations, 404/403/plan_required, forged bodies, id enumeration, 3 golden missions over the API, deterministic failure, cancel flow, no spend) |
| `security:check` | 147 pass. Now includes `src/lib/missions` and `src/lib/server/missions`. `bun audit`: **1 high, pre-existing, dev-only** (`braces` ≤ 3.0.3 via `eslint-config-next` → fast-glob → micromatch; lockfile unchanged by 17B) |
| Typecheck, lint, production build | Pass |
| Migration | Applied on ORQO Test; rollback validated there; re-applied |

**No real provider was called:** the isolated server runs with the kill switch on and blank keys; unit tests use fakes; DB tests run children with no research gateway; all golden missions use stored research. `provider_spend` and `usage_events` stay empty (asserted).

## 12. Limitations and deferred work
- **No background driver:** a mission advances only when `…/execute` is called (one child run per call). Whether 17C drives it from the UI (polling) or a scheduled worker is a 17C decision.
- **Member-written findings (LOW, same class as 17A §12):** step completions are fenced, but the database cannot verify finding *content*. A member calling `claim` + `complete_mission_step` directly can write findings into their own organization's missions. Nothing crosses tenants, no money moves, and execution itself is re-verified (contract, step, free authority). This matches the existing model, where `agent_runs.result` is member-writable.
- **Running child runs cannot be interrupted** on cancel (synchronous execution, as in Phase 4). They finish, and their results are discarded.
- **Children are depth 0**, linked by `mission_step_id`, not `parent_run_id`. Mission-level money envelopes and `deriveChild` delegation come with paid capabilities (17D).
- **Fan-out** only plans Research Basic children of prospects; templates are fixed in code (no user-defined templates).
- **Golden scenario 4 over HTTP** uses `target_not_found` instead of `research_refused`, because the isolated server's research gateway is real and would attempt a Basic fetch.
- **Dependency advisory:** `braces` (dev-only, pre-existing) is left for a dependency-maintenance pass. It is not part of 17B.

## 13. Recommended starting point for Phase 17C
1. **Read** `GET /api/v1/organizations/:org/missions/:id`. Its `findings` (keyed, typed payloads) and `mission_summary` are the inputs for the ORQO Briefing and work cards. Build presentation from them; don't re-derive.
2. **Decide the driver:** client-side execute loop (respect `yielded` / `busy` / `in_progress`) or a scheduled worker that calls `executeMission` with the user's session.
3. **Add bilingual labels** for mission and step statuses, step failure codes (`STEP_FAILURES` plus `RunFailure`, incl. the new `interrupted`) and finding kinds.
4. **Keep the golden missions green.** Extend `GOLDEN_MISSIONS` deliberately when templates change, and bump `TEMPLATE_VERSIONS` for any plan change.
