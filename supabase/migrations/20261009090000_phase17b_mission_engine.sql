-- ORQO V2 · Phase 17B · Mission engine (schema boundary "AX 17B")
-- A mission is a deterministic, versioned plan of steps that ORQO executes on the user's behalf. A step either
-- delegates to ONE ordinary agent run (Phase 4 run system, Phase 17A authority), or is an internal step
-- (fan-out, compile). This migration adds:
--   * missions           the plan of record (template, version, validated input, frozen contract) + lifecycle
--   * mission_steps      the steps, with lease-based ownership (owner, expiry, attempt = fencing token)
--   * mission_findings   structured results, attributable to mission / step / agent run, idempotent by key
--   * agent_runs.mission_step_id   which step a child run belongs to (every attempt), immutable once set
--   * RPCs: create_mission, claim_mission_step (recovers expired leases), attach_mission_child_run,
--           complete_mission_step (fenced), release_mission_step, cancel_mission
-- Organization-scoped, RLS default-deny, select for viewers, NO direct write grant: rows change only through
-- the functions below. Unreachable by anon and service_role. Additive only.

-- ---------------------------------------------------------------------------
-- Missions
-- ---------------------------------------------------------------------------
create table public.missions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  template text not null check (template ~ '^[a-z_]{1,40}$'),
  template_version smallint not null check (template_version between 1 and 100),
  -- Deterministic, server-built summary of the objective (never model text).
  objective text not null check (char_length(objective) between 1 and 300),
  input jsonb not null check (jsonb_typeof(input) = 'object' and pg_column_size(input) <= 4096),
  -- The frozen plan of record: template, envelope (free only in 17B), limits and initial steps.
  contract jsonb not null check (jsonb_typeof(contract) = 'object' and pg_column_size(contract) <= 16384),
  status text not null default 'planned' check (status in ('planned', 'running', 'completed', 'failed', 'cancelled')),
  failure_reason text check (failure_reason is null or failure_reason ~ '^[a-z_]{1,40}$'),
  idempotency_key uuid not null,
  created_by uuid references auth.users (id) on delete set null,
  cancelled_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, created_by, idempotency_key)
);
create index missions_org_time_idx on public.missions (organization_id, created_at desc);
create index missions_active_idx on public.missions (organization_id, status) where status in ('planned', 'running');

-- ---------------------------------------------------------------------------
-- Steps (lease-based execution)
-- ---------------------------------------------------------------------------
create table public.mission_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  mission_id uuid not null,
  -- Steps run in seq order. Templates leave gaps (10, 20, …) so a fan-out step inserts its children right after itself.
  seq smallint not null check (seq between 1 and 1000),
  step_key text not null check (step_key ~ '^[a-z0-9_]{1,40}$'),
  kind text not null check (kind in ('child_run', 'fanout', 'compile')),
  required boolean not null,
  spec jsonb not null check (jsonb_typeof(spec) = 'object' and pg_column_size(spec) <= 4096),
  status text not null default 'pending' check (status in ('pending', 'leased', 'completed', 'failed', 'skipped', 'cancelled')),
  -- Attempt number of the current/last lease. Also the fencing token: a completion must present it.
  attempt smallint not null default 0 check (attempt >= 0),
  max_attempts smallint not null check (max_attempts between 1 and 3),
  lease_owner uuid,
  lease_expires_at timestamptz,
  leased_by uuid references auth.users (id) on delete set null,
  recoveries smallint not null default 0 check (recoveries >= 0),
  -- The agent run of the current/last attempt (every attempt's run carries agent_runs.mission_step_id).
  child_run_id uuid,
  error_code text check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 2048)),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, mission_id, seq),
  unique (organization_id, mission_id, step_key),
  foreign key (organization_id, mission_id) references public.missions (organization_id, id) on delete cascade,
  foreign key (organization_id, child_run_id) references public.agent_runs (organization_id, id),
  check ((status = 'leased') = (lease_owner is not null and lease_expires_at is not null)),
  check (attempt <= max_attempts)
);
create index mission_steps_mission_idx on public.mission_steps (organization_id, mission_id, seq);

alter table public.agent_runs
  add column mission_step_id uuid,
  add constraint agent_runs_mission_step_fk foreign key (organization_id, mission_step_id) references public.mission_steps (organization_id, id) on delete cascade;
create index agent_runs_mission_step_idx on public.agent_runs (organization_id, mission_step_id) where mission_step_id is not null;

