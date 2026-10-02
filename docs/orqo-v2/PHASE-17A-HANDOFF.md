# ORQO V2 — Phase 17A Handoff (Governed Spend & Authority Foundation)

**What 17A does:** paid work becomes impossible without entitlement, budget and authority. There is no mission engine yet, and no real provider was activated.

## 1. State
| | |
|---|---|
| Baseline | `main` = `origin/main` = `555f72d` (Production runs `caaa476`) |
| Branch | `phase-17-autonomous-bd-organization`, local only: not pushed, not deployed |
| Migration | `20261008090000_phase17a_governed_spend`, with a rollback. The rollback was validated on ORQO Test (it removes everything cleanly), then the migration was re-applied |
| Where applied | **ORQO Test only** (`****xplh`). Production and Dev are untouched |

## 2. Internal (Founder) entitlement
**Sources:**
- `lib/governance/entitlement.ts` (pure);
- `lib/server/governance/entitlement.ts` (`resolveEntitlement`; billing plan is Free for everyone until billing exists).

**Rules:**
- `ORQO_INTERNAL_ORGS` lists the Internal organizations. `ORQO_INTERNAL_BUDGET_USD` sets their rolling 30-day ceiling: at most $1,000; absent or invalid means **no paid spend**.
- Internal resolves to `featurePlan = business`, which unlocks the workforce features.
- **Internal bypasses nothing:** RLS, authority, gate, reservation, ceiling, runtime, approvals, tripwires and the kill switch all still apply.
- Paid plans have no configured ceiling yet, so they get **no paid spend** until one exists.

**Legacy settings:**
- `ORQO_RESEARCH_PREVIEW_ORGS` is now an alias of Internal.
- `ORQO_AGENT_PREVIEW_ORGS` still means agents preview only, never paid spend.
- The ad-hoc preview functions were removed.

## 3. Authority Contract
`lib/governance/authority.ts` defines `AuthorityContract` (version 1). It holds:
- organization and user;
- entitlement tier;
- mission, run, parent run and depth;
- agent and capability;
- tools, data domains and writes;
- network level (`none` / `official_sites` / `public_search`);
- provider grants (OpenRouter: tasks and maximum tier; Brave: yes/no);
- limits: tool, model and provider calls, external requests, duration, `maxCostUsd`, `maxChildRuns`, `maxDepth` (2);
- autonomy;
- variable-cost approval (`per_call` / `pre_approved`);
- `killSwitch: "enforced"`.

**How it is built:** `buildAuthority()` = registry (agent ∩ capability) ∩ entitlement ∩ envelope.
- Free never holds paid tools, providers or money.
- A synthesis agent such as Partnership gets no network and no provider.

**Narrowing:**
- `deriveChild()` and `expansions()` reject any widening, on all 16 dimensions.
- A child spends one of its parent's child runs.

**Persistence:**
- Stored in `agent_runs.authority` once, while the run is queued, through `set_agent_run_authority`. The database checks organization, run, user, version, kill switch, cost cap, and the parent's money and child-run limits.
- After that it is **immutable**: a trigger blocks updates even from privileged roles, and there is no column grant.
- Malformed snapshots parse as no authority at all (`parseAuthority`).

**Where it is set:**
- Every agent run gets an authority in `acceptMission`, with an envelope by agent: Research $0.50, Prospecting $0.25, others $0.
- Resuming loads the frozen snapshot and never rebuilds it.
- A direct (non-agent) research run gets a server-built authority for its mode (Deep: $0.50).

## 4. Tripwires
**Sources:** `lib/governance/tripwire.ts` and `record_governance_event` (13 fixed kinds, members only).

Each tripwire: **deny, stop, audit** (`audit_events: governance.tripwire.<kind>`, plus an observability event). It is raised by:
- the provider gate: missing authority, cross-organization, provider outside authority, network, cost limit, provider-call limit;
- the orchestrator: a tool outside the frozen authority;
- research preparation: an agent research call without matching authority or tool.

