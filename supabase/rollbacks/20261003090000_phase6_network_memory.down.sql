-- Rollback for 20261003090000_phase6_network_memory (manual; not run by db:migrate).
-- DESTRUCTIVE for Phase 6 data: deletes all interactions, follow-ups and
-- relationship history, and the relationship metadata and contact details
-- recorded since Phase 6. Audit events already written stay in audit_events.
-- Apply only with the application rolled back to a pre-Phase-6 build.
begin;

drop trigger if exists record_network_event on public.companies;
drop trigger if exists record_network_event on public.contacts;

drop table if exists public.network_events;
drop table if exists public.follow_ups;
drop table if exists public.interactions;

drop function if exists private.record_network_event();
drop function if exists private.follow_up_lifecycle();

drop index if exists public.contacts_one_primary_idx;
alter table public.contacts
  drop column if exists email,
  drop column if exists phone,
  drop column if exists profile_url,
  drop column if exists notes,
  drop column if exists is_primary;

alter table public.companies
  drop column if exists network_stage,
  drop column if exists network_origin,
  drop column if exists network_reason;

delete from supabase_migrations.schema_migrations where version = '20261003090000';
commit;
