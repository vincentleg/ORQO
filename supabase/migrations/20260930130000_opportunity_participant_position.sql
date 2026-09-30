-- Keeps the engine's contribution order (e.g. software vendor first, hardware
-- partner second) when opportunities are persisted and reloaded.
alter table public.opportunity_participants
  add column position smallint not null default 0 check (position >= 0);
