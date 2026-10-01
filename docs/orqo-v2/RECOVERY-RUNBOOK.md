# ORQO V2 — Recovery Runbook (Phase 12 readiness)

This is the recovery *readiness* for the current codebase. It does **not** claim that production backups exist: no production hosting was configured or verified in Phase 12. Items marked **Phase 13** need managed-platform configuration.

## 1. Stores

| Store | Role | Authoritative? | Recovery |
|---|---|---|---|
| **PostgreSQL (Supabase)** | All business records: organizations, memberships, companies, Network memory, signals, events, research evidence, opportunities, agent runs, usage, audit | **Yes, the only source of truth** | Managed backups / PITR (**Phase 13: must be enabled and restore-tested**) |
| **Neo4j (optional)** | Per-organization Opportunity Graph projection | No, derived and disposable | Rebuild from PostgreSQL (§4) |
| **In-process memory** | Graph rebuild throttle, last graph error, the `/demo` graph mirror | No | Lost on restart, by design. Nothing to recover |
| **Browser** | `/demo` state (zustand), language/workspace preference cookies | No | Not recovered; `/demo` reloads its deterministic fixture |
| **Supabase Auth** | Accounts and sessions | Yes, for identity | Part of the Supabase project backup (**Phase 13**) |

There is no other datastore: no Redis, no queue and no object storage.

## 2. Schema and migrations

- **Migration-driven schema.** Every schema change is a versioned SQL file in `supabase/migrations/` (8 files at Phase 12). Hand-written reverse scripts live in `supabase/rollbacks/` for 7 of them. The privilege-revocation migration (`…140000_revoke_service_role_table_privileges`) intentionally has none: reversing it would re-grant privileges.
- **Applied with** `bun run db:migrate` and `bun run db:status` (`scripts/db-migrate.ts`, using `SUPABASE_DB_URL`).
- **Phase 12 added no migration.**
- **Failed migration:**
  1. Stop.
  2. Run `db:status` to see what was applied.
  3. If the migration was applied partially, apply the matching `supabase/rollbacks/*` script only after taking a backup/snapshot (Phase 13: PITR).
  4. Never edit an applied migration; write a new one.
- **Before any production migration (Phase 13):** confirm a restorable backup exists, run the migration on a staging copy, and keep the rollback script reviewed.

## 3. Bad deployment (conceptual rollback)

The application tier is stateless; all state is in PostgreSQL.

- **Code-only regression:** redeploy the previous build or commit. No data step is needed.
- **Regression together with a migration:** prefer a forward-fix migration. Use the rollback script only if no data was written in the new shape.
- **Emergency stops** (environment only, no deploy):
  - `ORQO_PROVIDERS_KILL_SWITCH=on`: every paid provider (OpenRouter, Brave) fails closed;
  - `ORQO_LIVE_AI=off`: OpenRouter only;
  - empty `ORQO_RESEARCH_PREVIEW_ORGS` / `ORQO_AGENT_PREVIEW_ORGS`: removes operator preview access;
  - `ORQO_DEMO_LIVE_PROVIDERS` unset: legacy demo routes off (the default).

## 4. Opportunity Graph rebuild

1. Neo4j can be emptied or replaced at any time without data loss.
2. Configure the `NEO4J_*` settings. An admin then opens **Network → Opportunity graph → Build graph from records** for each workspace.
3. The rebuild reads PostgreSQL, upserts nodes and edges, deletes stale ones for that organization only, and writes the marker last. An interrupted rebuild shows as **stale**, never as current.
4. The rebuild is idempotent: running it again produces the same projection (tested).
5. While Neo4j is unavailable, the graph view shows a preview computed from PostgreSQL, and other pages are unaffected.

## 5. Provider outages

| Outage | Behavior | Data impact |
|---|---|---|
| OpenRouter | Deep research and model hypotheses are unavailable (controlled `unavailable`). Basic analysis, Phase 11 briefs, the graph and Network keep working | None. A failed run is recorded as failed, and earlier analyses stay |
| Brave | Deep research search is unavailable | None |
| Official site unreachable | That research run fails (`unreachable`/`timeout`) | The previous stored analysis is kept |
| Neo4j | Graph preview from PostgreSQL. The rebuild fails with a category | None |
| Supabase (DB/Auth) | Workspace pages and API routes error (controlled 5xx / sign-in), never falling back to demo or another tenant. `/demo` keeps working (no DB) | Depends on the platform (**Phase 13**) |

