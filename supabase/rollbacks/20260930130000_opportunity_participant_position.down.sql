-- MANUAL ROLLBACK for 20260930130000_opportunity_participant_position.sql.
-- Contribution order is lost; reloaded opportunities list participants in arbitrary order.
-- (20260930140000 only revokes privileges; it has no rollback, since restoring them would widen access.)
begin;
alter table public.opportunity_participants drop column if exists position;
delete from supabase_migrations.schema_migrations where version = '20260930130000';
commit;