No model is ever consulted.

## 5. Provider gate
**The only path to a paid provider:** `lib/server/governance/provider-gate.ts` (`governedModelCall`, `governedSearch`, `governedModelProvider`, `governedSearchProvider`).

**Order of checks:**
1. authority present;
2. same organization, user and run;
3. **kill switch**;
4. entitlement (`mayUsePaidProviders`);
5. provider and task within the authority;
6. network within the authority;
7. the authority holds money;
8. Model Policy;
9. credentials configured;
10. **spend reservation** (the database refuses above any cap);
11. a single-use **permit** is issued;
12. the transport is called;
13. the reservation is settled;
14. usage is recorded with `reservation_id` and `duration_ms`.

**After the reservation:**
- The kill switch is checked again; if it flipped, the reservation is released without sending.
- A duplicate idempotency key is refused: **the same call is never sent twice**.

**Transports** (`governance/transports.ts`, plus `ai/openrouter.ts`) consume a permit before any network I/O. Permits cannot be forged: only the exact object the gate registered (a `WeakMap`) is accepted, and each is single-use and bound to one provider.

**Wired call sites:**
- Deep research (`research/execute.ts`);
- Prospecting web search (`discovery/sources.ts`).

The legacy demo `/api/research` and `/api/discover` now answer "unavailable"; they never reach a provider.

**Structural tests guarantee** that:
- only the transports contain the provider hosts;
- only the gate issues permits;
- only the transports call OpenRouter;
- only the gate imports the transports;
- no service-role key exists in the workforce path;
- no domain terms appear in governance code.

## 6. `provider_spend` ledger
**Columns:** `id, organization_id, agent_run_id?, research_run_id?, provider, task, model?, idempotency_key, reserved_usd (≤ $5 per call), settled_usd, cost_known, outcome (succeeded / failed / not_sent), status (reserved / settled / released), created_by, created_at, settled_at`.

**Security:**
- RLS: viewer or above can select.
- **No insert, update or delete grant:** rows are written only by the functions below.
- Every change is audited.

**`reserve_provider_spend`** returns `{id, reused}`:
1. checks the caller is a member;
2. validates inputs;
3. takes the **organization advisory lock**;
4. returns the existing row if the idempotency key was already used;
5. requires a **running** agent run whose authority grants the provider and task, within its `maxCostUsd` and `maxProviderCalls`, or a running research run;
6. checks the **rolling ceiling**.

**`settle_provider_spend`:** the reserving user only, once. Reported cost is used when known; otherwise the **full reservation is kept** (`cost_known = false`); `not_sent` releases it.

**Wrappers:** `governance/ledger.ts` (`setRunAuthority`, `getRunAuthority`, `reserveSpend`, `settleSpend`, `recordTripwire`, `spendSummary`).

**Known amounts:** Brave reports no cost, so each query reserves and settles $0.01 (conservative).

## 7. Model Policy Engine
`lib/governance/model-policy.ts`:
- tasks map to tiers: extraction and synthesis use **economy**; business reasoning and critique use standard, if the authority allows (Pro gets economy only);
- input and output token bounds;
- price caps per tier, sent to OpenRouter as `max_price`;
- reservation = worst case at the cap;
- candidate models: environment override → configured → default `google/gemini-3.8-flash`; malformed model ids are ignored;
- **at most one fallback**, with its own reservation;
- no model is selected without a tier.

`server/agents/model-policy.ts` is now a compatibility shim.

## 8. Kill switch
`ORQO_PROVIDERS_KILL_SWITCH=on` still blanks the keys in configuration. The gate denies before any reservation, and checks again after it. Tests prove the transport is never reached, and stored-data features stay usable.

