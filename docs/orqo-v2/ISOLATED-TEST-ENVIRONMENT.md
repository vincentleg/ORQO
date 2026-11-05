# ORQO V2 — Isolated Test Database

**Purpose:** run the destructive and integration suites (`tests/db`, `tests/http`, `scripts/e2e-*`) against a **disposable** PostgreSQL database that holds no real data. These suites create and delete users, organizations and records. They must **never** reach a database with real workspaces or production.

Recovery (Nov 2026): Supabase was removed. The test database is any PostgreSQL 15+: a separate free **Neon** project (`orqo-test`) or a local PostgreSQL. The previous Supabase-based procedure is in git history.

## 1. Values

Put them in **`.env.test.local`** (git-ignored; copy `.env.test.example`). Never share them in chat.

| Variable | Value | Visibility |
|---|---|---|
| `DATABASE_URL` | Neon `orqo-test` project → Connect → **pooled** connection string; or `postgres://user:pw@localhost:<port>/<db>` | **Secret** |
| `ORQO_DESTRUCTIVE_TESTS_PROJECT` | The database identity: the Neon endpoint id (`ep-…`, the first label of the host, without `-pooler`), or `local-<port>-<db>` | Not secret |
| `TEST_PREVIEW_ORG` (optional) | Leave unset (defaults to `7e570000-0000-4000-8000-000000000001`) | Not secret |

Another git-ignored file can be used with `ORQO_ISOLATED_ENV_FILE=.env.test.<name>.local` (for example a local PostgreSQL); every guard applies unchanged.

## 2. Guards (unchanged in substance since Phase 13)

`bun run test:isolated:check` validates without printing values. The runner refuses when:
- `ORQO_DESTRUCTIVE_TESTS_PROJECT` does not equal the identity of `DATABASE_URL`;
- the database is the one in `.env.local` (development) or in `.env.orqo-production` (production), whether through the pooled or the direct host;
- a credential is identical to a development or production value;
- stale Supabase variables point elsewhere;
- a preview/Internal organization id is not in the reserved `7e570000-` namespace, or is a real one.

Every known variable is set explicitly (no fallback to `.env.local`), paid providers are forced off (kill switch on, keys blank), and http/e2e servers are built from a clean worktree of `HEAD` with no env file.

## 3. Commands

```
bun run test:isolated migrate          # apply repository migrations to the TEST database
bun run test:isolated db               # tests/db (accounts, RLS isolation, persistence, governance, missions, …)
bun run test:isolated http             # tests/http against an isolated server
bun run test:isolated e2e:journey      # registration → workspace → research → track → persistence → isolation → mobile
bun run test:isolated e2e:app|e2e:opportunities|e2e:work|e2e:network|e2e:discover|e2e:agents|e2e:governance|e2e:missions|e2e:understanding
```

## 4. Local PostgreSQL (no account needed)

The owner must NOT be a superuser (superusers bypass RLS; Neon's owner is not one either):

```
createdb orqo_test
psql -c "create role app_owner login createrole password '<local only>'" -c "alter database orqo_test owner to app_owner"
psql -d orqo_test -c "alter schema public owner to app_owner"
# .env.test.pg.local
DATABASE_URL=postgres://app_owner:<local only>@localhost:5432/orqo_test
ORQO_DESTRUCTIVE_TESTS_PROJECT=local-5432-orqo_test
ORQO_ISOLATED_ENV_FILE=.env.test.pg.local bun run test:isolated migrate
```
