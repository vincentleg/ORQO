-- ORQO V2 · Phase 17A · Governed spend & authority
-- Paid work must be impossible without entitlement, budget and authority. This migration adds:
--   * agent_runs.authority (+ parent_run_id, depth): the run's Authority Contract, set ONCE while the run is
--     queued (set_agent_run_authority), then immutable (trigger). No column grant: the app cannot write it.
--   * provider_spend: the money ledger. A paid provider call is RESERVED before it is sent (worst case),
--     then SETTLED (reported cost, or the full reservation when the cost is unknown). Rows are written only
--     by reserve/settle functions, which check membership, the run's authority, per-call and per-run caps,
--     and the organization's rolling ceiling under an organization advisory lock (no overspend in parallel).
--   * usage_events.reservation_id / duration_ms: usage linked to the spend it consumed.
--   * record_governance_event: tripwire audit (governance.tripwire.<kind>), fixed vocabulary only.
-- Organization-scoped, RLS default-deny, unreachable by anon and service_role. Additive only.

-- ---------------------------------------------------------------------------
-- Authority snapshot on runs
-- ---------------------------------------------------------------------------
alter table public.agent_runs
  add column parent_run_id uuid,
  add column depth smallint not null default 0 check (depth between 0 and 2),
  add column authority jsonb check (authority is null or (jsonb_typeof(authority) = 'object' and pg_column_size(authority) <= 16384)),
  add constraint agent_runs_parent_fk foreign key (organization_id, parent_run_id) references public.agent_runs (organization_id, id) on delete cascade,
  add constraint agent_runs_parent_not_self check (parent_run_id is null or parent_run_id <> id),
  add constraint agent_runs_depth_parent check ((depth = 0) = (parent_run_id is null));

create index agent_runs_parent_idx on public.agent_runs (organization_id, parent_run_id) where parent_run_id is not null;

-- Same state machine as Phase 4, plus: authority, parent and depth change only once, from "none" while queued.
create or replace function private.enforce_agent_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed text[];
begin
  if tg_table_name = 'agent_runs' then
    if new.mission_id is distinct from old.mission_id or new.agent_id is distinct from old.agent_id
       or new.capability is distinct from old.capability or new.autonomy is distinct from old.autonomy
       or new.limits is distinct from old.limits or new.queued_at is distinct from old.queued_at then
      raise exception 'run identity, autonomy and limits are immutable' using errcode = '42501';
    end if;
    if ((to_jsonb(new) -> 'authority') is distinct from (to_jsonb(old) -> 'authority')
        or (to_jsonb(new) ->> 'parent_run_id') is distinct from (to_jsonb(old) ->> 'parent_run_id')
        or (to_jsonb(new) ->> 'depth') is distinct from (to_jsonb(old) ->> 'depth')) then
      if not (jsonb_typeof(to_jsonb(old) -> 'authority') = 'null' and old.status = 'queued' and jsonb_typeof(to_jsonb(new) -> 'authority') = 'object') then
        raise exception 'run authority is immutable' using errcode = '42501';
      end if;
    end if;
  elsif new.agent_id is distinct from old.agent_id or new.mission_type is distinct from old.mission_type
     or new.capability is distinct from old.capability or new.input is distinct from old.input
     or new.autonomy is distinct from old.autonomy or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'mission definition is immutable' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    allowed := case old.status
      when 'queued' then array['running', 'cancelled', 'failed']
      when 'running' then array['completed', 'failed', 'waiting_for_approval']
      when 'waiting_for_approval' then array['running', 'cancelled', 'failed']
      else array[]::text[]
    end;
    if not (new.status = any (allowed)) then
      raise exception 'invalid status transition % -> %', old.status, new.status using errcode = '23514';
    end if;
    if tg_table_name = 'agent_runs' then
      if old.status = 'waiting_for_approval' and new.status = 'running' and (to_jsonb(new) ->> 'approval_state') <> 'approved' then
        raise exception 'run resumes only after approval' using errcode = '42501';
      end if;
    end if;
  elsif old.status in ('completed', 'failed', 'cancelled') then
    raise exception 'finished records are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Sets the authority of a queued run, once. The application builds it (registry ∩ entitlement ∩ envelope);