## 9. Internal usage view
- **Where:** `/workspace/settings`, Internal workspaces only (`components/orqo/internal-usage.tsx`).
- **Shows:** ceiling, committed (settled + reserved), settled, reserved, remaining, number of calls, number of unknown-cost calls, the 20 most recent calls (provider, task, model, amount, status, date), and a kill-switch or no-ceiling notice.
- **Normal workspaces** see nothing of it.

## 10. Wording fixes
- The memory line now uses the singular ("ORQO remembers 1 company", "1 of them shows…"), in EN and FR.
- A company typed in lowercase is shown capitalized ("Globex"); websites and names that already have capitals are kept as typed.

## 11. Tests
| Suite | Result |
|---|---|
| Unit | 633 pass. New: `lib/governance/governance.test.ts` (30: entitlement, authority, 12 expansion dimensions, depth and child runs, model policy, structural guards) and `server/governance/provider-gate.test.ts` (15, fake transports: every denial reaches 0 transport calls; reserve before send; settlement; unknown cost; failure plus one bounded fallback; exact limit; double submit) |
| DB (ORQO Test) | 226 pass. New: `tests/db/governance.test.ts` (13: authority once and immutable even for privileged roles; database-side refusals; child limits; reservation needs a running run with matching authority; run cost and call limits; idempotency; **concurrency: 20 parallel $0.10 reservations against $0.55, exactly 5 succeed**; exact ceiling; settlement rules; usage linkage; tenant isolation; no direct writes; grants and `search_path`; tripwire audit) |
| HTTP | 76 pass (1 optional live-AI test skipped). New: `tests/http/governance.test.ts` (Free refused before spend or research run; Internal refused while the kill switch is on; legacy routes unavailable; sign-in required) |
| E2E | New: `e2e:governance` (Internal sees its budget, normal sees nothing, singular wording, capitalization, EN/FR, axe). `e2e:agents`, `e2e:discover`, `e2e:app`, `e2e:work` and `e2e:opportunities` pass |
| Typecheck, lint, local production build | Pass |

**No real provider was called:**
- the isolated server forces the kill switch on with blank keys;
- unit tests use fake transports;
- E2E records no host outside the app.

**Test environment:** the synthetic preview organization is Internal with a $0.50 ceiling. Real Internal and preview ids are protected from test cleanup.

## 12. Known limitations
- **Ceiling inputs:** the organization ceiling and window are passed by the server to `reserve_provider_spend`. The database enforces the per-call cap ($5), the run's frozen authority, and the per-call bound on the ceiling (≤ $1,000). A member calling the RPC directly can only reserve against their own organization: no money moves, and every row is attributed and audited. Moving ceilings into the database comes with billing.
- **OpenRouter `max_price`** is sent but has never been exercised against the live API (17D).
- **Brave cost** is never reported, so the reservation is kept in full.
- **Shared ceiling:** all Internal organizations use the same ceiling value, each in its own 30-day window.
- **Envelopes are constants:** Research $0.50, Prospecting $0.25, Deep $0.50. They will be tuned from 17D measurements.

## 13. Phase 17B integration points
- **Delegated runs:**
  1. create the child run (`create_agent_mission`, or a 17B mission RPC);
  2. `deriveChild(parentAuthority, buildAuthority(...))`;
  3. `setRunAuthority(db, org, childRunId, child, parentRunId)`;
  4. the database enforces depth and the parent's money and child-run limits.
- **Envelopes:** missions pass an `ExecutionEnvelope` (tools, network, writes, maxCostUsd, maxChildRuns, `variableCostPreApproved` once a mission-level approval exists).
- **Paid calls:** use `governedModelProvider` / `governedSearchProvider` with `{ db, organizationId, userId, authority, agentRunId, researchRunId }`. Never import the transports.
- **Tripwires:** `recordTripwire(...)` plus `TripwireError`. The orchestrator takes an `onTripwire` dependency.
- **Mission-level cost views:** `spendSummary`, or `provider_spend` grouped by `agent_run_id` (and `parent_run_id` via `agent_runs`).
