# ORQO V2 — Phase 10 Implementation Report: Opportunity Graph / Neo4j Production Foundation

## Objective

Add a production-safe, explainable graph layer over the existing PostgreSQL business records. It should answer "how are these business objects connected, and why?" and surface cautious **connections worth investigating**. It must not replace PostgreSQL, and it must not turn graph topology into business claims.

## Baseline

- Branch `phase-10-opportunity-graph`. Merge base with `main` is `087d5c9` (Merge Phase 9), and `main` is at `087d5c9`.
- The working tree was clean and no Phase 10 code existed.
- Graph code that already existed:
  - `lib/graph/elements.ts`: the demo `World` → elements projection.
  - `components/graph.tsx`: the demo SVG.
  - `lib/server/graph/repository.ts`: Neo4j over the HTTPS Query API, plus a memory fallback. It was global and not scoped to a tenant.
- Neo4j is **not configured** in this environment (`NEO4J_URI` and `NEO4J_PASSWORD` are unset; only their presence was checked).

## Architecture

```
PostgreSQL (canonical, RLS)
   │  lib/server/graph/canonical.ts   loadCanonicalSnapshot(db, org): column-minimized, org-filtered, row-bounded reads
   ▼
lib/graph/opportunity/projection.ts   buildProjection(snapshot): pure, deterministic, sorted nodes/edges
   │                     candidates.ts findOpportunityCandidates(): deterministic rules, cautious output
   │                     neighborhood.ts neighborhood(): bounded BFS (depth/per-layer/total caps)
   ▼
lib/server/graph/store.ts             GraphStore port: Neo4jGraphStore (HTTPS Query API v2), MemoryGraphStore (test double)
lib/server/graph/service.ts           status, preview fallback, store reads, rebuildOrganizationGraph, company context
```

The layers stay separate:

- **Domain data**: SQL lives only in `canonical.ts`.
- **Projection**: pure TypeScript with no I/O.
- **Transport**: Cypher lives only in `store.ts`.
- **UI and agent code** never see SQL or Cypher.

## PostgreSQL source-of-truth rule

The rule is stated in the module headers of `projection.ts`, `store.ts` and `service.ts`, and in `.env.example`:

- Neo4j holds a **derived, rebuildable, disposable** projection.
- All business writes stay in PostgreSQL.
- Nothing in Phase 10 writes a canonical record.
- Deleting Neo4j entirely loses nothing: running the rebuild again recreates it from PostgreSQL.

## Graph model

**Identity.** Each node key is `organizationId/kind/canonicalId`, and each node carries `canonicalTable` and `canonicalId`. Keys never use names, domains, emails or generated text. There is no parallel identity system.

**Nodes:**

| Kind | Canonical source | Notes |
|---|---|---|
| company | `companies` | Structural relationship context only: Network stage, last interaction **day**, open follow-up **count** |
| capability | `company_capabilities` | Includes tags and visibility. No `detail` |
| need | `company_needs` | Includes tags, intensity and visibility. No `detail` or `disclosure` |
| concept | closed vocabularies | `tag:<TAGS key>` (capability/need vocabulary) or `concept:<CONCEPTS key>` (evidence-store lexicon). Generic concepts are excluded |
| opportunity | `opportunities` | Title, stage, kind, confidence level. Never created here |
| signal | `company_signals` | Non-dismissed only. Headline, kind, status, quality, authority, published day |
| event | `events` | Name and dates. No description or objective |

Contacts, interactions, follow-ups and Phase 6 person-to-person `relationships` are **not** graph nodes. There is no generic `CONNECTED_TO` edge and no company→company edge, because no canonical company-to-company record exists.

**Edges** (each meaning is defined in `EDGE_KINDS` and in i18n `graph.edges.*`):

