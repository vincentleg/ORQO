-- ORQO V2 · Phase 1 · SaaS foundation
-- Tenancy (profiles, organizations, memberships), audit trail, and the minimum
-- tenant-owned tables the existing ORQO engine needs to evaluate a relationship
-- server-side. The organization is the security boundary: every tenant row
-- carries organization_id, and RLS checks membership of auth.uid() in the
-- database. Browser-supplied organization ids are never trusted on their own.

-- ---------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------
-- `private` is not exposed through the Data API; RLS helpers and trigger
-- functions live here so they cannot be called as RPC endpoints.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Types (mirror the closed unions in src/lib/domain/types.ts)
-- ---------------------------------------------------------------------------
-- Declared in ascending order of privilege so roles compare with >=.
create type public.org_role as enum ('viewer', 'member', 'admin', 'owner');
create domain public.locale_code as text check (value in ('en', 'fr'));
create type public.visibility_level as enum ('public', 'network', 'connection', 'agent-only', 'private');
create type public.need_intensity as enum ('exploring', 'active', 'critical');
create type public.relationship_status as enum ('unevaluated', 'evaluating', 'dormant', 'watching', 'active', 'matched');
create type public.lifecycle_stage as enum ('discovered', 'interested', 'mutual-interest', 'meeting', 'qualified', 'pilot', 'partnership', 'revenue', 'rejected', 'dormant');
create type public.participant_role as enum ('software-vendor', 'hardware-partner', 'vendor', 'distributor', 'seller', 'buyer', 'partner');
create type public.source_kind as enum ('company-website', 'press-release', 'news', 'public-filing', 'self-reported', 'conversation', 'agent-inferred', 'simulated-signal', 'web-search');

-- ---------------------------------------------------------------------------
-- Identity & tenancy
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 120),
  locale public.locale_code not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  default_locale public.locale_code not null default 'en',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index organization_memberships_user_idx on public.organization_memberships (user_id);

-- Append-only. actor_id has no FK so history survives user deletion.
create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_type text not null check (actor_type in ('user', 'agent', 'system')),
  actor_id uuid,
  action text not null,
  target_table text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index audit_events_org_time_idx on public.audit_events (organization_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Tenant-owned ORQO domain tables
-- Child tables reference parents through (organization_id, id) composite keys,
-- so a row can never point at another organization's row, even for callers
-- that bypass RLS.
-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  website text check (website is null or website ~* '^https?://'),
  tagline text not null default '',
  summary text not null default '',
  headquarters text not null default '',
  size text not null default '',
  markets text[] not null default '{}',
  geographies text[] not null default '{}',
  -- Engine Objective[] / Constraint[]; normalised when the Company Context lands.
  objectives jsonb not null default '[]'::jsonb check (jsonb_typeof(objectives) = 'array'),
  constraints jsonb not null default '[]'::jsonb check (jsonb_typeof(constraints) = 'array'),
  -- The organization's own company (precursor of the V2 Company Profile).
  is_own_company boolean not null default false,
  -- Stable identifier from an external system or fixture; never the primary key.
  external_ref text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, external_ref)
);
create unique index companies_one_own_company_idx on public.companies (organization_id) where is_own_company;

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind public.source_kind not null,
  label text not null check (char_length(label) between 1 and 500),
  url text check (url is null or url ~* '^https?://'),
  retrieved_at timestamptz not null,
  simulated boolean not null default false,
  external_ref text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, external_ref)
);

create table public.company_capabilities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid not null,
  label text not null check (char_length(label) between 1 and 300),
  detail text not null default '',
  tags text[] not null default '{}',
  -- Engine EvidenceRef[]: [{ sourceId, excerpt, epistemic, marketingLanguage? }]
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  visibility public.visibility_level not null default 'public',
  observed_at timestamptz not null default now(),
  external_ref text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, company_id) references public.companies (organization_id, id) on delete cascade,
  unique (organization_id, external_ref)
);
create index company_capabilities_company_idx on public.company_capabilities (organization_id, company_id);

create table public.company_needs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid not null,
  label text not null check (char_length(label) between 1 and 300),
  detail text not null default '',
  tags text[] not null default '{}',
  intensity public.need_intensity not null default 'exploring',
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  visibility public.visibility_level not null default 'public',
  -- What agents may disclose to the counterparty for agent-only/private needs.
  disclosure text,
  observed_at timestamptz not null default now(),
  external_ref text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, company_id) references public.companies (organization_id, id) on delete cascade,
  unique (organization_id, external_ref)
);
create index company_needs_company_idx on public.company_needs (organization_id, company_id);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  role text not null default '',
  location text not null default '',
  bio text not null default '',
  external_ref text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, company_id) references public.companies (organization_id, id) on delete set null (company_id),
  unique (organization_id, id),
  unique (organization_id, external_ref)
);
create index contacts_company_idx on public.contacts (organization_id, company_id);

