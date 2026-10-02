# ORQO V2 — Phases 14 + 15 Production Release

**Verdict: PASS.** Released 2 Oct 2026, about 06:35–06:50 UTC. Phase 14 (Adaptive Intelligence Foundation) and Phase 15 (Company & Opportunity Intelligence) are live at **https://orqo-jet.vercel.app**.

## Version
| | |
|---|---|
| Deployed commit | `2dce28dcde4ac4d3de6eb69095087ffce98f5f61` (`main` = `origin/main`), deployed from a clean Git worktree of that exact commit |
| New Production deployment | `dpl_81XekLwh73LXN9SST5M16rkdF4kL`, Ready, target production, holds the `orqo-jet.vercel.app` alias. Vercel build passed in 49 s |
| Previous Production deployment | `dpl_AayFd1odR6BJBfSnarbtVfUdGbN2` (Phase 13). Kept, so it is available for a Vercel rollback |
| Process | Established `vercel deploy --prod`. No Vercel setting, environment variable, Git connection or domain change |

## Pre-flight
**Git:** `main` = `origin/main` = `2dce28d`, clean. Phases 14 and 15 and both handoffs are present, and the only tracked env files are the two examples.

**Release delta:** since the Phase 13 deployment, exactly **one** migration, `20261006090000_phase14_company_validations`. Phase 15 has none.
- It is byte-identical (SHA-256) to the body recorded on ORQO Test.
- It is additive only: a new table, index, two triggers, grants, RLS and two policies. No `drop`, `truncate`, `delete` or `update`, and no statement on another object.

**Production identity:** guarded tool, ref `****tklx`, distinct from Dev and Test. The Vercel project is `orqo`.

**Environment:** the validated Phase 13 set of 7 variables (names only checked); kill switch on, no provider keys, no new secret needed. Public sign-up is disabled and email confirmation is required.

**Recovery position:**
- WAL archiving on: 29 segments, 0 failures, last at 01:33 UTC.
- The latest completed daily backup is still 01 Oct 23:30:55 UTC. The next daily one could not exist yet at 06:33 UTC.
- PITR is off.
- This is the posture accepted at Phase 13 closure. The migration only adds an empty table, so it doesn't make recovery worse.
- The backup list itself was not re-read in the dashboard: there is no management access from tooling.

**Pre-migration snapshot:** 28 tables, 28 with RLS, 82 policies, 54 public rows, 1 auth user, 1 research run, 0 usage events.

## Migration and database validation (before deploying)
**Migration:**
- Applied with `bun run prod:db apply --confirm=tklx`.
- Result: 9/9 applied, 0 pending, 0 unknown; recorded once, with a body identical to the repository.

**Catalog:** identical to ORQO Test for columns, constraints, indexes, policies, functions, triggers, grants, RLS and enums. Only the per-project archiver counters differ.

**`company_validations` structure:**
- RLS on;
- grants: `authenticated` select and insert only; anon and service_role none;
- policies: `select` for viewers and up, `insert` for members and up;
- triggers: `set_created_by`, `audit_change`, with `search_path` pinned;
- same-organization company foreign key.

**Behaviour under RLS**, as real roles, inside a transaction that was always rolled back (0 rows remained):
| Who | Action | Result |
|---|---|---|
| Member | insert, read | Allowed |
| Member | update, delete | Refused (42501: append-only) |
| Member | free-text value | Refused (23514) |
| Outsider | read the workspace's validations or companies | 0 rows |
| Outsider | insert | Refused |
| Anonymous | select | Refused |

## Unauthenticated smoke: PASS
- `/`, `/login`, `/demo`, `/signup`, `/api/status`: 200.
- Signed-out `/workspace`, `/workspace/company` and `/workspace/report`: 307 to sign-in. `/api/v1/me`: 401.
- HTTP redirects to HTTPS (308).
- HSTS, `X-Frame-Options: DENY`, `nosniff`, referrer policy, permissions policy and report-only CSP are all present.
- Providers are unavailable, and no secret-like string appears in the HTML.

## Authenticated smoke: PASS
Run by Claude in a headless browser on the existing "ORQO Smoke Test" workspace. The credentials were entered by the operator in local hidden dialogs and never printed.

**Account and access:**
- The session cookie is Secure and SameSite=Lax. It is not HttpOnly, which is inherent to `@supabase/ssr` and unchanged since Phase 13.
- The workspace, INFODIP's profile, the Network (GigaIO), the GigaIO company page, Intelligence, Events, Agents, Dashboard and Plans all load.
- The graph view degrades safely without Neo4j.

