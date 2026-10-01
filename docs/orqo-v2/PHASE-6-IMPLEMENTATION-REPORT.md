# ORQO V2 — Phase 6 Implementation Report

## 1. Git baseline

- Branch: `phase-6-network-followups`. Merge base with `main`: `d2ee9e0` (Merge Phase 5). The working tree was clean at the start.
- Not pushed and not merged. Phase 7 has not been started.

## 2. Scope implemented

Network is now a **business relationship memory**. Each company records:

- why it matters;
- how it entered the Network;
- who the people are;
- what happened;
- what is due;
- what changed.

All of it is deterministic database and TypeScript logic, with **zero provider or model calls**.

| Area | Status |
| --- | --- |
| Relationship stage, origin, "why it matters" | Implemented; editable by people |
| Contacts (email, phone, profile URL, notes, primary) | Implemented; manual only, no enrichment |
| Interactions (meeting, call, email, message, event, note, other) | Implemented |
| Follow-ups (open / done / dismissed, due day, priority, assignee) | Implemented |
| Timeline / history | Implemented: real rows plus trigger-written events |
| Next Best Action | Implemented; deterministic rules |
| Network home (summary, filters, attention strip, follow-ups view) | Implemented |
| Company detail page `/workspace/network/[companyId]` | New |
| Search → Add to Network | Hardened: server-derived, origin recorded, deduplicated |
| Discover → Add to Network | Unchanged flow; now also records `network_origin = discover` |
| Agent seam `read_relationship_context` | Implemented (read-only). No agent that holds it is executable |
| FR / EN | Implemented |

## 3. Files changed

**New**

| File | Purpose |
| --- | --- |
| `supabase/migrations/20261003090000_phase6_network_memory.sql` | Migration |
| `supabase/rollbacks/20261003090000_phase6_network_memory.down.sql` | Manual rollback |
| `src/lib/network/model.ts` (+ `model.test.ts`) | Pure logic: vocabularies, buckets, Next Best Action, timeline |
| `src/lib/server/repositories/network-memory.ts` | Organization-scoped reads and writes, agent context |
| `src/lib/server/network/search.ts` | Search → Add to Network |
| `src/app/actions/network.ts` | Server actions |
| `src/app/workspace/network/[companyId]/page.tsx` | Company detail page |
| `src/components/orqo/network.tsx` | Server display components |
| `src/components/orqo/network-forms.tsx` | Client forms |
| `tests/db/network.test.ts` | DB suite |
| `scripts/e2e-network.ts` | Browser walk-through |

**Modified**

- `src/app/workspace/network/page.tsx`: rewritten.
- `src/app/workspace/page.tsx`: Search add button and links to the company page.
- `src/components/saas/forms.tsx`: the old Search add button was removed.
- `src/app/actions/workspace.ts`: a manual add records origin `manual`.
- `src/lib/server/repositories/companies.ts`: optional `networkOrigin`.
- `src/lib/server/discovery/network.ts`: origin `discover`.
- Agents: `types.ts`, `registry.ts`, `tools.ts`, plus the server `agents/tools.ts`.
- The EN/FR catalogs.
- `eslint.config.mjs`: `lib/network` added to the domain boundary.
- `package.json`: `e2e:network`.
- `tests/db/schema.test.ts`: the table list.

## 4. DB / schema changes

The migration is one additive file, applied through `bun run db:migrate`. **Nothing is backfilled.**

**`companies`** gains three columns:

| Column | Values | Default |
| --- | --- | --- |
| `network_stage` | check-constrained, nullable | null |
| `network_origin` | check-constrained, nullable | null |
| `network_reason` | text, ≤ 2000 | `''` |

`null` means *Not recorded*.

**`contacts`** gains:

- `email` (format check);
- `phone`;
- `profile_url` (http(s) only);
- `notes`;
- `is_primary`, with a partial unique index: at most one primary contact per company.

**New table `interactions`:**

