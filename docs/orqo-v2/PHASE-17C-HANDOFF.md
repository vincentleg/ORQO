# ORQO V2 — Phase 17C Handoff (Mission Experience / ORQO Briefing)

**What 17C does:** turns the Phase 17B mission engine into a founder-facing product. The founder delegates a mission to ORQO, follows meaningful progress, can stop it, and receives the ORQO Briefing built from the mission's real findings. Free capabilities only. No engine redesign, **no schema change**, no provider.

## 1. State
| | |
|---|---|
| Baseline | `f24e010` (Phase 17B), branch `phase-17-autonomous-bd-organization`, local only: **not pushed, not deployed** |
| Schema | None. ORQO Test still has the 17B migration; Production and Dev untouched |
| Phase 17D | **Not started** |

## 2. Execution driver (decision)
**Decision: a bounded client-side driver on the mission page.** No worker or scheduler.

**Why:**
- 17B executes in bounded slices (one child run per execute call, at most ~130 s) and has no background worker.
- Its leases, fencing, adoption of completed runs and idempotent child creation already make repeated, concurrent or interrupted calls safe.
- A worker would need a new identity or credential model (it acts as the user under RLS), which is out of scope.

**How it works** (policy in `src/lib/missions/driver.ts` is pure; the loop in `src/components/orqo/mission-live.tsx`):

| Event | What the driver does |
|---|---|
| Members only, mission `planned` or `running` | Calls `POST …/missions/:id/execute`, **one call at a time** |
| `yielded` | Calls again immediately |
| `busy` / `in_progress` / `lease_lost` / 409 / 429 | Waits with backoff 3 → 6 → 12 → 24 → 30 s; at most 12 waits in a row, then pauses |
| `error` / 5xx / network failure | Retries with backoff; at most 3 retries in a row, then pauses |
| Terminal state | Stops; the briefing renders |
| 401 / 403 / 404 | Stops |
| 40 calls in one page session | Hard cap; stops |
| Paused | Shows a **Continue the mission** button. Nothing is lost: the mission is persisted |

**Refresh, navigation, second tab:**
- The page renders persisted state first, then the driver restarts.
- Leaving aborts the client request. The server request finishes or is fenced, and a later visit continues.
- A second tab gets `in_progress` and backs off.

**React lifecycle:** a generation counter retires stale loops (unmount, cancel, StrictMode remount). The loop starts from a timer, so a StrictMode remount never starts two loops.

**Viewers** never execute. They re-read the mission every 8 s, at most 40 times, then get a Refresh button.

**Consequence:** a mission advances only while a member has its page open. This is documented in the UI ("You can leave this page: the mission continues when you come back to it").

## 3. What was built
**Entry points:**
- **Missions** in the primary navigation (desktop and mobile; the mobile grid now follows the item count).
- **Work** shows "ORQO is working on" or "Latest briefings" (at most 3 rows), or a "Delegate a mission" link.
- **CEO** answers hand off:
  - `find_prospects` → "Have ORQO find and research prospects";
  - a not-yet-researched company → "Have ORQO research X".
  - Both pre-fill the delegation form.

**`/workspace/missions`:**
- **Delegate to ORQO:** the 3 real templates as cards (keyboard: arrow keys between radios). Only the fields each template needs. A plain "ORQO will …" summary and a "Free capabilities only" note.
- **Locked states:** Free plan → explanation and Plans link; viewer → can follow, not start.
- **Errors:** missing target, role, plan, too many active missions, daily quota, invalid input, network.
- **Lists:** in progress and recent missions.

**`/workspace/missions/[id]`:** title from the founder's own input, start/finish date, then the live card.
- **Phase:** Preparing / Reviewing candidates / Choosing what to research / Researching *X* / Compiling your briefing / Completed / Completed with gaps / Needs attention / Stopped.
- A live (`role="status"`) sentence and an accessible progress bar ("2 of 5 steps done").
- Founder-facing steps with plain failure reasons (folded into a disclosure once finished).
- A driver note: working / waiting / retrying / paused, plus Continue.

**Stop mission (creator or admin):**
- An inline `alertdialog` with focus on **Keep working**.
- It explains that finished results stay and the step in progress is discarded (the 17B behavior, worded without machinery).
- The driver stops, the mission is cancelled, and the page shows "What ORQO finished". A 409 (already finished) shows the true final state.

**ORQO Briefing** (`BriefingView`; derivation in `src/lib/missions/briefing.ts`, pure):

| Section | Content |
|---|---|
| What ORQO did | Reviewed N known companies and kept M; researched K companies; steps not completed (with reason); "you stopped it" |
| What matters | High-priority prospects; prospects worth investigating; per company: opportunity (relationship, confidence) / hypotheses only / no credible opportunity; no prospects; partial check; profile gap |
| What to do next (≤ 5, all linked) | Complete the profile (missing fields); validate the hypothesis with X; prospect's own next question; look into X; broaden and start again; research more candidates; start this mission again (same input) |
| What ORQO found | Work cards (see below) |

