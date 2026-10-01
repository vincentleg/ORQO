# ORQO V2 — Phase 7 Implementation Report: Intelligence & Signals

## 1. Objective

Answer one question: *"What changed in the outside world that could change what this company means for my business?"*

A signal is a **public business change with provenance**, attached to a Network company. It is explained against the organization's profile and, separately and privately, against the team's relationship memory. It is not a news feed, an RSS reader or an AI recommendation stream.

## 2. Baseline

- **Branch:** `phase-7-intelligence-signals`. Merge base with `main`: `69b1b4c` (Merge Phase 6). The tree was clean at the start, and no Phase 7 code existed.
- **Not pushed, not merged.** Phase 8 has not been started.

## 3. Architecture

```
Search re-analysis (Phase 3, official site, Free) ──► detectDelta(previous, next) ─┐
Team records a public change + source URL (never fetched) ─────────────────────────┤
                                                                                   ▼
                                  company_signals (PUBLIC data only, deduplicated)
                                                                                   │ read time
   own company profile ──► assessSignal ◄── private relationship memory (stage, interactions, follow-ups, reason)
                               │
                               ▼
              relevance state + reasons (fact / inference / private) + unknowns
                               ▼
              reevaluate → review / re-evaluate opportunity / revisit relationship / no material change
                               ▼
              human action: mark reviewed · dismiss · restore · create follow-up (explicit)
```

**Pure, deterministic and tested** (`src/lib/signals/`):

| File | Contents |
| --- | --- |
| `model.ts` | Vocabulary, `classifyChange`, `detectDelta`, `dedupKey`, `factGist`, `normalizeSourceUrl`, `evidenceQuality`, lifecycle `canTransition` |
| `relevance.ts` | `assessSignal`, `privateContextMatches`, `signalUnknowns`, `reevaluate`, `needsAttention`, the `SignalReasoner` seam (interface only) |
| `access.ts` | `signalReasoningDecision` (entitlement seam for future AI reasoning) |

**Server:**

| File | Contents |
| --- | --- |
| `src/lib/server/repositories/signals.ts` | Organization-scoped reads and writes; dedup store; manual record; lifecycle; follow-up from a signal; private-memory reader; agent read seam |
| `src/lib/server/signals/research.ts` | Research → signals hook |
| `src/lib/server/signals/view.ts` | Read model: assessment at read time |
| `src/app/actions/signals.ts` | Server actions |

**UI:**

| File | Contents |
| --- | --- |
| `src/components/orqo/signals.tsx` | `SignalCard` |
| `src/components/orqo/signal-forms.tsx` | Status buttons, record form, follow-up-from-signal form |
| `src/app/workspace/intelligence/page.tsx` | Rewritten |
| `src/app/workspace/network/[companyId]/page.tsx` | New "Public signals" card |

## 4. Schema / migrations

| File | Kind |
| --- | --- |
| `supabase/migrations/20261004090000_phase7_company_signals.sql` | Additive |
| `supabase/rollbacks/20261004090000_phase7_company_signals.down.sql` | Manual rollback, destructive for signals |

**New table `company_signals`:**

| Group | Columns |
| --- | --- |
| Scope | `organization_id`, `company_id` |
| Signal | `kind` (13 generic kinds), `origin` (`research` / `manual`), `headline`, `detail`, `excerpt`, `field`, `concepts` |
| Evidence | `epistemic` (`fact` / `inference`), `evidence_quality` (`strong` / `moderate` / `limited`) |
| Provenance | `source_id`, `source_url`, `source_label`, `source_authority` |
| Dates | `published_on` (date; null = unknown), `retrieved_at`, `first_seen_at`, `last_seen_at` |
| Delta | `previous_researched_at`, `previous_concepts` |
| Dedup | `dedup_key` |
| Lifecycle | `status` (`new` / `reviewed` / `acted_on` / `dismissed`), `status_changed_at`, `status_changed_by`, `follow_up_id` |
| Standard | `created_by`, `created_at`, `updated_at` |

**Constraints:**

- composite foreign keys `(organization_id, company_id)`, `(organization_id, source_id)` and `(organization_id, follow_up_id)`, so no row can reference another tenant's company, source or follow-up;
- unique `(organization_id, company_id, dedup_key)`;
- a research signal must have `source_id` and `retrieved_at`.