-- the database checks what it can verify: same organization and run, version, delegation depth, and that a
-- child never holds more money or child runs than its parent.
create function public.set_agent_run_authority(p_organization_id uuid, p_run_id uuid, p_authority jsonb, p_parent_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  p record;
  siblings integer;
begin
  if not private.has_org_role(p_organization_id, 'member') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_authority) <> 'object' or p_authority ->> 'version' <> '1'
     or p_authority ->> 'organizationId' <> p_organization_id::text or p_authority ->> 'runId' <> p_run_id::text
     or p_authority ->> 'userId' <> (select auth.uid())::text
     or p_authority ->> 'killSwitch' <> 'enforced'
     or jsonb_typeof(p_authority -> 'limits') <> 'object'
     or (p_authority -> 'limits' ->> 'maxCostUsd')::numeric not between 0 and 1000 then
    raise exception 'invalid authority' using errcode = '22023';
  end if;
  select id, status, (to_jsonb(ar) -> 'authority') as authority into r from public.agent_runs ar where ar.organization_id = p_organization_id and ar.id = p_run_id for update;
  if not found then
    raise exception 'run not found' using errcode = '42501';
  end if;
  if r.status <> 'queued' or jsonb_typeof(r.authority) <> 'null' then
    raise exception 'run authority is immutable' using errcode = '42501';
  end if;
  if p_parent_run_id is null then
    if (p_authority ->> 'depth')::int <> 0 or p_authority ->> 'parentRunId' is not null then
      raise exception 'invalid authority' using errcode = '22023';
    end if;
    update public.agent_runs set authority = p_authority where organization_id = p_organization_id and id = p_run_id;
  else
    select ar.id, ar.depth, ar.authority into p from public.agent_runs ar where ar.organization_id = p_organization_id and ar.id = p_parent_run_id;
    if not found or p.authority is null then
      raise exception 'parent not found' using errcode = '42501';
    end if;
    select count(*) into siblings from public.agent_runs c where c.organization_id = p_organization_id and c.parent_run_id = p_parent_run_id;
    if p.depth + 1 > 2 or (p_authority ->> 'depth')::int <> p.depth + 1 or p_authority ->> 'parentRunId' <> p_parent_run_id::text
       or (p_authority -> 'limits' ->> 'maxCostUsd')::numeric > (p.authority -> 'limits' ->> 'maxCostUsd')::numeric
       or (p_authority -> 'limits' ->> 'maxChildRuns')::int > (p.authority -> 'limits' ->> 'maxChildRuns')::int - 1
       or siblings >= (p.authority -> 'limits' ->> 'maxChildRuns')::int then
      raise exception 'authority expansion refused' using errcode = '42501';
    end if;
    update public.agent_runs set authority = p_authority, parent_run_id = p_parent_run_id, depth = p.depth + 1 where organization_id = p_organization_id and id = p_run_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Provider spend ledger
