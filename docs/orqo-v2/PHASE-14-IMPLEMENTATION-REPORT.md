# ORQO V2 — Phase 14 Implementation Report

**Status: Phase 14 COMPLETE — PASS (Adaptive Intelligence Foundation, rescoped).** The work is local on `phase-14-intelligence-rebuild` and has not been pushed or deployed. Production is unchanged.

Architecture, contracts and the integration points for Phase 15 are in `PHASE-14-HANDOFF.md`. This report records only what was delivered and how it was validated.

## Delivered
- **Business DNA and Domain & Market Model:** a pure, deterministic engine (`src/lib/understanding/`) built on a domain-neutral ontology. Labels: fact / inference / hypothesis / unknown.
- **Minimal Next Best Question.**
- **One append-only table**, `company_validations` (RLS), applied to **ORQO Test only**.
- **Discover, don't ask:**
  - the own-company form asks for name and website only;
  - empty profile fields are completed from the DNA for Search, Network and Event analyses.
- **Company page:**
  - "Read my company" uses the free Basic read only;
  - the DNA is shown with evidence, plus confirm / "not right";
  - the one-question card;
  - "How your market works".
  - EN/FR, responsive, accessible labels.

## Validation (final regression, run once)
| Check | Result |
|---|---|
| Unit (`bun run test`) | **490 pass, 0 fail** (37 files), including 22 Phase 14 tests |
| Typecheck | Pass |
| Lint | Pass (0 problems) |
| Production build (local) | Pass |
| DB / RLS, ORQO Test | **192 pass, 0 fail** (13 files), including 9 Phase 14 tests |
| HTTP, ORQO Test | **52 pass, 1 skip, 0 fail** (53 tests). The skip is the existing opt-in live-AI test, forced off |
| E2E `e2e:app` | Pass (22 screens, no console errors) |
| E2E `e2e:network` | Pass (10 screens) |
| E2E `e2e:discover` | Pass (10 screens) |
| E2E `e2e:agents` | Pass (13 screens) |
| E2E `e2e:understanding` (new) | Pass (5 screens). The read gave 27 DNA items and a partial market model with 47 entries. The answer, confirm and reject persisted. Mobile showed no horizontal scroll. French renders. No console errors or failed requests |

## Cross-domain validation
**Synthetic fixtures** (manufacturing, B2B SaaS, consultancy, biotech, logistics, and a thin niche site): the same engine produces materially different archetypes, roles, routes, buying dynamics, mechanisms, signals, events and risks. Negative bias assertions hold:
- no manufacturing for SaaS or the consultancy;
- no product distribution for the consultancy;
- no software ecosystem for the manufacturer.

The niche site yields `insufficient` coverage, no invented market and a first question about its offering. Removing evidence never adds knowledge. A static scan finds no vertical or company-specific terms in the logic.

**Real acceptance, read-only:** GigaIO from stored Dev intelligence, and INFODIP from an in-memory Basic read with nothing stored. Both were understood from their own evidence; their unknowns stayed unknown.

## Security and cost
- No provider, network or model is reachable from the understanding module (enforced by a test).
- The isolated runs forced paid providers off, and the Company page offers only the free Basic read.
- Validations accept only ontology values or existing items. The database refuses free text. Tenant isolation, viewer read-only access and append-only behaviour were tested on ORQO Test.
- No agent, entitlement, quota or kill-switch changes.
- `.env.local` is unchanged (hash verified).

## Not done (by design)
See the handoff, §11 (limitations) and §12 (deferred to Phases 15–20). Not done here:
- the Production migration and deploy;
- push;
- the Founder entitlement;
- target-company UI;
- re-basing Phase 11 relevance on the ontology.
