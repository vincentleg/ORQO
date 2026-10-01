# ORQO V2 — Phase 11 Implementation Report: Advanced Opportunity Intelligence

## Objective

Give a business developer an explainable answer, readable in about 30 seconds, to this question: *what business could we realistically create with this company? Why, why now, what supports it, what is missing, what could break it, and what should we validate next?*

The answer is a deterministic **Opportunity Intelligence brief**. It is not:

- a score;
- a model brainstorm;
- an automatic qualification;
- automatic creation of anything;
- automatic outreach.

## Baseline

- Branch `phase-11-opportunity-intelligence`, merge base `f343679` (Merge Phase 10). `main` and `origin/main` are at `f343679`.
- The working tree was clean and no Phase 11 code existed.

## Architecture

```
Existing sources (unchanged)                      Phase 11 (pure, src/lib/opportunity/intelligence.ts)
──────────────────────────────                    ─────────────────────────────────────────────────────
Search relevance candidate (Phase 3)  ──fromSearch──┐
Opportunity Graph candidate (Phase 10)──fromGraph───┼─► ThesisDraft ──assess(draft, context)──► OpportunityIntelligence
Canonical opportunity (read only)     ──fromCanonical┘                    ▲
                                                                         │ IntelContext
Network memory (Phase 6) ─relationshipFrom (minimized)─┬─────────────────┤
Open public signals (Phase 7) ───────────────────────────┘                │
Event targets (Phase 8) ─── inside relationshipFrom ──────────────────────┘
```

**No second reasoning system.**

- The Search mechanism rules, the critic verdicts and the ordered validation keys (`relevance.ts`) are reused unchanged.
- The Phase 10 graph candidate rules are reused unchanged.
- Phase 11 adapts each source into one shared assessment.

**Files:**

- `src/lib/opportunity/intelligence.ts`: the engine. Pure: no I/O, no model, no provider.
- `src/lib/server/repositories/opportunities.ts`: read-only canonical opportunity loader.
- `src/components/orqo/opportunity-intelligence.tsx`: the brief and the company card, as server components.
- Wiring: `app/workspace/network/[companyId]/page.tsx` and `components/orqo/opportunity-graph.tsx`.
- FR/EN wording: the `opportunityIntel.*` catalog.

## Opportunity Intelligence model

`OpportunityIntelligence` contains:

**Identity and status**

- `id` (source + source id), `source`, and `label`.
- Labels: `connection_worth_investigating` | `search_hypothesis` | `search_opportunity` (not qualified) | `tracked_opportunity`.
- `workflowStage`: the canonical stage, read only.

**The thesis**

- `mechanism`, `thesis`, `why` (with `whyBasis`) and `value`.
- `participants[]`: each has `brings[]`, `seeks[]` and `support`.

**Evidence and context**

- `fitEvidence[]` and `references[]`.
- `timing[]`, `relationships[]` and `assumptions[]`.

**Assessment**

- `contradictions[]` and `unknowns[]` (ordered; the first is the critical one).
- `nextAction`, `critic[]`, `dimensions` and `support`.

**Wording and limits**

- User-facing text is an i18n key with variables, or text recorded elsewhere and shown verbatim.
- An adapter leaves a field empty or `null` when data does not support it. Nothing is filled with generic text.

## Business mechanism

The engine reuses existing concepts and adds no new taxonomy.

**Search** uses the Phase 3 relationship type and rule:

- Rules: `build_for`, `regional_deployment`, `sought_capability`, `channel`, `combined_offer`, `segment_customer`, or a model hypothesis.
- `mechanism.concrete` is true only when the rule is concrete **and** the Search critic's mechanism check passed.
- `segment_customer` (shared segment) is *contextual*, which means `insufficient_evidence`.

**Graph:**

- `capability_need` maps to `supplier`.
- `missing_piece` maps to `complement` (A + B + C).

**Canonical:**

- `customer`, `reciprocal` or `multi` (shown as complement).
- The mechanism is concrete only when a structure is recorded **and** every participant has a recorded contribution.

## Participant contributions

