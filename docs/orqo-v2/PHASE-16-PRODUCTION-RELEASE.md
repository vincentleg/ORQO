# ORQO V2 — Phase 16 Production Release

**Verdict: PASS.** Released 2 Oct 2026, about 17:55–18:30 UTC. Phase 16 (16A Opportunity Precision and Tracked Opportunities, 16B ORQO CEO and Experience) is live at **https://orqo-jet.vercel.app**.

## Version
| | |
|---|---|
| Production before | Code `2dce28d` (Phases 14 + 15) on `dpl_81XekLwh73LXN9SST5M16rkdF4kL` |
| Phase 16 branch | `phase-16-orqo-ceo-experience`: 16A final `ee99e98`, 16B final `85784fa` |
| Merge into `main` | `caaa476` (no fast-forward, full history kept). Its tree is identical to `85784fa` |
| Deployed commit | `caaa476`, from a clean, detached Git worktree with no env files (`.vercelignore` excludes every env file but the two examples) |
| New deployment | `dpl_4pSD5hUT6VzVJmvEffcmVQXu4gVX`: Ready, target production, alias `orqo-jet.vercel.app` |
| Process | `vercel deploy --prod`. No Vercel setting, environment variable, domain or Git-connection change. The project still has no Git repository connected |

## Pre-release gate (on `85784fa`, ORQO Test)
- Typecheck, lint and the local production build: pass.
- Unit: 588 pass.
- DB/RLS (tracked opportunities, CEO, understanding, RLS isolation, schema): 116 pass.
- HTTP (opportunities, API): 43 pass.
- `e2e:work` and `e2e:opportunities`: pass. Axe found no violations on 14 pages; there were no console errors, no research or agent run, and no request outside the app.
- **Git:** only Phase 16 files changed. The diff adds exactly one migration (plus its rollback). No secret file is tracked, and no provider, environment, proxy or config change was made.

## Migration
**What was applied:** `20261007090000_phase16_tracked_opportunities` only, with `bun run prod:db apply --confirm=tklx`.

**Before:**
- 9/9 applied, 1 pending, 0 unknown;
- 29 tables, all 29 with RLS, 84 policies.

**Review:**
- The body is byte-identical (SHA-256) to the one recorded on ORQO Test.
- It is additive: one new table, its indexes, a function, triggers, grants, RLS and policies. Its only `alter` enables RLS on the new table.
- The rollback file exists.

**After:**
- 10/10 applied, recorded once, same hash.
- The `tracked_opportunities` catalog is **identical to ORQO Test**: columns, checks, same-organization foreign keys to companies and intelligence, unique keys, indexes, the four triggers (`set_created_by`, `set_updated_at`, `status_changed`, `audit_change`), RLS on, and three policies.
- Grants: `authenticated` may select and insert, and update the `status` column only. Nothing is granted to anon or service_role.
- Every pre-existing table count is unchanged.

## Tracked-opportunity RLS (Production)
Run as real roles inside **one transaction that was always rolled back**. Synthetic users, organizations and companies existed only inside it; afterwards there were 0 rows, 0 organizations and 0 users left. **17/17 PASS:**

| Who | Action | Result |
|---|---|---|
| Member | insert, read, change status | Allowed |
| Member | update the snapshot | Refused (42501) |
| Member | set an invalid status | Refused (23514) |
| Member | delete | Refused (42501) |
| Viewer | read | Allowed |
| Viewer | insert | Refused by RLS |
| Viewer | change status | 0 rows |
| Outsider | read | 0 rows |
| Outsider | insert into A | Refused by RLS |
| Outsider | insert in its own organization with A's company | Refused (foreign key 23503) |
| Outsider | update A's row | 0 rows |
| anon, service_role | read | Refused (42501) |
| Triggers | created_by, status date, audit | Fired (2 audit events) |

## Health and security (signed out)
- **Public pages:** `/`, `/login`, `/demo`, `/signup` and `/api/status` return 200.
- **Protected pages:** `/workspace` (with or without `ask`), `/workspace/companies`, `/workspace/companies/{id}`, `/workspace/network/{id}`, `/workspace/opportunities` and `/workspace/report` return 307 to sign-in.
- **APIs:** `/api/v1/me` and the opportunities API return 401.
- **Transport and headers:** HTTP redirects to HTTPS (308). HSTS (preload), `X-Frame-Options: DENY`, `nosniff`, referrer policy, permissions policy, an enforced `frame-ancestors` CSP and the report-only CSP are present.
- **Secrets:** none in the HTML.
- **Auth:** `disable_signup: true` and email confirmation required, both unchanged.
- **Providers:** `/api/status` shows AI unavailable, Brave off and graph `memory` (Neo4j unconfigured). The kill switch is on.

## Authenticated Phase 16 smoke
Run by Claude in a headless browser on the existing smoke workspace. The credentials were entered by the owner in local hidden dialogs and never printed or stored.

