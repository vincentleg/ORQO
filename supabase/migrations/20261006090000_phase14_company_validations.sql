-- ORQO V2 · Phase 14 · Adaptive Commercial Understanding — human validations
-- Business DNA and the Domain & Market Model are DERIVED: the application
-- recomputes them from the stored evidence (company_intelligence,
-- evidence_items, sources) on read. The only new state is what cannot be
-- recomputed: what a person said about their company —
--   * confirm / reject of a derived item (item_key = '<facet>:<value-key>');
--   * answer to the next question (facet = a business dimension, value = one
--     to three ontology values, or 'not_sure').
-- Append-only (the latest entry per item / dimension wins): no update or
-- delete privilege. Organization-scoped, same-organization company key,
-- RLS default-deny, unreachable by anon and service_role. Values are enum-like
-- keys, never free text.

create table public.company_validations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid not null,
  kind text not null check (kind in ('confirm', 'reject', 'answer')),
  facet text not null check (facet ~ '^[a-z_]{2,40}$'),
  item_key text check (item_key is null or item_key ~ '^[a-z_]{2,40}:[a-z0-9_]{1,80}$'),
  value text not null default '' check (value ~ '^([a-z_]{2,40}(,[a-z_]{2,40}){0,2})?$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, company_id) references public.companies (organization_id, id) on delete cascade,
  check ((kind = 'answer') = (item_key is null)),
  check (kind <> 'answer' or value <> '')
);

create index company_validations_company_idx on public.company_validations (organization_id, company_id, created_at);

create trigger set_created_by before insert on public.company_validations for each row execute function private.set_created_by();
create trigger audit_change after insert or update or delete on public.company_validations for each row execute function private.audit_change();

revoke all on public.company_validations from anon, authenticated, service_role;
grant select, insert on public.company_validations to authenticated;

alter table public.company_validations enable row level security;
create policy company_validations_select on public.company_validations
  for select to authenticated using (private.has_org_role(organization_id, 'viewer'));
create policy company_validations_insert on public.company_validations
  for insert to authenticated with check (private.has_org_role(organization_id, 'member'));
