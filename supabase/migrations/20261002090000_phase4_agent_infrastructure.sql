-- ORQO V2 · Phase 4 · Agent infrastructure
-- Adds: agent missions, agent runs (deterministic state machine enforced in the
-- database), bounded run steps, an append-only tool-call ledger, approvals,
-- usage attribution to agent runs, lifecycle audit events, and three RPCs:
--   create_agent_mission   atomic idempotency + concurrency + quota guard
--   request_agent_approval run → waiting_for_approval + approval row
--   decide_agent_approval  admin-only decision (approve / reject / expire)
--   cancel_agent_run       cancel a queued run or a run waiting for approval
-- Core agent DEFINITIONS stay version-controlled in code (src/lib/agents).
-- Every table is organization-scoped, RLS default-deny, and unreachable by
-- anon and service_role.

-- ---------------------------------------------------------------------------
-- Missions
-- ---------------------------------------------------------------------------
create table public.agent_missions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  agent_id text not null check (agent_id ~ '^[a-zA-Z]{1,40}$'),
  mission_type text not null check (mission_type ~ '^[a-z_]{1,40}$'),
  capability text not null check (capability ~ '^[a-z_]{1,40}$'),
  -- Deterministic, server-built summary of the objective (never model text).
  objective text not null check (char_length(objective) between 1 and 300),
  -- Structured input / context references, validated by the server contract.
  input jsonb not null check (jsonb_typeof(input) = 'object' and pg_column_size(input) <= 4096),
  autonomy smallint not null check (autonomy between 0 and 3),
  status text not null default 'queued' check (status in ('queued', 'running', 'waiting_for_approval', 'completed', 'failed', 'cancelled')),
  result_summary text check (result_summary is null or char_length(result_summary) <= 500),
  failure_reason text check (failure_reason is null or failure_reason ~ '^[a-z_]{1,40}$'),
  idempotency_key uuid not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, created_by, idempotency_key)
);
create index agent_missions_org_time_idx on public.agent_missions (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Runs
-- ---------------------------------------------------------------------------
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  mission_id uuid not null,
  agent_id text not null check (agent_id ~ '^[a-zA-Z]{1,40}$'),
  capability text not null check (capability ~ '^[a-z_]{1,40}$'),
  autonomy smallint not null check (autonomy between 0 and 3),
  status text not null default 'queued' check (status in ('queued', 'running', 'waiting_for_approval', 'completed', 'failed', 'cancelled')),
  approval_state text not null default 'not_required' check (approval_state in ('not_required', 'required', 'approved', 'rejected', 'expired')),
  -- Snapshot of the execution limits the run was granted (from the server registry).
  limits jsonb not null check (jsonb_typeof(limits) = 'object'),
  -- Budget accounting: tool calls, external requests, model calls, reported cost.
  counters jsonb not null default '{}'::jsonb check (jsonb_typeof(counters) = 'object'),
  -- Validated structured result (contract-checked by the server). No chain-of-thought.
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 65536)),
  error_code text check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, mission_id) references public.agent_missions (organization_id, id) on delete cascade
);
create index agent_runs_org_time_idx on public.agent_runs (organization_id, created_at desc);
create index agent_runs_active_idx on public.agent_runs (organization_id, status) where status in ('queued', 'running');
create index agent_runs_mission_idx on public.agent_runs (organization_id, mission_id);