- company, optional contact, kind, `occurred_at`, title, summary, outcome, next step;
- composite foreign keys to a company and contact of the same organization;
- index on (org, company, `occurred_at` desc).

**New table `follow_ups`:**

- company, optional contact, optional originating interaction;
- title, description, `due_on` (a calendar **date**);
- status (open, done, dismissed), priority, origin, `assigned_to`, `closed_at`;
- the check `(status = 'open') = (closed_at is null)`;
- composite foreign keys, plus an open-and-due index.

**New table `network_events`:**

- **append-only** history, written only by triggers;
- kinds: `stage_changed`, `contact_added`, `follow_up_created`, `follow_up_done`, `follow_up_dismissed`, `follow_up_reopened`;
- stores kinds, ids and enumerated stage values only, **never notes or personal data**.

**Triggers:**

- `follow_up_lifecycle`: the database decides `closed_at` (a forged value is ignored) and checks that the assignee is a member of the organization;
- `record_network_event`;
- plus the standard `set_updated_at`, `set_created_by`, `enforce_immutable_ownership` and `audit_change` (append-only audit) on the new tables.

**Deletion:**

- interactions, follow-ups and events cascade when their company is deleted;
- deleting a contact or interaction sets the references to it to `NULL`.

**Reuse decision:**

- `relationships` is the Phase 1 contact↔contact encounter model used by the engine, and its `relationship_status` enum is engine-specific. Reusing it for a company-level stage would have overloaded it, so the stage lives on `companies`.
- `opportunities` and `opportunity_participants` are reused as they are (read only).

## 5. RLS / security

- The new tables are RLS default-deny:
  - `interactions` and `follow_ups`: select for viewer+, insert/update/delete for member+;
  - `network_events`: **select only**, no write grant to anyone.
- `anon` and `service_role` hold no privileges.
- Composite `(organization_id, id)` foreign keys mean no row can reference another tenant's company or contact, even when RLS is bypassed.
- Server actions follow `requireAuth` → `requireMembership(member)`. The form's organization id is only a lookup key.
- The repositories:
  - filter on the organization;
  - verify the company is a Network company (never the own company);
  - verify contacts and interactions belong to **that company**.
- The only assignee a form can set is the signed-in user, and the database re-checks membership.
- Search → Add to Network takes **only the query**. Name, website and summary come from this organization's stored analysis, never from browser fields (the previous button posted name and summary from hidden inputs).
- Public analysis and private relationship memory are rendered in separate, labeled places:
  - "Private — recorded by your team, not public evidence";
  - "Public — from official sources ORQO analyzed";
  - the analysis-derived next action is labeled as an inference to validate.
- No secrets in the diff, no new environment variables, no client-side keys.

## 6. Network company model

`NetworkCompany` = identity (name, website, summary, markets) + stage + origin + reason + `addedAt` (the real `created_at`).

**Origin is resolved in this order:**

1. the recorded origin;
2. otherwise the origin proven by stored provenance (a `discover:` or `search:` `external_ref`), shown as *"from stored provenance"*;
3. otherwise *Not recorded*.

## 7. Contacts

- Add and edit on the company page.
- Recorded fields: name, role, email, phone, profile URL and notes.
- One primary contact per company: setting a new primary clears the old one, and the database enforces uniqueness.
- Manual entry only. There is no enrichment, no scraping and no paid API.

## 8. Relationship stages

| Key | Label |
| --- | --- |
| `watching` | Watching |
| `identified` | Identified |
| `contacted` | Contacted |
| `conversation` | Conversation |
| `qualified` | Qualified |
| `opportunity` | Opportunity |
| `customer_partner` | Customer / Partner |
| `dormant` | Dormant |
| `not_relevant` | Not relevant |

- Set only by people; never inferred from public research.
- Each change writes a `stage_changed` history event (from → to) and an audit row.

## 9. Interactions

- Fields: type, date and time, optional contact, title, notes, outcome, next step.
- The browser converts its local wall-clock time to an instant.
- Interactions are shown in the timeline at the time they happened.
- No email, calendar or Nylas ingestion.