create table public.relationships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_a_id uuid not null,
  contact_b_id uuid not null,
  encounter_event text not null default '',
  encounter_location text not null default '',
  encountered_at timestamptz,
  encounter_note text not null default '',
  status public.relationship_status not null default 'unevaluated',
  agents_connected_at timestamptz,
  visibility public.visibility_level not null default 'connection',
  external_ref text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (contact_a_id <> contact_b_id),
  foreign key (organization_id, contact_a_id) references public.contacts (organization_id, id) on delete cascade,
  foreign key (organization_id, contact_b_id) references public.contacts (organization_id, id) on delete cascade,
  unique (organization_id, id),
  unique (organization_id, external_ref)
);

-- One engine evaluation of a relationship (engine `Evaluation`). Append-only;
-- the precursor of V2 agent_runs.
create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  relationship_id uuid not null,
  kind text not null default 'relationship_evaluation' check (kind in ('relationship_evaluation')),
  engine text not null check (engine = 'deterministic' or engine like 'openrouter:%'),
  trigger jsonb not null check (jsonb_typeof(trigger) = 'object'),
  outcome text not null check (outcome in ('opportunity', 'no-strong-opportunity')),
  summary text not null,
  rejected_hypotheses jsonb not null default '[]'::jsonb check (jsonb_typeof(rejected_hypotheses) = 'array'),
  watch_conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(watch_conditions) = 'array'),
  stages jsonb not null default '[]'::jsonb check (jsonb_typeof(stages) = 'array'),
  opportunity_ids uuid[] not null default '{}',
  ran_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, relationship_id) references public.relationships (organization_id, id) on delete cascade
);
create index analysis_runs_relationship_idx on public.analysis_runs (organization_id, relationship_id, ran_at);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Deterministic engine identity (pattern + participating companies). Lets a
  -- re-evaluation update the same opportunity; never used as the primary key.
  engine_key text not null check (char_length(engine_key) between 1 and 300),
  source_relationship_id uuid,
  pattern_id text not null,
  kind text not null check (kind in ('reciprocal', 'customer', 'multi')),
  title text not null check (char_length(title) between 1 and 300),
  types text[] not null default '{}',
  summary text not null default '',
  why_exists text not null default '',
  why_now text not null default '',
  structure text not null default '',
  -- Engine OpportunityEvidence[] (FACT / INFERENCE / ASSUMPTION + visibility).
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  assumptions text[] not null default '{}',
  unknowns text[] not null default '{}',
  questions text[] not null default '{}',
  risks text[] not null default '{}',
  next_step text not null default '',
  missing_capabilities text[] not null default '{}',
  driving_need_ids text[] not null default '{}',
  confidence jsonb not null check (jsonb_typeof(confidence) = 'object'),
  critic jsonb not null check (jsonb_typeof(critic) = 'object'),
  stage public.lifecycle_stage not null default 'discovered',
  stage_history jsonb not null default '[]'::jsonb check (jsonb_typeof(stage_history) = 'array'),
  trigger jsonb not null check (jsonb_typeof(trigger) = 'object'),
  engine text not null check (engine = 'deterministic' or engine like 'openrouter:%'),
  delta jsonb check (delta is null or jsonb_typeof(delta) = 'object'),
  discovered_at timestamptz not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, source_relationship_id) references public.relationships (organization_id, id) on delete set null (source_relationship_id),
  unique (organization_id, id),
  unique (organization_id, engine_key)
);

-- Companies taking part in an opportunity, with their role and contributions.
-- Participants are always companies of the same organization; future
-- cross-organization collaboration will go through an explicit sharing
-- mechanism, never through direct references across tenants.
create table public.opportunity_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  opportunity_id uuid not null,
  company_id uuid not null,
  role public.participant_role not null,
  contributions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, opportunity_id) references public.opportunities (organization_id, id) on delete cascade,
  foreign key (organization_id, company_id) references public.companies (organization_id, id) on delete cascade,
  unique (opportunity_id, company_id)
);
create index opportunity_participants_company_idx on public.opportunity_participants (organization_id, company_id);

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER with an empty search_path: they read
-- memberships without re-entering RLS, which would otherwise recurse)
-- ---------------------------------------------------------------------------
create function private.has_org_role(org uuid, min_role public.org_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.role >= min_role
  );
$$;

create function private.shares_organization_with(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships mine
    join public.organization_memberships theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = other_user
  );
$$;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Callers cannot choose who created a row.
create function private.set_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.created_by := (select auth.uid());
  end if;
  return new;
end;
$$;