-- ---------------------------------------------------------------------------
-- Findings (append-only, idempotent by key)
-- ---------------------------------------------------------------------------
create table public.mission_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  mission_id uuid not null,
  step_id uuid not null,
  agent_run_id uuid,
  finding_key text not null check (finding_key ~ '^[a-z0-9_:.-]{1,200}$'),
  kind text not null check (kind in ('company_analysis', 'prospect', 'prospecting_summary', 'profile_gap', 'mission_summary')),
  subject_domain text check (subject_domain is null or subject_domain ~ '^[a-z0-9.-]{3,253}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 8192),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, mission_id, finding_key),
  foreign key (organization_id, mission_id) references public.missions (organization_id, id) on delete cascade,
  foreign key (organization_id, step_id) references public.mission_steps (organization_id, id) on delete cascade,
  foreign key (organization_id, agent_run_id) references public.agent_runs (organization_id, id)
);
create index mission_findings_mission_idx on public.mission_findings (organization_id, mission_id, created_at);

-- ---------------------------------------------------------------------------
-- State machines (mirror src/lib/missions/state.ts)
-- ---------------------------------------------------------------------------
create function private.enforce_mission_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed text[];
begin
  if new.template is distinct from old.template or new.template_version is distinct from old.template_version
     or new.objective is distinct from old.objective or new.input is distinct from old.input
     or new.contract is distinct from old.contract or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'mission definition is immutable' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    allowed := case old.status
      when 'planned' then array['running', 'cancelled', 'failed']
      when 'running' then array['completed', 'failed', 'cancelled']
      else array[]::text[]
    end;
    if not (new.status = any (allowed)) then
      raise exception 'invalid mission transition % -> %', old.status, new.status using errcode = '23514';
    end if;
  elsif old.status in ('completed', 'failed', 'cancelled') then
    raise exception 'finished missions are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create function private.enforce_mission_step()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed text[];
begin
  if new.mission_id is distinct from old.mission_id or new.seq is distinct from old.seq or new.step_key is distinct from old.step_key
     or new.kind is distinct from old.kind or new.required is distinct from old.required or new.spec is distinct from old.spec
     or new.max_attempts is distinct from old.max_attempts then
    raise exception 'step definition is immutable' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    allowed := case old.status
      when 'pending' then array['leased', 'skipped', 'cancelled', 'failed']
      when 'leased' then array['pending', 'completed', 'failed', 'cancelled', 'skipped']
      else array[]::text[]
    end;
    if not (new.status = any (allowed)) then
      raise exception 'invalid step transition % -> %', old.status, new.status using errcode = '23514';
    end if;
  elsif old.status in ('completed', 'failed', 'skipped', 'cancelled') then
    raise exception 'finished steps are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- A child run belongs to one step forever.
create function private.enforce_run_mission_step()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.mission_step_id is not null and new.mission_step_id is distinct from old.mission_step_id then
    raise exception 'run mission step is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create function private.audit_mission_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  verb text;
begin
  if not exists (select 1 from public.organizations o where o.id = new.organization_id) then
    return null;
  end if;
  if tg_op = 'INSERT' then
    verb := 'mission.created';
  elsif new.status is distinct from old.status then
    verb := 'mission.' || case when new.status = 'running' then 'started' else new.status end;
  else
    return null;
  end if;
  insert into public.audit_events (organization_id, actor_type, actor_id, action, target_table, target_id, metadata)
  values (new.organization_id, case when actor is null then 'system' else 'user' end, actor, verb, 'missions', new.id,
          jsonb_build_object('template', new.template, 'template_version', new.template_version, 'status', new.status, 'failure_reason', new.failure_reason));
  return null;
end;
$$;

create trigger set_updated_at before update on public.missions for each row execute function private.set_updated_at();
create trigger enforce_mission_status before update on public.missions for each row execute function private.enforce_mission_status();
create trigger enforce_mission_step before update on public.mission_steps for each row execute function private.enforce_mission_step();
create trigger enforce_run_mission_step before update on public.agent_runs for each row execute function private.enforce_run_mission_step();
create trigger audit_mission_event after insert or update on public.missions for each row execute function private.audit_mission_event();
create trigger set_created_by before insert on public.missions for each row execute function private.set_created_by();
create trigger set_created_by before insert on public.mission_findings for each row execute function private.set_created_by();
create trigger enforce_immutable_ownership before update on public.missions for each row execute function private.enforce_immutable_ownership();
create trigger enforce_immutable_ownership before update on public.mission_steps for each row execute function private.enforce_immutable_ownership();

