# ORQO V2 — Isolated Supabase Test Environment (Checkpoint A)

**Purpose:** run the destructive and integration suites (`tests/db`, `tests/http`, `scripts/e2e-app|agents|discover|network`) against a **disposable** Supabase project that contains no real data. These suites create and delete users, organizations and records. They must **never** reach the existing ORQO project.

Status: **runner implemented and unit-tested; the project does not exist yet (human action).**

## 1. What you create (manually, in the Supabase dashboard)

1. **A new project**, for example `orqo-test`, in the same organization or a separate one.
   - It must not be the existing ORQO project.
   - The Free plan is sufficient for tests.
   - Choose a region and a strong database password, and keep the password in your password manager only.
2. **Authentication settings** in the test project:
   - **Email confirmation:** the suites create users pre-confirmed through the admin API and never submit the sign-up form. Either setting works.
   - **Leave SMTP at the default.** No test sends email.
3. **Nothing else.** Don't import data, and don't copy the real project. The schema is created from the repository migrations by the runner (§4, after your approval).

## 2. Values and where they come from

Put them in **`.env.test.local`** at the repository root:

- copy `.env.test.example`;
- the file is git-ignored;
- never share the values in chat.

| Variable | Where in the TEST project | Visibility |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → Data API (project URL `https://<ref>.supabase.co`) | Public by design |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → Publishable key (`sb_publishable_…`) | Public by design |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → Secret key (`sb_secret_…`) | **Server/test only, secret** |
| `SUPABASE_DB_URL` | Connect → **Session pooler** connection string, with the password URL-encoded | **Server/test only, secret** |
| `ORQO_DESTRUCTIVE_TESTS_PROJECT` | The test project's ref (the `<ref>` in the URL above) | Not secret |
| `TEST_PREVIEW_ORG` (optional) | Leave unset (defaults to `7e570000-0000-4000-8000-000000000001`) | Not secret |

**Verifying without showing values:**

```
bun run test:isolated:check
```

It prints only a masked ref (`****abcd`) and either "guard passed, distinct from the real project, paid providers forced off" or a precise refusal. It makes no network call.

## 3. How the test project cannot be confused with the real one

All of these are enforced in code (`tests/support/isolated-env.ts`, `scripts/isolated-test.ts`) and unit-tested (`tests/unit/isolated-env.test.ts`):

1. **Only `.env.test.local` is read.** Every child process runs with `bun --no-env-file`, and the test loader reads only `ORQO_TEST_ENV_FILE`. `.env.local` is never auto-loaded.
2. **Existing guard:** `ORQO_DESTRUCTIVE_TESTS_PROJECT` must equal the project ref of **both** the API URL and the database URL.
3. **Never the real project:** the run is refused if the test ref equals the ref of the real `.env.local` (API or DB URL).
4. **No reused credential:** the run is refused if any Supabase URL or key is byte-identical to the real one.
5. **Synthetic organizations only:** preview and fixture organizations must start with `7e570000-` and must not be real preview organizations.
6. **No fallback:** every variable name known to the app (from the real `.env.local` names and `.env.example`) is set explicitly, to the test value or to empty. Next.js and Bun therefore cannot fall back to `.env.local`.
7. **Paid providers forced off:** kill switch on, OpenRouter/Brave/Neo4j blank, the opt-in live-AI test off.
8. **Isolated app server** (http/E2E):
   - built and started in a **temporary git worktree with no env file**, on port 3100, then removed afterwards;
   - the runner refuses if port 3100 is already in use;
   - your `.next` build and any dev server are untouched.
9. **Nothing printed:** no credential or full project ref is ever printed.

## 4. Commands to run after your approval (Stage F)

In this order, stopping at the first failure:

```
bun run test:isolated:check            # configuration only, no network
bun run test:isolated migrate-status   # read: applied migrations on the TEST project (expect none)
bun run test:isolated migrate          # apply the 8 repository migrations to the TEST project
bun run test:isolated migrate-status   # expect all 8 applied
bun run test:isolated db               # tests/db: schema, RLS isolation, tenancy, auth, persistence, research, network, signals, events, agents, discover, test-safety
bun run test:isolated http             # tests/http (isolated server): API, cross-tenant IDOR, research, agents, discover
bun run test:isolated e2e:app          # browser walk-through (one Basic analysis of a public site; no paid provider)
bun run test:isolated e2e:network
bun run test:isolated e2e:discover
bun run test:isolated e2e:agents
```

**Notes:**

- `e2e:app` performs **one real Basic analysis** of a public official website (`E2E_ANALYSIS_DOMAIN`, default set in the script). That is a few page fetches and no paid provider.
- **Reset:** delete and re-create the test project, or drop its `public` schema, then run `migrate` again.
