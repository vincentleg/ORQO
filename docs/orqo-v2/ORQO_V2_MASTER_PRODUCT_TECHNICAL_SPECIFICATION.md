# ORQO V2 --- Master Product & Technical Specification

**Version:** Architecture v1.0\
**Status:** Source of truth for migration planning and phased
implementation\
**Product:** ORQO --- Opportunity Relationship Qualification &
Orchestration

------------------------------------------------------------------------

## 0. Purpose of this document

This document is the product and technical source of truth for ORQO V2.

It describes: - the product vision; - the current ORQO concepts and
behaviors that must be preserved; - the new V2 product architecture; -
UX and navigation; - multi-agent organization; - web intelligence; -
business memory and relationship intelligence; - SaaS accounts,
organizations, permissions and persistence; - security, privacy and data
governance requirements; - the target technical architecture; - the
phased migration strategy.

This specification is intentionally broader than any single
implementation phase.

**Critical instruction for any coding agent:** do not attempt to
implement this entire specification in one pass. ORQO V2 must be
migrated incrementally from the existing repository, with regression
protection and explicit validation after each phase.

------------------------------------------------------------------------

# 1. Product identity

## 1.1 Name

**ORQO --- Opportunity Relationship Qualification & Orchestration**

Pronunciation: "or-ko".

## 1.2 Core category

ORQO is an **AI-powered Business Development Operating System** and an
**Autonomous Business Opportunity Discovery system**.

It is not merely: - a CRM; - an AI SDR; - a networking application; - a
business-card application; - a generic company-search tool; - a contact
database; - a simple matching engine; - an event networking app.

Its purpose is to understand companies, relationships, capabilities,
needs, timing and strategic changes in order to discover **concrete
business opportunities** and help humans act on them.

## 1.3 Core product thesis

**Humans create relationships. ORQO discovers what those relationships
and companies can become.**

Useful framing: - "You meet the person. ORQO finds the business." -
"Meet once. ORQO keeps looking." - "Turn relationships into
opportunities." - "Your network is full of opportunities you haven't
found yet." - "LinkedIn maps who you know. ORQO discovers what you can
build together." - "The opportunities already exist. We uncover them."

The new V2 vision expands ORQO so that it works **before, during and
after a relationship exists**.

### Before a relationship

"I found this company. What can we do together?"

ORQO researches, understands, qualifies and recommends.

### During the relationship

ORQO prepares meetings, captures context, identifies opportunity
structures and recommends next actions.

### After the relationship

Business Agents can reason bilaterally, opportunities can be
re-evaluated, follow-ups can be managed, new signals can reactivate
dormant relationships, and multi-company opportunities can be
discovered.

------------------------------------------------------------------------

# 2. Product design principle

ORQO may contain: - many specialized agents; - several LLM providers; -
web search and crawling systems; - a relational database; - a graph
database; - semantic memory; - external communication integrations; -
evaluation and observability infrastructure.

The user must **not** experience that complexity.

The frontend should feel simple, calm, premium and intuitive.

A defining interaction is:

> **What business are you looking for?**

The system handles orchestration behind the scenes.

------------------------------------------------------------------------

# 3. Primary navigation

ORQO V2 should expose only six main business spaces:

1.  **Search**
2.  **Discover**
3.  **Network**
4.  **Intelligence**
5.  **Agents**
6.  **Dashboard**

Separate utility areas: - **Settings** - **Company** - **Account**

Do not create a top-level navigation item for every feature.

Events, follow-ups, opportunities, missions, signals, timelines and
similar capabilities should live contextually inside the six primary
spaces.

------------------------------------------------------------------------

# 4. Search --- primary home and universal command center

## 4.1 Home

The default home is **Search**, not Dashboard.

The page should be extremely clean and centered around a large
search/command field.

Users may: - type a company name; - paste a company website URL; - ask a
natural-language business-development question; - later use voice.

Examples: - "Analyze this company: https://example.com" - "Find 20 US
companies that could need our European integration capabilities." -
"What changed among our prospects this week?" - "Prepare my meeting with
Company X tomorrow." - "Find interesting exhibitors at CES." - "Who
should I follow up with today?"

## 4.2 Intent routing

ORQO identifies the request type and delegates work to the relevant
agents and tools.

The user should not need to know which agents or APIs are required.

## 4.3 Company analysis flow

Target flow:

**Company name / URL** → official website discovery\
→ website crawl/extraction\
→ current web research\
→ source collection\
→ structured company understanding\
→ comparison with the account owner's Company Context\
→ specialist-agent analysis\
→ opportunity generation\
→ critic/qualification\
→ recommendation.

The output should answer: - What does this company actually do? - What
products/services matter? - Is there relevant hardware/software? - What
capabilities does it possess? - What might it need? - What
markets/geographies matter? - What current signals matter? - How could
our company work with it? - What does our company bring? - What does the
target bring? - Why this company? - Why this opportunity? - Why now? -
What evidence supports this? - What is inference? - What remains
unknown? - Who should we contact? - What should we do next?

