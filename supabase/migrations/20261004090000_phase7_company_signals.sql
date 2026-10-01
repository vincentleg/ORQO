-- ORQO V2 · Phase 7 · Intelligence & signals
-- A signal is a PUBLIC business change about one Network company, with its
-- provenance: what changed, which public source says so, when it was
-- published (if known) and when ORQO first and last saw it. Signals hold
-- public information only — private relationship memory (notes, interactions,
-- follow-ups) is never copied here; relevance against it is computed at read
-- time by the application.
--
-- Rows come from two no-cost paths:
--   * origin = 'research': the delta between two stored Search analyses of the
--     same official website (Phase 3 evidence store), linked to the source row;
--   * origin = 'manual': a public change a person recorded with its source URL
--     (never fetched by ORQO).
-- Organization-scoped, composite-keyed to same-organization company / source /
-- follow-up rows, RLS default-deny, unreachable by anon and service_role.
-- After insert, only lifecycle columns can change (column-level grants).

-- Follow-ups can now be created from a signal (explicitly, by a person).
alter table public.follow_ups drop constraint follow_ups_origin_check;
alter table public.follow_ups add constraint follow_ups_origin_check check (origin in ('manual', 'interaction', 'next_action', 'signal'));

create table public.company_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid not null,
  kind text not null check (kind in (
    'geographic_expansion', 'market_entry', 'product_launch', 'offering_change', 'manufacturing', 'funding', 'hiring',
    'partnership', 'acquisition', 'customer_win', 'certification', 'event', 'other'
  )),
  origin text not null check (origin in ('research', 'manual')),
  -- What changed, as the source states it (or as the person recorded it). Source language.
  headline text not null check (char_length(btrim(headline)) between 1 and 400),
  detail text not null default '' check (char_length(detail) <= 1000),
  -- Short verbatim excerpt of the public source (research only).
  excerpt text check (excerpt is null or char_length(excerpt) <= 320),
  -- Evidence-store field and concept keys the change is about.
  field text check (field is null or field ~ '^[a-z_]{1,40}$'),
  concepts text[] not null default '{}' check (cardinality(concepts) <= 12),
  -- fact: the source states it · inference: derived from a mention, to validate.
  epistemic text not null check (epistemic in ('fact', 'inference')),
  evidence_quality text not null check (evidence_quality in ('strong', 'moderate', 'limited')),
  -- Provenance. source_id: the evidence-store source (research); source_url: the cited page.
  source_id uuid,
  source_url text not null check (char_length(source_url) <= 2000 and source_url ~* '^https?://'),
  source_label text not null default '' check (char_length(source_label) <= 500),
  source_authority text not null check (source_authority in ('official', 'third_party', 'search_result')),
  -- Publication / event day when the source states one; null = unknown (never guessed).
  published_on date,
  -- When the source was retrieved by ORQO (research only).
  retrieved_at timestamptz,
  -- What ORQO knew before (delta): the earlier analysis time and its concepts in this field.
  previous_researched_at timestamptz,
  previous_concepts text[] not null default '{}' check (cardinality(previous_concepts) <= 24),
  dedup_key text not null check (dedup_key ~ '^[a-z_]{1,40}:[a-z_]{1,40}:[0-9a-f]{8,16}$'),
  status text not null default 'new' check (status in ('new', 'reviewed', 'acted_on', 'dismissed')),
  status_changed_at timestamptz,
  status_changed_by uuid references auth.users (id) on delete set null,
  follow_up_id uuid,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (origin <> 'research' or (source_id is not null and retrieved_at is not null)),
  check (last_seen_at >= first_seen_at),
  foreign key (organization_id, company_id) references public.companies (organization_id, id) on delete cascade,
  foreign key (organization_id, source_id) references public.sources (organization_id, id) on delete set null (source_id),
  foreign key (organization_id, follow_up_id) references public.follow_ups (organization_id, id) on delete set null (follow_up_id),
  unique (organization_id, id),
  -- Deduplication: one signal per company and change.
  unique (organization_id, company_id, dedup_key)
);
create index company_signals_org_seen_idx on public.company_signals (organization_id, first_seen_at desc);
create index company_signals_company_idx on public.company_signals (organization_id, company_id, first_seen_at desc);

-- ---------------------------------------------------------------------------
-- Lifecycle: the database decides who/when a status changed, and a signal can
-- only describe a Network company (never the organization's own company).
-- ---------------------------------------------------------------------------
create function private.company_signal_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.companies c where c.organization_id = new.organization_id and c.id = new.company_id and c.is_own_company) then
      raise exception 'signals describe Network companies, not the own company' using errcode = '23514';
    end if;
    new.status := 'new';
    new.status_changed_at := null;
    new.status_changed_by := null;
    new.first_seen_at := now();
    new.last_seen_at := now();
  elsif new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := (select auth.uid());
  else
    new.status_changed_at := old.status_changed_at;
    new.status_changed_by := old.status_changed_by;
  end if;
  if tg_op = 'UPDATE' and new.last_seen_at < old.last_seen_at then
    new.last_seen_at := old.last_seen_at;
  end if;
  return new;
end;
$$;
revoke all on function private.company_signal_lifecycle() from public;

create trigger company_signal_lifecycle
  before insert or update on public.company_signals
  for each row execute function private.company_signal_lifecycle();
create trigger set_updated_at before update on public.company_signals for each row execute function private.set_updated_at();
create trigger set_created_by before insert on public.company_signals for each row execute function private.set_created_by();
create trigger enforce_immutable_ownership before update on public.company_signals for each row execute function private.enforce_immutable_ownership();
create trigger audit_change after insert or update or delete on public.company_signals for each row execute function private.audit_change();

-- ---------------------------------------------------------------------------
-- Privileges: provenance is immutable once written; only the lifecycle moves.
-- ---------------------------------------------------------------------------
revoke all on public.company_signals from anon, authenticated, service_role;
grant select, insert, delete on public.company_signals to authenticated;
grant update (status, follow_up_id, last_seen_at) on public.company_signals to authenticated;

alter table public.company_signals enable row level security;
create policy company_signals_select on public.company_signals
  for select to authenticated using (private.has_org_role(organization_id, 'viewer'));
create policy company_signals_insert on public.company_signals
  for insert to authenticated with check (private.has_org_role(organization_id, 'member'));
create policy company_signals_update on public.company_signals
  for update to authenticated
  using (private.has_org_role(organization_id, 'member'))
  with check (private.has_org_role(organization_id, 'member'));
create policy company_signals_delete on public.company_signals
  for delete to authenticated using (private.has_org_role(organization_id, 'member'));
