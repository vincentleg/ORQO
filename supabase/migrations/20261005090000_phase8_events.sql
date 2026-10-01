-- ORQO V2 · Phase 8 · Events
-- An event is a time-bounded BUSINESS DEVELOPMENT CONTEXT, not a directory:
--   * events: name, calendar dates, location, website (never fetched), mission;
--   * event_companies: which canonical companies the organization targets or
--     met at an event (planned / targeted / met / missed / skipped), with an
--     explainable priority and private preparation notes;
--   * an optional event reference on the canonical Phase 6 contacts,
--     interactions and follow-ups (no parallel CRM), plus follow-up origin
--     'event';
--   * companies.origin_event_id: the event through which a company first
--     entered the Network. Set at creation only; never re-pointed, so an
--     older origin (Search, Discover…) is never overwritten by a later event.
-- Everything is organization-scoped, RLS default-deny, composite-keyed to the
-- same organization, and unreachable by anon and service_role. Events are
-- archived, not deleted, so event provenance stays durable. Nothing is backfilled.

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 4000),
  -- Calendar days, no time zone precision is claimed. null = not set yet.
  starts_on date,
  ends_on date,
  location text not null default '' check (char_length(location) <= 200),
  -- Untrusted input: rendered as a link only, never fetched by ORQO.
  website text check (website is null or (char_length(website) <= 500 and website ~* '^https?://')),
  objective_kind text check (objective_kind is null or objective_kind in (
    'customers', 'technology_partners', 'distributors', 'existing_prospects', 'market_exploration', 'suppliers', 'investors', 'strategic_partners', 'custom'
  )),
  objective text not null default '' check (char_length(objective) <= 2000),
  topics text[] not null default '{}' check (cardinality(topics) <= 20),
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or (starts_on is not null and ends_on >= starts_on)),
  unique (organization_id, id)
);
create index events_org_dates_idx on public.events (organization_id, starts_on desc nulls last);

-- ---------------------------------------------------------------------------
-- Event companies: a canonical company in the context of one event
-- ---------------------------------------------------------------------------
create table public.event_companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  event_id uuid not null,
  company_id uuid not null,
  status text not null default 'targeted' check (status in ('planned', 'targeted', 'met', 'missed', 'skipped')),
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  -- Whether the company is expected there is what a person states, never inferred.
  attendance text not null default 'unknown' check (attendance in ('unknown', 'expected', 'meeting_booked')),
  -- PRIVATE: why the team wants to meet them, and preparation notes.
  why text not null default '' check (char_length(why) <= 2000),
  prep_notes text not null default '' check (char_length(prep_notes) <= 4000),
  -- After the event: a person looked at this target and decided no action is needed.
  reviewed_at timestamptz,
  status_changed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, event_id) references public.events (organization_id, id) on delete cascade,
  foreign key (organization_id, company_id) references public.companies (organization_id, id) on delete cascade,
  unique (organization_id, id),
  -- A company appears once per event (and may appear in many events).
  unique (organization_id, event_id, company_id)
);
create index event_companies_company_idx on public.event_companies (organization_id, company_id);

-- ---------------------------------------------------------------------------
-- Event references on the canonical Network model
-- ---------------------------------------------------------------------------
alter table public.companies add column origin_event_id uuid;
alter table public.companies
  add constraint companies_origin_event_fk foreign key (organization_id, origin_event_id)
  references public.events (organization_id, id) on delete set null (origin_event_id);

alter table public.contacts add column event_id uuid;
alter table public.contacts
  add constraint contacts_event_fk foreign key (organization_id, event_id)
  references public.events (organization_id, id) on delete set null (event_id);

alter table public.interactions add column event_id uuid;
alter table public.interactions
  add constraint interactions_event_fk foreign key (organization_id, event_id)
  references public.events (organization_id, id) on delete set null (event_id);
create index interactions_event_idx on public.interactions (organization_id, event_id) where event_id is not null;

alter table public.follow_ups add column event_id uuid;
alter table public.follow_ups
  add constraint follow_ups_event_fk foreign key (organization_id, event_id)
  references public.events (organization_id, id) on delete set null (event_id);
create index follow_ups_event_idx on public.follow_ups (organization_id, event_id) where event_id is not null;

alter table public.follow_ups drop constraint follow_ups_origin_check;
alter table public.follow_ups add constraint follow_ups_origin_check check (origin in ('manual', 'interaction', 'next_action', 'signal', 'event'));

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------
-- An event target is a Network company (never the own company); the database
-- records when its status changed.
create function private.event_company_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.companies c where c.organization_id = new.organization_id and c.id = new.company_id and c.is_own_company) then
      raise exception 'event targets are Network companies, not the own company' using errcode = '23514';
    end if;
    new.status_changed_at := null;
    new.reviewed_at := null;
  elsif new.status is distinct from old.status then
    new.status_changed_at := now();
  else
    new.status_changed_at := old.status_changed_at;
  end if;
  return new;
end;
$$;

-- Event provenance on a company is written once, at creation. It can be
-- cleared by the foreign key but never re-pointed to another event, so a
-- company met later at an event keeps its original origin.
create function private.keep_origin_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.origin_event_id is not null and new.origin_event_id is distinct from old.origin_event_id then
    new.origin_event_id := old.origin_event_id;
  end if;
  return new;
end;
$$;

revoke all on function private.event_company_lifecycle() from public;
revoke all on function private.keep_origin_event() from public;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['events', 'event_companies'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
    execute format('create trigger set_created_by before insert on public.%I for each row execute function private.set_created_by()', t);
    execute format('create trigger enforce_immutable_ownership before update on public.%I for each row execute function private.enforce_immutable_ownership()', t);
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()', t);
  end loop;
end;
$$;

create trigger event_company_lifecycle
  before insert or update on public.event_companies
  for each row execute function private.event_company_lifecycle();
create trigger keep_origin_event
  before update of origin_event_id on public.companies
  for each row execute function private.keep_origin_event();

-- ---------------------------------------------------------------------------
-- Privileges (least privilege; RLS below decides which rows)
-- ---------------------------------------------------------------------------
revoke all on public.events, public.event_companies from anon, authenticated, service_role;
-- Events are archived, never deleted by users: their provenance stays.
grant select, insert on public.events to authenticated;
grant update (name, description, starts_on, ends_on, location, website, objective_kind, objective, topics, archived_at) on public.events to authenticated;
-- An event target is re-attached by recreating it, never moved between events or companies.
grant select, insert, delete on public.event_companies to authenticated;
grant update (status, priority, attendance, why, prep_notes, reviewed_at) on public.event_companies to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security (default deny)
-- ---------------------------------------------------------------------------
alter table public.events enable row level security;
alter table public.event_companies enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['events', 'event_companies'] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.has_org_role(organization_id, %L))', t || '_select', t, 'viewer');
    execute format('create policy %I on public.%I for insert to authenticated with check (private.has_org_role(organization_id, %L))', t || '_insert', t, 'member');
    execute format('create policy %I on public.%I for update to authenticated using (private.has_org_role(organization_id, %L)) with check (private.has_org_role(organization_id, %L))', t || '_update', t, 'member', 'member');
  end loop;
end;
$$;
create policy event_companies_delete on public.event_companies
  for delete to authenticated using (private.has_org_role(organization_id, 'member'));