------------------------------------------------------------------------

# 5. Company Context

Every Organization Workspace must contain a rich Company Profile.

Possible fields: - company name; - website; - description; - products; -
services; - capabilities; - technologies; - hardware/software
characteristics; - target markets; - verticals; - geographic coverage; -
ICP; - customer types; - partner types; - strategic partners; -
differentiators; - constraints; - certifications; - examples of
partnerships; - manufacturing/integration capabilities; - commercial
models; - strategic goals; - excluded or low-value target profiles; -
business-development preferences.

This context is configured once and continuously improved.

Agents automatically receive only the authorized Company Context they
need. Users should not have to re-explain their company for every
search.

------------------------------------------------------------------------

# 6. Strategic Goals

Organizations can define explicit goals, for example: - Enter the US
market. - Find 20 European OEM opportunities. - Develop the
cybersecurity vertical. - Generate a defined qualified pipeline. - Find
five strategic technology partners.

Agent prioritization should incorporate these goals.

ORQO should not optimize for generic "interesting opportunities"; it
should optimize for opportunities relevant to the organization's current
strategy.

------------------------------------------------------------------------

# 7. Discover

Discover contains what ORQO proactively finds.

Possible contextual views: - Companies - Contacts / People - Events -
Potential partners - Emerging opportunities

Every recommendation should include: - why it was suggested; - relevant
evidence; - likely need/capability match; - relevant signal; -
recommended person/contact when available; - potential business
structure; - Why Now; - Next Best Action.

## 7.1 Refresh principle

Agent-powered spaces must expose explicit actions such as: - Update
Suggestions - Find New Companies - Find New Contacts - Refresh Events -
Re-analyze Company - Refresh Signals - Update Opportunities -
Re-evaluate Network

A refresh must trigger real new work and, when applicable, fresh
Internet research---not merely re-render cached data.

Show: - last run time; - current run state; - agent(s) working; -
sources examined when appropriate; - result delta.

Example: "12 new companies analyzed · 3 recommendations · 2 contacts
identified."

------------------------------------------------------------------------

# 8. Network

Network is ORQO's commercial memory.

It contains companies and people with whom a relationship already
exists.

Each company dossier may contain: - company profile; - contacts; -
contact roles; - relationship origin; - event/introduction/search
source; - emails; - meetings; - notes; - conversation history; - files
or relevant artifacts; - agent analyses; - synergies; - opportunities; -
maturity; - next action; - follow-up status; - signals; -
re-evaluations; - timeline; - outcomes.

## 8.1 Relationship timeline

Example:

**Met → Email → Call → NDA → Dormant → New Signal → Re-analysis → New
Opportunity → Meeting → Pilot**

Agent events can appear in the same timeline: - European expansion
detected; - opportunity reopened; - contact changed company; - new
product launched; - follow-up became due.

## 8.2 Business Development Memory

Before a new interaction, ORQO should be able to reconstruct: - who the
person is; - where the relationship began; - what was discussed; -
previous emails; - previous opportunities; - why an opportunity was
rejected or dormant; - what has changed; - what should be proposed now.

Goal:

> **Never restart from zero with a business relationship.**

------------------------------------------------------------------------

# 9. Email and Follow-ups

Follow-ups live primarily within Network and the Action Inbox.

Each contact should support: - name; - role; - email; - LinkedIn/public
professional profile where appropriate; - first-contact date; - last
outbound email; - last inbound response; - conversation history; -
follow-up status; - next action; - relationship owner.

Initial sequence model:

**First Contact → No Response → Week 1 Follow-up → Week 2 → Week 3 →
Later/Dormant**

Useful views: - Follow up today - This week - Awaiting reply - Reply
received - Call to organize - Recontact later - No follow-up needed

Initial autonomy policy: - ORQO may read authorized communications. -
ORQO may identify overdue follow-ups. - ORQO may recommend follow-ups. -
ORQO may prepare drafts. - A human validates sending in the initial
product.

Do not silently introduce autonomous outbound messaging.

------------------------------------------------------------------------

# 10. Action Inbox

ORQO should provide a unified place for items that require human
intervention.

Example: "7 actions waiting for you · 3 follow-ups · 2 new opportunities
· 1 agent recommendation · 1 relationship reactivated."

Users can: - approve; - reject; - edit; - defer; - open context.

The philosophy is:

**Agents work behind the scenes; humans see decisions requiring
attention.**

------------------------------------------------------------------------

# 11. Intelligence

Intelligence combines market intelligence and relationship/company
signals.

## 11.1 Market Intelligence

The Market Intelligence Agent uses Company Context to decide what news
matters.

Potential categories: - strategic partners; - products and
technologies; - market trends; - startups; - product launches; -
funding; - expansion; - partnerships; - acquisitions; - strategic
hires; - events; - partner roadshows.

