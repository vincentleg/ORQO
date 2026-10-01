-- Rollback for 20261004090000_phase7_company_signals (manual; not run by db:migrate).
-- DESTRUCTIVE for Phase 7 data: deletes all company signals. Follow-ups that
-- were created from a signal are kept and re-labeled origin 'manual' so the
-- restored Phase 6 constraint holds. Audit events already written stay in
-- audit_events. Apply only with the application rolled back to a pre-Phase-7 build.
begin;

drop table if exists public.company_signals;
drop function if exists private.company_signal_lifecycle();

update public.follow_ups set origin = 'manual' where origin = 'signal';
alter table public.follow_ups drop constraint follow_ups_origin_check;
alter table public.follow_ups add constraint follow_ups_origin_check check (origin in ('manual', 'interaction', 'next_action'));

delete from supabase_migrations.schema_migrations where version = '20261004090000';
commit;