| Edge | Basis | Epistemic status |
|---|---|---|
| `HAS_CAPABILITY`, `HAS_NEED` (company → facet) | Workspace record | Strongest status among the facet's evidence refs, plus counts. `null` if no evidence |
| `TAGGED` (facet → concept) | Vocabulary | `null` (a classification) |
| `OFFERS`, `SEEKS` (company → concept) | Evidence store: fields offering/product/technology vs need. Also the own company profile (`offerings` / `soughtCapabilities`, same lexicon as Phase 3 relevance) | Strongest of the claims, plus counts and a self-described count. A profile statement counts as `fact` (stated by the workspace) |
| `PARTICIPATES_IN` (company → opportunity) | Opportunity record | `null`, with the role |
| `MISSING` (opportunity → tag) | Opportunity record | Always `inference` (an engine-derived gap) |
| `ABOUT` (signal → company) | Public signal | The signal's own fact/inference status |
| `TARGETED_AT`, `MET_AT` (company → event) | Event plan | `null`, with status, priority and attendance |

## Epistemic status and provenance

- **Status is never upgraded.** "Strongest present" is shown together with per-status counts.
- **UNKNOWN is never an edge.** Unknown evidence items are skipped. Gaps appear as candidate unknowns.
- **Provenance is references, not copies.** Each edge carries canonical references (`table:id`, at most 12): evidence items, sources, `company_intelligence`, signals, `event_companies`, opportunities, capability/need rows.
- **No excerpts or statements** are copied into the graph.
- **Self-described (marketing) claims** are counted and flagged in the explanation panel.

## Tenancy and security

| Threat | Mitigation |
|---|---|
| Cross-tenant traversal | Every Cypher pattern matches `OrqoNode {organizationId: $org}`. Edges only connect nodes of the same organization. Store reads drop rows whose key is not prefixed by the organization. Two workspaces tracking the same company produce disjoint keys (tested). |
| Forged organization id | The UI uses `loadWorkspace` (membership). Rebuild calls `requireMembership(..., "admin")`. Reads run as the user under RLS and are also filtered by `organization_id` (tested with a recording fake). |
| Cypher injection | Statements are constants and values are parameters. The only interpolated tokens come from the closed `NODE_LABELS` / `EDGE_KINDS` maps and are validated against `^[A-Z][A-Za-z_]{0,39}$`. No API accepts query text. |
| Canonical id spoofing | Ids come from PostgreSQL rows. Agent input is a strict `{ companyId: uuid }`. |
| Graph poisoning | Only `buildProjection` output is written. Store reads are validated against the projection schema (unknown kinds are dropped). Web content reaches the graph only as already-ingested evidence concept keys from a closed lexicon. It can never change policy or traversal. |
| Secret leakage | Credentials are server-only. Errors are reported as safe categories only (config/timeout/network/auth/http/invalid_response). Provider bodies are never logged or shown. |
| Private CRM duplication | Enforced at the column-list level. A test asserts the excluded columns. |
| Unbounded traversal / DoS | See **Query bounds** below. |
| Endpoint entitlement bypass | Graph paths have no variable cost. Rebuild is admin-only and throttled. |
| Legacy hole closed | The old `/api/graph` POST mirrored a browser-supplied `World` into Neo4j in a global, non-tenant namespace, and its GET pinged Neo4j without authentication. The demo mirror is now **in-memory only**, so it can never write to the production graph. `/demo` behaves the same: its label now reads "Graph store · in-memory (demo)". |

**Query bounds:**

- Loader row caps per table (`CANONICAL_LIMITS`). Hitting a cap is shown as "truncated".
- Neighborhood: depth ≤ 4, ≤ 10 nodes per layer, ≤ 36 nodes in total.
- Store reads: ≤ 200 keys and ≤ 1000 rows per statement. Neo4j reads expand one hop per layer, from kept nodes only.
- Candidates: ≤ 20.
- Timeouts: 4 s for reads, 15 s for writes.

## Neo4j adapter and configuration

- `Neo4jGraphStore` uses the HTTPS Query API v2 (no new dependency).
- URI and database name are validated (`queryEndpoint`). A malformed value gives status `unavailable/config` instead of a crash. Missing settings give status `unconfigured`.
- `.env.example` has placeholders only (the comment was updated).
- A best-effort composite uniqueness constraint is created on `(organizationId, key)`. MERGE is correct without it.

## Graph status

| State | When it is shown |
|---|---|
| `unconfigured` | No Neo4j settings |
| `unavailable` | Neo4j unreachable or misconfigured (with a category) |
| `not_synced` | Neo4j reachable, but this workspace has no projection marker yet |
| `stale` | The marker's fingerprint or version differs from the current PostgreSQL projection |
| `in_sync` | The marker matches, as checked by a real read with `checkedAt` |