Each item should contain: - date; - company; - category; - title; -
concise summary; - source; - retrieval date; - relevance to the
organization; - suggested action.

## 11.2 Signals

A news item can become a business signal.

Example:

Company X launches an Edge AI appliance → Signal Agent connects this to
an existing relationship → ORQO re-evaluates the company → dormant
opportunity becomes relevant → Action Inbox surfaces it.

Target chain:

**News → Signal → Re-evaluation → Recommendation → Opportunity → Network
resurfacing**

------------------------------------------------------------------------

# 12. Events Intelligence

Events live mainly in Discover and become dedicated workspaces when
selected.

The Event Agent can identify: - trade shows; - conferences; - meetups; -
networking events; - hackathons when relevant; - partner events; -
roadshows.

Lifecycle:

**Upcoming → Evaluate → Selected → Attending → Past**

## Before an event

ORQO may: - retrieve available exhibitor/participant information; -
analyze companies; - compare them with Company Context; - prioritize
targets; - explain why each target matters; - identify possible
contacts; - prepare meeting objectives.

## During

Users can: - add people met; - add notes; - add discussion context; -
create/enrich relationships.

## After

ORQO can produce: - companies met; - interesting companies not met; -
opportunities; - follow-ups; - calls to organize; - watchlist; - signals
to monitor.

A past event remains a permanent source of relationships and
opportunities.

------------------------------------------------------------------------

# 13. Dashboard

Dashboard is secondary, not the home.

It summarizes: - pipeline; - opportunities; - follow-ups due; -
signals; - new recommendations; - active missions; - agent activity; -
Action Inbox; - recent outcomes; - key business-development metrics.

Dashboard should emphasize action and results, not decorative metrics.

------------------------------------------------------------------------

# 14. Next Best Action

Every meaningful company, contact, relationship and opportunity should
attempt to answer:

> **What should I do next?**

Examples: - contact VP Partnerships; - ask for BOM; - propose NDA; -
wait for European launch; - follow up in seven days; - organize
technical call; - meet at Event X; - re-analyze after a funding
announcement.

The recommendation must be evidence-based and explainable.

------------------------------------------------------------------------

# 15. "Why Now?" principle

Every major recommendation should answer:

1.  **Why this company?**
2.  **Why this opportunity?**
3.  **Why now?**

Timing is a first-class business-development variable.

A good strategic fit can still be too early or too late.

ORQO must be able to represent: - relevant now; - relevant but too
early; - dormant; - reactivated; - no longer relevant.

------------------------------------------------------------------------

# 16. Opportunity model

An opportunity is not merely a compatibility score.

A useful opportunity should include: - title; - opportunity type; -
parties; - Why Now; - what Company A brings; - what Company B brings; -
proposed business structure; - evidence; - assumptions; - unknowns; -
risks; - missing information; - qualification; - next step; - status; -
outcome.

Possible structures: - customer; - supplier; - OEM; - ODM; - technology
integration; - reseller; - distribution; - strategic partnership; -
co-development; - event partnership; - other justified structures.

------------------------------------------------------------------------

# 17. Opportunity Simulator

From a company or relationship, users can ask:

> "Imagine all realistic ways we could work together."

Relevant agents generate multiple plausible business structures.

A Critic/Qualification Agent challenges them.

Do not return generic brainstorming as qualified opportunity.

------------------------------------------------------------------------

# 18. Missing Piece Discovery

ORQO should support:

**A + B = incomplete opportunity → missing capability X → search
Network/Web for C**

Example: - Company A has technology. - Company B can
manufacture/integrate. - Opportunity lacks European distribution. - ORQO
searches for Company C.

This capability uses the Opportunity/Relationship Graph and web
research.

------------------------------------------------------------------------

# 19. Original Agent-to-Agent concept --- preserve

The original ORQO relationship concept remains important.

Once a relationship exists: - each person/company can be represented by
a Business Agent; - agents can analyze capabilities, needs, markets and
goals; - bilateral reasoning looks for mutual value; - opportunities can
be proposed; - humans remain in control; - double consent can produce a
Business Match; - ORQO can prepare the next meeting; - outcomes are
tracked; - relationships are continuously re-evaluated.

Potential states:

**Discovered → Interested → Mutual Interest → Meeting → Qualified →
Pilot → Partnership / Customer / Revenue**

or:

**Rejected / Dormant**

## Re-evaluation

Old relationships must be reconsidered when context changes: - new
product; - new geography; - funding; - hiring; - distribution change; -
strategic partnership; - new requirement; - relevant event.

## Multi-company opportunities

ORQO must preserve the A+B+C concept and expand it through Missing Piece
Discovery.

------------------------------------------------------------------------

# 20. Explainability and evidence

ORQO must distinguish:

### FACT

Directly supported by a source or authorized internal record.

### INFERENCE

Reasoned conclusion based on facts.

