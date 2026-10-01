-- Rollback for 20261005090000_phase8_events (manual; not run by db:migrate).
-- DESTRUCTIVE for Phase 8 data: deletes all events and event targets, and the
-- event references on companies, contacts, interactions and follow-ups. The
-- canonical companies, contacts, interactions and follow-ups themselves are
-- kept; follow-ups created with origin 'event' are re-labeled 'manual' so the
-- restored Phase 7 constraint holds. Audit events already written stay in
-- audit_events. Apply only with the application rolled back to a pre-Phase-8 build.
begin;

drop trigger if exists keep_origin_event on public.companies;
drop function if exists private.keep_origin_event();

alter table public.companies drop constraint if exists companies_origin_event_fk;
alter table public.companies drop column if exists origin_event_id;
alter table public.contacts drop constraint if exists contacts_event_fk;
alter table public.contacts drop column if exists event_id;
alter table public.interactions drop constraint if exists interactions_event_fk;
alter table public.interactions drop column if exists event_id;
alter table public.follow_ups drop constraint if exists follow_ups_event_fk;
alter table public.follow_ups drop column if exists event_id;

update public.follow_ups set origin = 'manual' where origin = 'event';
alter table public.follow_ups drop constraint follow_ups_origin_check;
alter table public.follow_ups add constraint follow_ups_origin_check check (origin in ('manual', 'interaction', 'next_action', 'signal'));

drop table if exists public.event_companies;
drop table if exists public.events;
drop function if exists private.event_company_lifecycle();

delete from supabase_migrations.schema_migrations where version = '20261005090000';
commit;
