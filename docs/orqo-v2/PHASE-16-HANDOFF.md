# ORQO V2 — Phase 16 Handoff (for Phase 17)

**Phase 16 = ORQO CEO and the Experience**, delivered in two parts:
- **16A** (opportunity precision and tracked opportunities). Its details stay in `PHASE-16A-HANDOFF.md`.
- **16B** (CEO, Work, Companies and navigation).

## 1. Versions and state
| | |
|---|---|
| Original baseline | `598b7e4` (`main` = `origin/main`, unchanged) |
| Phase 16A final | `ee99e98` |
| Phase 16B final | see `git log` on `phase-16-orqo-ceo-experience` (local only: not pushed, not deployed) |
| Schema | One migration in all of Phase 16, `20261007090000_phase16_tracked_opportunities` (16A), with a rollback in `supabase/rollbacks/`. 16B adds **no** migration |
| ORQO Test (`****xplh`) | All 10 repository migrations applied |
| Production (`****tklx`) and Dev | Untouched. Dev still lacks the Phase 14 migration, as before Phase 16 |

## 2. Navigation
**Primary destinations:**

| Destination | Route |
|---|---|
| Work | `/workspace` |
| Companies | `/workspace/companies`. It also highlights for `/workspace/network*` and `/workspace/report` |
| Opportunities | `/workspace/opportunities` |
| Events | `/workspace/events` |

**"More"** (sidebar section; the "···" menu on mobile): Your company, Find companies (Discover), Signals (Intelligence), Agents, Overview (Dashboard), Plans, Settings.

**Compatibility routes, all working:**
- `/workspace?q=…` redirects to `/workspace/companies?q=…`.
- `/workspace/network/{id}` redirects to `/workspace/companies/{id}` (query kept).
- `/workspace/network` (the list with contacts, follow-ups and stages) is linked from Companies.
- Discover, Intelligence, Agents (runs and approvals), Dashboard and Report are unchanged.

**Shell:** `components/orqo/shell.tsx` and `shell-client.tsx`. The sidebar is narrower; on mobile there are 4 tabs plus "More". The faint-text contrast failures are fixed: axe runs on whole pages and passes.

## 3. Work: the home page
`app/workspace/page.tsx` and `components/orqo/ceo.tsx`.
- **Header:** a greeting (the display name, when one is set) and "What should your team work on?".
- **CEO input:** a plain GET form `?ask=…`, with no streaming, typing or "thinking". Example links sit under it.
- **Basis line:** "Based on what ORQO already knows…".

**Briefing** (`lib/server/ceo/briefing.ts`, composed by the pure `composeBriefing`):
- **Worth your attention** (at most 3):
  - tracked opportunities (investigating, then validated) that are **still credible** on the recomputed dossier;
  - then untracked **credible** leads.

  Weak ideas, `no_credible_opportunity` companies and paused or closed opportunities are never listed.
- **One thing ORQO needs from you** (at most one), in this order:
  1. "set up your company" when there is none;
  2. otherwise the relationship question for the leading company (if `askRelationship`);
  3. otherwise the own company's Phase 14 next question.
- **Continue working:** the 4 most recently active remembered companies, with memory signals.
- **Memory line:** "ORQO remembers N companies… M show no credible new opportunity, kept as context, not as prospects."

**Data:** `lib/server/ceo/memory.ts`. It loads the remembered companies, research references, stated relationships and tracked opportunities, then recomputes at most 8 dossiers (companies with active tracked opportunities first, then the most recently researched).

**Read-only, proven:** a static guard, a DB test (no change to research runs, usage, agent runs, audit or tracked rows) and the E2E (research and agent-run counts unchanged).

## 4. ORQO CEO
### Contract
`lib/ceo/intent.ts` (pure):
```ts
CeoIntent { type: CeoIntentType; objective; entities: CeoEntity[]; constraints: { geographies; industries };
            context: { organizationId }; requiredCapability; support: "executable" | "partial" | "future" }
CeoEntity = known (companyId) | researched (stored research, not remembered; domain) | unresolved (named only)
```