## 6. Test-data safety

- **Destructive suites refuse the real project.** `test:db`, `test:http` and `e2e:*` refuse to run unless `ORQO_DESTRUCTIVE_TESTS_PROJECT` equals the project ref of both the API URL and `SUPABASE_DB_URL` (`tests/support/safety.ts`, unit-tested). It is **unset** in this environment, and the configured project holds real workspaces, so these suites were **not run** in Phase 12.
- **Fictional data only.** Unit tests and the Phase 12 evaluation suite use fictional organizations and ids and never touch a database.
- **Demo fixtures are not production records.** `/demo` runs in the browser on a fictional world, and its graph mirror is in-memory only.

## 7. Phase 13 requirements (not done)

- **Backups:** enable and **restore-test** Supabase backups/PITR, and record the RPO/RTO.
- **Staging:** create an isolated staging/test Supabase project. Run the DB/HTTP/E2E suites there, then rehearse a migration and a rollback.
- **Monitoring:** a production log sink for `[orqo:op]` events, plus alerting on provider failures, spend and 5xx rates.
- **Secret rotation:** a documented procedure for Supabase, OpenRouter, Brave and Neo4j credentials.
- **Graph durability:** move the rebuild throttle and last-error state to durable storage if the app runs on several instances.

## 8. Restore drill (Phase 13 — to execute before real customers; not yet performed)

A restore is only *verified* once this drill has been completed and recorded. Phase 13 has **not** performed it.

1. **Prepare.** In the production Supabase project, confirm backups (and PITR, if the plan includes it) are enabled. Note the newest restore point.
2. **Restore into a scratch project, never into production.** Use the dashboard's restore-to-new-project, or restore a downloaded backup into a new, empty project.
3. **Check the schema.** Point `SUPABASE_DB_URL` at the **scratch** project in a dedicated shell, run `bun run db:status`, and confirm every migration is listed.
4. **Check the data.** Using read-only SQL in the dashboard, compare row counts of `organizations`, `companies`, `contacts`, `interactions`, `company_intelligence` and `audit_events` with production at the restore point. RLS is enabled on every table (`select relname from pg_class where relrowsecurity`).
5. **Rebuild derived state.** If Neo4j is in use, run a graph rebuild against the scratch project only (admin, from a scratch deployment), or simply confirm the graph preview renders.
6. **Record the drill:** date, restore point, duration (RTO), data loss window (RPO), and any problems.
7. **Clean up.** Delete the scratch project; it contains real data.

## 9. Secret compromise

| Secret | Immediate action | Then |
|---|---|---|
| `SUPABASE_SECRET_KEY` | Supabase → API Keys: **roll the secret key**. It is not used by the app runtime, so the app is unaffected | Update operator machines and test files. Review `audit_events` and the Auth logs for the exposure window |
| Database password (`SUPABASE_DB_URL`) | Supabase → Database → reset the password | Update operator shells only (not used by the app) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public by design; RLS protects data. Roll it only if abuse is observed (Supabase → API Keys) | Update Vercel and redeploy (the value is inlined at build time) |
| `OPENROUTER_API_KEY` / `BRAVE_API_KEY` | Set `ORQO_PROVIDERS_KILL_SWITCH=on` and redeploy, then revoke the key in the provider dashboard | Review provider spend and the usage ledger (`usage_events`). Issue a new key only with approval |
| Neo4j password | Rotate it in the Neo4j console. The graph is derived, so delete the instance if in doubt | Rebuild from PostgreSQL |
| A user's session | Supabase → Authentication → the user → sign out / ban | — |

**Never paste a secret into chat, a ticket or a commit. If one was committed:** rotate it first, then purge it from history.

## 10. Emergency provider stop

Set `ORQO_PROVIDERS_KILL_SWITCH=on` in the hosting environment and redeploy.

- **Stays available:** the deterministic features (Basic analysis, Network, Opportunity intelligence, graph preview, Events, `/demo`).
- **Fails closed:** deep research and model-backed agent steps, with "not available on this deployment".