## 10. Follow-ups

- Create one from the company page, or from an interaction's next step (`origin = interaction`).
- Close it as done or dismissed, or reopen it.
- **Buckets** (pure and tested):

  | Bucket | Rule |
  | --- | --- |
  | Overdue | Due before today |
  | Today | Due today |
  | This week | Due in the next 6 days |
  | Later | Due further out, or undated |
  | Completed | Done or dismissed |

  Ordering: due day, then priority, then creation.
- **Network home:**
  - the attention strip (overdue, today, this week);
  - the Companies / Follow-ups views;
  - the "Follow-up due" filter.

## 11. Timeline / history

The timeline is newest first and merges:

- **Added to Network** (the company's real creation time, plus its origin if known);
- interactions;
- `network_events`.

Event labels resolve names and titles at read time (deleted subjects read as "removed"). **Nothing is reconstructed for the period before Phase 6.** The page says so explicitly.

## 12. Next Best Action logic

`nextBestAction` in `src/lib/network/model.ts` is deterministic and unit-tested. It applies these rules in order:

1. the nearest open follow-up (a person already decided to do it);
2. dormant or not relevant → *no action proposed*;
3. the latest interaction's next step, unless a follow-up already tracks it (offered as "Create a follow-up from it");
4. before qualification, the top validation question of the stored public analysis (Phase 3 `analyzeRelevance` + `validationQuestion`, deterministic, labeled as an inference);
5. no contact → "Identify who to talk to" (never an outreach action);
6. a contact but no interaction → "No interaction recorded with X yet", plus a statement that ORQO never contacts anyone;
7. otherwise *"No next action recorded"*.

## 13. Search integration

`addSearchedCompany`:

1. re-parses the query;
2. reads stored research;
3. deduplicates against the searched target **and** the analyzed domain;
4. creates the company with `network_origin = search` and `external_ref = search:<domain>`; a concurrent double submit keeps one row.

The Search result links to the company page.

## 14. Discover integration

`addDiscoveredCompany` is unchanged apart from `networkOrigin: "discover"` on creation. Deduplication and the `discover:<run>:<domain>` provenance are as before.

The company page links back to the Discover run ("Found by Discover"). Discover inference is not copied into private fields.

## 15. Agent integration / seams

- **Tool:** `read_relationship_context` (internal, read, no network, no cost, no model). It is attached to the `relationship_context` and `followup_preparation` capabilities.
- **Output:** data-minimized, with stage, origin, contact names and roles, the 10 latest interactions (kind, date, title, next step) and the open follow-ups. **No email, phone, profile URL or notes.** It is tagged `provenance: "private_relationship_memory"`.
- **Not executable:** the Relationship and Follow-up agents stay `coming_soon` (tested).
- **Excluded:** no outbound action, no email, no autonomous follow-up.

## 16. Entitlement / cost behavior

- Network memory sits under the existing Free feature `network.companies`. No paid path exists in any Phase 6 code path.
- Operator preview, plans and quotas are untouched.
- The Search and Discover add paths make no provider call: they read stored research only.

## 17. i18n

- All new UI uses the `network.*` keys in EN and FR (stages, origins, kinds, buckets, Next Best Action, timeline, forms) and the agent tool label.
- Obsolete Phase 2 placeholder keys were removed.

## 18. Tests run / results

| Check | Result |
| --- | --- |
| `typecheck` | ✅ |
| `lint` | ✅ |
| `build` | ✅ (the new route `/workspace/network/[companyId]`) |
| Unit `bun run test` | ✅ **191/191** (+15 in `src/lib/network/model.test.ts`: dates, buckets, origin and provenance, every Next Best Action rule including completion updates, timeline without fabrication, agent seam not executable) |
| Migration dry run + RLS isolation (scratch script, **one transaction, always rolled back**) | ✅ **24/24**, see below |
| `test:db` (incl. new `tests/db/network.test.ts`) | ⛔ **Not run.** Refused by the Phase 5 safety guard |
| `test:http` | ⛔ **Not run.** Same guard |
| `e2e:network` (new), `e2e:discover`, `e2e:agents` | ⛔ **Not run.** Same guard |

**Rolled-back dry run (24 checks).** Synthetic auth users and organizations were created inside the transaction. After rollback, the new tables and the synthetic users were confirmed absent. It covered:

- the migration applies cleanly;
- a second primary contact is refused;
- a non-member assignee is refused;
- a forged `closed_at` is ignored;
- done sets `closed_at`;
- the expected history events are written by triggers;
- users cannot insert or delete history;
- audit rows are written;
- tenant B reads none of A's contacts, interactions, follow-ups or events;
- B cannot insert into A, point a row at A's company, link A's contact, update A's follow-up or change A's stage;
- a viewer reads but cannot write;
- `anon` and `service_role` hold no grants;
- RLS is enabled.

**Why DB/HTTP/E2E did not run.**

- `.env.local` does not set `ORQO_DESTRUCTIVE_TESTS_PROJECT`, and this Supabase project holds the real workspace. Setting it to this project would relax the guard, so I did not.
- The suites are written and type-checked. They run once a **dedicated test project** is authorized (as recommended in Phase 5 §33).
- The guard was confirmed to refuse (`Destructive tests are not authorized…`).

**Regression list (requested items 1–18):**

- **Covered by unit tests and the dry run:** 4, 10, 17, 18.
- **Covered by the written but not executed `tests/db/network.test.ts` / `e2e:network`:** 1–3, 5–9, 11, 12, 14, 15.
- **Not tested live:**
  - 13 (Discover add): only the origin argument changed;
  - 16 (operator preview): untouched code.

## 19. External / provider calls made

**None.** No OpenRouter, no Brave, Exa or Firecrawl, no Nylas, no email, no enrichment, no website fetch.

## 20. DB writes performed during development/testing

- **Schema:** the Phase 6 migration was applied to the development Supabase project through `db:migrate` (one row in `supabase_migrations.schema_migrations`). It is additive: new nullable columns, new tables, triggers and policies.
- **Data:** no tenant data was written, updated or deleted.
  - The dry run created synthetic users and organizations **inside a rolled-back transaction**; their absence was verified afterwards.
  - A read-only check confirmed the existing companies have no stage or origin set (nothing fabricated) and that the new tables are empty.

## 21. Safety measures

- `tests/support/safety.ts` and its guard are unchanged. Nothing was relaxed, bypassed or mocked.
- No real organization is used as a fixture. The new suites use only this run's synthetic organizations and `cleanupTestData`.
- No real organization ids or secrets were printed or written in this report.

## 22. Known limitations

- **"Today" is the UTC calendar day** (follow-up buckets and Next Best Action). A user near midnight in another time zone may see a bucket shift by one day.
- **The follow-up assignee** can only be the creator ("Assign to me"). There is no member picker yet.
- **Follow-ups** cannot be edited after creation, only closed or reopened. Interactions cannot be edited or deleted from the UI.
- **The Network home** loads up to 1000 recent interactions, 500 open follow-ups and 50 closed ones per organization. That is enough for now, but not paginated.
- **The detail page** reads public analysis by website domain, or by name when there is no website. A name match could hit a same-named analysis.
- **Contact deletion** has no UI.
- **DB, HTTP and browser suites are not executed** in this environment (§18). Browser behavior has **not been verified live**.

## 23. Deferred Phase 7+ work

- Signals, Events and the Event Agent.
- Continuous intelligence and re-evaluation.
- The Opportunity Graph / Neo4j.
- Nylas email and calendar sync.
- An executable Relationship or Follow-up agent (the seam exists).
- CRM integrations.
- A member picker for assignees, and per-user time zones.

## 24. Exact commits

See `git log d2ee9e0..phase-6-network-followups`. The single Phase 6 commit is *"Phase 6: Network intelligence and follow-ups"*.
