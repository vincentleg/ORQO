# ORQO — Guided tour (November 2026)

One click on **Open the demo** (home page, sign-in page, workspace footer) opens `/tour`, and ORQO plays a complete
business-development case by itself: **45 scenes in 14 stages, 5 seconds each (6 s for the last), about 3 min 47 s.**
No account, no choice, no click is needed; pause, back, skip, replay and exit are optional (also Space, ←, →, Esc).

## What is real and what is prepared

| Part | Source |
|---|---|
| INFODIP | Capabilities INFODIP describes publicly (OEM/ODM integration for Europe/EMEA). No customer, price, contact or unpublished information |
| Northvale Edge Systems | **Fictional** American edge-AI appliance company (`northvale-edge.example`), labelled "Fictional company" wherever it appears |
| Research results | Prepared, reproducible evidence (one official page per company), labelled "Prepared demo evidence" |
| Business DNA, market model, partnership ideas, critic, dossier, comparison, opportunity map, proposal | **Computed by the product engine** (`src/lib/tour/scenario.ts` calls `understandCompany` / `companyDossier`), rendered with the product's own components read-only |
| Action plan | Built from the dossier's questions, the mechanism's lowest-cost test and revenue structure; suggested roles are labelled suggestions |
| Monitoring timeline | **Illustrative** events (labelled). Implemented today: re-analysis signals. Planned: continuous monitoring |

`src/lib/tour/scenario.test.ts` pins every claim the tour makes to the engine's output.

## Architecture

- `src/lib/tour/script.ts` — the scenes (title, explanation, visual action, view, semantic cursor target, typing, reveal).
- `src/lib/tour/machine.ts` — pure playback state machine; ticks clamped to 100 ms and paused while the tab is hidden,
  so no scene is ever skipped; the last scene holds.
- `src/components/tour/player.tsx` — one `requestAnimationFrame` loop; React re-renders only when something visible
  changes; cursor and spotlight follow `data-tour` / `data-testid` / `data-section` / `data-map-node` selectors,
  re-measured every frame (any screen size). Reduced motion: no travel, no smooth scroll, no transitions.
- `src/components/tour/views.tsx` — the ORQO interface per stage, from product components.
- `/tour` is a static page: no session, database, provider or request. The stage ignores pointer input except the
  final buttons.

## Shared with the product

`compareCompanies` / `CompanyComparison` and `opportunityMap` / `OpportunityMapView` are used by both the tour and
every company page with a ready analysis.

## Tests

```
bun test src/lib/tour                                   # scenario pinned to the engine, machine, script
BASE_URL=<url> bun scripts/e2e-tour.ts                   # acceptance, playback ×6 (test hook ?speed=)
TOUR_REALTIME=1 BASE_URL=<url> bun scripts/e2e-tour.ts   # the real 5-second pacing
# protected preview: VERCEL_AUTOMATION_BYPASS_SECRET=<secret> (never printed)
```

The acceptance test clicks **Open the demo** once and then only observes: every scene and stage in order with the
script's text, progress bars, the cursor on each target, each result, the final screen; no console error, no POST,
no `/api` call, no session cookie; then pause/resume, skip/back, replay, mobile 390 px and reduced motion.
