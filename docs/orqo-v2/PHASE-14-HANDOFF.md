# ORQO V2 — Phase 14 Handoff (for Phase 15)

**Phase 14 = Adaptive Intelligence Foundation:** Business DNA, the Domain & Market Model, and their cross-domain foundation. This page is all Phase 15 needs; it is not necessary to reread ORQO's history.

## 1. Baseline
| | |
|---|---|
| Phase 13 baseline | `main` = `origin/main` = `30e83b8` (Production live, unchanged by Phase 14) |
| Branch | `phase-14-intelligence-rebuild` (local; not pushed, not deployed) |
| Production | Untouched: no migration, no deploy, no Vercel or Supabase change |
| ORQO Test | Migration `20261006090000_phase14_company_validations` applied |

## 2. What was built
1. **Domain-neutral ontology** (`src/lib/understanding/ontology.ts`). Archetype dimensions, value-chain roles, relations and a market catalog. Every entry declares the traits under which it applies. No industry selects anything.
2. **Detection vocabulary** (`lexicon.ts`), EN/FR. Vocabulary only: it marks a trait as *observed* in a company's own wording.
3. **Business DNA builder** (`dna.ts`), pure: answers "what is this company?".
4. **Domain & Market Model builder** (`market.ts`), pure and one-way: answers "how does the commercial world around it work?".
5. **Next Best Question** (`question.ts`), minimal: "the one thing I need from you".
6. **Persistence:** one append-only table, `company_validations`, with a repository and service (`src/lib/server/repositories/understanding.ts`).
7. **Discover, don't ask:** `loadOwnContext` completes empty own-profile fields from the DNA. It is used by Search (`research/execute.ts` and the Search page), the Network company page and the event target page.
8. **Minimal UX** on `/workspace/company`:
   - the own-company form asks for name and website only;
   - "Read my company" runs the existing free Basic read and stays on the page;
   - the Business DNA shows labels and evidence, with confirm / "not right" on ORQO's readings;
   - the one-question card;
   - "How your market works";
   - the manual profile is folded away.

## 3. Key decisions
- **Derived, not stored.** The DNA and the market model are recomputed on read from stored evidence plus validations. This is cheap and deterministic, and there are no snapshots to migrate when the ontology changes. The only stored state is what a person said.
- **No provider anywhere in Phase 14.** The builders are pure. The only input path is the existing Basic research (official website only, quota-limited, no paid provider). A static test forbids `src/lib/understanding` from importing server, AI, research or environment code.
- **Traits, not templates.** Market entries are selected by conditions on traits such as `offering_form:software`, `customer_scope:public_sector`, `role:manufacturer` or `has:integrations`. Industries are labels and vocabulary, never logic. Extending ORQO means adding a catalog entry; the builders do not change.
- **One-way contract.** The market model reads only the DNA's fact/inference traits, never its hypotheses, and never writes back. It owns no facts.
- **Only a person creates a fact from an inference** (confirm or answer). That fact is labelled "Confirmed by you" or "Stated by you".

## 4. Contracts (`src/lib/understanding/types.ts`)
```ts
understandCompany({ companyName, website, intelligence: { id, researchedAt, profile: TargetProfile } | null, validations }): CommercialUnderstanding
getOwnUnderstanding(db, organizationId): Promise<{ own, understanding } | null>   // server, RLS-scoped
loadOwnContext(db, organizationId, ownRow): Promise<OwnCompanyContext>            // DNA fallback for empty fields

interface CommercialUnderstanding { dna: BusinessDna; market: MarketModel; nextQuestion: NextQuestion | null }
```

**`BusinessDna`:**
- `status` (`not_analyzed` | `analyzed`), `basis` (intelligence id, researchedAt, website), `ontologyVersion`;
- `items: DnaItem[]`, `unknowns: DnaFacet[]`, `rejected[]`;
- `traits: Trait[]`: facts and inferences only; this is the only market-model input.

