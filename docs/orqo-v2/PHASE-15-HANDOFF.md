# ORQO V2 — Phase 15 Handoff (for Phase 16)

**Phase 15 = Company & Opportunity Intelligence:** what ORQO could realistically build, sell, deliver, license or develop with a target company. It builds on `PHASE-14-HANDOFF.md`, whose contracts are unchanged and extended.

## 1. Baseline
| | |
|---|---|
| Phase 14 baseline | `main` = `origin/main` = `ced1dc9` |
| Branch | `phase-15-company-opportunity-intelligence` (local; not pushed, not deployed) |
| Schema | **No migration.** Production and ORQO Test are unchanged by Phase 15 |
| Founder / Internal entitlement | Deferred to Phase 17 (owner decision) |

## 2. What was built (all pure and deterministic; no provider and no write)
| Module | Role |
|---|---|
| `src/lib/understanding/pairs.ts` | **Pair-mechanism catalog** (data), 15 mechanisms: contract production, resale, regional route, technical integration, embedding, implementation, referral, licensing, research collaboration, joint bid, fulfilment, marketplace onboarding, data partnership, **joint offer** and **co-development**. The last two are new offerings. Also the question catalog, revenue structures and signal vocabulary |
| `src/lib/understanding/scenarios.ts` | **Scenario engine, Deal Critic and revenue hypotheses** |
| `src/lib/understanding/dossier.ts` | **Company Intelligence 2.0**: the dossier on a target, personalized with the own company |
| `src/lib/understanding/dna.ts` | Extended: the own company's typed profile becomes **user-stated** DNA (`origin: "user"`, fact), plus inferred traits from it |
| `src/lib/intelligence/relevance.ts` | Phase 11 rules `build_for`, `regional_deployment` and `combined_offer` are a **trait-gated physical-product specialization** when traits are passed. Without traits, legacy behaviour is unchanged |
| `src/lib/server/repositories/understanding.ts` | `getDossier`, `relevanceTraitsFor` (read-only) |
| `src/components/orqo/dossier.tsx` | Dossier view (Search result and report) |
| `src/app/workspace/report/page.tsx`, `print-button.tsx` | **Deal Intelligence Report**: stored intelligence only, with browser print-to-PDF |

## 3. Contracts
```ts
generateScenarios(own: Party, target: Party): { scenarios: Scenario[]; discarded: { mechanism; provider; findings }[] }
companyDossier(own: Party, target: Party): Dossier
getDossier(db, organizationId, storedIntelligence, ownUnderstanding?): Promise<Dossier | null>   // RLS-scoped, read-only
type Party = { name: string; understanding: CommercialUnderstanding }                           // Phase 14
```