-- ---------------------------------------------------------------------------
create table public.provider_spend (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  agent_run_id uuid,
  research_run_id uuid,
  provider text not null check (provider in ('openrouter', 'brave')),
  task text not null check (task ~ '^[a-z_]{2,40}$'),
  model text check (model is null or model ~ '^[A-Za-z0-9._:/-]{1,120}$'),
  idempotency_key uuid not null,
  reserved_usd numeric(12, 6) not null check (reserved_usd > 0 and reserved_usd <= 5),
  settled_usd numeric(12, 6) check (settled_usd is null or settled_usd >= 0),
  -- False when the provider reported no cost: the full reservation is then kept (never treated as zero).
  cost_known boolean,
  outcome text check (outcome is null or outcome in ('succeeded', 'failed', 'not_sent')),
  status text not null default 'reserved' check (status in ('reserved', 'settled', 'released')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  check (agent_run_id is not null or research_run_id is not null),
  check ((status = 'reserved') = (settled_usd is null)),
  foreign key (organization_id, agent_run_id) references public.agent_runs (organization_id, id) on delete cascade,
  foreign key (organization_id, research_run_id) references public.research_runs (organization_id, id) on delete cascade
);

create index provider_spend_org_time_idx on public.provider_spend (organization_id, created_at desc);
create index provider_spend_run_idx on public.provider_spend (organization_id, agent_run_id) where agent_run_id is not null;

create trigger audit_change after insert or update or delete on public.provider_spend for each row execute function private.audit_change();

revoke all on public.provider_spend from anon, authenticated, service_role;
grant select on public.provider_spend to authenticated;
alter table public.provider_spend enable row level security;
create policy provider_spend_select on public.provider_spend
  for select to authenticated using (private.has_org_role(organization_id, 'viewer'));

-- Reserves the worst case of one paid provider call, BEFORE it is sent. Returns {id, reused}: a repeated
-- idempotency key returns the existing reservation with reused = true, and the caller must NOT send again.
create function public.reserve_provider_spend(
  p_organization_id uuid,
  p_agent_run_id uuid,
  p_research_run_id uuid,
  p_provider text,
  p_task text,
  p_model text,
  p_amount_usd numeric,
  p_ceiling_usd numeric,
  p_window_days integer,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing uuid;
  run record;
  run_spend numeric;
  run_calls integer;
  org_spend numeric;
  new_id uuid;
begin
  if not private.has_org_role(p_organization_id, 'member') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_provider not in ('openrouter', 'brave') or p_task !~ '^[a-z_]{2,40}$' or (p_model is not null and p_model !~ '^[A-Za-z0-9._:/-]{1,120}$')
     or p_amount_usd is null or p_amount_usd <= 0 or p_amount_usd > 5
     or p_ceiling_usd is null or p_ceiling_usd <= 0 or p_ceiling_usd > 1000
     or p_window_days not between 1 and 90 or p_idempotency_key is null
     or (p_agent_run_id is null and p_research_run_id is null) then
    raise exception 'invalid reservation' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('orqo.spend:' || p_organization_id::text, 0));

  select id into existing from public.provider_spend where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('id', existing, 'reused', true);
  end if;

  if p_agent_run_id is not null then
    select ar.status, ar.authority into run from public.agent_runs ar where ar.organization_id = p_organization_id and ar.id = p_agent_run_id;
    if not found or run.status <> 'running' or run.authority is null then
      raise exception 'run not authorized for spend' using errcode = '42501';
    end if;
    if not ((p_provider = 'brave' and coalesce((run.authority -> 'providers' ->> 'brave')::boolean, false))
            or (p_provider = 'openrouter' and jsonb_typeof(run.authority -> 'providers' -> 'openrouter') = 'object'
                and (run.authority -> 'providers' -> 'openrouter' -> 'tasks') ? p_task)) then
      raise exception 'provider outside authority' using errcode = '42501';
    end if;
    select coalesce(sum(case when status = 'reserved' then reserved_usd else settled_usd end), 0), count(*) into run_spend, run_calls
    from public.provider_spend where organization_id = p_organization_id and agent_run_id = p_agent_run_id;
    if run_spend + p_amount_usd > (run.authority -> 'limits' ->> 'maxCostUsd')::numeric then
      raise exception 'run cost limit reached' using errcode = '54002';
    end if;
    if run_calls + 1 > (run.authority -> 'limits' ->> 'maxProviderCalls')::int then
      raise exception 'run provider call limit reached' using errcode = '54003';
    end if;
  end if;
  if p_research_run_id is not null then
    perform 1 from public.research_runs rr where rr.organization_id = p_organization_id and rr.id = p_research_run_id and rr.status = 'running';
    if not found then
      raise exception 'research run not authorized for spend' using errcode = '42501';
    end if;
  end if;

  select coalesce(sum(case when status = 'reserved' then reserved_usd else settled_usd end), 0) into org_spend
  from public.provider_spend
  where organization_id = p_organization_id and created_at > now() - make_interval(days => p_window_days);
  if org_spend + p_amount_usd > p_ceiling_usd then
    raise exception 'spend ceiling reached' using errcode = '54001';
  end if;

  insert into public.provider_spend (organization_id, agent_run_id, research_run_id, provider, task, model, idempotency_key, reserved_usd, created_by)
  values (p_organization_id, p_agent_run_id, p_research_run_id, p_provider, p_task, p_model, p_idempotency_key, p_amount_usd, (select auth.uid()))
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'reused', false);
end;
$$;