### ASSUMPTION

Working hypothesis that requires validation.

### UNKNOWN

Information not yet established.

Every important external claim should retain: - source; - source
URL/reference; - retrieval timestamp; - provenance; - confidence/quality
metadata when appropriate.

Important recommendations should offer:

**Why is ORQO recommending this?**

with: - Evidence - Reasoning - Assumptions - Missing information -
Agents involved - Sources

Do not present model inference as researched fact.

------------------------------------------------------------------------

# 21. Web Intelligence Layer

Internet access is a core infrastructure requirement.

Target pipeline:

**Search → Crawl → Extract → Verify → Evidence Store → Agents →
Reasoning**

Candidate architecture v1: - Brave Search for broad/current search; -
Exa for semantic/deep discovery where useful; - Firecrawl for website
extraction/crawling; - provider abstraction so components can be
replaced.

All agent tools should call an internal ORQO tool layer rather than
hardcoding vendor APIs throughout business logic.

Examples: - `web.search` - `web.news` - `web.crawl` - `web.extract` -
`company.research` - `contact.research` - `event.research`

Respect robots, provider terms, privacy rules and applicable law.

"Publicly accessible" does not mean "collect and retain indefinitely."

------------------------------------------------------------------------

# 22. Agents --- product model

ORQO is an organization of specialized agents, not a single chatbot.

## 22.1 Core hierarchy concept

**ORQO Orchestrator** - Head of Prospecting - Research Agent -
Prospecting Agent - Contact Agent - Event Agent - Head of Business
Development - Business Development Agent - Partnership Agent -
Opportunity Agent - Follow-up Agent - Head of Intelligence - Market
Intelligence Agent - Signal Agent - Technical Agent

Exact hierarchy must be configurable.

## 22.2 Core Agent responsibilities

### ORQO Orchestrator

Understands user intent, Company Context and Strategic Goals; delegates
work; consolidates results; enforces policies.

### Research Agent

Broad company and market research with evidence.

### Prospecting Agent

Finds new companies matching strategic targeting logic.

### Contact Agent

Identifies appropriate public professional interlocutors and manages
contact intelligence within allowed policies.

### Technical Agent

Analyzes products, hardware, software, architectures and technical
compatibility.

### Business Development Agent

Translates capabilities/needs into concrete business structures.

### Partnership Agent

Focuses on strategic partnership models.

### Opportunity Agent

Builds structured opportunities.

### Critic / Qualification Agent

Challenges weak claims, unsupported assumptions and poor-fit
opportunities.

### Event Agent

Finds and analyzes events and exhibitors.

### Relationship Agent

Maintains relationship context and business memory.

### Follow-up Agent

Tracks next actions and follow-up cadence.

### Market Intelligence Agent

Finds relevant market developments.

### Signal Agent

Connects changes to companies, relationships and opportunities.

Additional agents can be introduced without changing the main
navigation.

------------------------------------------------------------------------

# 23. Agent Registry and configuration

Each agent should be represented by structured configuration, not merely
a prompt.

Possible fields: - id; - organization_id; - name; - description; -
role; - system instructions; - manager_agent_id; - team; -
managed_agents; - collaboration rules; - responsibilities; - priority; -
tools; - data scopes; - Internet access; - model policy; - autonomy
level; - output schemas; - evaluation profile; - status; -
permanent/mission; - created_by; - version; - timestamps.

------------------------------------------------------------------------

# 24. Agent hierarchy

Agents should have a visual organization chart.

Users with permission can: - drag/drop an agent under another; - change
manager; - create teams; - promote/demote; - change responsibilities; -
modify collaboration; - edit permissions; - modify tool access; - change
autonomy.

**This is not cosmetic.**

Changing hierarchy must change orchestration behavior.

------------------------------------------------------------------------

# 25. Agent selection

For some requests, users can select a lead agent: - Technical; -
Business Development; - Partnership; - Prospecting; - etc.

Alternatively, the Orchestrator automatically selects the correct team.

The interface should not force agent selection for normal use.

------------------------------------------------------------------------

# 26. Agent Missions

Missions allow temporary teams without creating new product sections.

Examples: - "CES 2027" - "INFODIP US → Europe Opportunities Q4"

A Mission may contain: - objective; - owner; - start/end; - assigned
agents; - tasks; - sources; - outputs; - status; - results; - archived
history.

Agents can be temporarily assembled around the mission.

------------------------------------------------------------------------

# 27. Agent Library and Create Custom Agent

Agents space contains:

1.  **Core Agents**
2.  **Add an Agent**
3.  **Create Custom Agent**

## Add an Agent

Catalog of preconfigured agents that can be activated.

## Create Custom Agent

User describes the desired collaborator in text or voice.

ORQO must **compile** this request into a structured agent
configuration.

Do not simply save the raw user prompt as the system prompt.

