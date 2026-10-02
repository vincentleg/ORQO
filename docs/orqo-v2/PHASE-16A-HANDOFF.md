# ORQO V2 — Phase 16A Handoff (for Phase 16B)

**Phase 16A = Opportunity Precision and Tracked Opportunities.** ORQO now tells an existing relationship apart from a new opportunity. "No credible new opportunity" is a confident, explained result. Users can keep the credible opportunities ORQO finds.

This document builds on `PHASE-15-HANDOFF.md`, whose contracts are unchanged unless stated below.

## 1. Baseline and state
| | |
|---|---|
| Baseline | `main` = `origin/main` = `598b7e4` (docs-only commit on top of the validated `2dce28d`) |
| Branch | `phase-16-orqo-ceo-experience`, local only: not pushed, not deployed |
| Migration | `20261007090000_phase16_tracked_opportunities`, applied to **ORQO Test only** (`****xplh`). Production (`****tklx`) and Dev are untouched |
| Rollback | `supabase/rollbacks/20261007090000_phase16_tracked_opportunities.down.sql` |
| Dev note | The Dev project never received the Phase 14 migration (`company_validations` is absent there). It is pre-existing and harmless for read-only checks. Do not migrate Dev without the owner |

## 2. Relationship assessment
`src/lib/understanding/relationship.ts` is pure.

```ts
assessRelationship(own, target, { validations, networkStage }): RelationshipAssessment
// { status: known | none | unknown, links: RelationshipLink[], roles: RelationshipRole[], answered }
```

**Roles:** customer, supplier, channel, partner, competitor, plus `unspecified`. A role always describes what the **target** is to the user's company.

**Sources, strongest first:**
1. **The user's answer** (fact). It is authoritative: it replaces what ORQO read, and "none" means no relationship.
2. **The Network stage `customer_partner`** (fact, kind unspecified).
3. **Sentences in either company's DNA that name the other company** (inference). Names are matched on the full name, the first distinctive word and the domain label.
   - The cue nearest to the name decides the role (vocabulary in `lexicon.ts`: `RELATIONSHIP_CUES`).
   - The reading depends on who wrote the sentence. "Built on X" on our site means X is our supplier. "Our customers include us" on X's site means the same.

## 3. Deal Critic precision
Implemented in `scenarios.ts`. The pair catalog in `pairs.ts` gains two data fields:
- `creates`: what the target would become under each mechanism;
- `needTerms`: wording that states a need.

**New critic codes:**

| Code | When | Severity |
|---|---|---|
| `restates_existing` | The target already holds the relationship this mechanism creates (classes in `RESTATES`: e.g. supplier ≈ partner for integration, implementation or joint offers) | **Kill** if stated by the user, **major** if read from evidence. Either way the scenario is at most weak |
| `reverses_relationship` | An existing supplier, partner or channel would have to buy from or sell for the user's company, with **no dated signal from the target** for this mechanism | **Kill** for a user-stated supplier, otherwise major. Forces weak |
| `no_credible_payer` | The need is not shown, and either the partner is the payer or there is no dated signal at all | Major |

**Other changes:**
- **Generic cues are not needs.** For contract production, selling through channel partners is no longer a need cue; a distributor role or stated wording is. This was found by the Dell acceptance.
- **Company size is not an input**, and a test enforces it.

**Verdicts are unchanged**, plus: weak = "considered, not recommended", which is never prioritized or trackable.

## 4. Dossier verdict
Implemented in `dossier.ts`.

**New fields on `Dossier`:**
- `verdict`: `opportunity` (at least one credible scenario) | `no_credible_opportunity` | `insufficient`;
- `relationship`;
- `askRelationship`;
- `considered` (weak, at most 4);
- `negative: { shared, reasons, consideredMechanisms: {mechanism, provider}[], reconsiderIf (signal types), unknowns }`.

**Behaviour:**
- `scenarios` and `novel` now contain **credible ones only**.
- There is no minimum count.
- A negative result always carries at least one reason: `no_common_ground` when nothing at all is shared.
- `trackableScenario(dossier, key)` is the single gate for tracking.

