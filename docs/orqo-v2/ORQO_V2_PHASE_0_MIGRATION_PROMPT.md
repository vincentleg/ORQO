# ORQO V2 --- Phase 0 Repository Audit & Migration Prompt

**Purpose:** First prompt to run against the existing ORQO repository\
**Mode:** Audit, planning and architecture mapping\
**Implementation authorization:** Minimal audit artifacts only; no V2
feature reconstruction

------------------------------------------------------------------------

## ROLE

You are the senior software architect and migration lead for ORQO.

You are working inside the existing ORQO repository.

A separate document, **"ORQO V2 --- Master Product & Technical
Specification"**, is the product and technical source of truth for the
target architecture.

Your task in Phase 0 is **not to build ORQO V2**.

Your task is to inspect the real repository, understand exactly what
exists, verify what actually works, compare it to the V2 specification,
and produce a safe phased migration plan.

------------------------------------------------------------------------

# NON-NEGOTIABLE RULES

**No destructive rewrite.\
No fake integration.\
No regression.\
No implementation before repository analysis.**

Additionally:

1.  Do not delete working code.
2.  Do not replace the current application shell merely because V2 will
    eventually have a new design.
3.  Do not install a large new stack during this audit unless absolutely
    required to inspect the repository.
4.  Do not create Supabase, LangGraph, Firecrawl, Exa, Nylas, Langfuse
    or other V2 integrations yet.
5.  Do not change production/runtime behavior as part of this audit.
6.  Do not modify secrets or expose credentials.
7.  Do not commit `.env` or `.env.local`.
8.  Do not claim an integration works without testing the real
    integration.
9.  Do not infer architecture from filenames alone. Read the
    implementation.
10. Do not convert mocks into "live" features.
11. Do not opportunistically implement future phases.
12. Preserve the ability to run the current ORQO application throughout
    Phase 0.

If you believe code must be changed during Phase 0 to enable inspection
or testing, keep the change minimal and explain it before making it.

------------------------------------------------------------------------

# TARGET PRODUCT CONTEXT

ORQO V2 is evolving from a hackathon prototype into an AI-powered
Business Development Operating System.

The target UX has six main spaces:

-   Search
-   Discover
-   Network
-   Intelligence
-   Agents
-   Dashboard

Separate utility spaces: - Settings - Company - Account

Search becomes the primary home.

The target architecture includes, over time: - multi-tenant
organizations and users; - persistent PostgreSQL business data; -
authentication and RLS; - FR/EN; - web research and
evidence/provenance; - multi-agent orchestration; - model-agnostic
OpenRouter access; - business memory; - Neo4j relationship/opportunity
graph; - contacts/emails/calendar; - follow-ups; - market
intelligence; - event intelligence; - agent hierarchy and custom
agents; - evaluation/observability; - security/privacy/data recovery.

**Do not build those features in Phase 0.**

------------------------------------------------------------------------

# KNOWN HISTORICAL CONTEXT --- VERIFY, DO NOT TRUST BLINDLY

The current prototype has historically included or discussed: - ORQO
opportunity discovery; - bilateral reasoning; - opportunity
generation; - critic/qualification; - human consent; - Business Match; -
signal-driven re-evaluation; - multi-company opportunity graph; -
deterministic demo data/fallback; - manual demo flow; - Auto Demo /
Presentation Mode; - OpenRouter live AI option; - Neo4j integration
abstraction; - Brave integration abstraction.

Historical reports indicated: - OpenRouter was genuinely used/tested. -
Neo4j code/interface existed but may not have been configured with real
credentials. - Brave code/interface existed but may not have been
configured with real credentials. - other partner integrations may not
exist.

Treat every statement above as a hypothesis to verify against the
repository and current configuration.

------------------------------------------------------------------------

# PHASE 0 OBJECTIVES

You must answer seven questions:

1.  **What does the repository actually contain today?**
2.  **What genuinely works today?**
3.  **What is demo/mock/deterministic only?**
4.  **What existing code is reusable for V2?**
5.  **What must be refactored or replaced?**
6.  **What new foundations must be added, and in what dependency
    order?**
7.  **What is the safest migration sequence with zero unnecessary
    regression?**

------------------------------------------------------------------------

# STEP 1 --- REPOSITORY INVENTORY

Inspect the entire repository structure.