-- ---------------------------------------------------------------------------
-- Steps (operations and results only — never model reasoning)
-- ---------------------------------------------------------------------------
create table public.agent_run_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  run_id uuid not null,
  seq smallint not null check (seq between 1 and 50),
  step_key text not null check (step_key ~ '^[a-z_]{1,40}$'),
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'skipped')),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object' and pg_column_size(summary) <= 4096),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, run_id, seq),
  foreign key (organization_id, run_id) references public.agent_runs (organization_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Tool-call ledger (append-only)
-- ---------------------------------------------------------------------------
create table public.agent_run_tool_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  run_id uuid not null,
  step_id uuid,
  tool_id text not null check (tool_id ~ '^[a-z_]{1,60}$'),
  outcome text not null check (outcome in ('succeeded', 'failed', 'denied', 'approval_required')),
  detail text check (detail is null or detail ~ '^[a-z_]{1,40}$'),
  cost_class text not null check (cost_class in ('none', 'internal', 'external_free', 'variable')),
  external_network boolean not null,
  -- References to produced/used records (ids only, same organization).
  research_run_id uuid,
  output_ref jsonb not null default '{}'::jsonb check (jsonb_typeof(output_ref) = 'object' and pg_column_size(output_ref) <= 1024),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, run_id) references public.agent_runs (organization_id, id) on delete cascade,
  foreign key (organization_id, step_id) references public.agent_run_steps (organization_id, id) on delete cascade,
  foreign key (organization_id, research_run_id) references public.research_runs (organization_id, id)
);
create index agent_run_tool_calls_run_idx on public.agent_run_tool_calls (organization_id, run_id, created_at);

-- ---------------------------------------------------------------------------
-- Approvals
-- ---------------------------------------------------------------------------
create table public.agent_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  run_id uuid not null,
  tool_id text not null check (tool_id ~ '^[a-z_]{1,60}$'),
  -- What would happen, built by the server from the registry (never model text).
  action jsonb not null default '{}'::jsonb check (jsonb_typeof(action) = 'object' and pg_column_size(action) <= 2048),
  state text not null default 'required' check (state in ('required', 'approved', 'rejected', 'expired')),
  created_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, run_id) references public.agent_runs (organization_id, id) on delete cascade,
  check ((state = 'required') = (decided_at is null))
);
-- At most one open approval per run.
create unique index agent_approvals_open_idx on public.agent_approvals (organization_id, run_id) where state = 'required';

-- ---------------------------------------------------------------------------
-- Usage attribution (reuses the Phase 3 ledger; no parallel cost system)
-- ---------------------------------------------------------------------------
alter table public.usage_events
  add column agent_run_id uuid,
  add constraint usage_events_agent_run_fk foreign key (organization_id, agent_run_id) references public.agent_runs (organization_id, id);
create index usage_events_agent_run_idx on public.usage_events (organization_id, agent_run_id) where agent_run_id is not null;

-- ---------------------------------------------------------------------------
-- Deterministic state machine + immutable run identity
-- Mirrors src/lib/agents/state.ts.
-- ---------------------------------------------------------------------------
create function private.enforce_agent_status()
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
    -- A run waiting for approval resumes only once the approval was granted (set by decide_agent_approval).
    -- Nested: plpgsql does not short-circuit, and missions have no approval_state.
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

-- A finished step is part of the audit trail and never changes.
create function private.enforce_agent_step_final()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'running' or new.run_id is distinct from old.run_id or new.seq is distinct from old.seq or new.step_key is distinct from old.step_key or new.started_at is distinct from old.started_at then
    raise exception 'finished steps are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger enforce_agent_step_final before update on public.agent_run_steps for each row execute function private.enforce_agent_step_final();

-- ---------------------------------------------------------------------------
-- Lifecycle audit (append-only audit_events; ids and codes only, no payloads)
-- ---------------------------------------------------------------------------
create function private.audit_agent_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  verb text;
  meta jsonb;
