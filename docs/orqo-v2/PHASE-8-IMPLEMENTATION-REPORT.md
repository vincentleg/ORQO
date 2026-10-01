# ORQO V2 — Phase 8 Implementation Report: Events

## 1. Objective

Answer one question: *"How do I turn an event into real business opportunities before, during and after it?"*

An event is a **business development context**, not a directory, a calendar or a ticketing system. It connects the existing ORQO graph:

```
Organization → Event → canonical Companies → Contacts → Interactions → Follow-ups → (Signals) → re-evaluation
```

Events own no parallel CRM. Companies, contacts, interactions and follow-ups are the Phase 6 records, carrying an event reference as context.

## 2. Baseline

- **Branch:** `phase-8-events`. Merge base with `main`: `c57a4b8` (Merge Phase 7). `main` had not moved.
- **Start state:** the tree was clean, and no Phase 8 code or migration existed.
- **Not pushed, not merged.** Phase 9 has not been started.

## 3. Architecture

**Pure, deterministic and tested** (`src/lib/events/`, inside the lint domain boundary):

| File | Contents |
| --- | --- |
| `model.ts` | Vocabularies; `eventPhase` (from dates); `validEventDates`; the target lifecycle `canTransitionTarget` / `canRemoveTarget`; `suggestPriority` (explainable, no score); `prepareTarget`; `reviewCounts`; `reviewItems`; `missedTargets`; `eventAttention`; `groupEvents` |
| `identity.ts` | `resolveEventCompany` (reuse by domain, then name; ambiguity is refused; own company refused) and `eventExternalRef` |
| `access.ts` | `eventAgentDecision` (Event Agent entitlement seam) |

**Server:**

| File | Contents |
| --- | --- |
| `src/lib/server/repositories/events.ts` | Organization-scoped reads and writes for events, targets, fast capture, the review read, company events, and the agent read seam `readEventContext` |
| `src/app/actions/events.ts` | Server actions: `requireAuth` → `requireMembership(member)` |
| `src/lib/server/repositories/network-memory.ts` | Gains optional event context, plus event-scoped reads |

The event-scoped reads in `network-memory.ts` are `listEventInteractions`, `listEventFollowUps` and `listContactRefs` (names and roles only).

**UI:**

| Route / file | Purpose |
| --- | --- |
| `/workspace/events` | Landing page |
| `/workspace/events/[eventId]` | Event page with Before / During / After tabs |
| `/workspace/events/[eventId]/targets/[targetId]` | Target preparation |
| `src/components/orqo/events.tsx` | Server display components |
| `src/components/orqo/event-forms.tsx` | Client forms |

## 4. Schema

**Migration:** `supabase/migrations/20261005090000_phase8_events.sql`. It is additive and backfills nothing.

**New table `events`:**