**Work:**
- One priority: "Integrate INFODIP and GigaIO" (credible, not yet tracked, with its decisive question). Dell never appears.
- Continue working: GigaIO. The one question is the relationship question. The memory line is shown.
- Opening Work changed nothing: research runs, usage events, agent runs and tracked rows all stayed the same.

**Navigation:** Work | Companies | Opportunities | Events. More: Your company, Find companies, Signals, Agents, Overview, Plans, Settings. The mobile More menu works.

**CEO** (all answered from stored records; research, usage and agent counts unchanged):

| Request | Answer |
|---|---|
| priorities | priorities |
| "What could we do with GigaIO?" | company: "The most credible opportunity with GigaIO: Integrate INFODIP and GigaIO." |
| Dell | company: "I don't see a credible new opportunity with …Dell…" |
| What we don't know about GigaIO | missing |
| What to investigate next | next investigation |
| Meeting with GigaIO | meeting, with the honest "no meeting brief yet" note |
| Email to GigaIO | future: outreach, not performed |
| Unknown company | not researched, with a lookup link |
| "hello" | one clarification |

**Companies:**
- GigaIO is remembered; 5 more companies are researched but not remembered.
- Looking up `dell.com` gives the verdict `no_credible_opportunity`.
- `/workspace/network/{id}` redirects to `/workspace/companies/{id}`.
- The memory line reads "Researched 2 Oct 2026 · Credible opportunity".

**Other pages:** Events, Agents, Signals, Overview, Discover and Your company all open.

## Opportunity precision (stored Production intelligence, no new research)
- **Dell:** `no_credible_opportunity`. The relationship is unknown (INFODIP's site does not name Dell). Reasons given: "Nobody is shown to need them enough to pay" and "No evidence shows … needs them". No Track button, not in priorities, not in Opportunities. The supplier-answer path was proven on ORQO Test in 16A. No Dell company or answer was created in Production.
- **GigaIO:**
  - **Credible:** technical integration, implementation partnership, and GigaIO reselling INFODIP.
  - **Considered, not recommended:** contract production, referral and the two embedding ideas.
  - Track buttons appear only on the 3 credible ideas; considered ideas have none.

## Tracked-opportunity acceptance (persistent smoke data)
- "Integrate INFODIP and GigaIO" (`technical_integration:own`) was tracked from the GigaIO company page. The server recomputed the dossier and stored its own snapshot.
- The detail page shows "Still credible" and the seven sections.
- The status changed to Validated, survived a reload, and was set back to **Investigating**.
- Audit: `tracked_opportunities.created` ×1 and `.updated` ×2.
- **This record stays in Production by design:** there is no delete. The owner can set it to Closed.

## Business Memory, FR/EN, responsive and accessibility
- **Memory:** "Researched …", "Opportunity tracked" and the verdict are shown on Work, Companies and the company page.
- **French:** the navigation reads "Travail | Entreprises | Opportunités | Événements". The CEO answers "Je ne vois pas de nouvelle opportunité crédible avec … Dell …". Opportunities and the company memory line are in French. The account language was restored to its previous setting (French).
- **Responsive:** 1280 and 390 px showed no horizontal overflow on Work, a CEO answer, Companies, the company page, Opportunities and Events.
- **Axe (WCAG A/AA, whole pages):** 0 serious or critical issues on Work, a CEO answer, Companies, the company page, the opportunity detail, Opportunities, the mobile More menu and Work in French.
- **Browser:** no console error. The only host contacted was `orqo-jet.vercel.app`.

## Data integrity (counts only)
**Changed, as expected:**
- `tracked_opportunities` 0 → 1 (the smoke record);
- `audit_events` 6 → 9 (those 3 events).

**Unchanged:**
- 1 user, 1 organization, 1 membership, 2 companies;
- 7 intelligence records, 147 evidence items, 1 company validation;
- 9 research runs, 0 usage events, 0 agent runs.

**Logs** for `dpl_4pSD…` since the deployment: 0 error, warning or fatal entries and 0 5xx. The only 4xx were the two deliberate signed-out API probes (401). No secret-like or provider strings.

## Recovery
- **Database:** WAL archiving is on (53 segments, 0 failures; last at 16:23 UTC, before the migration). Scheduled backups are not visible from tooling, and PITR is off, unchanged since Phase 13.
- **Rollback, application:** promote `dpl_81XekLwh73LXN9SST5M16rkdF4kL` (Ready). It ignores the new table.
- **Rollback, database:** `supabase/rollbacks/20261007090000_phase16_tracked_opportunities.down.sql` would delete tracked opportunities (one exists now). Prefer a forward fix, and use it only with owner approval.

## Known limitations (Production)
- **Names come from stored research profiles:** Dell's stored research names it "Computers, Monitors & Technology Solutions | Dell USA" (its page title).
- **Cosmetic wording, to fix in a later phase:**
  - "ORQO remembers 1 companies" (no singular form);
  - an unknown company's name is shown lowercased ("globex").
- **Phase 16 limitations** (`PHASE-16-HANDOFF.md` §12): a vocabulary-based CEO, no comparison, no written meeting brief, and the briefing limited to 8 dossiers.