Generated configuration should include: - name; - role; - mission; -
goals; - tools; - Internet permissions; - data permissions; - manager; -
collaborators; - model policy; - autonomy; - output schema; -
trigger/frequency; - evaluation criteria; - expiration if
mission-specific.

User reviews configuration before activation.

Support: - **Permanent Agent** - **Mission Agent**

------------------------------------------------------------------------

# 28. Agent autonomy and human control

Suggested levels:

### Level 0 --- Observe

Can read permitted information.

### Level 1 --- Recommend

Can produce recommendations.

### Level 2 --- Prepare

Can prepare drafts/actions but requires human approval.

### Level 3 --- Execute

Can perform explicitly authorized actions.

High-impact external actions should default to human approval until
deliberately enabled.

Permissions must be enforced in code/tooling, not merely in prompts.

------------------------------------------------------------------------

# 29. Organizational learning

Feedback options can include: - Relevant - Not relevant - Too early -
Wrong company - Wrong contact - Already discussed - Other + reason

Feedback should improve: - targeting preferences; - ranking; -
recommendation rules; - agent context; - evaluation datasets.

Do not implement opaque uncontrolled self-training.

Learning should be auditable and reversible where appropriate.

------------------------------------------------------------------------

# 30. Accounts and Organizations

ORQO V2 is a multi-tenant SaaS architecture.

Distinguish: - User - Organization / Company Workspace - Membership

A company workspace owns its business data.

Multiple users can belong to the same workspace.

Potential roles: - Owner - Admin - Member - Viewer

A user may later belong to multiple organizations.

Required account capabilities: - sign up; - login; - logout; - email
verification; - password reset/recovery; - personal profile; -
language/preferences; - invitations; - membership management.

------------------------------------------------------------------------

# 31. Tenant isolation

Tenant isolation is a non-negotiable requirement.

No data from Organization A may appear in Organization B.

Every tenant-owned entity should be scoped to the organization.

Use database-level controls such as Postgres Row Level Security where
appropriate.

Do not rely only on frontend filtering.

Test cross-tenant isolation explicitly.

------------------------------------------------------------------------

# 32. Persistence and data model

PostgreSQL is the primary transactional source of truth.

Core entities should include at minimum: - organizations; - users; -
memberships; - company_profiles; - strategic_goals; - companies; -
contacts; - relationships; - emails / communication metadata; -
meetings; - events; - event_companies; - opportunities; -
opportunity_parties; - follow_ups; - signals; - intelligence_items; -
sources; - evidence/claims; - agents; - agent_versions; -
agent_relationships; - missions; - mission_agents; - agent_runs; -
tool_runs; - recommendations; - feedback; - action_inbox_items; -
audit_events.

Exact schema is to be designed during migration planning and implemented
through migrations.

No production-critical state should remain browser-local.

------------------------------------------------------------------------

# 33. Memory architecture

ORQO should use three distinct memory layers.

## 33.1 Transactional Business Memory

PostgreSQL.

Stores what happened: - contacts; - meetings; - communications; -
companies; - opportunities; - statuses; - events; - actions.

## 33.2 Semantic Memory

Postgres + pgvector initially.

Stores embeddings/retrieval representations for: - notes; - analyses; -
documents; - meeting summaries; - company context; - relevant historical
text.

## 33.3 Relationship Intelligence

Neo4j.

Represents: - Person ↔ Company - Company ↔ Capability - Company ↔ Need -
Company ↔ Product - Company ↔ Market - Company ↔ Opportunity -
Opportunity ↔ Missing Capability - Company ↔ Event - Person ↔
Relationship

Principle:

**Postgres remembers what happened.\
Semantic memory helps retrieve what it meant.\
Neo4j models how business entities are connected.**

Postgres remains the system of record.

------------------------------------------------------------------------

# 34. Neo4j role

Neo4j must not be the sole database for V2.

Use it for: - Opportunity Graph; - Relationship Graph; - multi-hop
discovery; - Missing Piece Discovery; - A+B+C reasoning support; - graph
visualization; - GraphRAG experiments where justified.

Synchronize graph projections from canonical business data deliberately.

Do not create two uncontrolled sources of truth.

------------------------------------------------------------------------

# 35. LLM and model architecture

ORQO must remain model-agnostic.

Use OpenRouter as the initial gateway abstraction.

Different agents/tasks may use different models.

Introduce a **Model Policy** concept: - quality tier; - cost tier; -
latency needs; - privacy constraints; - fallback models; - task type.

Examples: - Orchestrator: strong reasoning model. - Technical Agent:
model selected through technical evals. - Extraction/classification:
cheaper fast model. - Follow-up drafting: writing-optimized model. -
Critic: potentially different model family from generator.

Never hardcode the entire product around a single model name.

Model choices should be configuration, not architecture.

------------------------------------------------------------------------

# 36. Agent orchestration

Target orchestration architecture v1: - LangGraph or equivalent stateful
graph orchestration; - ORQO-owned Agent Registry; - ORQO-owned
tool/permission layer; - OpenRouter for model access.