begin
  if not exists (select 1 from public.organizations o where o.id = new.organization_id) then
    return null;
  end if;
  if tg_table_name = 'agent_missions' then
    if tg_op <> 'INSERT' then return null; end if;
    verb := 'agent_mission.created';
    meta := jsonb_build_object('agent_id', new.agent_id, 'mission_type', new.mission_type, 'autonomy', new.autonomy);
  elsif tg_table_name = 'agent_runs' then
    if tg_op = 'INSERT' then
      verb := 'agent_run.queued';
    elsif new.status is distinct from old.status then
      verb := 'agent_run.' || case when new.status = 'running' and old.status = 'queued' then 'started' when new.status = 'running' then 'resumed' else new.status end;
    else
      return null;
    end if;
    meta := jsonb_build_object('agent_id', new.agent_id, 'mission_id', new.mission_id, 'status', new.status, 'error_code', new.error_code);
  elsif tg_table_name = 'agent_run_tool_calls' then
    verb := 'agent_tool.called';
    meta := jsonb_build_object('tool_id', new.tool_id, 'run_id', new.run_id, 'outcome', new.outcome, 'detail', new.detail);
  elsif tg_table_name = 'agent_approvals' then
    if tg_op = 'INSERT' then
      verb := 'agent_approval.requested';
    elsif new.state is distinct from old.state then
      verb := 'agent_approval.' || new.state;
    else
      return null;
    end if;
    meta := jsonb_build_object('tool_id', new.tool_id, 'run_id', new.run_id, 'state', new.state);
  else
    return null;
  end if;
  insert into public.audit_events (organization_id, actor_type, actor_id, action, target_table, target_id, metadata)
  values (new.organization_id, case when tg_table_name = 'agent_run_tool_calls' then 'agent' when actor is null then 'system' else 'user' end, actor, verb, tg_table_name, new.id, meta);
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['agent_missions', 'agent_runs'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
    execute format('create trigger enforce_agent_status before update on public.%I for each row execute function private.enforce_agent_status()', t);
  end loop;
  foreach t in array array['agent_missions', 'agent_runs', 'agent_run_tool_calls', 'agent_approvals'] loop
    execute format('create trigger set_created_by before insert on public.%I for each row execute function private.set_created_by()', t);
    execute format('create trigger audit_agent_event after insert or update on public.%I for each row execute function private.audit_agent_event()', t);
  end loop;
  foreach t in array array['agent_missions', 'agent_runs', 'agent_run_steps', 'agent_approvals'] loop
    execute format('create trigger enforce_immutable_ownership before update on public.%I for each row execute function private.enforce_immutable_ownership()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_agent_mission: idempotency + concurrency + quota, atomically
-- ---------------------------------------------------------------------------
-- The server validates agent, entitlement, autonomy and input against the code
-- registry BEFORE calling this. Calling it directly only creates queued rows
-- that count against the caller's own quota: execution happens only in the
-- server route, which re-derives everything from the registry.
create function public.create_agent_mission(
  p_organization_id uuid,
  p_agent_id text,
  p_mission_type text,
  p_capability text,
  p_objective text,
  p_input jsonb,
  p_autonomy smallint,
  p_limits jsonb,
  p_idempotency_key uuid,
  p_max_runs integer,
  p_window_hours integer,
  p_stale_after_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing record;
  busy integer;
  used integer;
  m_id uuid;
  r_id uuid;
begin
  if not private.has_org_role(p_organization_id, 'member') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_max_runs < 0 or p_max_runs > 1000 or p_window_hours not between 1 and 720 or p_stale_after_seconds not between 10 and 3600 then
    raise exception 'invalid limits' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('orqo.agents:' || p_organization_id::text, 0));

  -- Same click, retry or refresh: return the existing mission, never a second run.
  select m.id as mission_id, r.id as run_id, r.status into existing
  from public.agent_missions m
  join public.agent_runs r on r.organization_id = m.organization_id and r.mission_id = m.id
  where m.organization_id = p_organization_id and m.created_by = (select auth.uid()) and m.idempotency_key = p_idempotency_key
  order by r.created_at asc
  limit 1;
  if found then
    return jsonb_build_object('mission_id', existing.mission_id, 'run_id', existing.run_id, 'status', existing.status, 'reused', true);
  end if;

  select count(*) into busy
  from public.agent_runs r
  where r.organization_id = p_organization_id
    and r.status in ('queued', 'running')
    and r.created_at > now() - make_interval(secs => p_stale_after_seconds);
  if busy > 0 then
    raise exception 'an agent run is already in progress' using errcode = '55P03';
  end if;

  select count(*) into used
  from public.agent_runs r
  where r.organization_id = p_organization_id
    and r.created_at > now() - make_interval(hours => p_window_hours);
  if used >= p_max_runs then
    raise exception 'agent run quota reached' using errcode = '54000';
  end if;

  insert into public.agent_missions (organization_id, agent_id, mission_type, capability, objective, input, autonomy, idempotency_key)
  values (p_organization_id, p_agent_id, p_mission_type, p_capability, left(btrim(p_objective), 300), p_input, p_autonomy, p_idempotency_key)
  returning id into m_id;
  insert into public.agent_runs (organization_id, mission_id, agent_id, capability, autonomy, limits)
  values (p_organization_id, m_id, p_agent_id, p_capability, p_autonomy, p_limits)
  returning id into r_id;
  return jsonb_build_object('mission_id', m_id, 'run_id', r_id, 'status', 'queued', 'reused', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- request_agent_approval: running → waiting_for_approval + approval row
-- ---------------------------------------------------------------------------
create function public.request_agent_approval(
  p_organization_id uuid,
  p_run_id uuid,
  p_tool_id text,
  p_action jsonb,
  p_ttl_hours integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a_id uuid;
begin
  if not private.has_org_role(p_organization_id, 'member') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_ttl_hours not between 1 and 168 then
    raise exception 'invalid ttl' using errcode = '22023';
  end if;
  update public.agent_runs
  set status = 'waiting_for_approval', approval_state = 'required'
  where organization_id = p_organization_id and id = p_run_id and status = 'running';
  if not found then
    raise exception 'run is not running' using errcode = 'P0002';
  end if;
  update public.agent_missions m set status = 'waiting_for_approval'
  from public.agent_runs r
  where r.organization_id = p_organization_id and r.id = p_run_id and m.organization_id = r.organization_id and m.id = r.mission_id;
  insert into public.agent_approvals (organization_id, run_id, tool_id, action, expires_at)
  values (p_organization_id, p_run_id, p_tool_id, coalesce(p_action, '{}'::jsonb), now() + make_interval(hours => p_ttl_hours))
  returning id into a_id;
  return a_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- decide_agent_approval: admin+ only; the ONLY way an approval changes state
-- ---------------------------------------------------------------------------
create function public.decide_agent_approval(
  p_organization_id uuid,
  p_approval_id uuid,
  p_decision text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
  outcome text;
begin
  if not private.has_org_role(p_organization_id, 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  select * into a from public.agent_approvals
  where organization_id = p_organization_id and id = p_approval_id
  for update;
  if not found then
    raise exception 'approval not found' using errcode = 'P0002';
  end if;
  if a.state <> 'required' then
    raise exception 'approval already decided' using errcode = '55000';
  end if;

  outcome := case when a.expires_at <= now() then 'expired' when p_decision = 'approve' then 'approved' else 'rejected' end;
  update public.agent_approvals
  set state = outcome, decided_by = case when outcome = 'expired' then null else (select auth.uid()) end, decided_at = now()
  where id = a.id;

  if outcome = 'approved' then
    update public.agent_runs set approval_state = 'approved' where organization_id = p_organization_id and id = a.run_id;
  else
    update public.agent_runs
    set approval_state = outcome,
        status = case when outcome = 'expired' then 'failed' else 'cancelled' end,
        error_code = case when outcome = 'expired' then 'approval_expired' else 'approval_rejected' end,
        finished_at = now()
    where organization_id = p_organization_id and id = a.run_id;
    update public.agent_missions m
    set status = case when outcome = 'expired' then 'failed' else 'cancelled' end,
        failure_reason = case when outcome = 'expired' then 'approval_expired' else 'approval_rejected' end,
        completed_at = now()
    from public.agent_runs r
    where r.organization_id = p_organization_id and r.id = a.run_id and m.organization_id = r.organization_id and m.id = r.mission_id;
  end if;
  return outcome;
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_agent_run: only work that is not executing can be cancelled
-- ---------------------------------------------------------------------------
-- Runs execute synchronously inside one request; a running run cannot be
-- interrupted, so only queued runs and runs waiting for approval are
-- cancellable — by the member who started them, or by an admin.
create function public.cancel_agent_run(p_organization_id uuid, p_run_id uuid)
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
  select * into r from public.agent_runs where organization_id = p_organization_id and id = p_run_id for update;
  if not found then
    raise exception 'run not found' using errcode = 'P0002';
  end if;
  if r.created_by is distinct from (select auth.uid()) and not private.has_org_role(p_organization_id, 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if r.status not in ('queued', 'waiting_for_approval') then
    raise exception 'run cannot be cancelled' using errcode = '55000';
  end if;
  update public.agent_approvals set state = 'rejected', decided_by = (select auth.uid()), decided_at = now()
  where organization_id = p_organization_id and run_id = p_run_id and state = 'required';
  update public.agent_runs
  set status = 'cancelled', error_code = 'cancelled', finished_at = now(),
      approval_state = case when approval_state = 'required' then 'rejected' else approval_state end
  where organization_id = p_organization_id and id = p_run_id;
  update public.agent_missions set status = 'cancelled', failure_reason = 'cancelled', completed_at = now()
  where organization_id = p_organization_id and id = r.mission_id;
end;
$$;

revoke all on function public.create_agent_mission(uuid, text, text, text, text, jsonb, smallint, jsonb, uuid, integer, integer, integer) from public, anon;
revoke all on function public.request_agent_approval(uuid, uuid, text, jsonb, integer) from public, anon;
revoke all on function public.decide_agent_approval(uuid, uuid, text) from public, anon;
revoke all on function public.cancel_agent_run(uuid, uuid) from public, anon;
grant execute on function public.create_agent_mission(uuid, text, text, text, text, jsonb, smallint, jsonb, uuid, integer, integer, integer) to authenticated;
grant execute on function public.request_agent_approval(uuid, uuid, text, jsonb, integer) to authenticated;
grant execute on function public.decide_agent_approval(uuid, uuid, text) to authenticated;
grant execute on function public.cancel_agent_run(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges (default deny; anon and service_role get nothing)
-- ---------------------------------------------------------------------------
revoke all on public.agent_missions, public.agent_runs, public.agent_run_steps, public.agent_run_tool_calls, public.agent_approvals from anon, authenticated, service_role;

-- Missions and runs are created only by create_agent_mission; the server advances them.
-- approval_state, limits, autonomy and identity are not writable by members.
grant select on public.agent_missions, public.agent_runs, public.agent_run_steps, public.agent_run_tool_calls, public.agent_approvals to authenticated;
grant update (status, result_summary, failure_reason, started_at, completed_at) on public.agent_missions to authenticated;
grant update (status, counters, result, error_code, started_at, finished_at, duration_ms) on public.agent_runs to authenticated;
grant insert on public.agent_run_steps to authenticated;
grant update (status, summary, finished_at) on public.agent_run_steps to authenticated;
-- Append-only ledger.
grant insert on public.agent_run_tool_calls to authenticated;
-- Approvals change only through the RPCs above.

alter table public.agent_missions enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_run_steps enable row level security;
alter table public.agent_run_tool_calls enable row level security;
alter table public.agent_approvals enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['agent_missions', 'agent_runs', 'agent_run_steps', 'agent_run_tool_calls', 'agent_approvals'] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.has_org_role(organization_id, %L))', t || '_select', t, 'viewer');
  end loop;
  foreach t in array array['agent_missions', 'agent_runs', 'agent_run_steps'] loop
    execute format('create policy %I on public.%I for update to authenticated using (private.has_org_role(organization_id, %L)) with check (private.has_org_role(organization_id, %L))', t || '_update', t, 'member', 'member');
  end loop;
  foreach t in array array['agent_run_steps', 'agent_run_tool_calls'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (private.has_org_role(organization_id, %L))', t || '_insert', t, 'member');
  end loop;
end;
$$;
