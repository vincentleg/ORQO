-- Rollback for 20261007090000_phase16_tracked_opportunities (manual; not run by db:migrate).
-- DESTRUCTIVE for Phase 16 data: deletes every tracked opportunity. Companies,
-- intelligence and validations are untouched. Audit events already written stay
-- in audit_events. Apply only with the application rolled back to a pre-Phase-16 build.
begin;

drop table if exists public.tracked_opportunities;
drop function if exists private.tracked_opportunity_status();

delete from supabase_migrations.schema_migrations where version = '20261007090000';

commit;
