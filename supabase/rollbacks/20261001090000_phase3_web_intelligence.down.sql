-- MANUAL ROLLBACK for 20261001090000_phase3_web_intelligence.sql.
-- Destroys all research runs, company intelligence, evidence items and usage
-- events, and the own-company profile fields added in Phase 3. Sources created
-- by research stay (their `authority` column is dropped). Back up first.
begin;
drop function if exists public.start_research_run(uuid, public.research_mode, text, text, integer, integer, integer);
drop table if exists public.usage_events;
drop table if exists public.evidence_items;
drop table if exists public.company_intelligence;
drop table if exists public.research_runs;
drop type if exists public.research_status;
drop type if exists public.research_mode;
alter table public.sources drop column if exists authority;
alter table public.companies
  drop constraint if exists companies_partnership_goals_values,
  drop constraint if exists companies_profile_list_sizes,
  drop column if exists partnership_goals,
  drop column if exists sought_capabilities,
  drop column if exists customer_segments,
  drop column if exists offerings;
delete from supabase_migrations.schema_migrations where version = '20261001090000';
commit;