Use deterministic code for: - permissions; - database writes; - tenant
checks; - state transitions; - validation; - high-impact actions.

Use agentic reasoning for: - research strategy; - synthesis; -
opportunity reasoning; - prioritization; - recommendations.

Avoid an uncontrolled swarm of agents.

------------------------------------------------------------------------

# 37. Communications integration

Target integration candidate: Nylas or an equivalent abstraction.

Potential scopes: - email; - calendar; - contacts; - scheduling.

Initial principles: - least privilege; - explicit connection/consent; -
secure token handling; - provider terms respected; - human validation
for outbound actions initially.

External CRM integration can be added later through a unified provider
such as Merge or direct connectors if justified.

Do not rebuild Salesforce inside ORQO.

------------------------------------------------------------------------

# 38. Voice

Voice is optional for initial V2.

Potential uses: - Create Custom Agent; - command center; - quick event
notes; - meeting notes where lawful and consented.

Speech-to-text provider must be abstracted.

Do not make voice a dependency of core business logic.

------------------------------------------------------------------------

# 39. Observability and agent evaluation

Agent quality must be measurable.

Use an observability/evaluation platform such as Langfuse or equivalent.

Capture where appropriate: - agent run; - model; - prompt/version; -
tool calls; - retrieval; - latency; - tokens; - cost; - failures; - user
feedback; - outcome.

Create an **ORQO Golden Dataset** with real representative
business-development cases.

Evaluate: - research accuracy; - evidence quality; - opportunity
relevance; - false-positive rate; - unsupported claims; - contact
relevance; - timing/Why Now quality; - next-action usefulness.

Agents must become competent through: - better instructions; - better
tools; - better context; - better retrieval; - model selection; -
evaluation; - controlled feedback.

Do not claim an agent is "trained" unless actual model
training/fine-tuning occurred.

------------------------------------------------------------------------

# 40. Background and long-running work

Initial V2 should avoid unnecessary infrastructure.

Start with: - normal asynchronous/background jobs; - stateful agent
orchestration; - retries/idempotency.

Introduce a durable workflow system such as Inngest/Temporal only when
actual workload requires it.

Potential future uses: - long-running research; - market intelligence
refresh; - large event imports; - scheduled re-evaluation; - workflows
waiting for human approval.

------------------------------------------------------------------------

# 41. FR / EN localization

French and English must be first-class.

Localization covers: - navigation; - buttons; - forms; - settings; -
errors; - onboarding; - agent labels; - generated analyses; - generated
drafts; - notifications; - dates/locale formatting where appropriate.

Do not implement partial hardcoded translation.

User language preference belongs to account/workspace preferences.

Generated AI content should respect the active/requested language.

------------------------------------------------------------------------

# 42. Design direction

The existing redesign work should be treated as a reference, not
discarded blindly.

V2 design direction: - light; - open; - positive; - premium; - calm; -
modern cloud SaaS; - minimal; - business-oriented; - highly readable; -
desktop-first initially; - responsive architecture.

Avoid: - dark hacker/coder aesthetic; - excessive gradients; - dense
dashboards; - too many navigation sections; - decorative complexity; -
exposing raw multi-agent complexity to ordinary users.

Search Home should feel closer to a high-quality search/command product
than to a CRM dashboard.

Important concepts should be visual: - agent work/progress; -
timeline; - relationship graph; - opportunity structure; - Next Best
Action; - Action Inbox; - sources/evidence.

Design redesign is its own controlled phase. Do not combine massive
visual rewrite with database/auth migration unless explicitly planned.

------------------------------------------------------------------------

# 43. Security, Privacy, GDPR and Data Governance by Design

Security/privacy are architectural requirements, not launch polish.

Plan for: - privacy by design/default; - data minimization; - purpose
limitation; - retention policies; - deletion/export workflows; -
appropriate legal bases where applicable; - data subject rights where
applicable; - subprocessor inventory; - international-transfer
assessment; - cookie/tracker controls where applicable; - privacy
policy; - terms of use; - vendor/model data policies; - secure
secrets; - encryption in transit and appropriate encryption at rest; -
authentication; - authorization; - RLS; - RBAC; - audit trails; - agent
data permissions; - least privilege; - secure API tokens; - logging
policies; - PII handling; - incident-response planning.

Public web data must have explicit collection/retention rules.

Professional contact data must be treated carefully.

Before public launch, perform jurisdiction-specific legal review.
Technical architecture is not a legal compliance guarantee.

------------------------------------------------------------------------

# 44. Data recovery and reliability

Distinguish:

## Account Recovery

Password reset, verification, access recovery, optional MFA.

## Platform Backups

Automatic managed database backups.

## Company Export

Owner/Admin can export important company data in usable formats.

## Deletion Recovery

Trash/soft-delete or recovery mechanisms where appropriate.

## Version History