-- Settles a reservation once: the reported cost when known, otherwise the full reservation (conservative).
-- 'not_sent' releases it (the request never left ORQO).
create function public.settle_provider_spend(p_organization_id uuid, p_reservation_id uuid, p_outcome text, p_cost_usd numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if not private.has_org_role(p_organization_id, 'member') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_outcome not in ('succeeded', 'failed', 'not_sent') or (p_cost_usd is not null and (p_cost_usd < 0 or p_cost_usd > 100)) then
    raise exception 'invalid settlement' using errcode = '22023';
  end if;
  select id, status, reserved_usd, created_by into r from public.provider_spend where organization_id = p_organization_id and id = p_reservation_id for update;
  if not found or r.created_by is distinct from (select auth.uid()) then
    raise exception 'reservation not found' using errcode = '42501';
  end if;
  if r.status <> 'reserved' then
    raise exception 'reservation already settled' using errcode = '42501';
  end if;
  update public.provider_spend
  set status = case when p_outcome = 'not_sent' then 'released' else 'settled' end,
      settled_usd = case when p_outcome = 'not_sent' then 0 when p_cost_usd is null then r.reserved_usd else p_cost_usd end,
      cost_known = case when p_outcome = 'not_sent' then true else p_cost_usd is not null end,
      outcome = p_outcome,
      settled_at = now()
  where organization_id = p_organization_id and id = p_reservation_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Usage linked to spend
-- ---------------------------------------------------------------------------
alter table public.usage_events
  add column reservation_id uuid,
  add column duration_ms integer check (duration_ms is null or duration_ms >= 0),
  add constraint usage_events_reservation_fk foreign key (organization_id, reservation_id) references public.provider_spend (organization_id, id) on delete set null (reservation_id);

-- ---------------------------------------------------------------------------
-- Tripwire audit
-- ---------------------------------------------------------------------------
create function public.record_governance_event(p_organization_id uuid, p_tripwire text, p_agent_run_id uuid, p_detail text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_org_role(p_organization_id, 'viewer') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_tripwire not in ('missing_authority', 'unauthorized_tool', 'unauthorized_network', 'cross_organization', 'provider_outside_authority',
                        'write_outside_authority', 'privilege_expansion', 'delegation_limit', 'runtime_limit', 'cost_limit',
                        'provider_call_limit', 'external_action', 'authority_modification')
     or (p_detail is not null and p_detail !~ '^[a-z0-9_:.,-]{0,120}$') then
    raise exception 'invalid governance event' using errcode = '22023';
  end if;
  insert into public.audit_events (organization_id, actor_type, actor_id, action, target_table, target_id, metadata)
  values (p_organization_id, 'user', (select auth.uid()), 'governance.tripwire.' || p_tripwire, 'agent_runs', p_agent_run_id,
          case when p_detail is null then '{}'::jsonb else jsonb_build_object('detail', p_detail) end);
end;
$$;

revoke all on function public.set_agent_run_authority(uuid, uuid, jsonb, uuid) from public, anon;
revoke all on function public.reserve_provider_spend(uuid, uuid, uuid, text, text, text, numeric, numeric, integer, uuid) from public, anon;
revoke all on function public.settle_provider_spend(uuid, uuid, text, numeric) from public, anon;
revoke all on function public.record_governance_event(uuid, text, uuid, text) from public, anon;
grant execute on function public.set_agent_run_authority(uuid, uuid, jsonb, uuid) to authenticated;
grant execute on function public.reserve_provider_spend(uuid, uuid, uuid, text, text, text, numeric, numeric, integer, uuid) to authenticated;
grant execute on function public.settle_provider_spend(uuid, uuid, text, numeric) to authenticated;
grant execute on function public.record_governance_event(uuid, text, uuid, text) to authenticated;