**`DnaItem`:**
- `key`: stable `facet:value`, or `facet:<hash>` for statements;
- `facet`, `value`, `state` (`fact` | `inference` | `hypothesis`), `origin` (`research` | `derived` | `user`);
- `confirmed`, `selfDescribed`;
- `evidence[]` (`claimId`, `sourceUrl`, `retrievedAt`, `excerpt`), `derivedFrom[]`.

**Facets:**
- text: `description`, `identity`, `offerings`, `customers`, `industries`, `geographies`, `technologies`, `business_model`, `problems_solved`, `public_partners`, `integrations`, `certifications`, `case_studies`, `strategic_signals`;
- dimensions: `offering_form`, `customer_scope`, `revenue_model`, `sales_motion`, `regulation`;
- `value_chain_role`.

**`MarketModel`:**
- `coverage`: `insufficient` (no offering form), `partial` or `sufficient`;
- `archetype` (per dimension: values, state, basis), `roles`, `terminology`, `unknowns`;
- `items: MarketItem[]`, one per section: `role` (with a `relation`), `route`, `buying`, `mechanism`, `signal`, `event`, `risk`.

**`MarketItem`:**
- `state`: `inference` when a cue in this company's evidence supports it, otherwise `hypothesis` (typical for this kind of business);
- `because` / `evidencedBy`: traits;
- `basis`: DNA item keys.

**`NextQuestion`:** `{ dimension, options (only plausible values), unlocks }`.

## 5. Evidence model
**Labels:**
- **Facts** are sourced claims from the Evidence Store (`evidence_items` → `sources`). A claim marked fact without a retrieved source is downgraded to inference.
- **Inferences:** traits read from wording.
- **Derived inferences:** roles that follow from an offering form, with `derivedFrom` recorded.
- **Hypotheses:** come from model or assumption claims and never become traits.
- **Unknown:** any facet without an item.

Self-described statements are flagged. The DB value `assumption` maps to "hypothesis" in Phase 14 contracts.

## 6. Schema
**`public.company_validations`:**
- `organization_id`, `company_id` (same-organization foreign key);
- `kind` (`confirm` | `reject` | `answer`), `facet`, `item_key`, `value`, `created_by`, `created_at`.

**Database checks:** values are enum-like keys only, with no free text. An answer has no item; a confirm or reject has one.

**Access:**
- **Append-only:** `authenticated` may select and insert only.
- **RLS:** viewers read, members insert. Anon and service_role have no privileges.
- **Audited:** `audit_change` trigger. `created_by` is set by the database.
- **Latest wins:** the latest entry per item or dimension applies.

## 7. Security invariants kept
- **No provider and no network** in the understanding module, enforced by a static test. The Company page offers only the free Basic read.
- **External content is data:** website claims are only matched against reviewed vocabulary and rendered as escaped text.
- **Strict validation input:** zod, with no extra fields. Answers must be ontology values or "not sure", and confirm/reject must name an item currently in the understanding. The database independently refuses free text.
- **Tenancy:** RLS and the membership check (member+) in the server action are unchanged. Cross-tenant reads and writes are refused, as tested.
- **Unchanged:** no agent, tool, entitlement, quota or kill-switch changes.

## 8. Entitlements and cost
- Free gets all of Phase 14. The cost is zero beyond existing Basic reads, which count in the existing research quota.
- No model or paid call was added.
- The Founder/Internal entitlement is not built (deferred).

## 9. Tests
| Suite | Result |
|---|---|
| `src/lib/understanding/understanding.test.ts` | 22 tests: DNA labels, cross-domain differences, negative bias assertions, unknowns, monotonicity, the one-way contract, the next question, validations, strict input, static bias and isolation scans, EN/FR labels for every concept |
| `tests/db/understanding.test.ts` (ORQO Test) | 9 tests: derivation from stored evidence, the context fallback, validations, ontology-only values, append-only, tenant isolation, viewer read-only, grants |
| `scripts/e2e-understanding.ts` (`bun run test:isolated e2e:understanding`) | Name + website → one real Basic read → DNA (facts and inferences, evidence) → market model → answer, confirm and reject persist → mobile (no horizontal scroll, ≥32 px targets) → French. Fails on console errors, failed requests or unlabeled controls |
| `scripts/e2e-app.ts` | Updated for the folded manual profile |