Identify: - package manager; - framework; - frontend architecture; -
backend/server architecture; - routes/pages; - components; - state
management; - storage/persistence; - APIs; - server actions/endpoints; -
environment-variable usage; - test framework; - E2E framework; -
scripts; - build process; - lint/typecheck; - data fixtures; - mocks; -
demo state; - external-provider clients; - graph code; - AI/model
code; - prompt files; - agent abstractions; - localization if any; -
styling/design system; - deployment configuration; -
README/documentation; - generated/dead files.

Do not dump every file into the final report. Build a meaningful
architectural inventory.

------------------------------------------------------------------------

# STEP 2 --- RUN BASELINE VALIDATION

Before proposing migration, establish the current baseline.

Use the repository's actual documented commands where available.

Attempt, as appropriate: - dependency install; - typecheck; - lint; -
unit tests; - integration tests; - E2E tests; - production build.

If a command fails: - record the exact failure category; - distinguish
environment/configuration failure from code failure; - do not hide it; -
do not "fix everything" during Phase 0.

If the app can be run locally, verify the main flows without modifying
behavior.

Record baseline status.

------------------------------------------------------------------------

# STEP 3 --- MAP CURRENT USER FLOWS

Identify current user-visible flows.

At minimum investigate whether the application currently supports:

1.  initial/home state;
2.  connecting/analyzing profiles/companies;
3.  opportunity generation;
4.  opportunity critic/qualification;
5.  bilateral consent / Interested;
6.  Business Match;
7.  meeting preparation or scheduling simulation;
8.  signal/time-forward/re-evaluation;
9.  multi-company/A+B+C opportunity;
10. graph visualization;
11. reset demo;
12. Auto Demo / Presentation Mode;
13. live AI toggle or OpenRouter flow;
14. error/fallback behavior.

For each flow classify:

-   **WORKING**
-   **PARTIALLY WORKING**
-   **DEMO ONLY**
-   **BROKEN**
-   **NOT PRESENT**
-   **UNKNOWN / REQUIRES CREDENTIALS**

Provide evidence from code/tests/runtime.

------------------------------------------------------------------------

# STEP 4 --- INTEGRATION TRUTH TABLE

Create a table for every external integration found in code.

Required columns:

  ----------------------------------------------------------------------------------------------------
  Integration   Code      Env vars     Real     Credentials    Tested   Current          V2
                present   referenced   client   available?\*   in Phase classification   disposition
                                       call                    0                         
  ------------- --------- ------------ -------- -------------- -------- ---------------- -------------

  ----------------------------------------------------------------------------------------------------

\*Never print secret values. Only report whether configuration appears
present/absent.

Classifications:

-   **LIVE & TESTED**
-   **IMPLEMENTED BUT UNCONFIGURED**
-   **MOCK / DEMO**
-   **DEAD / UNUSED**
-   **UNKNOWN**
-   **NOT PRESENT**

Pay special attention to: - OpenRouter; - Neo4j; - Brave; - any model
provider; - any search provider; - any analytics; - any database; - any
email/calendar/CRM service; - any sponsor/hackathon integration.

**No integration may be upgraded in status based on README claims
alone.**

------------------------------------------------------------------------

# STEP 5 --- DATA AND STATE AUDIT

Determine exactly where current data lives.

Investigate: - browser localStorage/sessionStorage; - in-memory state; -
static fixtures; - JSON files; - API state; - databases; - graph
storage; - cookies; - environment configuration.

Identify every state that would be lost: - on refresh; - on browser
clear; - on deployment restart; - between devices; - between users.

Create a **Persistence Gap Report**.

Map current data concepts to future canonical entities such as: -
Organization - User - Membership - Company Profile - Company - Contact -
Relationship - Meeting - Event - Opportunity - Follow-up - Signal -
Evidence/Source - Agent - Mission - Agent Run - Action Inbox Item -
Feedback

Do not implement the database yet.

------------------------------------------------------------------------

# STEP 6 --- ARCHITECTURE DEPENDENCY MAP

Compare the current architecture with the V2 Master Specification.

For every major V2 capability classify the current repository as:

## KEEP

Current implementation is sound and should be retained with little
change.

## REFACTOR

Useful implementation exists but must be adapted.

## REPLACE

Existing implementation conflicts materially with V2 architecture.

## ADD

Capability does not exist and must be introduced.

## DEFER

Capability belongs to a later phase and must not be introduced early.

Required capability map:

-   Next.js/React application shell
-   TypeScript structure
-   current design components
-   FR/EN localization
-   Search Home / Command Center
-   Dashboard
-   Discover
-   Network
-   Intelligence
-   Agents
-   Settings/Company/Account
-   PostgreSQL/Supabase
-   authentication
-   organizations/memberships
-   RLS/tenant isolation
-   pgvector/semantic memory
-   Neo4j graph
-   OpenRouter/model layer
-   Agent Registry
-   LangGraph/orchestration
-   web provider abstraction
-   Brave
-   Exa
-   Firecrawl
-   Evidence Store
-   contacts
-   email/calendar
-   Nylas
-   follow-ups
-   events
-   market intelligence
-   signals/re-evaluation
-   Action Inbox
-   agent hierarchy
-   missions
-   Create Custom Agent
-   Langfuse/observability
-   evaluation datasets
-   privacy/security
-   backup/recovery
-   audit log
-   production deployment
-   mobile.

------------------------------------------------------------------------

# STEP 7 --- IDENTIFY TECHNICAL DEBT AND RISKS

Report: - tightly coupled components; - duplicated business logic; -
hardcoded demo assumptions; - hardcoded company names; - hardcoded model
names; - hardcoded provider logic; - missing types; - unsafe `any`; -
fragile state; - browser-only persistence; - missing validation; -
missing error handling; - missing tests; - secret-handling risks; -
unsafe client-side provider calls; - potential cross-tenant risks for
future migration; - dead code; - large components that should be
split; - provider code that should become adapters.

Prioritize each: - Critical - High - Medium - Low

Do not fix them all in Phase 0.

------------------------------------------------------------------------

# STEP 8 --- PRESERVATION PLAN

Identify the exact files/modules/concepts that should survive migration.

For each important current behavior, specify: - where it lives; -
whether it is reusable; - what future module should own it; - when it
should be migrated; - how to test regression.

Pay particular attention to: - opportunity structure; - bilateral
reasoning; - critic; - confidence/qualification; - consent; - Business
Match; - re-evaluation; - multi-company graph; - demo mode; -
OpenRouter; - Neo4j abstractions; - Brave abstractions; - current visual
components.

------------------------------------------------------------------------

# STEP 9 --- PROPOSE TARGET REPOSITORY ARCHITECTURE

Without implementing it, propose a target code organization suitable for
ORQO V2.

It should separate at least:

-   UI/application routes
-   domain/business logic
-   data access
-   authentication/authorization
-   agent definitions
-   orchestration
-   model gateway
-   tool registry
-   web research providers
-   evidence/provenance
-   graph
-   communications
-   observability
-   localization
-   tests
-   configuration

Prefer domain boundaries over a giant `utils` directory.

Show an example directory tree.

Do not move files yet.

------------------------------------------------------------------------

# STEP 10 --- PROPOSE CANONICAL DATA MODEL

Produce a first-pass ER/domain model.

For each core entity include: - purpose; - key fields; - organization
ownership; - important relationships; - whether soft-delete/versioning
is recommended.

Include: - Organization - User - Membership - CompanyProfile -
StrategicGoal - Company - Contact - Relationship - Communication/Email
metadata - Meeting - Event - Opportunity - OpportunityParty - FollowUp -
Signal - IntelligenceItem - Source - EvidenceClaim - Agent -
AgentVersion - AgentRelationship - Mission - AgentRun - ToolRun -
Recommendation - Feedback - ActionInboxItem - AuditEvent

Do not generate production migrations in Phase 0.

------------------------------------------------------------------------

# STEP 11 --- SECURITY / TENANCY PLAN

Before Phase 1 implementation, define:

-   tenant boundary;
-   `organization_id` strategy;
-   RLS strategy;
-   membership roles;
-   service-role usage rules;
-   server/client data boundaries;
-   secret management;
-   external provider token storage;
-   audit requirements;
-   soft-delete strategy;
-   export/delete requirements;
-   agent permission enforcement;
-   high-impact action approval model.

Identify any existing code patterns that would be unsafe in a
multi-tenant product.

------------------------------------------------------------------------

# STEP 12 --- PROVIDER ABSTRACTION PLAN

Define interfaces/adapters so ORQO business logic is not locked to
vendors.

At minimum propose interfaces for:

### Model Gateway

OpenRouter initially.

### Web Search

Brave / Exa.

### Web Crawl

Firecrawl.

### Graph

Neo4j.

### Communications

Nylas later.

### Observability

Langfuse later.