**Trigger `company_signal_lifecycle`:**

- on insert, it forces `status = new` and `first_seen_at = last_seen_at = now()`, ignoring forged values;
- it refuses a signal on the organization's own company;
- on a status change, the database sets `status_changed_at` and `status_changed_by`;
- `last_seen_at` never moves backwards.

Standard `set_updated_at`, `set_created_by`, `enforce_immutable_ownership` and `audit_change` triggers are also attached.

**Privileges:**

- `select`, `insert` and `delete` for `authenticated`, plus **column-level** `update` on `status`, `follow_up_id` and `last_seen_at` only. Provenance is immutable after insert;
- `anon` and `service_role` hold nothing;
- RLS: viewer+ reads, member+ writes.

**`follow_ups.origin`:** the check constraint is extended with `'signal'` (drop + add; existing values are unaffected). The rollback relabels `signal` follow-ups as `manual` and restores the Phase 6 constraint.

## 5. Signal model and evidence reuse

- **Research signals** point at the Phase 3 Evidence Store `sources` row (`source_id`).
- The claim's statement and excerpt are snapshotted on the signal. This is necessary because `saveIntelligence` replaces `evidence_items` on every refresh, and a signal must keep the evidence that justified it. There is no other duplicate of the Evidence Store.
- **Manual signals:**
  - store the URL a person entered;
  - ORQO **never fetches it**;
  - they are labeled "Recorded by your team from a public source · not retrieved by ORQO";
  - their evidence quality is `moderate`.
