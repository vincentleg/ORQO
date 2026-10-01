-- Rollback for 20261002090000_phase4_agent_infrastructure (manual; not run by db:migrate).
-- DESTRUCTIVE for Phase 4 data: deletes all agent missions, runs, steps, tool
-- calls and approvals. Audit events already written stay in audit_events.
-- Usage events keep their research attribution; only the agent link is dropped.
-- Apply only with the application rolled back to a pre-Phase-4 build.
begin;

drop function if exists public.cancel_agent_run(uuid, uuid);
drop function if exists public.decide_agent_approval(uuid, uuid, text);
drop function if exists public.request_agent_approval(uuid, uuid, text, jsonb, integer);
drop function if exists public.create_agent_mission(uuid, text, text, text, text, jsonb, smallint, jsonb, uuid, integer, integer, integer);

drop index if exists public.usage_events_agent_run_idx;
alter table public.usage_events drop constraint if exists usage_events_agent_run_fk;
alter table public.usage_events drop column if exists agent_run_id;

drop table if exists public.agent_approvals;
drop table if exists public.agent_run_tool_calls;
drop table if exists public.agent_run_steps;
drop table if exists public.agent_runs;
drop table if exists public.agent_missions;

drop function if exists private.audit_agent_event();
drop function if exists private.enforce_agent_step_final();
drop function if exists private.enforce_agent_status();

delete from supabase_migrations.schema_migrations where version = '20261002090000';

commit;
