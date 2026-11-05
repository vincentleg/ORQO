# ORQO — Recovery, November 2026 (Supabase removal → PostgreSQL/Neon)

**Status: production restored on 5 Nov 2026** — see §6 (verification), §7 (deployment) and §8 (open items). This document is the current operational reference for
the backend; Supabase-era runbooks are marked as superseded.

## 1. What happened

- All three Supabase projects (Production, Dev, Test) were removed by the owner after unexpected charges. Their
  hostnames no longer resolve (NXDOMAIN, verified 5 Nov 2026). No backup existed outside Supabase.
- Production (`orqo-jet.vercel.app`, Phase 16) kept serving the landing page and the demo, but every sign-in failed
  ("Something went wrong"), and the failure was logged only as a warning.
- Lost production data (from the Phase 16 release record): 1 user, 1 organization, 2 companies, 7 research
  records, 147 evidence items, 1 tracked opportunity. Public-company research can be regenerated (Basic research).

## 2. Architecture now

```
Browser ──HTTPS──> Next.js 16 on Vercel (Hobby, cle1) ──TLS verify-full, pooled──> Lakebase Postgres 18 on Neon (Free, aws-us-east-2)
                   │                                              ├─ schema public  (unchanged Phase 1–17 schema, 91 RLS policies)
                   │  every user query: BEGIN;                    └─ schema auth    (users, sessions, rate_limits)
                   │   set_config('role','authenticated',true);
                   │   set_config('request.jwt.claim.sub',<user>,true);
                   │   <one statement>; COMMIT
                   └─ accounts/sessions: owner connection, auth.* only (src/lib/server/auth/accounts.ts)
```

- **Schema:** `supabase/migrations/20260930110000_platform_auth_compat.sql` recreates on plain PostgreSQL the four
  Supabase pieces the schema depends on (roles `anon`/`authenticated`/`service_role` with Supabase's default
  privileges, `auth.users`, `auth.uid()`). The 12 phase migrations apply **unchanged** (no-op on Supabase).
- **Data access:** `src/lib/server/db/` — a PostgREST-compatible builder (the supabase-js subset ORQO uses) compiled
  to parameterized SQL; PostgreSQL serializes results with `json_agg` exactly like PostgREST. Repositories and
  business logic are unchanged.
- **Tenant isolation:** still enforced **in the database** by RLS. Each statement runs as role `authenticated` with
  `auth.uid()` = the session's user; settings are transaction-local, so the Neon pooler never leaks an identity.
  20 s statement timeout.
- **Accounts:** scrypt (N=2^15, r=8) password hashes; 256-bit opaque session tokens, stored as SHA-256; httpOnly,
  SameSite=Lax, Secure cookie `orqo_session`, 30 days; sign-out deletes the session. Throttling (hashed keys only):
  sign-in 10 per email and 50 per client per 15 min; sign-up 5 per client per hour and 50 per day overall
  (`ORQO_SIGNUP_PER_CLIENT_HOURLY`, `ORQO_SIGNUP_DAILY_CAP`); `ORQO_SIGNUP=closed` closes registration.
- **No email provider:** addresses are not verified and there is no password reset by email yet (§10).
- **Proxy:** no network call (redirects signed-out visitors only); pages and APIs verify the session in the DB.
- **Outages:** reported to the user as "temporarily unavailable" (error boundary, sign-in/up messages) and logged
  at ERROR level (`[orqo:op] … "outcome":"unavailable"`).

## 3. Environment variables

| Variable | Where | Notes |
|---|---|---|
| `DATABASE_URL` | Vercel Production (branch `production`) and Preview (branch `test`), `.env.orqo-production`, `.env.test.local` | Neon **pooled** string, Sensitive. Read only by `src/lib/server/db/config.ts`, which forces `sslmode=verify-full` |
| `DATABASE_URL_UNPOOLED` | `.env.orqo-production` | Direct string for migrations/inspection (`prod:db`); must be the same endpoint |
| `ORQO_SITE_URL` | Vercel Production | Canonical https origin |
| `ORQO_PROVIDERS_KILL_SWITCH=on` | Vercel | Paid providers (OpenRouter, Brave) off: zero AI spend |
| `ORQO_SIGNUP`, `ORQO_SIGNUP_DAILY_CAP`, `ORQO_SIGNUP_PER_CLIENT_HOURLY` | optional | Registration policy |
| `ORQO_PRODUCTION_PROJECT` | `.env.orqo-production` | Neon endpoint id (`ep-…`) of production; guards operator tooling |
| `ORQO_DESTRUCTIVE_TESTS_PROJECT` | `.env.test.local` | Neon endpoint id of the TEST database |

`NEXT_PUBLIC_SUPABASE_*` are no longer read anywhere (a security test asserts that no `NEXT_PUBLIC_` variable exists).

## 4. Procedures