**`Scenario`:**
- `mechanism`, `provider` / `partner` (`own` | `target`), `novelty` (`existing_mechanism` | `new_offering`);
- `contributions.{provider,partner}`: `traits` plus `support[]` (DNA item key, value, state, origin, source URL);
- `shared`: audiences, industries, technologies, partner regions;
- `state`: `inference` (evidence-backed: both sides plus a shown need) or `hypothesis`. A **new offering is always a hypothesis**;
- `needShown`, `whyNow[]` (dated research facts matched to the mechanism's signal types), `critic[]`, `verdict` (`credible` | `weak`);
- `dimensions`, all qualitative:
  - evidence: strong / moderate / limited;
  - strategic fit: complementary / overlapping;
  - market compatibility: typical in both / typical in one / atypical;
  - timing: evidenced / unknown;
  - feasibility;
  - risk;
- `questions[]` (the first is decisive), `revenue`.

**`CriticFinding`:** `{ code, severity: kill | major | minor, side, basis: DNA item keys }`.

**Codes:**
- `already_does`: kill if a fact, major if an inference;
- `need_not_shown`: major;
- `possible_competitor`: major; only when the provider brings its own product;
- `channel_conflict`: major;
- `atypical_mechanism`: major; neither market model lists the mechanism;
- `value_asymmetry`, `regulatory`, `procurement`, `timing_unsupported`, `execution_complexity`, `substitute`: minor.

**Verdicts:** any kill → rejected (listed in `discarded`); 2+ majors → weak; otherwise credible. A pair that only shares a sector yields `discarded: [{ mechanism: "similarity_only" }]`.

**`RevenueHypothesis`:** `{ payer, structure, mechanism, evidence (DNA keys), unknowns, validation, stage: "hypothesis", outcome: null }`. It never contains an amount, price, size or probability (enforced by a test).

**`Dossier`:**
- `status`: `ready` | `own_missing` | `target_insufficient`;
- `executive`: the target's roles, forms and scopes, its top routes, and the `lead` scenario;
- `targetDna`, `targetMarket`;
- `scenarios` (at most 3 existing mechanisms), `novel` (at most 2 new offerings), `discarded`;
- `needs` (inference or hypothesis), `whyNow`;
- `questions` (at most 4), `nextQuestion`;
- `next`: `read_own_company` | `learn_target` | `no_business_now` | `verify` | `ask`;
- `asOf`.

## 4. Epistemic propagation
- **Support items** keep their Phase 14 label: fact, inference or "stated by you".
- **The mechanism's narrative** (problem, joint value, value to each side) comes from the catalog and is rendered as **hypothesis**.
- **Unknowns** are the questions. Missing timing is shown as **Unknown**.
- A scenario is evidence-backed only if both sides' traits are known **and** the partner shows a need.
- New offerings carry **"ORQO-generated hypothesis"**, and the wording never says "plans" or "will".

## 5. Search relevance
- **Search result page:** shows the dossier first (executive assessment, scenarios, novel ideas, needs, the decisive question, discarded ideas, the target's market), then the understanding, unknowns and evidence. The legacy relevance block remains only when there is no own company.
- **Network and event-target pages:** pass both companies' traits to `analyzeRelevance`. Physical-product rules fire only when the DNA shows physical products plus a manufacturer/integrator (or the matching complementary form), never by default.
- **Hardware stays where it is real:** INFODIP keeps its hardware mechanisms because its own DNA carries those traits.

## 6. Report
- `/workspace/report?q=<domain>` sits behind the auth proxy and workspace membership, and every read is RLS-scoped.
- **No research:** it only calls `findIntelligence` and `getDossier`. No research, provider, write or fetch is possible, as checked by a static test and an E2E research-run count.
- **PDF:** "Download PDF" uses the browser's print dialog. The app navigation is `print:hidden`, and scenario details are expanded in the report.
- **Deferred:** a server-generated PDF.

## 7. Security, cost and entitlement
- **No provider:** zero provider calls anywhere in Phase 15. The static import guards cover `scenarios.ts`, `dossier.ts`, the report and the dossier view.
- **No new authority or entitlements:** no new actions, agents, entitlements or writes. Free gets all of Phase 15 at no variable cost.
- **Tenancy:** relies on Phase 14 RLS. A DB test checks that another organization cannot read the stored evidence the dossier uses; an HTTP test checks that the report requires sign-in.

## 8. Tests
| Suite | What it covers |
|---|---|
| `src/lib/understanding/scenarios.test.ts` | 18 tests: cross-domain pairs (manufacturer × hardware, SaaS × SaaS, consultancy × SaaS, biotech × pharma, logistics × consumer brand); niche → zero; same sector → "similarity only"; the critic rejects (user-confirmed "already does it") and weakens (inferred); findings only when triggered; new offering → hypothesis; no numbers in revenue; dossier personalization; evidence traceability; typed profile → stated DNA; relevance specialization; static guards; report never researches |
| `tests/db/understanding.test.ts` | +1 dossier test: own read + cross-tenant evidence isolation |
| `tests/http/api.test.ts` | +1: the report redirects signed-out users to sign-in |
| `scripts/e2e-app.ts` | The dossier on a real Basic read, the report, the print view (no navigation), and no research run created by opening the report |

New fictional partner fixtures are in `fixtures.ts`: Quartzline Devices, Fieldnote, Corvant Pharma, Lumen & Co, Northway Haulage.

## 9. INFODIP × GigaIO (read-only acceptance: Dev data, no fetch, no write)
**Inputs:** INFODIP's stored typed profile (as user-stated DNA) and GigaIO's stored intelligence.

**Scenarios produced:**
| Scenario | Label | Verdict and basis |
|---|---|---|
| Technical integration | Evidence-backed | Credible: partnership announcements give dated timing |
| Implementation partnership | Evidence-backed | Credible |
| Contract production by INFODIP | Hypothesis | Credible, but "no evidence shows GigaIO needs this" |

- **Decisive questions:** "Do shared customers ask for the two products to work together?" and "Does GigaIO produce in-house or outsource its production?"
- **No company-specific code.** The only change for this case was **vocabulary data**: "ODM / OEM-ODM" was added to the manufacturer-role terms in `lexicon.ts`.

## 10. Known limitations
- **Detection is vocabulary-based.** Thin or unusual websites yield fewer traits, and therefore fewer scenarios. This is by design: unknown is preferred to invention.
- **Mechanism narratives are generic per mechanism.** They are personalized by names, evidence and critic findings, not by bespoke prose. Model-written prose is deliberately absent.
- **The Network company page** still shows Phase 11 Opportunity Intelligence briefs; the dossier is on Search and in the report. Phase 16 should unify these surfaces.
- **Not persisted:** scenarios and revenue-hypothesis lifecycle stages. Tracking and outcomes belong to Phase 16 (Business Memory) and Phase 19 (Outcome Learning).
- **Report:** print-to-PDF only; there is no server PDF.

## 11. Deferred
| Phase | Items |
|---|---|
| 16 | CEO interface; workspace and navigation redesign; one surface for the dossier and Phase 11 briefs; tracking a scenario as an opportunity (persistence); conversational next question |
| 17 | Founder / Internal entitlement; agent workforce (an agent tool to read dossiers); Run ORQO |
| 18 | Continuous signals feeding `whyNow`; Event Radar |
| 19 | Missing Piece; reverse search; pathfinding; simulation; outcome learning on revenue hypotheses |
| 20 | Exhaustive hardening; the Trust & Legal Center |

## 12. Phase 16 integration points
- **CEO intents** such as `evaluate_partnership`, `explain_opportunity` and `challenge_business_scenario` can be answered directly from `getDossier` (scenario, critic, questions).
- **Business Memory:** persist `{ scenario.key, mechanism, stage, decision }` per target. The key is stable for a given mechanism and direction.
- **Opportunity Next Best Question:** use `dossier.nextQuestion`, which is already the decisive unknown of the lead scenario.
- **Unify the Network page** by rendering `DossierView` there and retiring the Phase 11 brief UI when ready.
