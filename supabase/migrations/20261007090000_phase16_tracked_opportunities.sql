-- ORQO V2 · Phase 16A · Tracked opportunities
-- "This is worth pursuing": the user keeps a CREDIBLE opportunity ORQO found, so
-- the best findings no longer live in a spreadsheet. Deliberately not a CRM:
-- no amounts, owners, pipeline stages or forecasts; four plain statuses.
--   * one row per (organization, remembered company, scenario key);
--   * snapshot: the scenario as the SERVER computed it when it was tracked
--     (evidence keys and values, critic, unknowns, revenue structure, relationship).
--     The application recomputes the live assessment on read and shows any change;
--   * only the status can change after creation (column-level grant); no delete,
--     so a closed opportunity stays in memory.
-- Organization-scoped, same-organization foreign keys, RLS default-deny,
-- unreachable by anon and service_role. Additive only.

create table public.tracked_opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  target_company_id uuid not null,
  intelligence_id uuid,
  scenario_key text not null check (scenario_key ~ '^[a-z_]{2,60}:(own|target)$'),
  mechanism text not null check (mechanism ~ '^[a-z_]{2,60}$'),
  status text not null default 'investigating' check (status in ('investigating', 'validated', 'paused', 'closed')),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and pg_column_size(snapshot) <= 32768),
  status_changed_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, target_company_id, scenario_key),
  check (split_part(scenario_key, ':', 1) = mechanism),
  foreign key (organization_id, target_company_id) references public.companies (organization_id, id) on delete cascade,
  foreign key (organization_id, intelligence_id) references public.company_intelligence (organization_id, id) on delete set null (intelligence_id)
);

create index tracked_opportunities_org_idx on public.tracked_opportunities (organization_id, status, updated_at desc);
create index tracked_opportunities_company_idx on public.tracked_opportunities (organization_id, target_company_id);

-- When the status changes, remember when.
create function private.tracked_opportunity_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger set_created_by before insert on public.tracked_opportunities for each row execute function private.set_created_by();
create trigger set_updated_at before update on public.tracked_opportunities for each row execute function private.set_updated_at();
create trigger status_changed before update on public.tracked_opportunities for each row execute function private.tracked_opportunity_status();
create trigger audit_change after insert or update or delete on public.tracked_opportunities for each row execute function private.audit_change();

revoke all on public.tracked_opportunities from anon, authenticated, service_role;
grant select, insert on public.tracked_opportunities to authenticated;
grant update (status) on public.tracked_opportunities to authenticated;

alter table public.tracked_opportunities enable row level security;
create policy tracked_opportunities_select on public.tracked_opportunities
  for select to authenticated using (private.has_org_role(organization_id, 'viewer'));
create policy tracked_opportunities_insert on public.tracked_opportunities
  for insert to authenticated with check (private.has_org_role(organization_id, 'member'));
create policy tracked_opportunities_update on public.tracked_opportunities
  for update to authenticated using (private.has_org_role(organization_id, 'member')) with check (private.has_org_role(organization_id, 'member'));
