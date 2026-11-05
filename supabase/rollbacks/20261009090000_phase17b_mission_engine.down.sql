-- Rollback of 20261009090000_phase17b_mission_engine (Phase 17B mission engine).
-- Removes the mission tables, the agent_runs.mission_step_id link, the RPCs and helpers. Agent runs created by
-- missions stay (they are ordinary Phase 4 runs). Take a snapshot first (RECOVERY-RUNBOOK.md).
begin;

drop function if exists public.cancel_mission(uuid, uuid);
drop function if exists public.release_mission_step(uuid, uuid, uuid, smallint, boolean);
drop function if exists public.complete_mission_step(uuid, uuid, uuid, smallint, text, text, boolean, jsonb, jsonb, jsonb);
drop function if exists public.attach_mission_child_run(uuid, uuid, uuid, smallint, text, text, text, text, jsonb, smallint, jsonb, integer, integer, integer);
drop function if exists public.claim_mission_step(uuid, uuid, uuid, integer);
drop function if exists public.create_mission(uuid, text, smallint, text, jsonb, jsonb, jsonb, uuid, integer, integer, integer);

drop trigger if exists enforce_run_mission_step on public.agent_runs;
alter table public.agent_runs drop constraint if exists agent_runs_mission_step_fk;
drop index if exists public.agent_runs_mission_step_idx;
alter table public.agent_runs drop column if exists mission_step_id;

drop table if exists public.mission_findings;
drop table if exists public.mission_steps;
drop table if exists public.missions;

drop function if exists private.settle_mission(uuid, uuid);
drop function if exists private.fail_mission(uuid, uuid, text);
drop function if exists private.valid_mission_step(jsonb);
drop function if exists private.audit_mission_event();
drop function if exists private.enforce_run_mission_step();
drop function if exists private.enforce_mission_step();
drop function if exists private.enforce_mission_status();

delete from supabase_migrations.schema_migrations where version = '20261009090000';

commit;