- "Syncing" is never claimed, because a rebuild is a single request.
- The last rebuild error and its category are kept in process memory only. They are not durable.

## Projection, rebuild and stale data

- **Idempotent.** The projection is sorted and keyed. MERGE on keys produces no duplicates (tested).
- **`rebuildOrganizationGraph(db, userId, org)`** runs these steps:
  1. Admin check. Configured-store check. Per-organization throttle (30 s).
  2. Load the snapshot, build the projection, compute a sha256 fingerprint.
  3. Upsert nodes, then edges, in batches of 500, tagged with a fresh `syncId`.
  4. Delete edges and nodes **of that organization** whose `syncId` differs.
  5. Write the marker node (`OrqoProjection`) **last**. An interrupted rebuild therefore reads as stale, never as current.
- There is no global wipe. Rebuild is exposed only as an admin button inside the graph view.
- **Incremental sync** is not implemented. A whole-organization rebuild is cheap and bounded, and staleness is detected by fingerprint. CDC was left out on purpose.

## Opportunity candidates (deterministic, cautious)

**Rules** (structured data only, no fuzzy text):

- `capability_need`: provider A offers concept X (a capability tagged X, or an `OFFERS` claim), and seeker B needs X (a need tagged X, or a `SEEKS` claim).
- `missing_piece` (**A + B + C**): a canonical opportunity records tag X as missing, and a non-participant C has a capability tagged X.

**Support** is not a score:

- `supported`: both sides have facts.
- `partial`: one side has facts.
- `needs_validation`: otherwise.
- A missing piece is at most `partial`, because the gap is an inference.

**Fit, timing and relationship stay separate:**

- Only fit decides support.
- Signals are attached as **timing** context and never change support or ordering (tested).
- Network stage, last interaction and events are **context**. Relationship context only breaks ties in ordering.
- Event attendance alone, or a relationship alone, creates nothing (tested).

**Exclusions:**

- Pairs already tracked together in a canonical opportunity.
- Companies whose stage is `not_relevant`.

**Each candidate includes:**

- Companies and their roles.
- Concepts.
- The path (node and edge keys).
- Canonical evidence references.
- Unknowns: whether the need is current, offer fit, complement fit, partner interest, side-not-fact, side-without-evidence, no relationship.
- A validation question.

**Human review:** the actions are Open company, Plan a follow-up (opens the company page, where the existing follow-up form lives), and Show in map. Nothing creates an opportunity, changes a stage or contacts anyone. "Not relevant" and "Investigate" are not persisted (they would need a migration, which was deferred). Marking a company's Network stage "Not relevant" already removes it from candidates.

## UI

**Network → "Opportunity graph" tab** (`/workspace/network?view=graph`). This is a third Network view, not a new top-level navigation item. It contains:

- **Status card**: state badge, explanation, map source (preview vs Neo4j), projection version, truncation and last-failure notices. A "Build graph from records" button appears for admins only, and only when Neo4j is configured.
- **Summary**: companies, capabilities, needs, worth investigating, signals · events.
- **Connection map**: a focus-company picker and a bounded neighborhood in columns by distance (hand-written SVG, no dependency).
  - Node kinds use a color and a kind caption.
  - Edge stroke encodes the status: fact solid green, inference dashed, assumption dotted, recorded grey.
  - Clicking a node or edge opens an **explanation panel**: meaning, why it is here (basis), status with evidence counts, self-described warning, canonical references, links to company, event or Intelligence, and a note that private CRM content is never in the graph.
- **"Connections worth investigating"**: why surfaced, fit evidence per side with its status, references, unknowns, validation question, timing / relationship / event context (each labelled as not proof of fit), and actions.
- If the graph fails to load, the section shows "Opportunity graph is temporarily unavailable" and the rest of the page keeps working.

**Company detail → Business context → "Connected business context":** concepts the company is recorded as offering or looking for (with their status), the number of candidates involving it, and a link to the graph focused on it. A failure shows a notice.

Everything is available in FR and EN.

## Agent integration