### Voice

provider later.

For each interface specify: - core methods; - expected normalized
output; - error semantics; - provenance metadata; - retry/caching
considerations.

Do not integrate new providers yet.

------------------------------------------------------------------------

# STEP 13 --- AGENT ARCHITECTURE PLAN

Design, but do not implement, the future Agent Registry.

Explain how: - agents are configured; - hierarchy is stored; - manager
relationships work; - tools are permissioned; - model policy is
assigned; - data scope is assigned; - permanent vs mission agents
work; - agent versions work; - custom agents are compiled; - LangGraph
can execute the organization; - human approvals interrupt/resume
workflows.

Distinguish deterministic orchestration from LLM reasoning.

------------------------------------------------------------------------

# STEP 14 --- MIGRATION PHASES

Validate or adjust this sequence based on actual repository
dependencies:

1.  Phase 0 --- Audit & Architecture Freeze
2.  Phase 1 --- SaaS Foundation
3.  Phase 2 --- Shell / Design / i18n
4.  Phase 3 --- Web Intelligence & Company Analysis
5.  Phase 4 --- Agent Infrastructure
6.  Phase 5 --- Discover & Prospecting
7.  Phase 6 --- Network & Follow-ups
8.  Phase 7 --- Intelligence & Signals
9.  Phase 8 --- Events Intelligence
10. Phase 9 --- Agent Organization & Missions
11. Phase 10 --- Opportunity Graph / Missing Piece
12. Phase 11 --- Advanced Opportunity Intelligence
13. Phase 12 --- Hardening
14. Phase 13 --- Production Deployment
15. Phase 14 --- Mobile

You may recommend moving a phase only if the actual codebase creates a
clear dependency reason.

For each phase provide: - objective; - prerequisites; - existing code
reused; - new components; - migrations; - tests; - exit criteria; - main
risks.

------------------------------------------------------------------------

# STEP 15 --- DEFINE PHASE 1 PRECONDITIONS

At the end of the audit, give an exact checklist required before we
authorize Phase 1.

Examples: - baseline tests green or known failures documented; - current
state backed up in Git; - branch strategy established; - Supabase
project decision confirmed; - environment variable naming decided; -
schema approved; - RLS approach approved; - rollback plan defined; - no
secret leakage.

Do not start Phase 1 automatically.

------------------------------------------------------------------------

# REQUIRED OUTPUT

Create a single comprehensive audit report:

`docs/orqo-v2/PHASE-0-AUDIT.md`

Use this structure:

1.  Executive Summary
2.  Current Repository Architecture
3.  Baseline Build/Test Status
4.  Current User Flows
5.  Integration Truth Table
6.  Data & Persistence Audit
7.  KEEP / REFACTOR / REPLACE / ADD / DEFER Matrix
8.  Technical Debt & Risks
9.  Preservation Plan
10. Proposed Target Repository Architecture
11. Proposed Canonical Data Model
12. Security & Multi-Tenancy Plan
13. Provider Abstraction Plan
14. Agent Architecture Plan
15. Migration Dependency Map
16. Recommended Phase Plan
17. Phase 1 Preconditions
18. Open Questions / Decisions Requiring Human Approval

If useful, create diagrams in Mermaid inside the Markdown report.

------------------------------------------------------------------------

# HUMAN-APPROVAL GATE

After writing the audit report:

**STOP.**

Do not: - implement Supabase; - redesign the app; - install LangGraph; -
add authentication; - migrate state; - add web providers; - change
navigation; - add agents; - modify the database; - remove existing
features.

Present a concise terminal summary containing:

-   baseline status;
-   number of integrations by classification;
-   top five migration risks;
-   major KEEP items;
-   major REFACTOR/REPLACE items;
-   proposed Phase 1 scope;
-   path to the audit report.

Then explicitly state:

> **Phase 0 audit complete. No V2 migration has been executed. Awaiting
> approval for Phase 1.**

------------------------------------------------------------------------

# SUCCESS CRITERIA

Phase 0 succeeds if, after reading the report, a human can answer:

-   exactly what ORQO is today;
-   exactly what is real vs mocked;
-   what will survive;
-   what will change;
-   what must be added;
-   how data will migrate;
-   how tenant isolation will work;
-   how providers will be abstracted;
-   how agents will be orchestrated;
-   what Phase 1 will change;
-   how regressions will be prevented.

The goal is not code volume.

The goal is **certainty before migration**.
