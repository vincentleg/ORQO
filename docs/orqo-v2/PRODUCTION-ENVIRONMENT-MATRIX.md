# ORQO V2 — Production Environment Matrix (Phase 13)

This document lists every environment variable referenced by the application, the tests or the scripts. **Values are never written here.**

- **Public:** inlined into the browser bundle (`NEXT_PUBLIC_*`).
- **Server:** read only on the server, never sent to the browser.
- **Build-time:** `NEXT_PUBLIC_*` values are inlined at **build** time. Changing them requires a rebuild.

## Application (production deployment)

| Variable | Purpose | Public / server | Production | Provider | If missing | Variable cost? | Write/admin capability? |
|---|---|---|---|---|---|---|---|
| `ORQO_SITE_URL` | Canonical public origin. Used for the sign-up confirmation link and to decide Secure cookies | Server (not secret) | **Required** | — | Sign-up refused with "not available on this deployment". Cookies default to Secure | No | No |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL | **Public** (build-time) | **Required** | Supabase | Accounts unavailable (controlled 503); `/demo` still works | No | No (RLS) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (`sb_publishable_…`) | **Public** (build-time) | **Required** | Supabase | Same as above | No | No (RLS protects every table) |
| `OPENROUTER_API_KEY` | Model gateway for deep research / model hypotheses | Server, **secret** | Optional (leave unset at launch) | OpenRouter | Deep research reads "not available on this deployment" | **Yes** | No |
| `ORQO_LIVE_AI` | `off` disables OpenRouter even with a key | Server | Optional | — | Enabled when a key exists | — | No |
| `ORQO_DISCOVERY_MODEL`, `ORQO_MODEL_EXTRACTION`, `ORQO_MODEL_SYNTHESIS`, `ORQO_MODEL_REASONING`, `ORQO_MODEL_CRITIQUE` | Model choice per task | Server | Optional | OpenRouter | Default model | Indirectly | No |
| `BRAVE_API_KEY` | Web search for deep research | Server, **secret** | Optional (leave unset) | Brave | Deep research unavailable | **Yes** | No |
| `ORQO_PROVIDERS_KILL_SWITCH` | `on` makes OpenRouter and Brave read as unconfigured | Server | **Recommended `on` at launch** | — | Off (normal gating) | Stops cost | No |
| `ORQO_DEMO_LIVE_PROVIDERS` | `on` enables legacy demo routes that spend credits without a plan or quota | Server | **Must stay unset** | OpenRouter/Brave | Legacy routes refuse (503) | **Yes** if on | No |
| `ORQO_RESEARCH_PREVIEW_ORGS` | Operator preview for deep research (comma-separated org UUIDs) | Server | Optional; empty at launch | — | No preview | **Yes** for listed orgs | No |
| `ORQO_AGENT_PREVIEW_ORGS` | Operator preview for agent execution | Server | Optional; empty at launch | — | Agents locked (Free) | Indirectly | No |
| `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, `NEO4J_DATABASE` | Optional derived Opportunity Graph store | Server, **password secret** | Optional (unset → preview from PostgreSQL) | Neo4j | "Graph preview — Neo4j not configured" | Hosting cost only | Writes the derived projection only (admin rebuild) |
| `NODE_ENV` | Set by the platform (`production`) | — | Platform | — | — | — | — |

**Legacy aliases** (accepted, not needed): `OPENROUTER_MODEL`, `BRAVE_SEARCH_API_KEY`, `NEO4J_USER`.

**Status only:** `BAND_API_KEY` is only reported as a boolean by `/api/status`. There is no integration, so leave it unset.

## Never in the application deployment

| Variable | Why |
|---|---|
| `SUPABASE_SECRET_KEY` | Bypasses RLS. The runtime never reads it (static test). It is used only by operator scripts and test suites |
| `SUPABASE_DB_URL` | Direct database credentials, used by `bun run db:migrate` (operator machine) and the test suites. Not needed by the app |

## Tests and operator tooling only

| Variable | Where | Notes |
|---|---|---|
| `ORQO_DESTRUCTIVE_TESTS_PROJECT` | `.env.test.local` | Must equal the **isolated test** project ref. Never set it in a shell or file that targets the real project |
| `TEST_PREVIEW_ORG` | `.env.test.local` | Synthetic `7e570000-…` organization only |
| `ORQO_TEST_ENV_FILE` | Set by `scripts/isolated-test.ts` | Makes the test loader read only `.env.test.local` |
| `BASE_URL` | Set by the runner (`http://localhost:3100`) | HTTP/E2E target |
| `E2E_ANALYSIS_DOMAIN` | Optional | Public site used by one E2E basic analysis (no paid provider) |
| `ORQO_TEST_LIVE_AI` | Optional | Opt-in real OpenRouter test. **Forced off** by the isolated runner |

## Rules (implemented and tested)

- **Browser exposure:** only the two `NEXT_PUBLIC_SUPABASE_*` values reach the browser (static test).
- **No privileged reads at runtime:** the runtime never reads `SUPABASE_SECRET_KEY` or `SUPABASE_DB_URL` (static test).
- **Fail-closed providers:** every paid provider fails closed when absent, and the kill switch overrides keys (tests).
- **No demo fallback:** production never falls back to demo credentials. Missing Supabase settings give a controlled "accounts not available"; `/demo` uses no credentials at all.
- **Committed files:** `.env*` are git-ignored except `.env.example` and `.env.test.example` (placeholders only).
