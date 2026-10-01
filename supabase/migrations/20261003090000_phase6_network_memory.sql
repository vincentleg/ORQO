-- ORQO V2 · Phase 6 · Network intelligence & follow-ups
-- Turns Network companies into a private relationship memory:
--   * relationship metadata on companies (stage, origin, why it matters);
--   * richer contacts (email, phone, profile URL, notes, primary contact);
--   * interactions (meetings, calls, notes…) recorded by people;
--   * follow-ups (open / done / dismissed) with due dates;
--   * network_events: an append-only, trigger-written relationship history.
-- Everything is organization-scoped, RLS default-deny, composite-keyed to the
-- parent company of the same organization, and unreachable by anon and
-- service_role. Nothing is backfilled: older companies show "Not recorded"
-- until a person records real state.

-- ---------------------------------------------------------------------------
-- Relationship metadata on Network companies (null = not recorded)
-- ---------------------------------------------------------------------------
alter table public.companies
  add column network_stage text check (network_stage is null or network_stage in (
    'watching', 'identified', 'contacted', 'conversation', 'qualified', 'opportunity', 'customer_partner', 'dormant', 'not_relevant'
  )),
  add column network_origin text check (network_origin is null or network_origin in (
    'search', 'discover', 'event', 'manual', 'referral', 'existing'
  )),
  add column network_reason text not null default '' check (char_length(network_reason) <= 2000);

-- ---------------------------------------------------------------------------
-- Contacts: details people enter themselves (no enrichment, no scraping)
-- ---------------------------------------------------------------------------
alter table public.contacts
  add column email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  add column phone text check (phone is null or char_length(phone) between 3 and 50),
  add column profile_url text check (profile_url is null or (char_length(profile_url) <= 500 and profile_url ~* '^https?://')),
  add column notes text not null default '' check (char_length(notes) <= 4000),
  add column is_primary boolean not null default false;
-- At most one primary contact per company.
create unique index contacts_one_primary_idx on public.contacts (organization_id, company_id) where is_primary and company_id is not null;

-- ---------------------------------------------------------------------------
-- Interactions: what happened with the company, recorded by a person
-- ---------------------------------------------------------------------------
create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid not null,
  contact_id uuid,
  kind text not null check (kind in ('meeting', 'call', 'email', 'message', 'event', 'note', 'other')),
  occurred_at timestamptz not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  summary text not null default '' check (char_length(summary) <= 8000),
  outcome text not null default '' check (char_length(outcome) <= 2000),
  next_step text not null default '' check (char_length(next_step) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, company_id) references public.companies (organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete set null (contact_id),
  unique (organization_id, id)
);
create index interactions_company_time_idx on public.interactions (organization_id, company_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Follow-ups: what a person intends to do next, and whether it was done
-- ---------------------------------------------------------------------------
create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid not null,
  contact_id uuid,
  -- The interaction whose next step this follow-up came from, if any.
  interaction_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 4000),
  -- A calendar day, not an instant: "due on 3 Oct" means the same everywhere.
  due_on date,
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  origin text not null default 'manual' check (origin in ('manual', 'interaction', 'next_action')),
  assigned_to uuid references auth.users (id) on delete set null,
  closed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'open') = (closed_at is null)),
  foreign key (organization_id, company_id) references public.companies (organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete set null (contact_id),
  foreign key (organization_id, interaction_id) references public.interactions (organization_id, id) on delete set null (interaction_id),
  unique (organization_id, id)
);
create index follow_ups_company_idx on public.follow_ups (organization_id, company_id, status, due_on);
create index follow_ups_open_due_idx on public.follow_ups (organization_id, due_on) where status = 'open';