- Each participant keeps its **own** `brings` and `seeks` with a per-item epistemic basis. Contributions are not mirrored to make the brief look symmetric.
- **Search:**
  - The own side comes from the saved profile fields (offerings or summary; `soughtCapabilities` go to `seeks`).
  - The target side comes from the cited target claims.
- **Graph:**
  - The provider *brings* the concepts and the seeker *seeks* them.
  - A+B participants are "already part of “opportunity”"; the complement brings the missing concept.
- **Canonical:** recorded contributions, with the basis taken from the visible evidence of that company.
- A side with nothing behind it renders "Not established yet." It is `unknown`, which makes support `insufficient_evidence` and adds a `side_no_evidence` unknown.

## Fit

- Only participant evidence decides fit:
  - Search: cited target claims plus the own profile.
  - Graph: capability, need and evidence-store edges.
  - Canonical: visible evidence items.
- Base support:
  - every side a fact: `supported`;
  - some sides facts: `partially_supported`;
  - none: `needs_validation`;
  - any side unknown: `insufficient_evidence`.
- Then caps apply:
  - no concrete mechanism or no specific concept: `insufficient_evidence`;
  - no value statement: at most `needs_validation`;
  - the source's own verdict (Search reject → insufficient, weak → needs validation, limited confidence → partial; graph missing piece → at most partial; canonical critic weak → needs validation);
  - a weakening contradiction: at most `needs_validation`.
- Same event, same industry, relationship, geography and keyword overlap are **not** fit inputs.

## Timing (WHY NOW)

- Timing items: open public signals about the participants, dated *strategy* claims cited by the Search candidate, an upcoming event the company is planned for, and the recorded `why_now` of a canonical opportunity (shown as inference).
- With no timing item the brief says **"No current timing evidence."** and adds a `timing` unknown as the *last* unknown.
- Timing is never an input to support and never reorders briefs (tested).

## Relationship

- `relationshipFrom` minimizes Network memory to:
  - stage;
  - contact **count**;
  - the primary contact's **name**;
  - interaction **count** and last interaction **day**;
  - open follow-up **count**;
  - event name and target status.