- **Authority:**
  - `official` (company's own site/announcement), `third_party` and `search_result` stay distinct;
  - a search snippet can never produce a signal.

## 6. Public / private boundary

- `company_signals` contains no private field (tested on the type and the schema). Private memory is **never written** into a signal, a citation or a source.
- At read time, `privateContextMatches` checks whether interactions, open follow-ups or "why it matters" mention the topic of the change (kind keywords in EN/FR, plus signal concepts). It returns **references only** (kind, id, title, date), never the note text (tested).
- **UI:**
  - the public headline, source and evidence are labeled **Public**;
  - private matches appear in a separate dashed **Private · Private context** block: "Shown to explain relevance only. Not part of the public evidence.";
  - on the company page, signals are a separate **Public signals** card and are not merged into the private activity timeline.

## 7. Relevance logic (deterministic, no score)

**Dimensions:**

| Dimension | Trigger | Basis |
| --- | --- | --- |
| `geography` | Signal concepts ∩ own geographies/markets | fact or inference, as the signal |
| `capability_fit` | Signal concepts ∩ own offerings/sought/segments | as the signal |
| `capability_fit` (build) | A build-type change meets a build/integration offering | **inference** |
| `partnership` | Partnership/acquisition/expansion vs declared goals | inference |
| `timing` | Change kinds that typically move priorities | inference |
| `relationship` | An active stage | private |
| `private_context` | Private matches | private |

**States:**

| State | Rule |
| --- | --- |
| `needs_validation` | Limited evidence, or no own profile |
| `relevant` | A business link **and** (a relationship / private context, or 2 business links) |
| `potentially_relevant` | 1 business link, or relationship + timing |
| `no_clear_link` | Otherwise |

**Unknowns are always explicit:**

- `need_unproven` is always present: a change alone never establishes a need;
- per kind: `expansion_scope`, `build_or_partner`, `use_of_funds`, `partner_room`, `impact_unclear`;
- `date_unknown`;
- `change_timing` (a website delta shows what ORQO newly saw, not when it changed);
- `own_profile_missing`.

## 8. Delta / change logic

`detectDelta(previous, next)` compares two stored analyses of the **same domain**.

**Nothing is proposed for:**

- the first analysis (baseline);
- unchanged facts;
- reworded identity or summary text;
- generic concepts.

**What becomes a signal:**

1. **A stated change.** A sourced sentence whose gist (folded text, dates and numbers removed) was not in the previous analysis, and which is:
   - classified by generic EN/FR patterns (expansion, funding, partnership, acquisition, customer win, certification, manufacturing, product launch, hiring, event);
   - or a news/strategy item (kind `other`);
   - or a product newly listed in official navigation (kind `offering_change`).

   It is recorded as a **fact**.
2. **A newly mentioned specific concept** in geography, industry, customer, offering or technology. It is recorded as an **inference**, with **limited** evidence.

**Further rules:**

- Model-extracted claims are compared only with an earlier **deep** analysis, so "read more deeply" is not mistaken for "changed".
- At most 8 signals per delta.
- `published_on` is always null for website deltas: Phase 3 extraction has no trustworthy page date, so the date is unknown and never the retrieval day.
- What ORQO knew before is preserved as `previous_researched_at` and `previous_concepts`. The UI shows "Before: ORQO's analysis of {date} listed {…}".

**Deduplication:**

| Signal | Key |
| --- | --- |
| Stated change | `kind:stated:hash(gist)` (independent of field/page, so one sentence = one signal) |
| Concept mention | `kind:field:hash(concepts)` |
| Manual | `kind:url:hash(normalized URL)` (host lower-cased, `www.`/trailing slash/fragment/tracking params removed) |

The unique key holds per company. When a known change is seen again, only `last_seen_at` is refreshed: **a dismissed signal stays dismissed.**

## 9. Re-evaluation logic

`reevaluate()` returns one of:

| Result | When |
| --- | --- |
| `no_material_change` | Closed, or no clear link |
| `review` | Validate first |
| `reevaluate_opportunity` | Qualified / opportunity / customer stage |
| `revisit_relationship` | The change touches a privately recorded topic |

**An existing open follow-up is never replaced.** The suggestion names it ("Your open follow-up '…' (due …) stays as it is — review whether its timing should change").

**No autonomous loop:** there is no background job, no email and no contact. The only write a person can trigger is an explicit "Create a follow-up", which reuses the Network `createFollowUp` rules (validation, same-company contact, membership-checked assignee). It then marks the signal `acted_on` and links it. The follow-up records the public headline and source URL in its description.

## 10. Next Best Action decision

**The Phase 6 `nextBestAction` is unchanged** and receives no signal input. Signals expose a separate "Suggested review" inside each signal card. This was the safer option: a human-recorded follow-up or next step always keeps priority, and a test asserts that the open follow-up stays the Next Best Action while the signal only suggests reviewing it.

## 11. Intelligence UI (`/workspace/intelligence`)

- **Needs attention:** new signals with something to re-evaluate (not `needs_validation`), relevant first, up to 5.
- **Signals:** chronological, with GET filters for company, type, status (default *Open* = new + reviewed; or one status; or all) and relevance. Entries already expanded above are shown as one compact line.
- **Signal card:**
  - type, relevance, status and **Public** badges;
  - the change (a quote when stated; "now mentions X" for an inference);
  - published date or "Publication date unknown", first seen, authority, evidence quality;
  - the suggested review;
  - a disclosure with: why it may matter (each reason tagged Fact / Inference), evidence (excerpt, source link `rel="noopener noreferrer nofollow"`, origin, retrieved date, *Before*), still unknown, and the private context block;
  - actions: Mark reviewed, Dismiss, Restore / Reopen, Open company, Create a follow-up.
- **Where signals come from:** an explanation card, the "Continuous monitoring" plan card (Pro, coming soon) and the Signals Agent status line.
- **Record form:** the publication date is a plain optional `YYYY-MM-DD` text field, not a native date input. An empty Safari date input paints today's date (the Phase 6 lesson), which would look like "published today". The Phase 6 `DueDateField` is untouched; `FollowUpFields` only gained an optional `description` prefill.

## 12. Network company page integration

- A new **Public signals** card sits under the Next Best Action. It shows open signals, with closed ones folded away.
- It offers "Record a public change", "Re-analyze the official site" (link to Search) and "Open Intelligence".
- The private activity timeline, follow-ups, Next Best Action and layout are unchanged. A follow-up created from a signal shows "From a public signal".

## 13. Agent integration

- The existing `signal` agent is reused; no new agent was created.
- The `signal_analysis` capability now lists `read_company_signals` (new) and `read_relationship_context`.
- `read_company_signals`:
  - is internal, read-only, with no network, no model and no cost (tested);
  - returns public signals only (`provenance: "public_signals"`).
- **The Signals Agent stays `coming_soon`** and is not executable (tested).

## 14. Entitlements / cost

| Capability | Plan | Availability |
| --- | --- | --- |
| `intelligence.feed` (store, view, assess, record, review) | Free | **available** (changed from coming soon) |
| `intelligence.monitoring` | Pro | coming soon (unchanged) |
| `agents.signal` | Pro | coming soon (unchanged) |

- **Research signals** are produced only inside the existing governed `runPreparedResearch`, after a run the user already started through Phase 3 authorization (member+, quota, refresh window). Basic mode gets **no paid provider by construction** (unchanged). Detection adds no fetch, provider or model call, and a detection failure never fails the research run.
- **`signalReasoningDecision`** refuses AI reasoning while the agent is not built: for Free, Pro, Business **and operator preview** (tested). The preview is preserved and does not pretend to be a subscription.
- **A source scan test** asserts that no signal file imports the providers, Brave, OpenRouter, the fetcher or calls `fetch(`.

## 15. Security

- **Server actions:** `requireAuth` → `requireMembership(member)`. The form's organization id is a lookup key only. Repositories filter on the organization and verify a Network (non-own) company.
- **Status transitions** are checked server-side (`canTransition`) with optimistic matching on the current status. `acted_on` is reachable only by creating a follow-up.
- **External content** stays untrusted data:
  - website deltas reuse the Phase 3 SSRF-guarded fetcher (unchanged);
  - manual URLs are validated as http(s) and only rendered as links;
  - headlines are rendered as text.

  Nothing from a page is executed or treated as an instruction.
- **No secrets** were added or exposed, and there are no new environment variables.

## 16. Tests run

| Check | Result |
| --- | --- |
| `typecheck` | ✅ |
| `lint` | ✅ (`src/lib/signals/**` added to the domain boundary) |
| `build` | ✅ |
| Unit `bun run test` | ✅ **237/237** (was 201) |
| Migration + RLS dry run against the dev DB (**one transaction, always rolled back**, synthetic users and orgs) | ✅ **29/29** |
| Rollback script (up + down inside a rolled-back transaction) | ✅ Table removed, Phase 6 constraint restored |

**Unit tests added:**

- `src/lib/signals/signals.test.ts`, **32 tests**:
  - classification (EN/FR);
  - delta: baseline, unchanged, stated fact with source and no date, new product, inference = limited, deep/basic guard, snippets excluded, other domain;
  - dedup: reworded/dated, URL normalization, cross-field, no duplicates;
  - evidence quality;
  - relevance, including the generic Company B scenario, inference-only fit, weak evidence → review only, no link, no own profile, opportunity stage;
  - public/private: references only, private never needed or altering evidence, unrelated note, no private field;
  - lifecycle and Needs-attention;
  - **NBA not overridden**;
  - unknown dates;
  - Free feed / locked monitoring / agent coming soon;
  - reasoning refused incl. preview;
  - tool seam free;
  - no provider reachable.
- `src/components/orqo/signals.test.tsx`, **4 tests** (static render):
  - EN card with Public/Private separation, private note text never shown, unknown date, unknowns, human-only wording;
  - no private block without memory;
  - FR render;
  - the record form has no native date input.

**Dry run, 29 checks:**

- the migration applies;
- forged status and `first_seen` are ignored;
- duplicate key refused;
- own-company signal refused;
- unsourced research signal refused;
- own-org source accepted, cross-tenant source refused;
- provenance update refused (column grants);
- status time and actor set by the DB;
- follow-up origin `signal` accepted, unknown origins still refused;
- tenant B cannot read, insert, re-point, update, delete or link A's rows;
- a viewer reads but cannot write;
- `anon`/`service_role` have no grants;
- RLS is enabled;
- audit rows are written;
- after rollback, the table and the synthetic users are absent.

**Regressions:** all Phase 1–6 unit suites pass unchanged, including the Phase 6 follow-up and Safari due-date tests and the agent registry/tool consistency tests.

## 17. Tests not run, and why

- **`test:db`** (including the new `tests/db/signals.test.ts` and the updated `schema.test.ts`), **`test:http`** and the **e2e scripts** were not run. The Phase 5/6 safety guard refuses them: `ORQO_DESTRUCTIVE_TESTS_PROJECT` is not set, and the configured Supabase project holds the real workspace. The guard was not touched or bypassed.
- These suites are written and type-checked, and will run once a dedicated test project is authorized.
- No new e2e script was added.
- **Browser behavior has not been verified live** by me. It needs the human review below.

## 18. External calls made

**None.** No Brave, OpenRouter, Exa, Firecrawl, website fetch, email or enrichment calls. All signal logic was tested with fictional fixtures.

## 19. Database writes made

- **Schema:** `bun run db:migrate` applied `20261004090000_phase7_company_signals` to the development Supabase project (one row in `supabase_migrations.schema_migrations`). It is additive: a new table, function, triggers and policies, plus the extended `follow_ups.origin` check.
- **Data:** none. The dry runs used synthetic users and organizations **inside rolled-back transactions**, and their absence was verified. A read-only count after migrating showed 0 signals and 0 signal follow-ups. No real workspace record was inserted, modified or deleted.

## 20. Known limitations

- **No scheduled monitoring:** signals arrive only from an explicit Search re-analysis of a Network company's site (subject to the Phase 3 refresh window and quota) or from manual recording.
- **Website deltas cannot date a change:** `published_on` is null and the UI says so. Concept-mention signals are noisy by nature and therefore stay *needs validation*.
- **Network companies only:** an analysis of a domain that matches no Network company (by website domain) creates no signal. A company without a website only receives manual signals.
- **Private matching is keyword/concept-based:** a note that discusses expansion in other words will not match, and a match only means "same topic", which is how the UI words it.
- **The Intelligence page loads up to 300 signals,** with filtering in memory. Follow-ups created from the Intelligence page have no contact preselection; the company page offers contacts.
- **No edit or delete UI for signals:** they are dismissed instead.
- **The Signals Agent is not executable,** and AI reasoning over signals is a declared seam only.
- **"Today" for follow-up text** is still the UTC day (as in Phase 6).

## 21. Browser review (no paid calls)

Use a **separate review workspace** so the real workspace is not touched:

1. Signed in, open `/onboarding` and create a workspace named e.g. "ORQO Phase 7 Review". It becomes active; switch back later with the workspace switcher. In **Company**, set a short profile, e.g. geographies "Europe", offerings "System integration".
2. Open **Intelligence**. Expect the empty state explaining where signals come from, the "Where signals come from" card, Continuous monitoring (Pro · coming soon) and the Signals Agent status line. No fabricated signals.
3. In **Network**, add a fictional company, e.g. "Fictional Rover Co", website `https://example.com`. Open its page and check the new **Public signals** card (empty, with explanation) above the private follow-ups and activity. Confirm the Next Best Action card is unchanged.
4. Record a private interaction whose notes mention international expansion. Set the stage to *Conversation*. Create a follow-up (e.g. "Check in next year"), optionally with a due date.
5. In **Public signals**, click "Record a public change":
   - type *Geographic expansion*;
   - "Announces a new office in Rotterdam to serve European customers";
   - a source link (any public URL; it is not fetched);
   - *The company's own announcement*;
   - leave the publication date **empty**.

   Save, then check:
   - the card shows "Publication date unknown" and "First seen by ORQO …";
   - **Relevant to you**;
   - suggested review "This relationship may deserve attention earlier than planned", naming your existing follow-up as *staying as it is*;
   - the Next Best Action still shows your follow-up.
6. Open "Why it matters, evidence and unknowns" and check:
   - each reason is tagged Fact / Inference;
   - the source link and "Recorded by your team … not retrieved by ORQO";
   - **Still unknown** ("whether … needs what you offer");
   - a dashed **Private · Private context** block that names the interaction title only, never the note text.
7. Record the same URL again: no duplicate is created.
8. On **Intelligence**, check that the signal is under *Needs attention* and in *Signals*. Try the filters (type, status, relevance, company).
9. Lifecycle:
   - **Mark reviewed** → it leaves *Needs attention*;
   - **Dismiss** → hidden from *Open*, visible with status "Dismissed";
   - **Restore** → back to New.
10. Click **Create a follow-up** on the signal. It is prefilled with the headline and source; the due date shows "No due date" (Phase 6 behavior, including in Safari). Save. The signal becomes *Acted on*, and the company's follow-ups show "From a public signal". Nothing is sent.
11. Switch the language to FR and repeat steps 2 and 6 for rendering.
12. *(Optional, Free path)* On the company page, "Re-analyze the official site" opens Search. A refresh of a **real** official site uses only the Phase 3 official-site path (no paid provider). It produces signals only if the site shows something new compared with the previous stored analysis. The first analysis is a baseline.

Afterwards, delete or leave the review workspace. Nothing was written to the real workspace.

## 22. Commits

See `git log 69b1b4c..phase-7-intelligence-signals`. The single Phase 7 commit is *"Phase 7: Intelligence and signals"*.

## 23. Human review fix: invented offer in the relevance explanation

### Validated in the browser before the fix (preserved)

- Intelligence empty state; no fabricated signals.
- The Free/Pro monitoring presentation; the Signals Agent stays coming soon.
- Network regression.
- Public Signals are separated from private Activity, and the private note body is never shown as public evidence.
- The Phase 6 Next Best Action is unchanged by the signal.
- The signal is classified as relevant.
- On the main card, the unknown publication date and the first-seen date are kept apart.
- The review suggestion does not create follow-ups.
- The unknown "a change alone does not establish a need" is shown.

### Finding

On a fictional review profile (offers: system integration, industrialization, European deployment/logistics, technology-partner support), the expanded relevance section said:

> "Votre offre comprend Fabrication, Assemblage, configuration et intégration, Déploiement et support."

The user never entered fabrication, assembly or support.

### Root cause

The text was not a hardcoded list. The build-type fit (`assessSignal`, `capability_fit` through `BUILD_SERVICES`) did three things:

1. **Read too many fields.** It mapped the WHOLE own profile to lexicon concepts: summary, offerings, segments, markets and sought capabilities.
2. **Matched loosely.** It matched by alias. "industrialisation" is an alias of `manufacturing`; "intégration de systèmes" is an alias of `assembly_integration`; "déploiement" is an alias of `deployment_services`.
3. **Printed the wrong words.** The UI printed the **concept labels** ("Fabrication", "Assemblage, configuration et intégration", "Déploiement et support") as "your offer includes".

Lexicon labels are broader than what the person wrote, so the sentence asserted capabilities that are not in the profile.

### Fix (generic; nothing specific to a company)

- **Build-type fit.** It rests only on the organization's **declared offerings**:
  - an offering qualifies only if it mentions a build/deploy concept;
  - the summary, segments and markets can no longer support "your offer includes";
  - the reason carries those offerings **verbatim** (`ownTerms`, marked `build: true`).
  - Text: "Votre offre déclarée comprend « … »" / "Your stated offering includes “…”".
  - No declared build offering → no such sentence (an incomplete profile invents nothing).
- **Direct capability fit.** It now quotes the matching profile items as written: "…ce qui correspond à votre profil d'entreprise : « … »". When only the summary matched, it says so instead of claiming an offer.
- **Lexicon labels.** They are still used only to describe the signal's own topic, never the organization's offer.
- **Unknown date wording:**
  - FR: "La date de publication reste inconnue. ORQO connaît uniquement la date à laquelle ce signal a été vu pour la première fois."
  - EN: "The publication date remains unknown. ORQO only knows when it first saw this signal."
  - The date model is unchanged.
- **Unchanged:** relevance states, dedup, lifecycle, re-evaluation and private handling. The assessment is computed at render time and nothing is persisted, so there is no migration.

### Tests

New file `src/components/orqo/signal-relevance-profile.test.tsx` (8 tests, fictional fixtures):

1. Offers A–D: the quoted offers are always a subset of the declared offerings (FR and EN).
2. No `BUILD_SERVICES` lexicon label (FR or EN) appears in the offer sentence.
3. An incomplete profile, or a summary-only or non-build offer, gives no offer sentence; a direct fit quotes profile items verbatim.
4. Geography alone can make a signal relevant with no capability fit, and `need_unproven` is kept.
5. "A change alone does not establish a need" is rendered.
6. The private note body never appears, not even in `ownTerms`.
7. The publication-date and first-seen wording are distinct (FR and EN); the old wording is gone.
8. The Phase 6 Next Best Action is unchanged, and the network model does not depend on signals.

Tests 1 and 3 were confirmed to **fail on the pre-fix implementation**.

The existing 36 signal and relevance tests (relevance, dedup, lifecycle, re-evaluation, render) pass unchanged.

**Results:** unit 245/245, typecheck, lint and build pass. DB, HTTP and E2E suites were not run (the safety guard; a dedicated test project is still required). No external calls. No database writes.

**A browser re-review of this fix is still required.**
