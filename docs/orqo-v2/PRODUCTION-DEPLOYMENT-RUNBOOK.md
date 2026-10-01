# ORQO V2 — Production Deployment Runbook (Phase 13)

**Target:** Vercel for the Next.js application, plus a **new** production Supabase project (or an explicitly approved existing one), with no paid provider at launch.

Every step marked ⛔ needs an explicit human approval checkpoint. Values are never pasted into chats, tickets or commits. Variable names and where to set them are in `PRODUCTION-ENVIRONMENT-MATRIX.md`.

---

## PRE-DEPLOY

1. **Clean main.** `git status` is clean, and `main` equals `origin/main` and contains the release commit.
2. **Local verification**, all green:
   - `bun test src tests/unit`;
   - `bun run typecheck`;
   - `bun --bun eslint src scripts tests next.config.ts`;
   - `bun run build`.
3. **Isolated suites** (`ISOLATED-TEST-ENVIRONMENT.md`, ⛔ checkpoint A): `db`, `http`, `e2e:*` all green against the isolated project. Record the counts.
4. **Production Supabase project** ⛔:
   - plan with daily backups;
   - PITR if required;
   - region;
   - strong database password stored in a password manager.
5. **Migrations** ⛔: from the operator machine, using only the git-ignored `.env.orqo-production`:
   - `bun run prod:db check` (guard, offline);
   - `bun run prod:db inspect` (read-only state);
   - `bun run prod:db apply --confirm=<last4>`;
   - `bun run prod:db inspect` (expect all migrations applied, RLS on every table).

   Never use `db:migrate` / `db:status` for production (they auto-load `.env.local`), and never point `ORQO_DESTRUCTIVE_TESTS_PROJECT` at production. *Phase 13 Stage G: the initial 8 migrations were applied this way.*
6. **Supabase Auth settings** ⛔, on the production project:
   - **Site URL** = the production origin.
   - **Redirect allow-list:** `https://<prod-origin>/auth/callback` and `https://<prod-origin>/auth/confirm`, plus a preview origin only if previews are used for sign-in.
   - Email confirmation on.
   - **Custom SMTP.** The default Supabase email service is for testing and is rate-limited.
   - Review the auth rate limits and the minimum password length.
7. **Vercel project** ⛔:
   - Framework: Next.js.
   - Install command: `bun install`.
   - Build command: `bun run build` (`bun --bun next build`). The runtime is the Vercel Node.js runtime. *A plain Node build was not verifiable locally; verify it on the first preview build.*
   - **Function duration:** research and agent routes declare `maxDuration` 120–150 s, so the plan must allow at least 150 s.
8. **Environment variables in Vercel** ⛔ (Production scope):
   - `ORQO_SITE_URL`;
   - `NEXT_PUBLIC_SUPABASE_URL`;
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`;
   - `ORQO_PROVIDERS_KILL_SWITCH=on`.

   **Not set:**
   - `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL`;
   - `OPENROUTER_API_KEY`, `BRAVE_API_KEY`;
   - `NEO4J_*`;
   - `ORQO_*_PREVIEW_ORGS`;
   - `ORQO_DEMO_LIVE_PROVIDERS`.

   **Note:** `NEXT_PUBLIC_*` values are inlined at build time, so redeploy after changing them.
9. **Backups** ⛔: confirm the backup schedule in the dashboard. Run a **restore drill** into a scratch project before real customers (`RECOVERY-RUNBOOK.md` §8).
10. **Monitoring:**
    - Vercel runtime logs capture the structured `[orqo:op]` lines: provider calls, graph rebuilds, `request.refused`, `auth.*`, `agent.run`, `csp.report_only_violation`.
    - An external log drain or alerting is ⛔ optional and not configured.
11. **Domain/DNS** ⛔ (optional at first): the `*.vercel.app` URL is acceptable for a closed review.

## DEPLOY

1. ⛔ Deploy from `main`, with a preview first if possible.
2. Migration order: **database migrations first, then the application.** All migrations so far are additive.
3. **Health:**
   - `GET /api/status` returns 200 (booleans only);
   - `GET /login` returns 200;
   - `GET /workspace` signed out redirects (307) to `/login?next=%2Fworkspace`.
4. **Headers** (`curl -sI https://<prod>/login`):
   - `Strict-Transport-Security` (sent by Vercel; verify it is present);
   - `X-Frame-Options: DENY`;
   - `Content-Security-Policy` (frame-ancestors…);
   - `Content-Security-Policy-Report-Only`;
   - `X-Content-Type-Options: nosniff`;
   - `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`;
   - **no** `X-Powered-By`.

## POST-DEPLOY (⛔ public smoke review; fictional account only)

1. **Sign-up and sign-in** with a fictional reviewer account.
   - The confirmation email link points to `ORQO_SITE_URL`.
   - Session cookies show `Secure` in DevTools → Application.
2. **Workspace isolation:** two fictional accounts in two workspaces cannot see each other's companies.
3. **Search (Free):** one Basic analysis of a public site. Deep research shows Pro-locked.
4. **Network:** add the company, open its page; relationship next action and Opportunity intelligence render.
5. **Opportunity Intelligence:** a truthful weak or partial state, and no "Confidence".
6. **Graph:** "Graph preview — Neo4j not configured".
7. **Intelligence, Events, Agents** (locked / coming soon) and **Plans** (Free; no checkout).
8. **FR/EN** switch.
9. **`/demo`:** loads without sign-in and is isolated.
10. **Security headers** as above. `/login?next=%2F%09%2Fevil.example` → after sign-in, lands on `/workspace`.
11. **Logs:**
    - `[orqo:op]` lines present;
    - no contact data, notes, prompts, tokens or emails in logs;
    - no `csp.report_only_violation` from real pages.

    Investigate any report before enforcing the CSP.

## ROLLBACK

- **Application:** Vercel → Deployments → promote the previous production deployment (instant). The database is unaffected.
- **Database migration:** prefer a forward fix. Use `supabase/rollbacks/<migration>.down.sql` only if no data exists in the new shape, after a backup/PITR snapshot.
- **Provider shutdown:** set `ORQO_PROVIDERS_KILL_SWITCH=on` and redeploy, or remove the provider keys. Remove the preview org lists.
- **Graph:** Neo4j is derived. Empty or remove it; the app falls back to the preview. Rebuild from PostgreSQL when configured.
- **Secret compromise:** see `RECOVERY-RUNBOOK.md` §9.
- **Incident notes:** record the time, the deployment id, the action taken, the affected workspaces (ids only), and follow-ups.

## Enforcing the CSP (later, reviewed step)

The CSP runs **report-only** (`Content-Security-Policy-Report-Only`), and reports go to `/api/csp-report`. After a production observation period with **no unexplained `csp.report_only_violation` events**, propose moving the same policy to the enforced header. A nonce-based script policy remains a separate decision, because it requires dynamic rendering.
