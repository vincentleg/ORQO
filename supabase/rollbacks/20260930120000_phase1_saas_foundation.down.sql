-- MANUAL ROLLBACK for 20260930120000_phase1_saas_foundation.sql
-- DESTRUCTIVE: drops every Phase 1 table and all data in them. Never run by
-- scripts/db-migrate.ts. Run by hand only against a development project, after
-- a backup, then delete the matching row from supabase_migrations.schema_migrations.

begin;

drop trigger if exists on_auth_user_created on auth.users;

drop function if exists public.set_member_role(uuid, uuid, public.org_role);
drop function if exists public.create_organization(text, public.locale_code);

drop table if exists public.opportunity_participants;
drop table if exists public.opportunities;
drop table if exists public.analysis_runs;
drop table if exists public.relationships;
drop table if exists public.contacts;
drop table if exists public.company_needs;
drop table if exists public.company_capabilities;
drop table if exists public.sources;
drop table if exists public.companies;
drop table if exists public.audit_events;
drop table if exists public.organization_memberships;
drop table if exists public.organizations;
drop table if exists public.profiles;

drop schema if exists private cascade;

drop type if exists public.source_kind;
drop type if exists public.participant_role;
drop type if exists public.lifecycle_stage;
drop type if exists public.relationship_status;
drop type if exists public.need_intensity;
drop type if exists public.visibility_level;
drop domain if exists public.locale_code;
drop type if exists public.org_role;

delete from supabase_migrations.schema_migrations where version = '20260930120000';

commit;
