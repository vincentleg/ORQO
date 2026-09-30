-- Least privilege: the application never uses the service role, so it gets no
-- privileges on Phase 1 tables (this project's default ACL otherwise grants it
-- TRUNCATE, REFERENCES, TRIGGER and MAINTAIN). Later phases that need a
-- privileged backend path must grant exactly what they use, in a migration.
revoke all on
  public.profiles, public.organizations, public.organization_memberships, public.audit_events,
  public.companies, public.sources, public.company_capabilities, public.company_needs, public.contacts,
  public.relationships, public.analysis_runs, public.opportunities, public.opportunity_participants
from service_role;