**Server-side resolution:**
- `getDossier(db, org, intel, own?, known?)` now applies the target company's validations and Network stage.
- `getCompanyDossier(db, org, companyId)` resolves a remembered company entirely on the server.

## 5. The relationship question
- **Wording:** "How does {target} work with {own} today?" (only the user can know this).
- **Storage:** an append-only `company_validations` row on the target company (`kind=answer`, `facet=relationship_role`, value: 1–3 roles, or `none`, or `not_sure`).
- **When it is asked:** only if it is unanswered and either there is a lead to confirm or a relationship was read from evidence.
- **After any answer, including "not sure",** it is never asked again.
- **Interfaces:** `addRelationshipAnswer`, `answerRelationshipAction`, and `GET/POST /api/v1/organizations/{org}/companies/{id}/relationship`.

## 6. Tracked opportunities
| | |
|---|---|
| Table | `tracked_opportunities(id, organization_id, target_company_id, intelligence_id?, scenario_key, mechanism, status, snapshot jsonb ≤ 32 KB, status_changed_at, created_by, created_at, updated_at)` |
| Constraints | Unique on `(org, company, scenario_key)`. Same-organization foreign keys to companies (cascade) and to intelligence (set null). `mechanism` must equal the key's prefix |
| Statuses | `investigating` (default), `validated`, `paused`, `closed`. No pipeline, no amounts, no owners |
| Grants and RLS | `authenticated`: select and insert, plus **update(status) only**. No delete. Nothing for anon or service_role. Policies: viewer+ select, member+ insert and update |
| Triggers | `set_created_by`, `set_updated_at`, `status_changed` (dates status changes), `audit_change` |
| Snapshot | Built by the **server** from its own dossier: the scenario (long texts clipped), the relationship, and both names. On read, the detail page recomputes the dossier: "Still credible", "assessment changed" or "research missing" |
| Repository | `src/lib/server/repositories/tracked-opportunities.ts`: `trackOpportunity`, `listTrackedOpportunities`, `getTrackedOpportunity`, `setTrackedStatus` |
| Entry points | Server actions in `src/app/actions/opportunities.ts`. API: `GET/POST /api/v1/organizations/{org}/opportunities`, `GET/PATCH …/opportunities/{id}` |

**What tracking does, in order (the browser sends only `{ targetCompanyId, scenarioKey }`, or the Search query):**
1. checks membership;
2. checks the company belongs to the organization and is not the own company;
3. recomputes the dossier;
4. requires `trackableScenario`;
5. stores the snapshot.

Tracking is idempotent. From Search, the company is remembered first (the existing add-to-Network path).

## 7. UI
**Shared `DossierView`** (Search result, Network company page, report):
- the relationship today, with its source;
- the confident `NegativeView`: why it still matters, why ideas aren't recommended, what's unknown, what would change it;
- "Why this is new" on incremental scenarios;
- collapsed "Ideas ORQO considered but doesn't currently recommend";
- **Track** on credible scenarios only, and only when `actions` is given (never in the report);
- the one-time relationship question.

**Network company page:** renders the dossier and the company's tracked opportunities. The Phase 11 briefs move under a collapsed "Earlier analysis". Without stored research, the page is unchanged.

**`/workspace/opportunities`** is a list (in progress, then closed) with an empty state. **`/workspace/opportunities/{id}`** answers the seven questions in business language, with evidence on demand and the status control.

**Navigation:** a temporary "Opportunities" entry after Network. 16B replaces the navigation.

**Accessibility:** the `--color-fg-faint` token is darkened to `#666b77` for WCAG AA contrast, which affects all pages slightly. New controls are at least 44 px.

**Components:**
- `opportunity-forms.tsx` (client): `TrackButton`, `RelationshipQuestion`, `StatusForm`;
- `tracked-opportunity.tsx`: the detail view, `trackedTitle`, `mainUnknown`.