**Work cards:**
- Prospects are ranked by priority, then discovery rank. A researched prospect carries its research result on the same card (no duplicate cards).
- Company research cards: status, best fit, evidence counts, open questions, analysis date.
- "How ORQO searched": the funnel.
- "Your company profile": missing fields.
- `mission_summary` marks a compiled briefing. Every line comes from findings or steps; absent findings produce no text (or an explicit "nothing to report" / "no prospects" line).

**Authority and spend:**
- Every mission shows "Free capabilities · $0 paid authority". This comes from the frozen contract envelope.
- It also shows "No paid provider was used." This comes from the **real** `provider_spend` rows of the mission's child runs (every attempt), via `missionSpend`.
- 17D fills this same line with requested, approved and actual amounts.

## 4. API additions (read-only, no engine change)
`GET …/missions/:id` and `POST …/execute` now also return:
- `mission.input`;
- `steps[].subject` (the research target of a child step);
- `authority` (envelope: `maxCostUsd`, `paidProviders`, `webSearch`, `deepResearch`; a contract that doesn't parse is shown as $0, never more);
- `spend` (`committedUsd`, `settledUsd`, `calls`, from the ledger).

The shared type is `src/lib/missions/view.ts` (`MissionView`). Still never echoed: the contract, the lease owner.

## 5. EN / FR
A new `missions` namespace in `en.ts` / `fr.ts` covers:
- mission and step statuses, phases and phase sentences;
- steps, failure codes (incl. `interrupted`, `attempts_exhausted`, `invalid_step`, plus a generic fallback);
- finding kinds, card labels, briefing sections and lines;
- actions, errors, locked states, authority, and the Work and CEO hand-offs.

Plus `nav.missions`. Existing labels are reused for relationships, confidence, priorities, intents and profile fields. No parallel system.

## 6. Tests (exact results)
| Suite | Result |
|---|---|
| Unit `bun test src tests/unit` | **710 pass**, 0 fail. New: `src/lib/missions/experience.test.ts` (16: driver policy — yielded, terminal, busy and backoff bounds, errors, auth, hard budget, who drives; phase, progress and title from **real** golden mission state; briefing from real findings; failed, stopped, zero-prospect, profile-gap, partial and malformed cases) and `src/components/orqo/missions.test.tsx` (12: live view in progress / viewer / completed, briefing and cards, failed briefing, FR, authority line, delegation form incl. pre-fill and locked states, Work section, "no machinery shown" check) |
| HTTP (isolated server) | **91 pass**, 0 fail (golden test now also asserts input, subjects, $0 authority, $0 ledger spend, no lease owner) |
| DB `tests/db/missions.test.ts` (17B goldens) | **21 pass**, 0 fail |
| E2E (isolated server) | `e2e:missions` **pass** (new). `e2e:app` **pass**. `e2e:work` **pass** after updating its nav expectations to the five intended primary destinations (EN, FR, mobile) |
| `security:check` | **162 pass**. `bun audit`: the same pre-existing dev-only `braces` advisory as in 17B |
| Typecheck, lint, production build | Pass |

**`e2e:missions` covers:**
- primary nav → delegation with the keyboard;
- a reload while the page drives the mission → completed briefing (2 researched prospects, free-authority line, no Stop);
- busy (a real blocking agent run) → "Waiting…" → completes once freed;
- a target-less research mission → inline error;
- cancel: focus on Keep working, Keep closes, confirm → Stopped, and it survives a reload;
- lists and Work;
- mobile 375 px without horizontal overflow;
- a French viewer: translated briefing, no Stop, locked delegation;
- axe WCAG A/AA on 6 views, no console error, no request outside the app.

Screenshots: `.screenshots/p17c-*.png`.

**17B goldens:** all green (unit `executor.test.ts`, DB `missions.test.ts`, HTTP `missions.test.ts`).

## 7. Limitations and deferred work
- **The mission advances only while a member has its page open** (client-side driver). A background driver needs a server-side identity for acting as the user; deferred.
- **Cancellation cannot interrupt** a child run already executing (17B). The UI says the step in progress is discarded.
- **The 40-call per-page cap** can pause a very large mission. Continue resumes it.
- **Viewers** see progress via bounded re-reads, not push updates.
- **Mission titles** for Network-company targets resolve names on the mission and list pages. The Work section shows the stored query/intent only (company-id research missions there read "this company").
- **17B limitations unchanged:** members can write findings directly in their own workspace (LOW); child runs are not parent-run delegated; paid capabilities are deferred.
- **`braces` advisory:** dev-only, pre-existing; left for a dependency pass.

## 8. Recommended starting point for Phase 17D
1. **Paid authority:** extend the template envelope (`FREE_ENVELOPE` / `MissionContract.envelope`) with a requested paid envelope. Add the founder approval step before execution: approval bound to the mission contract and audited, with `variableCostPreApproved` for its children, using the 17A `deriveChild` / `parent_run_id` delegation.
2. **Surface it** in `AuthorityLine` (`src/components/orqo/missions.tsx`): requested, approved and actual. `spend` is already real (`missionSpend`).
3. **Paid steps** (web candidates via Brave, Deep Research, OpenRouter) go only through `provider-gate.ts`. Add new templates with a `TEMPLATE_VERSIONS` bump and new golden missions. Keep the free goldens unchanged.