The final regression results are in `PHASE-14-IMPLEMENTATION-REPORT.md`.

## 10. Cross-domain fixtures (`src/lib/understanding/fixtures.ts`, fictional)
| Company | Reads as | Market structure, distinctively |
|---|---|---|
| Contract electronics manufacturer | Physical product; manufacturer; regulated | Input suppliers, supply changes, capacity, trade shows, supplier qualification |
| AP-automation SaaS | Software; subscription; self-serve + demo + marketplace | Integration ecosystem, marketplaces, trial first, churn |
| Management consultancy | Service; project fees + retainer; referrals | Referrals and reputation, executive sponsors, key-people risk. No manufacturing, even though it *serves* manufacturers |
| Biotech | Research + IP licensing; regulated; institutions | Licensing, milestone partnering, scientific congresses, regulatory milestones |
| Freight logistics | Capacity / infrastructure; usage-based; business + public sector | Capacity, public tenders, joint bids, subcontracting |
| Thin niche site | Nothing readable | Coverage `insufficient`, no invented market, first question "What does your company mainly sell?" |

**Real acceptance, read-only:**
- **GigaIO** (stored Dev intelligence): physical product + software, business customers, partial coverage. Next question: revenue model.
- **INFODIP** (in-memory Basic read of its public site, nothing stored): physical product + service + software, distributor cue. Next question: customer types.

No company-specific code exists; a static test forbids company names and vertical terms in the logic files.

## 11. Known limitations
- **Detection is vocabulary-based.** A company that describes itself unusually may stay *unknown* until the user answers. That is by design, but coverage depends on the website's wording.
- **Over-reading:** multi-activity sites (for example hardware + software + services) yield several offering forms and many hypotheses. The UI folds hypotheses beyond four per section.
- **Phase 11 is unchanged:** relevance (`concepts.ts`, `relevance.ts` RULES and VALIDATION_KEYS) still carries its hardware-leaning vocabulary. It now benefits from the DNA context fallback but is not yet ontology-driven.
- **Own company only in the UI:** targets get Business DNA through `understandCompany`, but no target UI exists.
- **No snapshot history:** the understanding is recomputed, and the validation log is the history.

## 12. Deferred (by phase)
| Phase | Items |
|---|---|
| 15 | Company Intelligence 2.0 for targets; Partnership Scenario Engine; novel business hypotheses; Deal Critic; Revenue Hypotheses; Why Now; reports; re-basing Phase 11 relevance on the ontology; Founder/Internal entitlement; model-assisted DNA extraction (gated) |
| 16 | CEO interface; navigation and workspace redesign; conversational next question; Business Memory experience |
| 17 | Agent organization; Run ORQO; an agent read tool for the understanding |
| 18 | Event Radar; continuous signals; incremental refresh |
| 19 | Reverse search; Missing Piece; pathfinding; simulation; outcome learning |
| 20 | Exhaustive security and privacy hardening; the Trust & Legal Center |

## 13. Phase 15 integration points
- **Inputs to the Partnership Scenario Engine:** `understandCompany` for both companies.
- **Typical mechanisms:** `market.items` where `section === "mechanism"`.
- **Plausibility of a proposed mechanism:** check it against the other company's archetype with `holds(entry.when, traits)`.
- **Why Now:** `signal` entries tell which signals matter in each market.
- **Deal Critic:** `risk` and `buying` entries give domain-appropriate objections.
- **Validation questions:** reuse `nextQuestion`'s "unlocks" logic.
- **Extending the ontology:** add catalog entries plus EN/FR labels (enforced by a test). Never add industry branches to the builders.