**Localization:** EN and FR are complete (new `dossier.*`, `opportunities.*`, `nav.opportunities`, `network.earlierAnalysis*` keys).

## 8. Acceptance
**GigaIO**, read-only on Dev, with INFODIP's stored research:
- technical integration and implementation partnership remain **credible**;
- contract production is **considered**: no shown need, nobody shown to pay;
- the two embedding ideas are also considered, flagged as a possible competitor.

**INFODIP × Dell Technologies** (free Basic reads of both public sites on ORQO Test; temporary test, not kept):
- Without an answer: **No credible new opportunity**. INFODIP's site does not name Dell, so the relationship is unknown. Dell shows no need, and nobody is shown to pay for contract production, regional routes or licensing.
- With "they supply us": still no opportunity, and every reversing or restating idea is rejected outright (killed by `reverses_relationship` / `restates_existing`).
- With fictional fixtures, real incremental evidence (the target's dated outsourcing programme) turns it back into an opportunity, explained as new.

**Cross-domain fixtures** (`fixtures.ts`): integrator × server maker, SaaS × cloud host, consultancy × the vendor it implements, biotech × reagent supplier, brand × logistics provider. All five yield no credible opportunity with the relationship recognized; the positive variants hold.

**No company-specific code:** a static test scans the generic reasoning files for company, industry and size terms.

## 9. Tests (all on ORQO Test where a database or server is involved)
| Suite | Result |
|---|---|
| Unit (`bun test src tests/unit`) | 536 pass. New: `precision.test.ts` (relationship, the 14 negative-result cases, cross-domain, Dell pattern, the question), `dossier-precision.test.tsx` (EN/FR static render) |
| DB (`test:isolated db`) | 208 pass, including the new `tracked-opportunities.test.ts` (15) |
| HTTP (`test:isolated http`) | 67 pass, 1 optional live-AI test skipped. New: `opportunities.test.ts` |
| E2E | `e2e:app`, `e2e:understanding`, `e2e:network`, `e2e:discover` and `e2e:agents` pass. New `e2e:opportunities` passes: axe WCAG A/AA on page content in EN/FR, 1440/1280/390 px with no overflow, tap targets, keyboard focus, no console error, no research run, no request outside the app |
| Typecheck, lint, local production build | Pass |

**Tooling:** `scripts/isolated-test.ts db|http tests/…/x.test.ts` can now target single files.

## 10. Security and cost
- No new authority, entitlement, provider or model call.
- Every Phase 16A page and route reads stored data, except tracking and the relationship answer, which write to the organization under RLS.
- Non-members get 404. Viewers can read but not write. Cross-site writes are refused (403).

## 11. Known limitations
- **Relationship evidence is name-based:** a company the own website never names stays "unknown" until the user answers. A short or common first name could, rarely, mis-match; the source sentence is always shown.
- **Stated-need vocabulary is still small:** `needTerms` covers 7 mechanisms.
- **The question isn't offered for unremembered companies:** a company seen only in Search (not yet in the Network) has nowhere to store the answer.
- **The sidebar shell still fails axe contrast** on two labels (workspace label, language switch). It is left for the 16B shell redesign; the e2e runs axe on page content.
- **Tracked opportunities involve exactly two companies** (own and target).

## 12. For Phase 16B
- **CEO briefing:** use `listTrackedOpportunities` (status investigating), plus `getCompanyDossier(...).dossier.verdict === "opportunity"` for untracked leads. **Exclude** `no_credible_opportunity` and `considered`.
- **CEO intents:**
  - `evaluate_partnership` / `explain_opportunity` → `getCompanyDossier` and `DossierView`;
  - `identify_missing_information` → `negative.unknowns` / `questions` / `askRelationship`;
  - the next best question on Work → the relationship question or `dossier.nextQuestion`.
- **Companies route:** render `DossierView` with `actions` (it already works on Search and Network). The compatibility routes are `/workspace?q=` and `/workspace/network/{id}`.
- **Navigation:** remove the temporary entry when Work / Companies / Opportunities / Events lands, and fix the shell contrast.