-- ---------------------------------------------------------------------------
-- Relationship history: append-only, written only by the triggers below.
-- Stores kinds, ids and enumerated values — never notes or personal details.
-- ---------------------------------------------------------------------------
create table public.network_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid not null,
  kind text not null check (kind in ('stage_changed', 'contact_added', 'follow_up_created', 'follow_up_done', 'follow_up_dismissed', 'follow_up_reopened')),
  subject_id uuid,
  actor_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  foreign key (organization_id, company_id) references public.companies (organization_id, id) on delete cascade
);
create index network_events_company_time_idx on public.network_events (organization_id, company_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------
-- Follow-up lifecycle is decided by the database: closed_at follows status,
-- and the assignee must be a member of the follow-up's organization.
create function private.follow_up_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is not null and not exists (
    select 1 from public.organization_memberships m
    where m.organization_id = new.organization_id and m.user_id = new.assigned_to
  ) then
    raise exception 'assignee is not a member of this organization' using errcode = '23503';
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.closed_at := case when new.status = 'open' then null else now() end;
  else
    new.closed_at := old.closed_at;
  end if;
  return new;
end;
$$;

create function private.record_network_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  -- Rows removed by an organization deletion cascade have nothing to attach to.
  if not exists (select 1 from public.organizations o where o.id = new.organization_id) then
    return null;
  end if;

  if tg_table_name = 'companies' then
    if new.network_stage is distinct from old.network_stage then
      insert into public.network_events (organization_id, company_id, kind, subject_id, actor_id, metadata)
      values (new.organization_id, new.id, 'stage_changed', null, actor,
              jsonb_build_object('from', old.network_stage, 'to', new.network_stage));
    end if;
  elsif tg_table_name = 'contacts' then
    if new.company_id is not null and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id) then
      insert into public.network_events (organization_id, company_id, kind, subject_id, actor_id)
      values (new.organization_id, new.company_id, 'contact_added', new.id, actor);
    end if;
  elsif tg_table_name = 'follow_ups' then
    if tg_op = 'INSERT' then
      insert into public.network_events (organization_id, company_id, kind, subject_id, actor_id, metadata)
      values (new.organization_id, new.company_id, 'follow_up_created', new.id, actor, jsonb_build_object('origin', new.origin));
    elsif new.status is distinct from old.status then
      insert into public.network_events (organization_id, company_id, kind, subject_id, actor_id)
      values (new.organization_id, new.company_id,
              case new.status when 'done' then 'follow_up_done' when 'dismissed' then 'follow_up_dismissed' else 'follow_up_reopened' end,
              new.id, actor);
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.follow_up_lifecycle() from public;
revoke all on function private.record_network_event() from public;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['interactions', 'follow_ups'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
    execute format('create trigger set_created_by before insert on public.%I for each row execute function private.set_created_by()', t);
    execute format('create trigger enforce_immutable_ownership before update on public.%I for each row execute function private.enforce_immutable_ownership()', t);
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()', t);
  end loop;
end;
$$;

create trigger follow_up_lifecycle
  before insert or update on public.follow_ups
  for each row execute function private.follow_up_lifecycle();

create trigger record_network_event
  after update of network_stage on public.companies
  for each row execute function private.record_network_event();
create trigger record_network_event
  after insert or update of company_id on public.contacts
  for each row execute function private.record_network_event();
create trigger record_network_event
  after insert or update of status on public.follow_ups
  for each row execute function private.record_network_event();

-- ---------------------------------------------------------------------------
-- Privileges (least privilege; RLS below decides which rows)
-- ---------------------------------------------------------------------------
revoke all on public.interactions, public.follow_ups, public.network_events from anon, authenticated, service_role;
grant select, insert, update, delete on public.interactions, public.follow_ups to authenticated;
-- History is read-only for everyone: only the triggers write it.
grant select on public.network_events to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security (default deny)
-- ---------------------------------------------------------------------------
alter table public.interactions enable row level security;
alter table public.follow_ups enable row level security;
alter table public.network_events enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['interactions', 'follow_ups'] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.has_org_role(organization_id, %L))', t || '_select', t, 'viewer');
    execute format('create policy %I on public.%I for insert to authenticated with check (private.has_org_role(organization_id, %L))', t || '_insert', t, 'member');
    execute format('create policy %I on public.%I for update to authenticated using (private.has_org_role(organization_id, %L)) with check (private.has_org_role(organization_id, %L))', t || '_update', t, 'member', 'member');
    execute format('create policy %I on public.%I for delete to authenticated using (private.has_org_role(organization_id, %L))', t || '_delete', t, 'member');
  end loop;
end;
$$;

create policy network_events_select on public.network_events
  for select to authenticated
  using (private.has_org_role(organization_id, 'viewer'));