### Support levels
| Support | Intents |
|---|---|
| Executable | `analyze_company`, `evaluate_partnership`, `explain_opportunity`, `identify_missing_information`, `recommend_next_investigation`, `show_priorities` |
| Partial | `find_prospects`: opens Discover with the objective pre-filled; the user starts the run under the existing plan gate |
| Partial | `prepare_meeting`: the verdict, the questions worth asking and the Deal Intelligence Report, with an explicit "no written meeting brief yet" note |
| Future | `compare_companies`; outreach, monitoring and autonomous execution are recognized and answered honestly, never executed |

### Routing
- **Interpretation** (`parseCeoRequest`): deterministic regex vocabulary in EN and FR (folded, accent-insensitive). Future capabilities are checked first, then the intents in a fixed order. Constraints come from the existing concept vocabulary. No model and no provider.
- **Resolution** (`resolveEntities` in `server/ceo/answer.ts`):
  - names and domains are matched on word boundaries against the organization's remembered companies, then against stored research not yet remembered;
  - a full name wins over a shared first word;
  - a URL `company=` id counts only if this organization remembers it;
  - an invented `as=` intent is ignored.
- **Ambiguity:** one clarification, as business-language links (`?ask&as&company`). Examples: "Which company do you mean?" when several match or none is named, and "What would help most right now?" when the request is unclear.

### Answers
`CeoAnswer` is a union rendered as product objects:

| Answer | What is rendered |
|---|---|
| `company` (focus analyze / evaluate) | Verdict headline ("The most credible opportunity with X: …" or "**I don't see a credible new opportunity with X.**"), then the 16A `DossierView` with Track |
| `company` (focus missing) | Unknowns, the relationship question |
| `company` (focus next) | The next investigation |
| `company` (focus meeting) | See the table above |
| `opportunity` | The tracked opportunity view, plus its live re-assessment |
| `priorities`, `next_investigation` | Built from the briefing |
| `not_researched` | A link to look the company up in Companies; research only runs when the user starts it |
| `own_missing`, `prospects`, `future`, `clarify` | As named |

## 5. Companies
- **`/workspace/companies`:**
  - lookup by name or website (the former Search result, moved unchanged to `companies/search-result.tsx`), with the "Compared with {own}" context;
  - remembered companies with memory signals: researched date, relationship known, opportunity tracked, stage;
  - companies researched but not remembered;
  - "Find new companies" (Discover).

  There is no manual add form here. ORQO discovers from a name or website, and the Network list keeps its form.
- **`/workspace/companies/{id}`** is the canonical company page (moved from Network). In order:
  1. back to Companies;
  2. the **Business Memory line** (researched, your stated relationship, tracked, verdict);
  3. the 16A dossier (relationship, assessment, negative result, considered ideas, Track, relationship question);
  4. tracked opportunities;
  5. "Earlier analysis" (Phase 11);
  6. the relationship next action;
  7. signals, follow-ups, activity;
  8. on the side: relationship, events, people, business context.

  Without research, it says so and offers a lookup.
- **One object everywhere:** the same `DossierView` renders on Companies, the company page, the CEO and the report.

## 6. Business Memory and Next Best Question
- **Memory is shown as signals, not as a database page:**
  - "Researched {date}", "Your answer: …" / "Stated by you", "Opportunity tracked", the verdict;
  - "ORQO remembers N companies…";
  - the opportunity status ("since…").
- **Questions:**
  - the relationship question (16A, stored in `company_validations`, never repeated after any answer);
  - the own company's Phase 14 question, now also on Work (`validateUnderstandingAction` revalidates the whole workspace).