-- ---------------------------------------------------------------------------
-- Helpers (private)
-- ---------------------------------------------------------------------------
-- Validates one step definition (server-built; re-validated by the executor before anything runs).
create function private.valid_mission_step(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
     and coalesce(p ->> 'key', '') ~ '^[a-z0-9_]{1,40}$'
     and coalesce(p ->> 'kind', '') in ('child_run', 'fanout', 'compile')
     and jsonb_typeof(p -> 'required') = 'boolean'
     and jsonb_typeof(p -> 'maxAttempts') = 'number' and (p ->> 'maxAttempts')::numeric in (1, 2, 3)
     and jsonb_typeof(p -> 'seq') = 'number' and (p ->> 'seq')::numeric between 1 and 1000 and (p ->> 'seq')::numeric = trunc((p ->> 'seq')::numeric)
     and jsonb_typeof(p -> 'spec') = 'object' and pg_column_size(p -> 'spec') <= 4096;
$$;

-- Fails a mission: remaining pending steps are skipped (a leased step keeps its lease until its holder reports).
create function private.fail_mission(p_organization_id uuid, p_mission_id uuid, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.mission_steps set status = 'skipped', finished_at = now()
  where organization_id = p_organization_id and mission_id = p_mission_id and status = 'pending';
  update public.missions set status = 'failed', failure_reason = p_reason, finished_at = now()
  where organization_id = p_organization_id and id = p_mission_id and status in ('planned', 'running');
end;
$$;

-- Completes a running mission when no step is pending or leased any more.
create function private.settle_mission(p_organization_id uuid, p_mission_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  st text;
begin
  select status into st from public.missions where organization_id = p_organization_id and id = p_mission_id;
  if st = 'running' and not exists (select 1 from public.mission_steps where organization_id = p_organization_id and mission_id = p_mission_id and status in ('pending', 'leased')) then
    update public.missions set status = 'completed', finished_at = now() where organization_id = p_organization_id and id = p_mission_id;
    return 'completed';
  end if;
  return st;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_mission: idempotency + active-mission cap + quota, atomically
-- ---------------------------------------------------------------------------
-- The server builds the plan from a code template and validates input and entitlement BEFORE calling this.
-- A direct call can only create a plan for the caller's own organization; execution happens only in the
-- server executor, which re-validates every step (free-only, registry, entitlement) before it runs.
create function public.create_mission(
  p_organization_id uuid,
  p_template text,
  p_template_version smallint,
  p_objective text,
  p_input jsonb,
  p_contract jsonb,
  p_steps jsonb,
  p_idempotency_key uuid,
  p_max_missions integer,
  p_window_hours integer,
  p_max_active integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing record;
  used integer;
  active integer;
  m_id uuid;
  s jsonb;
begin
  if not private.has_org_role(p_organization_id, 'member') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_max_missions not between 0 and 1000 or p_window_hours not between 1 and 720 or p_max_active not between 1 and 20 then
    raise exception 'invalid limits' using errcode = '22023';
  end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) not between 1 and 24 then
    raise exception 'invalid steps' using errcode = '22023';
  end if;
  for s in select * from jsonb_array_elements(p_steps) loop
    if not private.valid_mission_step(s) then
      raise exception 'invalid step' using errcode = '22023';
    end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('orqo.missions:' || p_organization_id::text, 0));

  select m.id, m.status into existing from public.missions m
  where m.organization_id = p_organization_id and m.created_by = (select auth.uid()) and m.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('mission_id', existing.id, 'status', existing.status, 'reused', true);
  end if;

  select count(*) into active from public.missions m where m.organization_id = p_organization_id and m.status in ('planned', 'running');
  if active >= p_max_active then
    raise exception 'too many active missions' using errcode = '55P03';
  end if;
  select count(*) into used from public.missions m where m.organization_id = p_organization_id and m.created_at > now() - make_interval(hours => p_window_hours);
  if used >= p_max_missions then
    raise exception 'mission quota reached' using errcode = '54000';
  end if;

  insert into public.missions (organization_id, template, template_version, objective, input, contract, idempotency_key)
  values (p_organization_id, p_template, p_template_version, left(btrim(p_objective), 300), p_input, p_contract, p_idempotency_key)
  returning id into m_id;
  insert into public.mission_steps (organization_id, mission_id, seq, step_key, kind, required, spec, max_attempts)
  select p_organization_id, m_id, (e ->> 'seq')::smallint, e ->> 'key', e ->> 'kind', (e ->> 'required')::boolean, e -> 'spec', (e ->> 'maxAttempts')::smallint
  from jsonb_array_elements(p_steps) e;
  return jsonb_build_object('mission_id', m_id, 'status', 'planned', 'reused', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_mission_step: recover expired leases, then lease the next pending step
-- ---------------------------------------------------------------------------
-- Returns {state}: claimed (with the step and the previous attempt's run), in_progress (another executor holds
-- a live lease), or the mission's terminal status. A step whose attempts are exhausted fails here (and fails the
-- mission when required), unless its last run completed: a completed run is always adoptable.
create function public.claim_mission_step(p_organization_id uuid, p_mission_id uuid, p_lease_owner uuid, p_lease_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
  s record;
  prev record;
  recovered integer;
  live timestamptz;
begin
  if not private.has_org_role(p_organization_id, 'member') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_lease_owner is null or p_lease_seconds not between 30 and 900 then
    raise exception 'invalid lease' using errcode = '22023';
  end if;
  select id, status into m from public.missions where organization_id = p_organization_id and id = p_mission_id for update;
  if not found then
    raise exception 'mission not found' using errcode = 'P0002';
  end if;
  if m.status in ('completed', 'failed', 'cancelled') then
    return jsonb_build_object('state', m.status);
  end if;
  if m.status = 'planned' then
    update public.missions set status = 'running', started_at = now() where id = m.id;
  end if;

  -- Recovery: a lease that expired belongs to an executor that stopped. Its step becomes claimable again.
  update public.mission_steps set status = 'pending', lease_owner = null, lease_expires_at = null, recoveries = recoveries + 1
  where organization_id = p_organization_id and mission_id = p_mission_id and status = 'leased' and lease_expires_at <= now();
  get diagnostics recovered = row_count;

  select max(lease_expires_at) into live from public.mission_steps
  where organization_id = p_organization_id and mission_id = p_mission_id and status = 'leased';
  if live is not null then
    return jsonb_build_object('state', 'in_progress', 'lease_expires_at', live);
  end if;

  loop
    select * into s from public.mission_steps
    where organization_id = p_organization_id and mission_id = p_mission_id and status = 'pending'
    order by seq limit 1 for update;
    if not found then
      return jsonb_build_object('state', private.settle_mission(p_organization_id, p_mission_id), 'recovered', recovered);
    end if;
    select r.id, r.status, r.created_by, (r.authority is not null) as has_authority, r.error_code into prev
    from public.agent_runs r where r.organization_id = p_organization_id and r.id = s.child_run_id;
    if s.attempt >= s.max_attempts and (prev.id is null or prev.status <> 'completed') then
      update public.mission_steps set status = 'failed', error_code = coalesce(error_code, 'attempts_exhausted'), finished_at = now() where id = s.id;
      if s.required then
        perform private.fail_mission(p_organization_id, p_mission_id, 'step_failed');
        return jsonb_build_object('state', 'failed', 'recovered', recovered);
      end if;
      continue;
    end if;
    exit;
  end loop;

  update public.mission_steps
  set status = 'leased', attempt = least(attempt + 1, max_attempts), lease_owner = p_lease_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds), leased_by = (select auth.uid()), started_at = coalesce(started_at, now())
  where id = s.id;
  return jsonb_build_object(
    'state', 'claimed',
    'recovered', recovered,
    'step', jsonb_build_object('id', s.id, 'seq', s.seq, 'key', s.step_key, 'kind', s.kind, 'required', s.required, 'spec', s.spec,
                               'attempt', least(s.attempt + 1, s.max_attempts), 'max_attempts', s.max_attempts, 'recoveries', s.recoveries),
    'previous_run', case when prev.id is null then null else jsonb_build_object('id', prev.id, 'status', prev.status, 'created_by', prev.created_by, 'has_authority', prev.has_authority, 'error_code', prev.error_code) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- attach_mission_child_run: create the step's agent run (lease holder only)
-- ---------------------------------------------------------------------------
-- Uses the Phase 4 create_agent_mission (idempotency, one concurrent run, quota) with a key derived from
-- (step, attempt): retrying the same attempt can never create a second run. The run is linked to the step
-- in the same transaction, so no run is ever orphaned from its step.
create function public.attach_mission_child_run(
  p_organization_id uuid,
  p_step_id uuid,
  p_lease_owner uuid,
  p_attempt smallint,
  p_agent_id text,
  p_mission_type text,
  p_capability text,
  p_objective text,
  p_input jsonb,
  p_autonomy smallint,
  p_limits jsonb,
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
  s record;
  res jsonb;
  r_id uuid;
begin
  if not private.has_org_role(p_organization_id, 'member') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select st.*, m.status as mission_status into s
  from public.mission_steps st join public.missions m on m.organization_id = st.organization_id and m.id = st.mission_id
  where st.organization_id = p_organization_id and st.id = p_step_id
  for update of st;
  if not found then
    raise exception 'step not found' using errcode = 'P0002';
  end if;
  if s.kind <> 'child_run' then
    raise exception 'not a child-run step' using errcode = '22023';
  end if;
  if s.mission_status <> 'running' or s.status <> 'leased' or s.lease_owner <> p_lease_owner or s.attempt <> p_attempt or s.lease_expires_at <= now() then
    raise exception 'lease lost' using errcode = '55000';
  end if;
  -- Deterministic key, shaped as an RFC 9562 version-8 UUID (version and variant nibbles set).
  res := public.create_agent_mission(p_organization_id, p_agent_id, p_mission_type, p_capability, p_objective, p_input, p_autonomy, p_limits,
                                     overlay(overlay(md5('orqo.mission-step:' || s.id::text || ':' || s.attempt::text) placing '8' from 13) placing '8' from 17)::uuid,
                                     p_max_runs, p_window_hours, p_stale_after_seconds);
  r_id := (res ->> 'run_id')::uuid;
  update public.agent_runs set mission_step_id = s.id where organization_id = p_organization_id and id = r_id and mission_step_id is null;
  update public.mission_steps set child_run_id = r_id where id = s.id;
  return res;
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_mission_step: the lease holder reports the step's outcome (fenced)
-- ---------------------------------------------------------------------------
-- Rejected (not raised) when the lease was lost (another executor reclaimed it: owner/attempt differ) or the
-- mission is no longer running (cancelled): the caller's work is discarded, never recorded twice.
-- completed: findings are inserted idempotently (unique key); a fan-out step may insert its child steps.
-- failed: retried later when p_retry and attempts remain; otherwise failed, and a required failure fails the mission.
create function public.complete_mission_step(
  p_organization_id uuid,
  p_step_id uuid,
  p_lease_owner uuid,
  p_attempt smallint,
  p_outcome text,
  p_error_code text,
  p_retry boolean,
  p_result jsonb,
  p_findings jsonb,
  p_new_steps jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  mid uuid;
  ms text;
  s record;
  f jsonb;
  e jsonb;
  total integer;
  next_status text;
begin
  if not private.has_org_role(p_organization_id, 'member') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_outcome not in ('completed', 'failed', 'skipped')
     or (p_error_code is not null and p_error_code !~ '^[a-z_]{1,40}$')
     or (p_result is not null and (jsonb_typeof(p_result) <> 'object' or pg_column_size(p_result) > 2048))
     or jsonb_typeof(coalesce(p_findings, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_findings, '[]'::jsonb)) > 40
     or jsonb_typeof(coalesce(p_new_steps, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_new_steps, '[]'::jsonb)) > 8 then
    raise exception 'invalid completion' using errcode = '22023';
  end if;
  select mission_id into mid from public.mission_steps where organization_id = p_organization_id and id = p_step_id;
  if not found then
    raise exception 'step not found' using errcode = 'P0002';
  end if;
  -- Lock order: mission, then step (same as claim and cancel).
  select status into ms from public.missions where organization_id = p_organization_id and id = mid for update;
  select * into s from public.mission_steps where id = p_step_id for update;
  if ms <> 'running' then
    return jsonb_build_object('state', 'rejected', 'reason', 'mission_' || ms);
  end if;
  if s.status <> 'leased' or s.lease_owner <> p_lease_owner or s.attempt <> p_attempt then
    return jsonb_build_object('state', 'rejected', 'reason', 'lease_lost');
  end if;

  if p_outcome = 'completed' then
    for f in select * from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) loop
      if jsonb_typeof(f) <> 'object' or coalesce(f ->> 'key', '') !~ '^[a-z0-9_:.-]{1,200}$'
         or coalesce(f ->> 'kind', '') not in ('company_analysis', 'prospect', 'prospecting_summary', 'profile_gap', 'mission_summary')
         or (f ->> 'subjectDomain' is not null and (f ->> 'subjectDomain') !~ '^[a-z0-9.-]{3,253}$')
         or jsonb_typeof(f -> 'payload') <> 'object' or pg_column_size(f -> 'payload') > 8192 then
        raise exception 'invalid finding' using errcode = '22023';
      end if;
      insert into public.mission_findings (organization_id, mission_id, step_id, agent_run_id, finding_key, kind, subject_domain, payload)
      values (p_organization_id, mid, s.id, s.child_run_id, f ->> 'key', f ->> 'kind', f ->> 'subjectDomain', f -> 'payload')
      on conflict (organization_id, mission_id, finding_key) do nothing;
    end loop;
    if jsonb_array_length(coalesce(p_new_steps, '[]'::jsonb)) > 0 then
      if s.kind <> 'fanout' then
        raise exception 'only a fan-out step adds steps' using errcode = '22023';
      end if;
      for e in select * from jsonb_array_elements(p_new_steps) loop
        -- Children of a fan-out run right after it: seq strictly inside its gap (seq + 1 … seq + 9).
        if not private.valid_mission_step(e) or e ->> 'kind' <> 'child_run' or (e ->> 'seq')::int not between s.seq + 1 and s.seq + 9 then
          raise exception 'invalid step' using errcode = '22023';
        end if;
      end loop;
      select count(*) into total from public.mission_steps where organization_id = p_organization_id and mission_id = mid;
      if total + jsonb_array_length(p_new_steps) > 24 then
        raise exception 'too many steps' using errcode = '22023';
      end if;
      insert into public.mission_steps (organization_id, mission_id, seq, step_key, kind, required, spec, max_attempts)
      select p_organization_id, mid, (x ->> 'seq')::smallint, x ->> 'key', x ->> 'kind', (x ->> 'required')::boolean, x -> 'spec', (x ->> 'maxAttempts')::smallint
      from jsonb_array_elements(p_new_steps) x;
    end if;
    next_status := 'completed';
  elsif p_outcome = 'skipped' then
    next_status := 'skipped';
  elsif coalesce(p_retry, false) and s.attempt < s.max_attempts then
    next_status := 'pending';
  else
    next_status := 'failed';
  end if;

  update public.mission_steps
  set status = next_status, lease_owner = null, lease_expires_at = null, error_code = p_error_code,
      result = coalesce(p_result, result), finished_at = case when next_status = 'pending' then null else now() end,
      -- A reported, retryable failure is closed: the next attempt starts a new run instead of re-adopting it.
      child_run_id = case when next_status = 'pending' then null else child_run_id end
  where id = s.id;

  if next_status = 'failed' and s.required then
    perform private.fail_mission(p_organization_id, mid, 'step_failed');
    return jsonb_build_object('state', 'step_failed', 'mission', 'failed');
  end if;
  return jsonb_build_object('state', 'step_' || next_status, 'mission', private.settle_mission(p_organization_id, mid));
end;
$$;

-- ---------------------------------------------------------------------------
-- release_mission_step: give a lease back without an outcome (e.g. another run is busy)
-- ---------------------------------------------------------------------------
create function public.release_mission_step(p_organization_id uuid, p_step_id uuid, p_lease_owner uuid, p_attempt smallint, p_consume boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_org_role(p_organization_id, 'member') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.mission_steps
  set status = 'pending', lease_owner = null, lease_expires_at = null,
      attempt = case when coalesce(p_consume, true) then attempt else greatest(attempt - 1, 0) end
  where organization_id = p_organization_id and id = p_step_id and status = 'leased' and lease_owner = p_lease_owner and attempt = p_attempt;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_mission: creator or admin; stops everything that is not already executing
-- ---------------------------------------------------------------------------
-- Pending and leased steps are cancelled. A queued child run is cancelled; a running child run cannot be
-- interrupted (it executes synchronously in a request) — it finishes, and its completion is rejected, so
-- nothing from it is recorded as a finding.
create function public.cancel_mission(p_organization_id uuid, p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
  steps integer;
  runs integer;
  running integer;
begin
  if not private.has_org_role(p_organization_id, 'member') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into m from public.missions where organization_id = p_organization_id and id = p_mission_id for update;
  if not found then
    raise exception 'mission not found' using errcode = 'P0002';
  end if;
  if m.created_by is distinct from (select auth.uid()) and not private.has_org_role(p_organization_id, 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if m.status not in ('planned', 'running') then
    raise exception 'mission cannot be cancelled' using errcode = '55000';
  end if;

  update public.agent_approvals a set state = 'rejected', decided_by = (select auth.uid()), decided_at = now()
  from public.mission_steps st, public.agent_runs r
  where st.organization_id = p_organization_id and st.mission_id = p_mission_id and r.organization_id = st.organization_id and r.mission_step_id = st.id
    and a.organization_id = r.organization_id and a.run_id = r.id and a.state = 'required';
  with c as (
    update public.agent_runs r
    set status = 'cancelled', error_code = 'cancelled', finished_at = now(),
        approval_state = case when r.approval_state = 'required' then 'rejected' else r.approval_state end
    from public.mission_steps st
    where st.organization_id = p_organization_id and st.mission_id = p_mission_id and r.organization_id = st.organization_id
      and r.mission_step_id = st.id and r.status in ('queued', 'waiting_for_approval')
    returning r.mission_id
  ), cm as (
    update public.agent_missions am set status = 'cancelled', failure_reason = 'cancelled', completed_at = now()
    where am.organization_id = p_organization_id and am.id in (select mission_id from c) and am.status in ('queued', 'waiting_for_approval')
    returning 1
  )
  select count(*) into runs from c;
  select count(*) into running from public.agent_runs r join public.mission_steps st on st.organization_id = r.organization_id and st.id = r.mission_step_id
  where st.organization_id = p_organization_id and st.mission_id = p_mission_id and r.status = 'running';

  update public.mission_steps set status = 'cancelled', lease_owner = null, lease_expires_at = null, finished_at = now()
  where organization_id = p_organization_id and mission_id = p_mission_id and status in ('pending', 'leased');
  get diagnostics steps = row_count;
  update public.missions set status = 'cancelled', failure_reason = 'cancelled', cancelled_by = (select auth.uid()), finished_at = now() where id = m.id;
  return jsonb_build_object('cancelled_steps', steps, 'cancelled_runs', runs, 'running_runs', running);
end;
$$;

revoke all on function private.valid_mission_step(jsonb) from public, anon;
revoke all on function private.fail_mission(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.settle_mission(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_mission(uuid, text, smallint, text, jsonb, jsonb, jsonb, uuid, integer, integer, integer) from public, anon;
revoke all on function public.claim_mission_step(uuid, uuid, uuid, integer) from public, anon;
revoke all on function public.attach_mission_child_run(uuid, uuid, uuid, smallint, text, text, text, text, jsonb, smallint, jsonb, integer, integer, integer) from public, anon;
revoke all on function public.complete_mission_step(uuid, uuid, uuid, smallint, text, text, boolean, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.release_mission_step(uuid, uuid, uuid, smallint, boolean) from public, anon;
revoke all on function public.cancel_mission(uuid, uuid) from public, anon;
grant execute on function public.create_mission(uuid, text, smallint, text, jsonb, jsonb, jsonb, uuid, integer, integer, integer) to authenticated;
grant execute on function public.claim_mission_step(uuid, uuid, uuid, integer) to authenticated;
grant execute on function public.attach_mission_child_run(uuid, uuid, uuid, smallint, text, text, text, text, jsonb, smallint, jsonb, integer, integer, integer) to authenticated;
grant execute on function public.complete_mission_step(uuid, uuid, uuid, smallint, text, text, boolean, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.release_mission_step(uuid, uuid, uuid, smallint, boolean) to authenticated;
grant execute on function public.cancel_mission(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges (default deny; read for viewers; writes only through the functions above)
-- ---------------------------------------------------------------------------
revoke all on public.missions, public.mission_steps, public.mission_findings from anon, authenticated, service_role;
grant select on public.missions, public.mission_steps, public.mission_findings to authenticated;

alter table public.missions enable row level security;
alter table public.mission_steps enable row level security;
alter table public.mission_findings enable row level security;
create policy missions_select on public.missions for select to authenticated using (private.has_org_role(organization_id, 'viewer'));
create policy mission_steps_select on public.mission_steps for select to authenticated using (private.has_org_role(organization_id, 'viewer'));
create policy mission_findings_select on public.mission_findings for select to authenticated using (private.has_org_role(organization_id, 'viewer'));