-- Tenant ownership and identity never change after insert, so a member of two
-- organizations cannot move a row from one to the other.
create function private.enforce_immutable_ownership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id then
    raise exception 'id and organization_id are immutable' using errcode = '42501';
  end if;
  if to_jsonb(new) ? 'created_by' and (to_jsonb(new) -> 'created_by') is distinct from (to_jsonb(old) -> 'created_by') then
    raise exception 'created_by is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Evidence may only cite sources of the same organization.
create function private.assert_evidence_sources()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from jsonb_array_elements(new.evidence) as e
    where jsonb_typeof(e) <> 'object'
       or not exists (
         select 1 from public.sources s
         where s.organization_id = new.organization_id
           and s.id::text = e ->> 'sourceId'
       )
  ) then
    raise exception 'evidence references an unknown source' using errcode = '23503';
  end if;
  return new;
end;
$$;

-- Writes audit_events for changes to audited tables. Stores changed column
-- names, never column values, to keep personal data out of the audit trail.
create function private.audit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec jsonb;
  org uuid;
  entity text;
  verb text;
  meta jsonb := '{}'::jsonb;
  changed jsonb;
  actor uuid := (select auth.uid());
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org := case when tg_table_name = 'organizations' then (rec ->> 'id')::uuid else (rec ->> 'organization_id')::uuid end;

  -- Rows removed by an organization deletion cascade have nothing to attach to.
  if not exists (select 1 from public.organizations o where o.id = org) then
    return null;
  end if;

  entity := case tg_table_name
    when 'organizations' then 'organization'
    when 'organization_memberships' then 'membership'
    when 'companies' then 'company'
    when 'contacts' then 'contact'
    when 'relationships' then 'relationship'
    when 'opportunities' then 'opportunity'
    when 'analysis_runs' then 'analysis_run'
    else tg_table_name
  end;
  verb := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;

  if tg_op = 'UPDATE' then
    select coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb) into changed
    from jsonb_each(to_jsonb(new)) as n
    where n.key <> 'updated_at' and n.value is distinct from (to_jsonb(old) -> n.key);
    if changed = '[]'::jsonb then
      return null;
    end if;
    meta := jsonb_build_object('changed', changed);
  end if;

  if tg_table_name = 'organization_memberships' then
    meta := meta || jsonb_build_object('user_id', rec ->> 'user_id', 'role', rec ->> 'role');
    -- Nested: plpgsql does not short-circuit, and OLD is unassigned on INSERT.
    if tg_op = 'UPDATE' then
      if (to_jsonb(old) ->> 'role') is distinct from (rec ->> 'role') then
        verb := 'role_changed';
        meta := meta || jsonb_build_object('previous_role', to_jsonb(old) ->> 'role');
      end if;
    end if;
  end if;

  insert into public.audit_events (organization_id, actor_type, actor_id, action, target_table, target_id, metadata)
  values (org, case when actor is null then 'system' else 'user' end, actor, entity || '.' || verb, tg_table_name, (rec ->> 'id')::uuid, meta);
  return null;
end;
$$;

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, locale)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 120), ''),
    case when new.raw_user_meta_data ->> 'locale' in ('en', 'fr') then new.raw_user_meta_data ->> 'locale' else 'en' end
  );
  return new;
end;
$$;

revoke all on all functions in schema private from public;
grant execute on function private.has_org_role(uuid, public.org_role) to authenticated;
grant execute on function private.shares_organization_with(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'organizations', 'organization_memberships', 'companies', 'sources',
    'company_capabilities', 'company_needs', 'contacts', 'relationships', 'opportunities', 'opportunity_participants'
  ] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
  end loop;

  foreach t in array array[
    'companies', 'sources', 'company_capabilities', 'company_needs', 'contacts', 'relationships',
    'analysis_runs', 'opportunities'
  ] loop
    execute format('create trigger set_created_by before insert on public.%I for each row execute function private.set_created_by()', t);
  end loop;

  foreach t in array array[
    'organization_memberships', 'companies', 'sources', 'company_capabilities', 'company_needs', 'contacts',
    'relationships', 'analysis_runs', 'opportunities', 'opportunity_participants'
  ] loop
    execute format('create trigger enforce_immutable_ownership before update on public.%I for each row execute function private.enforce_immutable_ownership()', t);
  end loop;

  foreach t in array array[
    'organizations', 'organization_memberships', 'companies', 'contacts', 'relationships', 'opportunities', 'analysis_runs'
  ] loop
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()', t);
  end loop;
end;
$$;

create trigger assert_evidence_sources
  before insert or update of evidence on public.company_capabilities
  for each row execute function private.assert_evidence_sources();
create trigger assert_evidence_sources
  before insert or update of evidence on public.company_needs
  for each row execute function private.assert_evidence_sources();