- `name`, `description`;
- `starts_on` / `ends_on` (**dates**, nullable). A check refuses an end date without a start date, or an end date before the start date;
- `location`;
- `website` (http(s), ≤ 500; **never fetched**);
- `objective_kind` (9 generic objectives), `objective` (the mission, in the user's own words), `topics[]` (≤ 20);
- `archived_at`;
- standard `created_by` / `created_at` / `updated_at`, and `unique (organization_id, id)`.

**New table `event_companies`** (event target):

| Group | Columns |
| --- | --- |
| Keys | `event_id`, `company_id` (composite foreign keys to the same organization) |
| Lifecycle | `status` (`planned` / `targeted` / `met` / `missed` / `skipped`) |
| Preparation | `priority` (`high` / `medium` / `low`), `attendance` (`unknown` / `expected` / `meeting_booked`, always as stated by a person) |
| Private text | `why`, `prep_notes` |
| Review | `reviewed_at`, `status_changed_at` (set by the database) |

`unique (organization_id, event_id, company_id)`: a company appears once per event, and can appear in many events.

**Event references on the canonical model.** All use composite foreign keys with `on delete set null (col)`:

- `companies.origin_event_id`: the event through which the company **entered** the Network;
- `contacts.event_id`: the contact was recorded at this event;
- `interactions.event_id`, with a partial index;
- `follow_ups.event_id`, with a partial index.

**`follow_ups.origin`** is extended with `'event'` (drop + add). `manual`, `interaction`, `next_action` and `signal` are unchanged.

**Triggers:**

- `event_company_lifecycle`:
  - refuses the organization's own company;
  - nulls forged `reviewed_at` / `status_changed_at` on insert;
  - sets `status_changed_at` when the status changes.
- `keep_origin_event` on companies: `origin_event_id` **can never be re-pointed** (it may only be cleared by the foreign key).
- The standard `set_updated_at`, `set_created_by`, `enforce_immutable_ownership` and `audit_change` on both new tables.

**Privileges:**

| Table | Grants to `authenticated` |
| --- | --- |
| `events` | `select`, `insert`, and column-level `update` on the editable columns and `archived_at`. **No `delete`:** events are archived, so their provenance stays |
| `event_companies` | `select`, `insert`, `delete`, and column-level `update` on `status`, `priority`, `attendance`, `why`, `prep_notes` and `reviewed_at`. `event_id` and `company_id` are immutable |

`anon` and `service_role` hold nothing. RLS: viewer+ reads, member+ writes.

**Rollback:** `supabase/rollbacks/20261005090000_phase8_events.down.sql` is manual and **destructive for Phase 8 data**. It:

- drops both tables and the four event columns;
- relabels `event` follow-ups as `manual`;
- restores the Phase 7 origin constraint.

It was tested inside the rolled-back dry run (§16).

## 5. Event lifecycle (dates)

The phase is **derived, never maintained by hand**. Calendar days are compared as strings; no time or time zone precision is claimed.

| Phase | Rule |
| --- | --- |
| `undated` | No (valid) start day |
| `upcoming` | Today is before the start |
| `active` | Start ≤ today ≤ end (inclusive; no end = a one-day event) |
| `past` | Today is after the end |

- **Date input** reuses the Phase 6 Safari-safe `DueDateField`, which gained optional `name` / `label` / `emptyLabel` props; its defaults are unchanged and the Phase 6 tests pass unchanged. An empty field shows "No date", renders no native date input and submits nothing.
- **On the server**, `normalizeDueOn` maps an empty value to `null`, never to today.
- **Archive / restore.** Archived events are read-only; the server refuses changes with `ArchivedEventError`.

## 6. Targets

**Three sources:**

1. **A Network company** (picker). This includes companies previously added from Search or Discover.
2. **A new company** (name + optional website). It is resolved server-side by `resolveEventCompany`:
   - an existing company with the **same domain** → reused;
   - otherwise the **same normalized name** → reused;
   - the **same name with a different website** → `AmbiguousCompanyError`. The user is asked to pick from Network; nothing is merged silently.

     **Behavior change:** the Phase 6 Search add reuses a company on a name match even when the websites differ. Events deliberately do not.
   - the organization's own company → refused;
   - otherwise created through the trusted `createCompany` with `network_origin = 'event'`, `origin_event_id = <event>` and `external_ref = event:<eventId>:<domain|name:key>` (unique, so a double submit keeps one row).
3. **Fast capture** (§9). It adds the company as a `met` target.

**Lifecycle (`canTransitionTarget`, checked server-side with optimistic matching on the current status):**

- `planned` ⇄ `targeted`;
- `planned` / `targeted` → `met` / `missed` / `skipped`;
- `missed` / `skipped` → `met`;
- any state → reset to `targeted`.

**Removal:** only while the target is `planned` / `targeted` and no event interaction exists. The company always stays in Network.

**Priority** is set by the person (default `medium`). ORQO shows an explainable **suggestion** (`suggestPriority`), never a score:

| Suggestion | When |
| --- | --- |
| High | A recorded opportunity, a qualified-or-beyond stage, or an open signal assessed *relevant* |
| Low | The team marked the company *not relevant* |
| Medium | Otherwise |

Every factor is listed. With nothing recorded, the suggestion says so explicitly ("nothing is recorded about this company yet").

**Attendance** is only what a person states. ORQO never infers it, and "Attendance not confirmed" is listed as an unknown.

## 7. Preparation

The target page reads, without copying anything:

- Network memory: stage, origin (+ origin event), contacts, latest interaction, open follow-up;
- the **unchanged Phase 6 Next Best Action**, computed with exactly the Network page's inputs;
- recorded opportunities;
- the stored public analysis (Phase 3), with its date;
- open public signals (Phase 7), marked when assessed relevant.

`prepareTarget` produces grounded questions:

| Question | Grounded in |
| --- | --- |
| Identify who to meet | No contact recorded |
| Plan to meet {primary contact} | A recorded contact |
| Close the loop on the open follow-up | An open follow-up |
| Pick up the last next step | The latest interaction's next step |
| Ask how a public change affects their plans | A recorded signal headline |
| Validate: … | Up to two Phase 3 validation questions (an "inference to validate") |

Each question names its basis (Private / Public / Inference to validate).

**Unknowns** are explicit:

- no public analysis;
- no contact;
- attendance unconfirmed;
- no reason;
- no history.

The validation questions come from the existing `validationQuestion` wording, so the Phase 7 fix (quote only declared offers) is untouched.

## 8. Contacts / interactions reuse

- **Contacts** are created by `createNetworkContact(…, { eventId })`, with the same validation and primary-contact rules. They are manual only, with no enrichment.
- **Encounters** are canonical `interactions` of kind `event` with `event_id`, written by `recordInteraction(…, { eventId })`.
- **The event page** displays event interactions and contacts by reading them (no duplicated content). Only names and roles of contacts are sent to the browser.
- **The Network company page timeline** shows "· at {event}" on such interactions.

## 9. Fast capture

On the During tab, the form is open by default while the event is active. It is one compact form: company (targets first, then Network, or "+ New company"), contact (that company's contacts, or "+ New contact"), when, title (prefilled "Met at {event}"), what happened, outcome and next step.

`captureEncounter` runs four steps:

1. resolves or creates the canonical company (as in §6);
2. optionally creates the canonical contact (with `event_id`);
3. records the canonical interaction (kind `event`, `event_id`);
4. marks the target `met`, or creates it as `met`.

**The next step stays on the interaction.** A follow-up is created only through an explicit "Make it a follow-up". Nothing is sent.

## 10. Follow-ups reuse

`createEventFollowUpAction` → canonical `createFollowUp(…, { eventId })`. The origin is decided by `followUpOrigin`:

| Created from | Origin | `event_id` |
| --- | --- | --- |
| An interaction's next step | `interaction` (unchanged Phase 6 semantics) | kept |
| An event context otherwise (missed target, review) | `event` | kept |
| Phase 7 signal | `signal` (unchanged) | — |
| Phase 6 manual | `manual` (unchanged) | — |

`FollowUpItem` shows "From an event" for origin `event`. The Safari due-date field is reused unchanged.

## 11. Network provenance

| Case | Result |
| --- | --- |
| Company **created** through an event | `network_origin = event` + `origin_event_id`. The relationship card shows "Entered your Network at {event}" (link) |
| Company **already known** (e.g. Discover), later met at an event | Reused, and **never written**. The repository contains no `companies` update and no `network_origin` write (asserted by a test). The database `keep_origin_event` trigger also prevents re-pointing (verified in the dry run). The encounter is recorded as event context on interactions, contacts and targets |

A new **Events** card on the Network company page lists every event the company appears in, with phase and target status.

## 12. NBA integration

`nextBestAction` is **unchanged** and receives no event input. Event follow-ups are canonical open follow-ups, so they become the Next Best Action by Phase 6 rule 1 (tested). An event interaction's next step is offered by rule 3, never created automatically. There is no competing engine.

## 13. Review (after the event)

`reviewCounts` returns factual counts only:

- targets, met, missed, skipped, no outcome recorded;
- companies met, new Network companies (by `origin_event_id`);
- contacts added, interactions;
- open follow-ups, completed follow-ups.

No score, no percentage, no ROI, and no claimed partnership or deal.

**"Requires your review"** (`reviewItems`):

1. a missed **high-priority** target;
2. an event next step with no follow-up tracking it;
3. other missed targets;
4. after the event ends, targets with no recorded outcome.

**The user may:**

- create a follow-up (explicit);
- mark "No action needed" (`reviewed_at`; undoable);
- set an outcome.

**Missed targets remain durable.** A reviewed missed target leaves the queue but stays in the **Missed targets** list, in the counts and in Network. No follow-up is ever created automatically.

**The landing page's "Needs attention"** lists:

- an upcoming or active event with no targets;
- missed high-priority targets;
- a past event with open follow-ups;
- a past event with unrecorded outcomes.

## 14. Event Agent and entitlements

- **Reused:** the existing `event` agent (no duplicate). It **stays `coming_soon`**, with no mission types and no execution budget.
- **`event_analysis` capability:** it now lists `read_event_context` (new), `read_relationship_context` and `read_company_signals`. All are internal, read-only, with no network, no model and no cost.
- **`read_event_context`** returns event basics, targets (status, priority, attendance) and review counts, tagged `provenance: "private_event_plan"`. It deliberately **excludes** `why`, preparation notes, contact details and interaction contents.
- **`eventAgentDecision`** refuses autonomous event work while the agent is not built, for Free, Business **and operator preview** (tested).

**Features:**

| Feature | Plan | Availability |
| --- | --- | --- |
| `events.workspace` | Free | available |
| `events.automation` | Pro | coming soon |
| `agents.event` | Pro | coming soon (unchanged) |

No quotas or prices were invented. The landing page shows an "Automated event research" plan card and an Event Agent status card stating that nothing runs automatically.

## 15. Public / private boundary and security

**Private, labeled "Private":**

- why, preparation notes;
- interactions, contacts, follow-ups;
- relationship memory on the target page.

**Public, labeled "Public":**

- stored analysis;
- signals.

They live in separate cards. Contact channels and notes are not rendered on the preparation page and are not sent to the browser on the event page. Private text never enters a signal, a source or evidence. Phase 8 writes nothing to public tables.

**Event URL:** validated as http(s) in the database and with zod, and rendered only as a `rel="noopener noreferrer nofollow"` link with "not visited by ORQO". **No fetch.** A source scan test asserts that no Events file imports providers, Brave, OpenRouter, the fetcher or research execution, or calls `fetch(`, `mailto:` or Nylas.

**Authorization:**

- server actions: `requireAuth` → `requireMembership(member)`; the form's organization id is a lookup key only;
- repositories: filter on the organization, verify Network (non-own) companies and same-company contacts and interactions, and check event existence and archive state;
- assignee: only the signed-in user can be chosen (unchanged);
- isolation: composite foreign keys make cross-tenant references impossible even if RLS is bypassed.

No secrets were added, and there are no new environment variables.

## 16. Tests run

| Check | Result |
| --- | --- |
| `typecheck` | ✅ |
| `lint` (`src/lib/events/**` added to the domain boundary) | ✅ |
| `build` (three new routes) | ✅ |
| Unit `bun run test` | ✅ **292 / 292** (was 245; +47) |
| Migration + RLS + rollback dry run against the dev DB (**one transaction, always rolled back**, synthetic users and organizations) | ✅ **38 / 38** |

**Unit tests added:**

- **`src/lib/events/events.test.ts`, 34 tests:**
  - phase from dates, including inclusive/one-day/undated and invalid dates;
  - landing grouping;
  - lifecycle and removal rules;
  - identity: domain reuse, name reuse, ambiguity refused, own company refused, creation key, reuse across events;
  - origins: `event` added and others kept, `followUpOrigin`;
  - existing origin never written (source assertion), the DB trigger present;
  - explainable priority;
  - preparation: grounded questions, explicit unknowns, the private note never surfaced, the Company B scenario;
  - factual review counts;
  - review queue ordering, missed targets durable after review, no automatic follow-up;
  - landing attention;
  - **NBA canonical**;
  - Free / locked features;
  - Event Agent coming soon and refused incl. preview;
  - read-only tool seam;
  - no provider / fetch / outreach reachable.
- **`src/components/orqo/events.test.tsx`, 13 tests** (static render):
  - preparation EN/FR, with Private/Public labeling, no private note and no email shown;
  - the target page's separate labeled cards;
  - event dates using the Safari-safe empty state (no native input, nothing submitted);
  - the Phase 6 due-date defaults intact;
  - actions using `normalizeDueOn`;
  - fast capture fields, with no outreach or due date (EN/FR);
  - factual event card counts (EN/FR);
  - allowed status buttons;
  - "From an event" (EN/FR).

**Dry run, 38 checks:**

- the migration applies;
- `created_by` is set by the database;
- invalid date ranges and a `javascript:` website are refused;
- events cannot be deleted; archiving works;
- `origin_event_id` cannot be re-pointed; an existing Discover company gains no event provenance;
- a company cannot point at another tenant's event;
- forged review/status timestamps are ignored; the default status is `targeted`;
- a duplicate target is refused; the same company on a second event is allowed;
- the own company is refused;
- the status time is set by the database;
- `event_id` / `company_id` are immutable;
- a target cannot reference another tenant's company;
- interactions, contacts and follow-ups with event context are accepted;
- origin `event` is accepted, `signal` still accepted, unknown origins still refused;
- tenant B cannot attach interactions or follow-ups to A's event, cannot read, insert, target, update or delete A's rows;
- a viewer reads but cannot write;
- `anon`/`service_role` have no privileges;
- RLS is enabled;
- audit rows are written;
- the rollback removes the tables and columns, relabels follow-ups, and restores the Phase 7 constraint;
- **after rollback, no table and no synthetic user remain.**

**Regressions:** every Phase 1–7 unit suite passes unchanged. This includes:

- Network model / NBA;
- the Safari due-date tests;
- the Phase 7 signals and signal-relevance (declared-offer) tests;
- the agent registry and tool consistency;
- plans and the i18n EN/FR key parity.

## 17. Tests not run, and why

- **`test:db`** (including the new `tests/db/events.test.ts` and the updated `schema.test.ts`), **`test:http`** and the **e2e scripts** were not run.
  - The safety guard refuses them: `ORQO_DESTRUCTIVE_TESTS_PROJECT` is not set, and the configured Supabase project holds the real workspace.
  - The refusal was confirmed (`Destructive tests are not authorized…`). The guard was not touched or bypassed.
  - The suites are written and type-checked, and will run once a dedicated test project is authorized.
- **No new e2e script** was added.
- **Browser behavior has not been verified live by me.** It requires the human review in §21.

## 18. External calls

**None.** No Brave, OpenRouter, Exa, Firecrawl, website or event-URL fetch, email, LinkedIn or enrichment calls. All logic was tested with fictional fixtures.

## 19. Database writes

- **Schema:** `bun run db:migrate` applied `20261005090000_phase8_events` to the development Supabase project (one row in `supabase_migrations.schema_migrations`). It is additive:
  - two tables;
  - four nullable columns;
  - two functions and triggers;
  - policies;
  - the extended `follow_ups.origin` check.
- **Data:** none.
  - The dry run ran in a single rolled-back transaction; the absence of its tables and users was verified.
  - A read-only count after migrating showed:
    - 0 events and 0 targets;
    - 0 companies, interactions and contacts with an event reference;
    - 0 event follow-ups.
  - No record in the real workspace was inserted, modified or deleted.

## 20. Known limitations

**Dates and statuses:**

- "Today" is the **UTC** calendar day (as in Phases 6–7), so an event's phase can flip up to a day early or late near midnight elsewhere.
- Event times and time zones are not modeled.

**Fast capture and writes:**

- Fast capture is **not one database transaction**: it writes company → contact → interaction → target in sequence. A failure midway can leave the earlier records (real, user-entered data), and the form reports the error.

**What Events cannot do yet:**

- There is no attendee or exhibitor import, no scraping and no event research. The Event Agent is not executable; only read seams exist.
- Discover candidates must first be added to Network (existing button) before they can be picked as targets. A Search-analyzed company can be added by entering its website: its stored public analysis is then found by domain on the preparation page.
- Events are archived, never deleted, and there is no hard-delete UI.

**Data and scale:**

- Targets cannot be moved between events.
- The interaction `kind` for captured encounters is always `event`.
- The event page loads up to 1000 targets and 500 interactions and follow-ups per event; the landing page reads up to 5000 target rows organization-wide. This is not paginated.
- Prioritization suggestions use recorded facts only. A company with no recorded context is "medium — nothing recorded", by design.

## 21. Human browser review (no paid calls)

Use a **separate review workspace** so the real workspace is not touched.

1. **Workspace.** Signed in, open `/onboarding` and create "ORQO Phase 8 Review". In **Company**, set a short profile (e.g. offerings "System integration", geographies "Europe").
2. **Empty state.** Open **Events** (new nav item between Intelligence and Agents). Expect:
   - the empty state;
   - the "Automated event research" card (**Pro**, locked on Free);
   - the **Event Agent** status card saying nothing runs automatically.
3. **Create an event.** Use **Create event** with:
   - name "Fictional Infrastructure Summit";
   - objective *Find technology partners*;
   - mission "Find US technology companies that may need a European deployment/integration partner";
   - start and end dates a few days ahead.

   Leave the website empty or enter any URL, and check that it is shown as a link "not visited by ORQO". In Safari, check the empty date fields read "No date" and stay empty after opening and closing the picker.
4. **Phases.** Back on Events, the card is under **Upcoming**. Create a second event dated in the past and a third with no dates, and check **Past** and **Dates not set**. Edit one to include today and check **Happening now**.
5. **Fictional Network company.** In **Network**, add a fictional company, e.g. "Fictional Rover Co", `https://example.com`. Set stage *Conversation*.
6. **Targets.** In the event, on **Before · Targets**:
   - add it **From your Network**, priority High, with a "why";
   - add a **New company** "Fictional Quill Ltd" (no website);
   - add a **New company** "Fictional Rover Co" with a *different* website, and check that the ambiguity message appears and nothing is created.
7. **Preparation.** Open **Prepare** on Fictional Rover Co and check:
   - the Private and Public cards are separate;
   - "Attendance not confirmed" appears under Still unknown;
   - "Identify who you want to meet" appears (no contact yet);
   - the suggested priority and its factual reasons;
   - the Next Best Action is the same as on its Network page.

   Edit the preparation notes; they show only in the Private card.
8. **Capture.** Switch to **During · Encounters** → **Record an encounter**:
   - company *Fictional Rover Co*;
   - "+ New contact" "Alex Fictional, CTO";
   - what happened, outcome, next step "Send the integration brief".

   Save, then check:
   - "Encounter saved… marked Met";
   - the target is **Met**;
   - the encounter appears with the next step and **Make it a follow-up**.
9. **Provenance.** On the Network page of Fictional Rover Co, check:
   - the contact appears;
   - the timeline shows the Event interaction "· at Fictional Infrastructure Summit";
   - the **Events** card lists the event;
   - the origin is still **Manual** (not overwritten).

   On Fictional Quill Ltd's Network page, check that the origin is **Event** with "Entered your Network at Fictional Infrastructure Summit".
10. **Explicit follow-up.** Click **Make it a follow-up** (prefilled; due date "No due date") and save. The encounter shows "Follow-up created".
11. **Network and NBA.** In **Network**, the follow-up appears in Follow-ups. On the company page it shows "From an interaction" and is now the **Next Best Action**. Nothing was sent.
12. **Missed target.** Mark Fictional Quill Ltd **Missed** (Before tab). Open **After · Review** and check:
    - factual counts;
    - Quill under **Requires your review** as "High-priority target not met" (set it High if needed);
    - **No action needed** → it leaves the queue but stays under **Missed targets** with "Reviewed — no action";
    - **Create a follow-up** on a missed target works and shows "From an event".
13. **Needs attention.** Back on Events, check "Needs attention" (e.g. the undated or upcoming event with no targets).
14. **Archive.** Archive an event. It is read-only, its records stay in Network, and **Restore** works.
15. **FR.** Switch to **FR** and repeat steps 2, 7 and 12 for rendering.
16. **Signals.** On Fictional Rover Co, record a public signal (Phase 7). The preparation page then lists it under Public and adds "Ask how this public change affects their plans".

Afterwards, delete or leave the review workspace. Nothing was written to the real workspace.

## 22. Commits

See `git log c57a4b8..phase-8-events`. The single Phase 8 commit is *"Phase 8: Events"*.