For selected high-value records/configurations.

## Audit Log

Who/what changed what and when, including agent-originated changes.

## Restore

Prefer selective restore before implementing dangerous "restore entire
workspace to yesterday" behavior.

No silent data loss.

Database migrations must be versioned and reversible where practical.

------------------------------------------------------------------------

# 45. External actions and safety

Agent permissions must be enforceable.

Examples of sensitive actions: - send email; - delete company; - change
permissions; - export data; - connect external account; - publish
information; - modify agent autonomy; - execute CRM writes.

Require explicit authorization and, initially, human approval for
high-impact external actions.

Custom agents cannot grant themselves permissions.

------------------------------------------------------------------------

# 46. Technology architecture v1.0

Target stack:

-   **Frontend:** Next.js + React + TypeScript
-   **Backend:** TypeScript services / Next.js server boundaries, with
    clean service abstractions
-   **Primary database:** Supabase PostgreSQL
-   **Authentication:** Supabase Auth initially
-   **Tenant isolation:** Postgres RLS + application authorization
-   **Semantic memory:** pgvector initially
-   **Graph:** Neo4j
-   **LLM gateway:** OpenRouter
-   **Models:** provider/model agnostic
-   **Agent orchestration:** LangGraph + ORQO Agent Registry
-   **Web search:** Brave + Exa behind internal abstraction
-   **Website crawl/extraction:** Firecrawl behind internal abstraction
-   **Email/calendar/contacts:** Nylas candidate
-   **CRM:** Merge or direct connectors later
-   **Voice:** provider abstraction; ElevenLabs candidate later
-   **Observability/evals:** Langfuse candidate
-   **Background jobs:** simple first; Inngest/Temporal only when
    justified
-   **Tool protocol:** internal typed tools + MCP where useful
-   **Hosting:** decide before production deployment
-   **Mobile:** later, shared backend/API

Vendor substitutions are allowed if implementation testing demonstrates
a materially better fit. The abstraction boundaries must make
substitution possible.

------------------------------------------------------------------------

# 47. Internal architecture principles

1.  **No vendor-specific business logic scattered across UI.**
2.  **All external providers sit behind adapters/services.**
3.  **Postgres is canonical business data.**
4.  **Neo4j is derived relationship intelligence, not canonical account
    data.**
5.  **Model names are configuration.**
6.  **Agent permissions are code-enforced.**
7.  **Evidence/provenance are first-class data.**
8.  **Human approval is first-class workflow state.**
9.  **Every tenant-owned record is tenant-scoped.**
10. **Background jobs are idempotent where possible.**
11. **External writes must be auditable.**
12. **No fake integrations.**

------------------------------------------------------------------------

# 48. Current prototype --- preservation requirements

The migration must inspect the existing repository before deciding exact
preservation mechanics.

Conceptually, preserve: - ORQO identity and opportunity-discovery
thesis; - bilateral reasoning; - opportunity generation; -
critic/qualification behavior; - human consent; - Business Match; -
signal-driven re-evaluation; - multi-company opportunity graph; - manual
demo journey where still useful; - presentation/demo mode where still
useful; - deterministic fallback behavior where it remains valuable; -
current working OpenRouter integration; - existing Neo4j
abstraction/code if reusable; - existing Brave abstraction/code if
reusable; - current design components that fit V2.

Do not assume an existing integration is live merely because code
exists.

During Phase 0, classify every integration: - LIVE & TESTED -
IMPLEMENTED BUT UNCONFIGURED - MOCK/DEMO - DEAD/UNUSED - UNKNOWN

------------------------------------------------------------------------

# 49. No-fake-integration rule

A feature may only be labeled "integrated," "connected," "live," or
"working" if: - credentials/configuration exist where required; - the
real provider is called; - a real response is observed; - failure
behavior is handled; - the integration is tested.

Otherwise label it clearly: - interface prepared; - mock; - demo data; -
not configured; - not tested.

This rule applies to OpenRouter, Neo4j, Brave, Exa, Firecrawl, Nylas,
Supabase, Langfuse and every future provider.

------------------------------------------------------------------------

# 50. Migration strategy

No big-bang rewrite.

Target phases:

## Phase 0 --- Repository Audit & Architecture Freeze

Inspect the current repository. Produce migration map. No broad
implementation.

## Phase 1 --- SaaS Foundation

Postgres/Supabase, Auth, Organizations, memberships, RLS, persistence,
migrations, localization foundation.

## Phase 2 --- ORQO Shell & Design System

New navigation, Search Home, FR/EN UI, Company/Account settings,
controlled redesign.

## Phase 3 --- Web Intelligence & Company Analysis

Web provider layer, Evidence Store, URL/company analysis, Company
Context comparison.

**Milestone:** first genuinely useful ORQO V2 workflow.

## Phase 4 --- Agent Infrastructure

Agent Registry, Orchestrator, core agents, model policies, tool
permissions, LangGraph orchestration.