-- ---------------------------------------------------------------------------
-- RPC: organization lifecycle (the only way to create orgs and change roles)
-- ---------------------------------------------------------------------------
create function public.create_organization(p_name text, p_default_locale public.locale_code default 'en')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  org uuid;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if (select count(*) from public.organizations o where o.created_by = uid) >= 20 then
    raise exception 'organization limit reached' using errcode = '54000';
  end if;
  insert into public.organizations (name, default_locale, created_by)
  values (btrim(p_name), p_default_locale, uid)
  returning id into org;
  insert into public.organization_memberships (organization_id, user_id, role)
  values (org, uid, 'owner');
  return org;
end;
$$;

create function public.set_member_role(p_organization_id uuid, p_user_id uuid, p_role public.org_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  caller_role public.org_role;
  target_role public.org_role;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select m.role into caller_role
  from public.organization_memberships m
  where m.organization_id = p_organization_id and m.user_id = uid;
  -- Same error for non-members and insufficient roles: no organization enumeration.
  if caller_role is null or caller_role < 'admin' then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if p_user_id = uid then
    raise exception 'members cannot change their own role' using errcode = '42501';
  end if;
  select m.role into target_role
  from public.organization_memberships m
  where m.organization_id = p_organization_id and m.user_id = p_user_id
  for update;
  if target_role is null then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;
  if (p_role = 'owner' or target_role = 'owner') and caller_role <> 'owner' then
    raise exception 'only owners can grant or revoke the owner role' using errcode = '42501';
  end if;
  update public.organization_memberships
  set role = p_role
  where organization_id = p_organization_id and user_id = p_user_id;
end;
$$;

revoke all on function public.create_organization(text, public.locale_code) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, public.org_role) from public, anon;
grant execute on function public.create_organization(text, public.locale_code) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, public.org_role) to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges (least privilege; RLS below decides which rows)
-- ---------------------------------------------------------------------------
revoke all on
  public.profiles, public.organizations, public.organization_memberships, public.audit_events,
  public.companies, public.sources, public.company_capabilities, public.company_needs, public.contacts,
  public.relationships, public.analysis_runs, public.opportunities, public.opportunity_participants
from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, locale) on public.profiles to authenticated;
grant select on public.organizations to authenticated;
grant update (name, default_locale) on public.organizations to authenticated;
grant select on public.organization_memberships to authenticated;
grant select on public.audit_events to authenticated;
grant select, insert, update, delete on
  public.companies, public.sources, public.company_capabilities, public.company_needs, public.contacts,
  public.relationships, public.opportunities, public.opportunity_participants
to authenticated;
grant select, insert on public.analysis_runs to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security (default deny: no policy, no access)
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.audit_events enable row level security;
alter table public.companies enable row level security;
alter table public.sources enable row level security;
alter table public.company_capabilities enable row level security;
alter table public.company_needs enable row level security;
alter table public.contacts enable row level security;
alter table public.relationships enable row level security;
alter table public.analysis_runs enable row level security;
alter table public.opportunities enable row level security;
alter table public.opportunity_participants enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_organization_with(id));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy organizations_select on public.organizations
  for select to authenticated
  using (private.has_org_role(id, 'viewer'));
create policy organizations_update on public.organizations
  for update to authenticated
  using (private.has_org_role(id, 'admin'))
  with check (private.has_org_role(id, 'admin'));

-- Memberships are written only by create_organization / set_member_role.
create policy memberships_select on public.organization_memberships
  for select to authenticated
  using (private.has_org_role(organization_id, 'viewer'));

-- Audit events are written only by triggers.
create policy audit_events_select on public.audit_events
  for select to authenticated
  using (private.has_org_role(organization_id, 'admin'));

do $$
declare
  t text;
begin
  foreach t in array array[
    'companies', 'sources', 'company_capabilities', 'company_needs', 'contacts',
    'relationships', 'opportunities', 'opportunity_participants'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.has_org_role(organization_id, %L))', t || '_select', t, 'viewer');
    execute format('create policy %I on public.%I for insert to authenticated with check (private.has_org_role(organization_id, %L))', t || '_insert', t, 'member');
    execute format('create policy %I on public.%I for update to authenticated using (private.has_org_role(organization_id, %L)) with check (private.has_org_role(organization_id, %L))', t || '_update', t, 'member', 'member');
    execute format('create policy %I on public.%I for delete to authenticated using (private.has_org_role(organization_id, %L))', t || '_delete', t, 'member');
  end loop;
end;
$$;

create policy analysis_runs_select on public.analysis_runs
  for select to authenticated
  using (private.has_org_role(organization_id, 'viewer'));
create policy analysis_runs_insert on public.analysis_runs
  for insert to authenticated
  with check (private.has_org_role(organization_id, 'member'));