- New read-only seam `read_opportunity_graph` with input `{ companyId: uuid }` (strict). It returns offered/sought concepts with their status and the candidates involving the company. The provenance literal is `opportunity_graph_projection`.
- Cost class is internal: no external network, no model, approval `never`.
- Permissions: read access, domain `opportunity_graph`, and it withholds all four private-field classes.
- New capability `opportunity_graph` on the **Partnership Manager**. The tool is **not granted** to any agent and no mission calls it, so Agent detail lists it truthfully as a *planned* tool (Phase 9 `plannedTools`). There is no Cypher access and no Neo4j access: it reads the PostgreSQL-derived projection.

## Cost behavior

- No OpenRouter, Brave, Exa, Firecrawl or other provider call exists anywhere on the graph path.
- Projection, candidates, rendering and the agent seam are pure or database reads (tested with a fetch trap).
- The only outbound call is to the operator-configured Neo4j, for status, reads and admin rebuild.
- No entitlement change.

## Database / migrations

- **No migration and no schema change.** Sync metadata lives on the Neo4j marker node, and staleness is computed.
- Columns read for the first time by this phase: `companies.network_stage`, `offerings`, `sought_capabilities` (existing columns).

## Tests

`bun test src tests/unit`: **365 pass, 0 fail** (27 files). This includes 36 new Phase 10 tests in three files:

- `src/lib/graph/opportunity/graph.test.ts` covers:
  - deterministic and idempotent output, independent of input order;
  - canonical ids;
  - two-organization isolation for the same company;
  - no private data;
  - provenance;
  - FACT/INFERENCE preserved and UNKNOWN never an edge;
  - openness claims never become a need;
  - dismissed signals excluded, and signals attach to companies only;
  - stale removal;
  - candidate determinism, unknowns and validation question;
  - signal affects timing, not fit;
  - event attendance alone and relationship alone create no fit;
  - relationship never changes support;
  - A+B+C;
  - tracked and not-relevant exclusions;
  - candidate bounds;
  - no network access;
  - neighborhood bounds.
- `src/lib/server/graph/graph-store.test.ts` covers:
  - Neo4j via a fake transport: parameterized and org-scoped statements, ordered reconcile, cross-org projection refused, bounded reads that drop foreign or invalid rows, safe error categories, closed tokens, endpoint validation;
  - service: unconfigured preview, unavailable degradation, not_synced → rebuild → in_sync (store read equals preview) → stale, idempotent and isolated rebuild with stale removal, admin/configured/throttle checks, failure recorded, no canonical write and no fetch on the read path, company context;
  - loader: org filter on every query and private columns absent;
  - agent tool: read-only, not granted, rejects extra keys or non-uuid input, runs org-scoped.
- `src/components/orqo/opportunity-graph.test.tsx`: map renders in EN and FR, kinds and legend are distinguishable, no private content.

Other checks:

- Existing Phase 4–9 suites (agents, signals, events, network, discover) are unchanged and pass.
- `tsc --noEmit` is clean, `eslint src` is clean, and one `next build` succeeded.

## Not run

- `test:db`, `test:http` and the `e2e:*` scripts: they target the configured real Supabase project (safety rule and destructive-tests policy).
- **Neo4j live integration was not tested.** No safe test instance exists. Cypher was exercised only through a fake transport, and live Query API behavior (constraint support, LIMIT parameters, response shapes) is unverified.

## External calls and database writes

- **External calls:** none. No provider, no Neo4j and no network was used during implementation or tests.
- **Database writes:** none (no DB suites were run, and no data was created in any workspace).

## Known limitations

- Neo4j is not live-tested. The read path from Neo4j is used only when the store is `in_sync`; otherwise the preview is used.
- No incremental sync: after record changes the graph reads as `stale` until an admin rebuilds.
- The last-error and throttle state is in process memory only (it does not survive restarts or span multiple instances).
- Candidate review actions ("Not relevant", "Investigate") are not persisted, because they would need a migration.
- Candidate rules need structured data: tagged capabilities/needs, evidence-store concepts (Search analyses) or own-profile concepts. Capability/need rows have no UI editor yet (API/fixtures only), so in the SaaS app most candidates come from stored analyses plus the own profile.
- The company page loads the workspace projection (bounded) on each view.
- Capability tag labels are English vocabulary terms. Evidence-store concepts are bilingual.