- Levels: `not_in_network` | `in_network` | `contact_known` | `in_conversation` | `inactive`.
- Access: `direct` | `via_event` | `none` | `unknown` (`unknown` in the graph view, which does not load contacts).
- The relationship affects **actionability** only (the next action's channel). It never affects support (tested).

## Event context

- An event appears under **Relationship** (event name · Met/Targeted…) and, when upcoming, under **Why now**.
- It never appears in fit evidence or participant contributions (tested at engine and render level).
- Preparation notes, the "why" text and the event description are never read into the brief.

## Graph context

- A Phase 10 candidate is a source of a thesis plus its path references (`references`).
- The brief is always labelled **"Connection worth investigating"** and the graph path is never proof:
  - the seeker's inferred need stays an inference;
  - a missing piece is at most partially supported.
- Questions about the workspace's **own** need or offer are not turned into questions to someone else.

## Evidence and epistemic status

- Basis per statement: `fact` | `inference` | `assumption` | `recorded` (workspace record with no evidence) | `unknown`. Statuses are copied, never upgraded (tested against source claims).
- Origin per evidence item:
  - `official` (company's own site, flagged *self-described* when applicable);
  - `third_party`;
  - `workspace_profile`;
  - `workspace_record`;
  - `recorded_evidence` (graph evidence-store edges).
- The Evidence dimension prefers independent → official → workspace → none. It is not a formula.
- The thesis mechanism (`why`) is labelled Inference. For a model hypothesis it is labelled Assumption.
- Rule assumptions are listed as assumptions.

## Contradictions and negative evidence

All of these are deterministic and come only from records and stored evidence:

| Code | Source | Severity |
|---|---|---|
| `marked_not_relevant` | Network stage set by a person | **blocking**: Contradicted, no validation proposed |
| `relationship_dormant` | Network stage | **access**: shown, does not change fit |
| `outside_goals` | Search critic: relationship type not in the saved partnership goals | weakening |
| `possible_competitor` | Search insight (overlapping offer concepts), for supplier/channel/customer theses | weakening, plus the first unknown ("competes") |
| `geography_mismatch` | Channel/segment thesis: own geographies declared, target geography facts present, no overlap | weakening |
| `missing_capability` | Canonical `missing_capabilities` | weakening |
| `critic_rejected` | Canonical stored critic verdict `reject` | weakening |

## Unknowns

- The order is deterministic and opportunity-specific (not a statistical information gain):
  1. contradiction-derived (they can kill the thesis);
  2. missing evidence on a side (`side_no_evidence`, `own_contribution`);
  3. the mechanism's own unknowns, in Search's decision order (e.g. `production_model` before `volumes_stage`), or the graph unknowns (`need_current`, `offer_fit`, `complement_fit`, `partner_interest`), or the recorded canonical unknowns;
  4. `side_not_fact`;
  5. `timing`, last.
- At most 5 unknowns are shown.
- Each unknown has a resolution channel: `research` (public), `ask` (the company) or `profile` (the own profile).

## Validation questions

- Every unknown carries its question:
  - Search reuses `analysis.validation.*`, e.g. "Does {target} build its hardware in-house, or outsource manufacturing and integration?";
  - graph and evidence-gap questions are new and specific, naming the concept, company or opportunity;
  - canonical opportunities use the recorded questions.
- No generic "interested in a partnership?" wording exists (tested).

## Next validation action

The action is deterministic and **never executed**:

1. If the company is marked Not relevant, or the thesis is contradicted: `none`.
2. Otherwise the critical non-timing unknown is resolved through:
   - `update_profile`;
   - `research`;
   - `ask_contact` (primary contact name);
   - `follow_up_event` (met at an event, no contact recorded);
   - `ask_company` (contacts not known in this view);
   - `identify_contact` (find who owns the decision).
3. Only timing open: `watch_timing`.
4. Nothing open: `decide` ("ORQO does not qualify or create anything").

The Phase 6 relationship NBA is unchanged and shown separately. The brief states that the two answer different questions.

## Critic

The critic checks run in this order:

1. mechanism
2. own contribution
3. other contributions
4. value follows from mechanism
5. specific fit
6. contradictions
7. critical unknown
8. timing
9. relationship

- Timing and relationship are always `info`: they cannot pass, fail or rescue anything (tested).
- The critic rejects briefs: weak theses end as `insufficient_evidence` or `contradicted`.
- The Phase 3 Search critic still runs first and unchanged. Its verdict caps the brief.

## Support states

`supported` · `partially_supported` · `needs_validation` · `insufficient_evidence` · `contradicted`

- Derived only from fit evidence, mechanism, value and contradictions.
- No probability, percentage, score or revenue figure is produced (tested by pattern over every brief).
- **Workflow status is separate:** a canonical opportunity's `stage` is shown as "Workflow stage: X — unchanged by this analysis" and never written.

## UI

**Network company detail.** A new **"Opportunity intelligence"** card sits directly below the relationship Next Best Action.

- It holds up to 6 briefs in this order:
  - tracked opportunities;
  - Search candidates (up to 3);
  - graph candidates (up to 3);
  - then by support state.
- There are no ranks. Short tags (Timing signal present / Needs attention / Direct access / Open questions) replace a leaderboard.
- Each brief is a collapsible card (the first one is open). Its sections:
  - badge row (label · support · mechanism);
  - thesis;
  - **Why this could work** (mechanism + per-participant "brings / is looking for" + "What it could create:");
  - **Qualification** (Fit · Timing · Relationship · Access · Evidence);
  - **Why now**;
  - **Relationship · private context**;
  - **What could break it**;
  - **What we don't know**;
  - **Validate next** (action + quoted question + "Resolves: …");
  - **Evidence** (statements with basis, origin, self-described flag and source link; reference count; assumptions);
  - **How ORQO challenged it** (critic, collapsed);
  - "Nothing here creates an opportunity, changes a stage or contacts anyone."
- **Weak/empty state:** "Potential connection, but there is not enough evidence yet to describe a credible business opportunity." It shows *What is known* (stage, analysis on file, recorded offer/need concepts) and *What is missing* (no analysis / own profile missing / no concrete mechanism / no graph pattern), with links to Search and the Company profile.

**Network → Opportunity graph.** Each candidate now embeds its brief: "Intelligence brief · A connection worth investigating, not a qualified opportunity."

- No new top-level navigation item.
- Everything is in FR and EN.

## Network and Search integration

- **Network:** described above. The relationship NBA and its inputs are unchanged. The card shows the opportunity validation action separately.
- **Search:**
  - The brief is built *from* the Search analysis (same rules, critic and validation keys). The Search page itself is unchanged.
  - The brief adds what Search cannot know (relationship, signals, events, contradictions from Network stage) without a second reasoning path.
- **Discover** is unchanged. The adapters and `assess` are reusable for it later.

## Agent integration

- **None added.**
- A `read_opportunity_intelligence` tool would have no built consumer: Partnership Manager is not executable, and Phase 10's `read_opportunity_graph` is still not granted.
- Adding an ungranted seam was judged unnecessary, so Phase 9 agent definitions, permissions and tests are unchanged.

## Public / private boundary

- The brief's **Evidence** section contains only public and recorded evidence.
- **Relationship · private context** is a separate, labelled section with counts, days, stage, event name and status, and the primary contact's name (used in the action).
- **Never read or rendered:** contact email or phone, contact notes, interaction titles/summaries/outcomes, follow-up descriptions, event prep notes, the event "why" or description, and canonical evidence `privateDetail`.
- Canonical evidence with visibility `agent-only` or `private` is dropped.
- These rules are tested in the engine, in the render and in the repository (zod strips `privateDetail`).

## Security

| Threat | Mitigation |
|---|---|
| Forged organization / cross-tenant | The page uses `loadWorkspace` (membership). Every new read runs as the user under RLS **and** filters `organization_id` (tested with a recording fake). Context only attaches to participants of the thesis (foreign context is ignored, tested). |
| Arbitrary candidate / company ids | There is no new endpoint and no user-supplied id. The company id comes from the route and is uuid-validated, and briefs are computed server-side. |
| Endpoint entitlement bypass | There is no new route, server action or variable cost. |
| Prompt injection / graph poisoning | Web text reaches the brief only as already-stored claims, rendered as literal text. It cannot change rules, support, stage, permissions or actions. Graph input is the existing validated projection. |
| Unsupported promotion / automatic high-impact action | Nothing is written: no opportunity creation, no qualification, no stage change, no outreach. Actions are text only. |

## Cost and providers

- Fully deterministic. No OpenRouter, Brave, Exa, Firecrawl, Neo4j or network call exists on the intelligence path. The test suite installs a `fetch` trap.
- There is no LLM synthesis seam. A model hypothesis already stored by a paid deep Search is *displayed* as an assumption; no new call is made.
- No entitlement change.

## Database

- **No migration and no schema change.**
- New read-only query: `opportunity_participants` → `opportunities` (minimized columns) → participant company names. All are organization-filtered and bounded (10).

## Human decisions not persisted (deferred)

These are deliberately not built, because each needs a migration or a durable write path that cannot be verified safely here:

- "Investigate" / "Not relevant" on a graph candidate. The existing way to exclude a company remains the Network stage "Not relevant", which now makes every brief about it **Contradicted**.
- **Promoting a candidate into a canonical opportunity.** No SaaS write path for `opportunities` exists yet (`engine_key`, critic and trigger provenance would all need defining). It also requires DB/RLS tests that cannot be run safely here.
- **"What changed since the last evaluation".** There is no stored evaluation history, so a diff would be fabricated. Briefs are recomputed from current records on every view, and historical evidence is never mutated.

## Tests run

`bun test src tests/unit`: **407 pass, 0 fail** (30 files). This includes **42 new tests**:

- `src/lib/opportunity/intelligence.test.ts` (35) covers:
  - mechanism required, generic overlap insufficient, contributions separate, an unsupported side stays unknown, own side unknown leads to a profile action, value never invented;
  - signal leads to WHY NOW and never fit, timing cannot rescue fit, event leads to access/timing and never fit, relationship leads to actionability and never fit, explicit "no timing";
  - graph candidate stays a candidate, graph signals stay timing, A+B+C complement, no questions sent about the own need;
  - Not relevant contradicts, dormant is access-only, weakening caps, possible competitor is checked first, critic order and rejection;
  - unknown decision order, a specific question, action channel by relationship/event/research, watch timing / decide;
  - FACT/INFERENCE preserved, no probability/score/revenue, private context minimized;
  - canonical stage separate and untouched, agent-only evidence hidden, missing capability weakens;
  - truthful empty state, ordering without ranks, org isolation, purity/no side effects, Phase 6 NBA unchanged and distinct;
  - FR/EN;
  - fetch trap.
- `src/components/orqo/opportunity-intelligence.test.tsx` (5) covers:
  - EN sections and label;
  - signal only in Why now, event only in Relationship;
  - no private data;
  - FR fully translated without mixing;
  - empty state in EN/FR.
- `src/lib/server/repositories/opportunities.test.ts` (2) covers: org filter on every query, select only (no write), minimized columns, `privateDetail` stripped, malformed item dropped, participant order, and no reads for an invalid id.

**Regression and build checks:**

- The existing Phase 3–10 suites pass unchanged (signals, events, network/NBA, agents, graph).
- `bun run typecheck` is clean, `eslint src` is clean, and one `next build` succeeded.

## Not run

- `test:db`, `test:http` and `e2e:*`: they target the configured real Supabase project (safety guard and destructive-tests policy).
- No live Neo4j (not configured; the Phase 11 path does not use it).
- No browser review by the implementer. It is listed below for the human reviewer.

## External calls and database writes

- **External calls:** none during implementation or tests.
- **Database writes:** none. No DB suite was run, no record was created in any workspace, and the code adds no write path.

## Known limitations

- Canonical opportunities have no SaaS creation path yet. In practice the company card shows Search and graph briefs, and the canonical adapter is exercised by tests only.
- The graph view's briefs use the projection's relationship context (no contact count). Access there may read "Not known here", and the action is "Ask {company}".
- **Search briefs need a stored analysis and an own profile.** Fictional companies without a real website analysis show the truthful empty state.
- **Graph briefs need structured capability/need records or evidence concepts.** As in Phase 10, a fictional workspace may legitimately show none.
- The canonical evidence `companyId` must match participant company ids for the per-side basis. Otherwise the side reads "Recorded".
- Rule-based value and mechanism wording are templates. A model hypothesis's value is not stated, because it is an assumption.
- Not persisted: candidate decisions, promotion, and evaluation history (see the deferred section above).

## Browser review (fictional workspace only — never INFODIP)

1. Sign in to the fictional workspace (e.g. Northstar Systems). Open **Network**, then a fictional company (e.g. Vector).
2. Check that the **Opportunity intelligence** card sits below the relationship Next action.
   - Without a stored analysis or graph pattern it shows *"Potential connection, but there is not enough evidence yet…"*.
   - It shows *What is known* and *What is missing*, with links to Search and the profile, and no invented thesis.
3. If a company has a stored Search analysis with a candidate, open its brief and check:
   - a concrete thesis;
   - separate "{company} brings" blocks for each side;
   - "What it could create:" (cautious, or "Not supported yet…").
4. **Qualification** shows five separate dimensions with no percentage or score.
5. **Why now:** a signal (if any) appears here, otherwise "No current timing evidence." Signals do not appear under Why this could work or Evidence.
6. **Relationship · private context:**
   - stage, counts, last interaction day and event status only;
   - no email, phone, notes or interaction text;
   - an event the company was met at appears here, not in fit.
7. Set the company's Network stage to **Not relevant**. The brief becomes **Contradicted** and Validate next reads "no validation proposed". Restore the stage afterwards.
8. **What we don't know** lists specific unknowns, and **Validate next** shows a concrete question and the channel (contact, event follow-up, identify contact, research).
9. Confirm the separate relationship Next action is unchanged.
10. **Evidence** shows Fact/Inference/Assumption labels, origin and the self-described flag. **How ORQO challenged it** lists the 9 checks; Timing and Relationship are "–" (info).
11. Check that no opportunity was created, no stage changed (other than your own step 7), and no message or follow-up was created.
12. **Network → Opportunity graph** still loads. Each candidate (if any) shows "Intelligence brief · A connection worth investigating, not a qualified opportunity". With zero candidates, the existing empty state is unchanged.
13. Check that Network companies/follow-ups, Intelligence (signals), Events, Agents (Partnership Manager still Business-locked, "Read the Opportunity graph" still *planned*) and `/demo` still work.
14. Switch **FR ⇄ EN**: the card and brief are fully translated, with no mixed language.

## Human review correction

**Observed (fictional workspace).**

- The own profile offers integration, configuration, testing, deployment support and supply-chain coordination. Its goals are Potential customer, Technology partner, OEM / ODM and Strategic partner.
- An official-site Search of a hardware vendor produced the build mechanism "{own} could build, integrate or prepare {target}'s hardware", labelled *Integration partner*.
- It was shown under "Other observations (not in your partnership goals)".

**Root cause.**

- `relevance.ts` checked goal alignment with strict equality (`partnershipGoals.includes(candidate.relationship)`).
- The `build_for` rule names its mechanism with one type: `oem` when the own company manufactures, otherwise `integration`.
- A company that integrates or tests other companies' hardware, without manufacturing, was therefore considered outside an OEM/ODM or customer goal, although it is the same mechanism.

**Semantic fix (no new taxonomy).**

- A rule may declare `alsoFits`: other *existing* relationship types the same mechanism satisfies.
- `goalFits()` aligns a candidate when a goal equals its type or one of its `alsoFits`.
- Only `build_for` declares compatibility, as OEM/ODM ⇄ integration (one build-for-another-brand value chain), plus customer (the target would pay for the service).
- Technology partner, strategic, channel, supplier, co-development and market entry stay incompatible. Other rules and model hypotheses keep the exact-type match. For example, a hardware + software "integration" offer does not match an OEM goal (tested).
- Nothing is hardcoded about a company, product, sector or geography.

**Validation unknown (generic derivation).**

- For `build_for`, when the own company integrates, tests or deploys but does not manufacture, the first validation key is now `outsourced_services`. Its question now reads "Does {target} do {services} in-house, or use an external partner?", with `{services}` derived from the own profile's services.
- `production_model` ("in-house or outsource manufacturing") stays first for manufacturers.
- In the brief this unknown resolves by asking the company, not by public research.

**Evidence thresholds intentionally not relaxed.**

- Alignment only removes the wrong "outside your goals" weakening. It adds no evidence.
- The target's products prove what it *has*, not that it *needs* an external integrator.
- A generic **demand** check was added to the Phase 11 brief (critic: "Someone needs it"). It passes only when some side's need is declared or evidenced: the workspace's own "looking for", a stated target need claim, or a graph seeker/gap. When no need is established, support is capped at **Partly supported**, whatever the timing or relationship.
- Result for the review case: an aligned "Opportunity from public analysis · not qualified" brief.
  - Support: Partly supported.
  - Demand check: "no side is shown to need this yet".
  - First unknown and validation question: whether the target uses an external partner for those services.
- Nothing is qualified, created or sent.
- **Search page, deliberately unchanged:** its own deterministic critic now lists the aligned candidate in its opportunity section at *Moderate* (not Strong) confidence, with the same outsourcing question first. A profile that had selected "Integration partner" already got exactly this result. Search scoring was not changed.

**Tests run.**

- New focused tests:
  - `goalFits` compatible and incompatible goals;
  - an integrate-only profile is aligned and asks `outsourced_services` first;
  - combined-offer integration gets no borrowed compatibility;
  - the review-like case, end to end, stays not Supported, with a demand warning and the outsourcing question;
  - a declared need passes the demand check;
  - the demand cap is not lifted by timing or relationship.
- Overall: `bun test src tests/unit` **413 pass, 0 fail**. This includes the existing Search (qualification, intelligence), Discover, signals, events, network, agents, graph and Phase 11 suites.
- `bun run typecheck` and `eslint src` are clean.
- Not run: the DB/HTTP/E2E suites (real project). No provider call, no database write, no build re-run.

**Final browser re-review is still required.** Re-run Search on the same fictional case, then check the Search section placement and the company page brief (Partly supported, demand warning, outsourcing question).

## Final human review correction (presentation)

**Observed.**

- On the Search page, the fictional build/integration candidate read "Confidence: Moderate", and its critic showed six green checks plus "– Timing".
- The demand check introduced by the previous correction was not visible.
- As a result, the card implied "almost everything passed except timing", although nothing shows the target needs an external integrator.

**Root cause.**

- The demand check existed only in the Phase 11 brief engine (company page).
- The Search card renders the Phase 3 critic checks, which have no demand concept.
- Its badge showed the Phase 3 `confidence`. That value measures how well-sourced a candidate is (verdict, warnings, dated and independent evidence); it is not confidence that the business opportunity is valid.

**Fix (one definition, no new scoring).**

- **Shared demand logic.** `demandEstablished()` moved into `relevance.ts`:
  - a need is established when the workspace declared it is looking for this, or the target states a need about one of the mechanism's drivers as a sourced fact;
  - products, an openness-to-partners link (inference), timing and relationship never count.
- **Recorded on the candidate.** `analyzeRelevance` records it as `EvaluatedCandidate.demand`. It is not a verdict check, so the Search verdict, the confidence, the ordering and Discover/agent behavior are unchanged.
- **Phase 11 reuses it.** The Phase 11 adapter now reads `c.demand` instead of recomputing it.
- **Search card critic.** A **"Someone needs it"** row (✓/!) is added after the verdict checks. For the review case it reads: "! Not established. No evidence yet shows that {target} needs or uses what {own} would provide."
- **Evidence wording.** The evidence check is renamed "Evidence of what {target} does": "Retrieved sources show what {target} does or sells — not that it needs this."
- **Search card badge.**
  - The badge now shows the **Phase 11 support state**, from the same `assess(fromSearch(...))` used on the company page (without private Network context, which Search does not read).
  - Review case: **Partly supported**, because demand is not established.
  - The internal `confidence` stays in the data and is still shown by Discover and agent run summaries. Those views were deliberately not changed.

**Evidence threshold.** Unchanged:

- no rule, verdict or confidence formula was modified;
- demand only caps the support state;
- nothing is qualified or created.

**Tests.** `src/components/orqo/analysis-critic.test.tsx` (7 tests):

- product evidence, an openness link and a dated plan do not establish demand;
- an explicit sourced target need about the mechanism does, while one about another concept does not;
- demand changes neither the verdict nor the checks;
- timing, relationship and event context never satisfy demand, support stays cautious, nothing is qualified, and the next action asks the outsourcing question;
- rendered EN critic: demand row "!", the "Evidence of what … does" wording, no "Confidence:", and a "Partly supported" badge;
- a stated need renders "✓";
- FR is translated with no mixing.

Overall: `bun test src tests/unit` **420 pass, 0 fail**. `bun run typecheck` and `eslint src` are clean. DB/HTTP/E2E were not run. No provider call and no database write.

**Final browser re-review is still required.** Re-open the same fictional Search result and check:

- the badge reads "Partly supported";
- the critic shows "! Someone needs it — Not established…";
- the evidence row reads "Evidence of what … does";
- the company-page brief matches.

## Final human browser review — PASSED

The reviewer re-reviewed the fictional GigaIO / Northstar Systems case in the browser after `0de56bf` and confirmed:

- The Search opportunity badge reads **"Partly supported"**. There is no opaque confidence label.
- "Evidence of what GigaIO does" is clearly separated from evidence of demand.
- The critic explicitly shows **"Someone needs it — Not established"**.
- "Fits your goals" is correctly satisfied: the build/integration mechanism is aligned with the saved partnership goals.
- Timing remains not established.
- Outsourcing remains an assumption, not a fact.
- The first validation question asks whether GigaIO performs the relevant integration/testing work in-house or uses an external partner.
- The Next Best Action is aligned with resolving that unknown.
- No opportunity is presented as qualified, created or confirmed.

**Result: PASSED.**

No product code changed after this review; only this report was updated.

## Commits

On `phase-11-opportunity-intelligence`, on top of `f343679`:

- `39c246e` Phase 11: Advanced Opportunity Intelligence (deterministic briefs)
- `36dec66` Phase 11 human review correction: build-mechanism goal compatibility + demand check
- `0de56bf` Phase 11 final human review correction: demand in Search critic, support state badge
- Phase 11 report: record final human review (documentation only)

Pushed to `origin/phase-11-opportunity-intelligence` after the final review. Not merged into `main`. Phase 12 has not started.