- Create schema on a new database: `bun run prod:db status` (read-only) → `bun run prod:db apply --confirm=<last4>`.
- Tests: `docs/orqo-v2/ISOLATED-TEST-ENVIRONMENT.md`.
- Deploy: `vercel deploy` (preview, test DB) → `vercel curl` checks → `vercel deploy --prod` from a clean worktree of
  the verified commit → `BASE_URL=https://orqo-jet.vercel.app bun scripts/e2e-journey.ts`.
- Backups (Neon Free keeps 6 h of history only): `pg_dump --format=custom "$DATABASE_URL" > orqo-YYYYMMDD.dump`
  regularly, stored outside Neon (§10).

## 5. Costs and limits (official pages, checked 5 Nov 2026)

| Service | Plan | Cost | Limits that matter | When exceeded |
|---|---|---|---|---|
| Neon | Free (no card) | $0 | 100 CU-hours/project/month, 0.5–2 CU autoscale, scale to zero after 5 min idle, 1 GB storage/project, 5 GB egress, 6 h restore history | Compute suspended / writes blocked until next month — **never billed** |
| Vercel | Hobby | $0 | 4 active-CPU h, 1 M invocations, 100 GB transfer per month; **non-commercial use only** | Feature paused (no bill) |
| OpenRouter, Brave | — | $0 | Kill switch on; no key configured | Deep research and paid agents are refused with a clear message |

The database is woken only by requests that carry a well-formed session cookie (or Bearer token) and by account
actions (sign-in/up): without one, the proxy, landing page, demo and `/api/status` never query it, so bots on
public pages cannot burn the compute quota.

## 6. Neon project and tooling

- Project `ORQO` (`falling-term-87383693`), org `org-frosty-frost-01651352`, **Free plan** (`neon me`), Postgres 18,
  `aws-us-east-2`. Branches: `production` (default; the app) and `test` (0.25–1 CU, scale to zero; all
  destructive suites). Local `.env.local` deliberately holds **no** production URL (a dev server must not write to
  production); use `neon checkout dev --create --no-env-pull` for a development branch.
- `neon init` (Claude Code): skills `neon` and `neon-postgres` (`.claude/skills`, `skills-lock.json`), Neon MCP
  server for this project with OAuth only (`.mcp.json`, no key), `.neon` link (git-ignored), `neon.ts` declaring
  Postgres only. `neon config plan` / `neon deploy --no-env-pull`: no change, no paid service.
- Vercel guidance followed: `pg` pool + `attachDatabasePool` (Fluid compute); functions in `cle1`, next to Neon.

## 7. Verification (5 Nov 2026)

| Gate | Result |
|---|---|
| Typecheck, lint, production build | Pass |
| Unit + training tests | 724 + 54 pass |
| `bun audit --audit-level=high` | Pass (one moderate, dev-only `minimatch` in ESLint) |
| DB/RLS integration, local PostgreSQL 17 (non-superuser owner) | 267/267 |
| DB/RLS integration, **Neon test branch** (Postgres 18) | **267/267** |
| HTTP API suite (isolated server) | 89/89 |
| Browser E2E, 10 suites (journey, app, opportunities, work, network, discover, agents, governance, missions, understanding) | All pass, no console errors |
| Preview `dpl_4CFPdQFyZMjTaZMQYNGzsRTF78K6` (Neon test branch), via `vercel curl` | status/login/signup/demo 200, workspace → login, API 401 signed out; authenticated: session, create workspace, create + read back company, other account 404, forged token 401 |
| Production schema (branch `production`) | 13/13 migrations; 34 tables, all RLS, 91 policies |
| **Production** `orqo-jet.vercel.app`, browser journey | Registration → workspace → profile → company → Basic analysis → sign-out/in persistence → cross-account isolation → mobile 390 px: **pass**, no console error, no 5xx in logs |

## 8. Open items (honest limits)

1. **No email**: addresses are not verified; no password reset by email. Needs an email provider (free tiers
   exist but require an account) — owner decision.
2. **AI**: kill switch on, no OpenRouter/Brave key → Deep research and paid agents refuse with a clear message.
   Everything deterministic works (Basic research, dossier, critic, scenarios, tracking, CEO, signals, events,
   network). Enabling AI = a paid key and a budget: owner decision.
3. **Plans**: billing does not exist; every workspace is Free, so Pro/Business agents stay locked (operator
   allowlists `ORQO_AGENT_PREVIEW_ORGS` / `ORQO_INTERNAL_ORGS` unlock specific workspaces, governed, $0 with the
   kill switch on).
4. **Vercel Hobby is non-commercial**: charging users requires Vercel Pro.
5. **Backups**: Neon Free keeps 6 h of history; run a regular `pg_dump` of `DATABASE_URL_UNPOOLED` to storage you own.
6. **Smoke data in production**: the journey creates accounts on reserved `orqo-smoke-…@example.com` addresses
   with a "Journey …" workspace; they can be removed by the operator.
7. Supabase-era data is not recoverable from this side (see §1); ask Supabase support if needed.
