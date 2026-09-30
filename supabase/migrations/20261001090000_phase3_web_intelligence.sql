-- ORQO V2 · Phase 3 · Web intelligence & company analysis
-- Adds: own-company profile fields used for comparison, research runs (with an
-- atomic, server-called quota/concurrency guard), per-organization company
-- intelligence, a normalized evidence store linked to `sources`, and a usage
-- ledger for variable-cost provider calls. Every table is organization-scoped,
-- RLS default-deny, and unreachable by anon and service_role.

-- ---------------------------------------------------------------------------
-- Own-company profile (Company Context, focused subset)
-- ---------------------------------------------------------------------------
alter table public.companies
  add column offerings text[] not null default '{}',
  add column customer_segments text[] not null default '{}',
  add column sought_capabilities text[] not null default '{}',
  add column partnership_goals text[] not null default '{}',
  add constraint companies_profile_list_sizes check (
    cardinality(offerings) <= 30 and cardinality(customer_segments) <= 30
    and cardinality(sought_capabilities) <= 30 and cardinality(partnership_goals) <= 9
  ),
  add constraint companies_partnership_goals_values check (
    partnership_goals <@ array['customer', 'supplier', 'technology_partner', 'oem', 'integration', 'channel', 'strategic', 'co_development', 'market_entry']::text[]
  );

-- Source authority: official site, retrieved third-party page, or search snippet only.
alter table public.sources
  add column authority text check (authority is null or authority in ('official', 'third_party', 'search_result'));

-- ---------------------------------------------------------------------------
-- Research runs
-- ---------------------------------------------------------------------------
create type public.research_mode as enum ('basic', 'deep');
create type public.research_status as enum ('running', 'succeeded', 'failed');

create table public.research_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  mode public.research_mode not null,
  query text not null check (char_length(query) between 1 and 200),
  domain text check (domain is null or domain ~ '^[a-z0-9.-]{3,253}$'),
  status public.research_status not null default 'running',
  stage text not null default 'resolving' check (stage in ('resolving', 'sources', 'reading', 'structuring', 'comparing', 'evaluating', 'complete')),
  error_code text check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  -- Hard-limit accounting: search queries, pages, bytes, model calls.
  counters jsonb not null default '{}'::jsonb check (jsonb_typeof(counters) = 'object'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index research_runs_quota_idx on public.research_runs (organization_id, mode, started_at desc);

-- ---------------------------------------------------------------------------
-- Company intelligence (one current analysis per organization + domain)
-- ---------------------------------------------------------------------------
create table public.company_intelligence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  domain text not null check (domain ~ '^[a-z0-9.-]{3,253}$'),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  -- Folded name, for "search by name" cache hits.
  name_key text not null check (char_length(name_key) <= 200),
  mode public.research_mode not null,
  research_run_id uuid,
  -- Resolution, language, unknowns and the source map (key → sources.id, page type). Claims live in evidence_items.
  profile jsonb not null check (jsonb_typeof(profile) = 'object'),
  -- Deep research only: model hypotheses, re-validated by the deterministic critic on every read.
  hypotheses jsonb not null default '[]'::jsonb check (jsonb_typeof(hypotheses) = 'array'),
  researched_at timestamptz not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, domain),
  foreign key (organization_id, research_run_id) references public.research_runs (organization_id, id)
);
create index company_intelligence_name_idx on public.company_intelligence (organization_id, name_key);

-- ---------------------------------------------------------------------------
-- Evidence store: one row per claim, linked to a same-organization source
-- ---------------------------------------------------------------------------
create table public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  intelligence_id uuid not null,
  source_id uuid,
  claim_key text not null check (claim_key ~ '^[a-z][0-9]{1,4}$'),
  field text not null check (field in ('identity', 'summary', 'offering', 'product', 'customer', 'industry', 'geography', 'technology', 'business_model', 'strategy', 'need')),
  statement text not null check (char_length(statement) between 1 and 400),
  excerpt text check (excerpt is null or char_length(excerpt) <= 320),
  epistemic text not null check (epistemic in ('fact', 'inference', 'assumption', 'unknown')),
  method text not null check (method in ('structured_data', 'page_metadata', 'page_text', 'navigation', 'model_extraction')),
  concepts text[] not null default '{}' check (cardinality(concepts) <= 12),
  self_described boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, intelligence_id, claim_key),
  foreign key (organization_id, intelligence_id) references public.company_intelligence (organization_id, id) on delete cascade,
  foreign key (organization_id, source_id) references public.sources (organization_id, id),
  -- A fact must cite a source.
  check (epistemic <> 'fact' or source_id is not null)
);
create index evidence_items_intelligence_idx on public.evidence_items (organization_id, intelligence_id);

