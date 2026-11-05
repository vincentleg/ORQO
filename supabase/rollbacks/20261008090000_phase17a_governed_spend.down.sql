-- Rollback for 20261008090000_phase17a_governed_spend (manual; not run by db:migrate).
-- DESTRUCTIVE for Phase 17A data: deletes the provider spend ledger (and its link from usage_events) and the
-- authority snapshots of agent runs. Usage events, runs and audit events themselves are kept. Apply only with
-- the application rolled back to a pre-Phase-17A build.
begin;

drop function if exists public.record_governance_event(uuid, text, uuid, text);
drop function if exists public.settle_provider_spend(uuid, uuid, text, numeric);
drop function if exists public.reserve_provider_spend(uuid, uuid, uuid, text, text, text, numeric, numeric, integer, uuid);
drop function if exists public.set_agent_run_authority(uuid, uuid, jsonb, uuid);

alter table public.usage_events drop constraint if exists usage_events_reservation_fk;
alter table public.usage_events drop column if exists reservation_id;
alter table public.usage_events drop column if exists duration_ms;

drop table if exists public.provider_spend;

-- Phase 4 state machine, restored verbatim.
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

drop index if exists public.agent_runs_parent_idx;
alter table public.agent_runs drop constraint if exists agent_runs_depth_parent;
alter table public.agent_runs drop constraint if exists agent_runs_parent_not_self;
alter table public.agent_runs drop constraint if exists agent_runs_parent_fk;
alter table public.agent_runs drop column if exists authority;
alter table public.agent_runs drop column if exists depth;
alter table public.agent_runs drop column if exists parent_run_id;

delete from supabase_migrations.schema_migrations where version = '20261008090000';

commit;