## Browser review (Neo4j unconfigured → preview state)

Use a fictional workspace only. Do not use INFODIP.

1. In **Company**, set fictional own-profile *sought capabilities* (e.g. "distribution") and *offerings*.
2. Analyze a fictional or public company in Search (Basic, official site) and add it to Network.
3. Open **Network → Opportunity graph**. The badge reads **"Graph preview — Neo4j not configured"**, and the source reads "preview from your workspace records". There is no "connected" or "healthy" claim and no rebuild button.
4. Check that Companies, Follow-ups and the other workspace pages still work.
5. Check the summary counts and the bounded map. Kinds should be distinguishable by color and caption.
6. Select a node: its kind, stage or context, connections, and an open link.
7. Select a connection: meaning, basis, Fact/Inference/Recorded, evidence counts, canonical references, and the "no private data" note.
8. Check the candidates: rule, support category, why surfaced, unknowns, validation question, and timing/relationship/event context marked "not proof of fit". There should be no "partnership" claim.
9. Click "Show in map". The candidate path is highlighted.
10. Check that no opportunity, stage change or message was created.
11. Company detail → "Connected business context" → open it in the graph.
12. Check that the Network, Signals (Intelligence), Events and Agents pages still work. Partnership Manager should list "Read the Opportunity graph" as **planned** (not granted).
13. Switch FR ⇄ EN.
14. `/demo` → Network → Sync graph should say "in-memory demo graph".

## Human review result — PASS

The browser review used the fictional Northstar Systems workspace, with Neo4j intentionally unconfigured. It confirmed:

- **Network.** The Companies and Follow-ups views still work, and the existing fictional follow-up is still visible. No regression was seen.
- **Opportunity graph.** It loads inside Network, includes the workspace's fictional companies, and truthfully shows "Graph preview — Neo4j not configured", with the explanation that it is computed from workspace records.
- **Profile concepts.** Editing the fictional own-company profile produced deterministic concept nodes for Northstar Systems: assembly/configuration/integration and distribution/resale.
- **Explanations.** Node and connection selection explained each item without exposing private relationship data.
- **Public/private boundary.** Contacts, contact channels, private notes, interaction contents and event preparation notes are absent from the graph. Event and Network relationship context remain intact.
- **FR/EN** switching works.
- **No side effects.** No opportunity, stage change, outreach, contact or follow-up was created.
- **Partnership Agent.** It stays Business-plan locked and not executable in the Free workspace. "Read the Opportunity graph" appears under "Read access prepared for this agent — not granted until it is built", and the existing restrictions remain visible (no external outreach, no private contact/interaction content, no paid providers). No agent ran.

**Expected empty candidate state.** The review showed Capabilities 0, Needs 0 and Connections worth investigating 0. This is the correct result, not a failure:

- A candidate needs a second company on the opposite side of the same concept (one offers X, another looks for X).
- Own-profile text creates only concept "offers" / "looks for" edges for the own company. Need and Capability nodes come only from capability/need records, and the current SaaS UI has no way to create those.
- A Network company gets offer/need concepts only from a stored analysis of a real website. The fictional companies (Vector, Quill) have none.
- The reviewers deliberately did not use real-website analysis, fixture or database manipulation, or new functionality to force a candidate.
- Candidate logic is covered by unit tests with fictional fixtures.

**During the final review:**

- No external provider was called.
- No business data was written by ORQO; the only edit was the reviewer's own change to the fictional profile.
- No live Neo4j test was run, because no safe, isolated instance is available.

**Final verification:**

- 365 unit tests pass.
- Typecheck is clean.
- Lint is clean.
- One production build succeeded.
- No implementation code changed after these results.

**Final known limitations:** the limitations listed above still apply. In particular, a candidate cannot be produced through the current UI for fictional Network companies until there is a way to record capabilities or needs.

## Commits

On `phase-10-opportunity-graph`, on top of `087d5c9`:

- `d5f66cc` Phase 10: Opportunity Graph / Neo4j production foundation
- Phase 10 report: record final human review (documentation only)

Not merged. Phase 11 has not started.