-- ---------------------------------------------------------------------------
-- Usage ledger for variable-cost provider calls (precursor of the Cost Ledger)
-- ---------------------------------------------------------------------------
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  research_run_id uuid,
  provider text not null check (provider ~ '^[a-z0-9_-]{1,40}$'),
  service text not null check (char_length(service) between 1 and 120),
  operation text not null check (operation in ('web_search', 'extraction', 'reasoning')),
  succeeded boolean not null,
  -- Provider-reported units (tokens, results…). Never estimated.
  units jsonb not null default '{}'::jsonb check (jsonb_typeof(units) = 'object'),
  -- Only when the provider returns it; never fabricated.
  cost_usd numeric(12, 6) check (cost_usd is null or cost_usd >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, research_run_id) references public.research_runs (organization_id, id)
);
create index usage_events_org_idx on public.usage_events (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers (reuse Phase 1 helpers)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['research_runs', 'company_intelligence'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
  end loop;
  foreach t in array array['research_runs', 'company_intelligence', 'usage_events'] loop
    execute format('create trigger set_created_by before insert on public.%I for each row execute function private.set_created_by()', t);
  end loop;
  foreach t in array array['research_runs', 'company_intelligence', 'evidence_items'] loop
    execute format('create trigger enforce_immutable_ownership before update on public.%I for each row execute function private.enforce_immutable_ownership()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Quota + concurrency guard (called by the server before any provider work)
-- ---------------------------------------------------------------------------
-- Atomically: verifies member role, refuses a second concurrent run for the
-- organization, counts runs of this mode in the window, and inserts the run.
-- The limits come from server configuration. Calling this RPC directly only
-- creates run rows (which count against the caller's own quota); it can never
-- trigger provider calls, which happen only in the server route.
create function public.start_research_run(
  p_organization_id uuid,
  p_mode public.research_mode,
  p_query text,
  p_domain text,
  p_max_runs integer,
  p_window_hours integer,
  p_stale_after_seconds integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  used integer;
  busy integer;
  run_id uuid;
begin
  if not private.has_org_role(p_organization_id, 'member') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_max_runs < 0 or p_max_runs > 1000 or p_window_hours not between 1 and 720 or p_stale_after_seconds not between 10 and 3600 then
    raise exception 'invalid limits' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('orqo.research:' || p_organization_id::text, 0));

  select count(*) into busy
  from public.research_runs r
  where r.organization_id = p_organization_id
    and r.status = 'running'
    and r.started_at > now() - make_interval(secs => p_stale_after_seconds);
  if busy > 0 then
    raise exception 'a research run is already in progress' using errcode = '55P03';
  end if;

  select count(*) into used
  from public.research_runs r
  where r.organization_id = p_organization_id
    and r.mode = p_mode
    and r.started_at > now() - make_interval(hours => p_window_hours);
  if used >= p_max_runs then
    raise exception 'research quota reached' using errcode = '54000';
  end if;

  insert into public.research_runs (organization_id, mode, query, domain)
  values (p_organization_id, p_mode, left(btrim(p_query), 200), p_domain)
  returning id into run_id;
  return run_id;
end;
$$;

revoke all on function public.start_research_run(uuid, public.research_mode, text, text, integer, integer, integer) from public, anon;
grant execute on function public.start_research_run(uuid, public.research_mode, text, text, integer, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges (default deny; anon and service_role get nothing)
-- ---------------------------------------------------------------------------
revoke all on public.research_runs, public.company_intelligence, public.evidence_items, public.usage_events from anon, authenticated, service_role;

-- Runs are created only by start_research_run; the server advances their state.
grant select on public.research_runs to authenticated;
grant update (stage, status, error_code, counters, finished_at, domain) on public.research_runs to authenticated;
grant select, insert, update, delete on public.company_intelligence, public.evidence_items to authenticated;
-- Append-only ledger.
grant select, insert on public.usage_events to authenticated;

alter table public.research_runs enable row level security;
alter table public.company_intelligence enable row level security;
alter table public.evidence_items enable row level security;
alter table public.usage_events enable row level security;

create policy research_runs_select on public.research_runs
  for select to authenticated using (private.has_org_role(organization_id, 'viewer'));
create policy research_runs_update on public.research_runs
  for update to authenticated
  using (private.has_org_role(organization_id, 'member'))
  with check (private.has_org_role(organization_id, 'member'));

do $$
declare
  t text;
begin
  foreach t in array array['company_intelligence', 'evidence_items'] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.has_org_role(organization_id, %L))', t || '_select', t, 'viewer');
    execute format('create policy %I on public.%I for insert to authenticated with check (private.has_org_role(organization_id, %L))', t || '_insert', t, 'member');
    execute format('create policy %I on public.%I for update to authenticated using (private.has_org_role(organization_id, %L)) with check (private.has_org_role(organization_id, %L))', t || '_update', t, 'member', 'member');
    execute format('create policy %I on public.%I for delete to authenticated using (private.has_org_role(organization_id, %L))', t || '_delete', t, 'member');
  end loop;
end;
$$;

-- Usage and cost metadata: readable by admins, written by members' server requests.
create policy usage_events_select on public.usage_events
  for select to authenticated using (private.has_org_role(organization_id, 'admin'));
create policy usage_events_insert on public.usage_events
  for insert to authenticated with check (private.has_org_role(organization_id, 'member'));
