# ORQO V2 — Phase 2 Implementation Report

## 1. Status

**Complete.** The product shell, design system and entitlement-aware presentation are implemented. This branch is ready for human review; it is not merged and not pushed.

## 2. Baseline

`main` @ `e304fd0` (Merge Phase 1 SaaS foundation). The working tree was clean at the start.

## 3. Branch

`phase-2-shell-design-system`

## 4. What changed

- The production app is now an ORQO shell. **Search is the home**, and the six principal spaces plus three secondary areas are navigable.
- A light, token-based design system for production. The demo's dark theme is untouched.
- A typed **Free / Pro / Business** presentation model with reusable locked-feature UX and a Plans page. There are no prices, no quotas and no checkout.
- Deterministic Search: input parsing plus "already in your Network?". **Add to Network** and a **Company profile** (own company) write real data under RLS.
- FR/EN for all new UI. The landing, auth and onboarding screens are restyled to the light system.

## 5. Information architecture

Every space lives under `/workspace/*`, which the Phase 1 proxy and page guards already protect, so no routing or auth changes were needed.

| Space | Route | Phase 2 content |
| --- | --- | --- |
| **Search** (home) | `/workspace` | Search field (name or URL), company context, result shell |
| Discover | `/workspace/discover` | Category chips, run controls (disabled), empty state, locked Prospecting missions |
| Network | `/workspace/network` | **Real** company list + add form; relationship-memory placeholder |
| Intelligence | `/workspace/intelligence` | Change → Signal → Re-evaluation → Opportunity → Action chain; empty state; locked monitoring |
| Agents | `/workspace/agents` | Orchestrator → Managers → Specialists; catalog of 12 agents with plan state; Missions placeholder |
| Dashboard | `/workspace/dashboard` | **Real** counts; deterministic Next Best Action; empty sections |
| Company · Plans · Settings | `/workspace/{company,plans,settings}` | Own-company profile; plan comparison; account (language), workspace (role, members), plan |

- Signed-in visitors to `/` are redirected to Search.
- Legacy redirects (`/network` → `/demo/network`, …) are kept. Product spaces don't collide with them, because they live under `/workspace`.

## 6. Search home

The home is the centered prompt **"What business are you looking for?"**, a large search field, and the line "Compared with {own company}" (or a link to set up the Company profile). A search result shows:

- the detected target (website domain or company name);
- a real **in your Network / not yet** check, with **Add to Network** for members and above;
- a clearly labeled **Company analysis — Coming soon** card that lists the questions the analysis will answer, plus the FACT / INFERENCE / ASSUMPTION / UNKNOWN legend;
- a locked **Deep research** card (Pro).

Parsing (`lib/search/query.ts`) is pure. No query reaches an AI or web provider, and no result is fabricated.

## 7. Design system

- **Tokens** (`globals.css`): canvas, surface, subtle, edge, fg, brand and status colors, and card/raised shadows. They are named separately from the demo tokens. The theme is enabled by `.orqo-light`, and `html/body:has(.orqo-light)` switches the page background.
- **`components/orqo/`**, all server-safe except `shell-client.tsx`:
  - `ui.tsx`: Button, ButtonLink, Field, TextArea, Card, CardHeader, Badge, PageHeader, Page, Section, EmptyState, Skeleton, ListRow, Monogram, Stat, and a focus ring.
  - `shell.tsx` / `shell-client.tsx`: AppFrame with sidebar, mobile top nav, workspace switcher, plan badge, EN/FR switch and sign-out. The nav marks the current page with `aria-current`.
  - `plan.tsx`: PlanBadge, AccessBadge, UpgradeLink, FeatureCard.
  - `patterns.tsx`: RunControls (last run / status / Refresh / Find more, disabled with a reason), EvidenceLegend, NextBestAction.
  - `icons.tsx`: 16 inline SVG icons (no new dependency).
- The layout is desktop-first with a mobile top nav below `md`. There is no horizontal overflow at 390 px.

## 8. Free / Pro / Business presentation architecture

- `lib/entitlements/plans.ts` holds `Plan`, `planAtLeast`, and the `FEATURES` registry (`minPlan` + `availability: available | coming_soon`).
- `featureAccess(plan, feature)` returns `available | coming_soon | locked` together with the required plan. A plan gap wins over "coming soon".
- `USAGE_UNITS` are business units: agent runs, deep research runs, prospecting missions, monitored companies, active agents, automated workflows.
- `PLAN_COMPARISON` gives qualitative levels only (Essentials / Included / Expanded / Advanced…). It contains **no numbers and no prices**.
- `lib/entitlements/agents.ts` is the agent catalog, with tier and feature per agent.
- **Free** keeps Search, Network, Dashboard, Company, the Relationship Agent (it will build on the existing deterministic engine) and the essentials of Discover and Intelligence. Every Free feature is designed to run without open-ended paid model calls.
- **Pro** unlocks the specialist agents (Research, Prospecting, Follow-up, Signal, Event, Sales), limited Custom agents, deep research and monitoring.
- **Business** adds the Orchestrator, Partnership, Technical and Market agents, and team controls.
- **Presented plan:** `lib/server/entitlements.ts#getPresentedPlan` returns `"free"` for every workspace. It is documented as presentation-only, and its signature is meant to be kept when billing makes it authoritative. The module header records the mandatory future server chain: auth → org → plan → entitlement → quota → rate limit → cost budget → agent authorization → model router → provider.
- Components never compare plan strings; they call `featureAccess`. The ESLint domain boundary now also covers `lib/entitlements` and `lib/search`.