## 7. Precision preserved
- **No change since 16A:** `src/lib/understanding/**`, the tracked-opportunity repository and the schema are byte-identical to `ee99e98`.
- **Work and CEO** consume `dossier.verdict`, `trackableScenario` and `scenarios`/`novel` (credible only); they never read `considered` for priorities.
- **Acceptance cases, unchanged from 16A:**
  - Dell: no credible new opportunity, with or without the "supplier" answer;
  - GigaIO: integration and implementation credible, contract production considered;
  - the five cross-domain negative patterns.
- **New in 16B:** briefing tests across the five domains, covering both negative and positive cases.

## 8. Events and Agents
- **Events:** a primary destination, unchanged. There is no Event Radar or monitoring.
- **Agents:** under More. Routes, runs, approvals and APIs are unchanged. The CEO never starts an agent: a static guard plus the agent-run count in DB and E2E tests.

## 9. Security and cost
- **No new authority:** the CEO only reads under RLS. The only writes on its pages are the existing 16A actions (Track, relationship answer, status), all server-validated.
- **Isolation:** another organization resolves neither the names nor the ids of A's companies (DB test).
- **Sign-in:** Work with `ask`, Companies, the company pages and the old Network URLs require it (HTTP test).
- **Cost:** no new provider or model call. Free plan cost is unchanged.
- **Privacy:** the E2E records no request leaving the app.

## 10. Localization
EN and FR are complete for the `work.*`, `ceo.*`, `companies.*` and `nav.*` keys. The CEO understands both languages. Business phrasing is used in French ("Sur quoi votre équipe doit-elle travailler ?", "Je ne vois pas de nouvelle opportunité crédible avec X.").

## 11. Tests
| Suite | Result |
|---|---|
| Unit | 588 pass. New: `lib/ceo/ceo.test.ts` (52: EN/FR intents, future capabilities, resolution and isolation, briefing precision, cross-domain, static guards) |
| DB (ORQO Test) | 213 pass. New: `tests/db/ceo.test.ts` (5) |
| HTTP (isolated server) | 72 pass, 1 optional live-AI test skipped. 5 new protected-route checks |
| E2E | `e2e:work` is new: Work, the CEO in EN/FR, Companies, compatibility, navigation, 1440/1280/390 px, the mobile More menu, keyboard focus, axe on 9 whole pages with no violations, no console error, no research or agent run, no request outside the app. `e2e:app`, `e2e:network`, `e2e:opportunities`, `e2e:understanding`, `e2e:discover` and `e2e:agents` were updated for the navigation and pass |
| Typecheck, lint, local production build | Pass |

## 12. Known limitations
- **Interpretation is vocabulary-based:** unusual phrasings fall back to one clarification. Entity resolution covers remembered and researched companies only; anything else is "not researched yet", with a lookup link.
- **`compare_companies` is not implemented:** it shows each assessment instead. `prepare_meeting` has no written brief.
- **The briefing bounds its work:** it recomputes at most 8 dossiers per load (deterministic, a few dozen RLS queries). Larger workspaces only see their most recent companies.
- **The Network list and the canonical company page keep Phase 6 data-entry forms** (contacts, interactions, follow-ups, stage). These are category A: only the user knows them. They sit behind Edit and Add buttons.

## 13. Phase 17 integration points
- **Specialist delegation:** add capabilities to `CEO_CAPABILITIES` and new `CeoAnswer` kinds. `answerCeo` is the single dispatch point; agent execution should arrive as a new, explicitly approved answer kind (with real run status), never inside the existing read-only ones.
- **The briefing as agent input:** `loadBriefing` / `composeBriefing` and `loadWorkspaceMemory` give agents the same memory the user sees.
- **Read-only boundary:** keep the static guards (no research, fetch, write or provider in the CEO modules) and widen them only for the new delegated path.
- **Phase 18:** continuous intelligence feeds `whyNow` and the briefing. The briefing wording ("based on what ORQO already knows") must then say what actually changed.