## Phase 5 --- Discover & Prospecting

Suggestions, company/contact discovery, Why Now, Next Best Action,
refresh flows.

## Phase 6 --- Network & Follow-ups

Relationships, contacts, communication integration, timeline, S1/S2/S3,
Action Inbox.

## Phase 7 --- Intelligence & Signals

Market intelligence, signals, re-evaluation.

## Phase 8 --- Events Intelligence

Event discovery, exhibitors, before/during/after workflows.

## Phase 9 --- Agent Organization

Agent library, custom agents, hierarchy drag/drop, missions, optional
voice.

## Phase 10 --- Opportunity Graph

Neo4j production graph, A+B+C, Missing Piece Discovery.

## Phase 11 --- Advanced Opportunity Intelligence

Opportunity Simulator, richer organizational learning, advanced memory.

## Phase 12 --- Hardening

Privacy, security, recovery, audit, observability, evaluations,
performance, cost controls.

## Phase 13 --- Production Deployment

Production hosting, domain, monitoring, production secrets, operational
readiness.

## Phase 14 --- Mobile

Mobile product using the same backend/business architecture.

Each phase: **branch → implementation prompt → implementation → tests →
review → commit → merge**

Do not advance while critical regressions remain.

------------------------------------------------------------------------

# 51. Testing requirements

Every phase must define: - unit tests; - integration tests; - end-to-end
tests where relevant; - migration tests; - tenant isolation tests; -
permission tests; - error-state tests; - provider failure tests; -
regression tests for existing ORQO behavior.

Critical flows must not rely only on manual visual testing.

------------------------------------------------------------------------

# 52. Definition of Done for a feature

A feature is not done because UI exists.

Done means: - behavior implemented; - persistence correct; - permissions
correct; - loading/error/empty states exist; - real integration tested
if applicable; - sources/provenance retained where applicable; - FR/EN
considered; - telemetry/observability considered; - tests pass; - no
known regression; - documentation updated.

------------------------------------------------------------------------

# 53. Cost and performance principles

Track: - model spend; - search/crawl spend; - provider calls; - token
use; - latency; - retries; - cache effectiveness.

Use expensive reasoning only where it adds value.

Do not run every agent for every request.

The Orchestrator should select the minimum sufficient team.

Cache public research intelligently, but refresh when the user
explicitly requests fresh information.

------------------------------------------------------------------------

# 54. Product roadmap constraints

Do not prematurely implement: - autonomous outbound sales; - complex CRM
replacement; - full mobile app; - full Temporal infrastructure; -
uncontrolled autonomous background agents; - opaque self-training; -
excessive top-level navigation; - public launch before security/privacy
hardening.

------------------------------------------------------------------------

# 55. Success criteria

ORQO V2 succeeds if a user can:

1.  Create/log into an organization.
2.  Configure their company once.
3.  Paste a target company URL.
4.  Receive sourced, current research.
5.  Understand realistic ways to work together.
6.  See Why This Company / Why This Opportunity / Why Now.
7.  Know the Next Best Action.
8.  Save the relationship/company.
9.  Track contacts, meetings and follow-ups.
10. Receive relevant new signals.
11. Re-evaluate dormant relationships.
12. Discover new companies/events proactively.
13. Understand why ORQO recommends something.
14. Configure an agent organization without seeing backend complexity.
15. Trust that data is isolated, recoverable and governed.

------------------------------------------------------------------------

# 56. Non-negotiable implementation rules

For every implementation agent and every phase:

1.  **Inspect before modifying.**
2.  **Preserve validated behavior unless explicitly replaced.**
3.  **No destructive rewrite without explicit justification and
    approval.**
4.  **No fake integrations.**
5.  **No regression.**
6.  **No silent data loss.**
7.  **No cross-tenant leakage.**
8.  **No unsupported claim presented as fact.**
9.  **No high-impact autonomous action without permission.**
10. **Test real behavior.**
11. **Prefer incremental migrations.**
12. **Document architectural decisions.**
13. **Keep provider abstractions replaceable.**
14. **Keep ORQO model-agnostic.**
15. **Do not expose technical complexity unnecessarily in UX.**

------------------------------------------------------------------------

# 57. Source-of-truth instruction

This Master Specification defines the intended ORQO V2 destination.

A phase prompt defines what is allowed to change **now**.

If a phase prompt conflicts with this document, the conflict must be
surfaced before implementation.

Do not silently reinterpret the product.

Do not implement future phases opportunistically unless required as a
minimal dependency and explicitly documented.

------------------------------------------------------------------------

# 58. Immediate next step

Run **Phase 0 --- Repository Audit & Architecture Freeze** using the
separate Phase 0 Migration Prompt.

Phase 0 must inspect the actual repository and convert this high-level
architecture into a repository-specific migration plan.

**Phase 0 is analysis/planning. It is not authorization for a V2
rewrite.**