## 9. Premium / locked UX

`FeatureCard` shows a lock icon, what the feature does, "Available with {plan}", an sr-only reason ("Not part of the Free plan") and an **Upgrade to {plan}** link to `/workspace/plans`. Locked-card CTAs use the secondary button style, so the grid does not read like an advertisement.

On Plans, the current plan is marked, and the other plans show a **disabled "Upgrades open soon"** button next to a note saying that pricing, checkout and allowances don't exist yet.

Entitled but unbuilt features show "Coming soon". No agent can present as runnable (unit and E2E asserted).

## 10. i18n

- About 190 new keys are in `messages/en.ts`. `fr.ts` must `satisfies Messages`, so a missing key fails compilation.
- The in-house translator is unchanged, and no second i18n system was added.
- The new EN/FR segmented switch reuses `setLocaleAction` (profile + cookie). The Settings page keeps the Phase 1 select.
- `<html lang>` follows the locale.
- Brand and plan names are not translated. Plan names stay Free / Pro / Business in FR.

## 11. Security preservation

- No change to migrations, RLS, roles, the proxy, the auth flows or the API routes.
- Every page calls `loadWorkspace()`: `requireWorkspace` memoized per request with React `cache`. The layout is not treated as the auth boundary.
- The new `createOwnCompanyAction` re-verifies the user and requires the `member` role on the target org. The database still enforces one own company per org.
- `addCompanyAction` changed only its revalidation scope.
- No privileged keys are used in the app. No secrets are tracked (only `.env.example`), and the diff contains no provider calls.

## 12. Demo preservation

`/demo` code is untouched, apart from the additive CSS tokens it doesn't use; it stays dark and English. The manual demo E2E and the Auto Demo E2E pass with no console errors (§13).

## 13. Tests executed / results

| Check | Result |
| --- | --- |
| `bun run typecheck` | ✅ 0 errors |
| `bun run lint` | ✅ 0 problems |
| `bun run test` | ✅ 38/38 (26 Phase 1 + 12 new: plans/entitlements 7, search parsing 5) |
| `bun run build` | ✅ 34 routes |
| `bun run e2e:app` (real Supabase, `next start`) | ✅ all checkpoints, no console errors. Covers: login redirect, onboarding, Search home, **six spaces with `aria-current`**, company profile, Search → Add to Network → "Already in your Network", Network persistence across reload, **Prospecting Agent locked on Free → Upgrade to Pro → Plans (upgrade disabled)**, no agent "available", Dashboard next action, FR switch with `html lang=fr`, FR Agents/Search, sign-out, FR wrong password, public EN/FR switch, demo signed-out |
| `bun run e2e` (manual demo) | ✅ passed, no console errors |
| `bun run e2e:autodemo` | ✅ passed, no console errors |
| Narrow viewport (390 px), ad-hoc | ✅ no horizontal overflow, no console errors |
| `test:db` / `test:http` | Not rerun: no schema, RLS, API or auth changes in this phase. Phase 1 results (113/113, 24/24) stand |

## 14. Known limitations

- The presented plan is always Free, because there is no billing. The Pro/Business unlocked states are covered by unit tests, not visually.
- The Company profile can be created but not edited yet. The rich Company Context comes with Phase 3.
- The Network shows companies only. Contacts, relationships and timelines have schema and API support but no UI yet.
- The search placeholder truncates on very narrow screens.
- After "Add to Network", the page revalidates straight to "Already in your Network", so the transient confirmation is rarely visible.
- The `tabs:outgoing.message.ready` browser message from Phase 1 did not appear in headless runs. It is still treated as extension-related and deferred.

## 15. Deferred future-phase work

Web research and company analysis (Phase 3), agent execution, missions and `agent_runs` (Phase 4), discovery and prospecting (Phase 5), relationship timelines and follow-ups (Phase 6), signals (Phase 7), authoritative billing and entitlements with quotas, usage and cost ledgers, rate limits, budgets and kill switches (a later phase, before any paid agent route exists), invitations and member management, and a mobile app.

## 16. Files / areas materially changed

- `src/app/workspace/**` (layout + 9 pages), `src/app/{page,not-found,login/page}.tsx`, `src/app/actions/workspace.ts`, `src/app/globals.css`
- `src/components/orqo/*` (new), `src/components/saas/{forms,frame}.tsx`
- `src/lib/entitlements/*`, `src/lib/search/*` (new, with tests)
- `src/lib/server/{workspace,entitlements}.ts`, `src/lib/server/repositories/overview.ts` (new)
- `src/lib/i18n/messages/{en,fr}.ts`, `eslint.config.mjs`, `scripts/e2e-app.ts`, `README.md`

## 17. Git commits

See `git log e304fd0..phase-2-shell-design-system`: the shell and design system, then the review polish, E2E and docs.

## 18. Phase 3 readiness

Ready. Phase 3 plugs into:

- the Search result's "Company analysis" card and `search.companyAnalysis` / `search.deepResearch`;
- the Company profile, to extend into the Company Context;
- `RunControls` and `EvidenceLegend`, for real runs and evidence.

Before any paid route ships, `getPresentedPlan` must become an authoritative server lookup, with quota and budget enforcement in the route handler.