**Other checks:**
- FR ↔ EN on the dossier works, and the locale was restored to `en`.
- Sign-out returns to `/login`.
- Across two passes: no console errors, no 5xx and no browser request to any provider.

## Phase 14 acceptance: PASS
- **Business DNA:** one free Basic read of `infodip.com` from the Company page produced 37 items (15 facts, 22 inferences), including 10 stated by the team. Evidence and source links render, and unknowns are listed.
- **Market model:** partial coverage, 50 entries, 5 of them evidence-backed.
- **Next question:** "Who are your customers?", with 4 constrained options.
- **Validation persistence:** the member confirmed "physical products", a reading derived from the team's own typed profile, so the statement is truthful. It survived a reload, is append-only and is audited (`company_validations.created`). Viewer, outsider and anonymous refusals were proven by the rolled-back checks above.

## Phase 15 acceptance: PASS, from stored intelligence only

**Search for GigaIO:** the dossier (status `ready`) leads with the executive assessment:
> GigaIO — product company and software vendor. Sells physical products and software to businesses. In its market, customers are typically reached through direct sales and self-serve sign-up. For INFODIP, the most credible business to investigate: Integrate INFODIP and GigaIO.

**Scenarios:**
- technical integration (credible, evidence-backed);
- implementation partnership (credible);
- resale channel (credible).

There are no new-business ideas and no discarded ideas for this pair.

**Deal Critic:** on the lead scenario, it reports no specific objection in the evidence and still asks for validation. It invents nothing.

**Revenue hypothesis:**
- shared customers pay;
- for each product, more likely kept because they work together;
- through an integration partnership, with no direct payment;
- "ORQO does not estimate amounts…". No amounts appear.

**Labels:** the support items show facts and inferences.

**Decisive question:** "Do shared customers ask for the two products to work together?" → ask GigaIO.

**Read-only acceptance on Production data** (deployed code, before INFODIP's website was read): from INFODIP's typed profile alone, ORQO proposed **INFODIP producing GigaIO's products** as a hypothesis. The critic said "no evidence shows GigaIO needs this", and the next investigation was "Does GigaIO produce in-house or outsource its production?" The scenarios changed once INFODIP's own website evidence was read, as designed.

**Report:**
- authenticated; correct pair; "built only from stored intelligence" note; 4 sources;
- print view: navigation and print button hidden;
- a company not in this workspace shows "No stored analysis", never another workspace's data;
- a random company id returns 404.

**Search adaptation:** hardware mechanisms appear only through INFODIP's own traits. The legacy hardware-only block no longer drives Search.

## Provider and cost safety: PASS
- 0 usage events, 0 Deep runs and 0 agent runs before and after.
- The only research was the one deliberate free Basic read of INFODIP's website (official site only).
- Revisits and the report started no research: the research-run count was unchanged.
- No provider host appears in the logs, and the kill switch is on with no keys.

## Data and log review
**Expected changes:**
- +1 table (`company_validations`);
- +1 research run (basic, `infodip.com`, succeeded), +1 intelligence record, +19 evidence items, +2 sources;
- +1 validation and +1 audit event.

Nothing else changed: users 1, organizations 1, memberships 1, companies 2, profile locale `en`.

**Logs** for `dpl_81Xek…` over the release window: 0 error, warning or fatal entries and 0 5xx. The only 4xx were the deliberate signed-out `/api/v1/me` probe (401, recorded as a denied request) and the random company-id probe (404). No secret-like strings.

## Production state after release
| | |
|---|---|
| Public sign-up | Disabled |
| Paid providers | Off (kill switch on, no keys) |
| Neo4j | Unconfigured |
| Health | Healthy |

PITR, SMTP, domain, CSP enforcement and the GitHub connection are unchanged and still deferred (Phase 13 §23).

## Rollback notes
- **Application:** promote `dpl_AayFd1odR6BJBfSnarbtVfUdGbN2` (Phase 13). It does not use the new table, so it stays compatible with the migrated database.
- **Database:** the migration is additive. If it ever had to be reversed, dropping `company_validations` would delete the validations recorded since the release. Don't do it without owner approval.

## Known limitations (Production)
- A not-yet-read own company shows only the "Read my company" step on the Company page. Its typed profile still feeds the dossier.
- The report's PDF comes from the browser's print dialog only.
- Recovery point: up to about 24 h (daily backups, no PITR), and no restore drill yet.
