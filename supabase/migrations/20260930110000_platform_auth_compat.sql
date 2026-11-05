-- Recovery (Nov 2026): ORQO on standard PostgreSQL (Neon, local) instead of Supabase.
--
-- The application schema (every later migration) was written for Supabase and relies on exactly four platform
-- pieces: the roles anon / authenticated / service_role, Supabase's default privileges on schema public,
-- auth.users (with raw_user_meta_data, read by the new-user trigger) and auth.uid(). This migration provides
-- them on a plain PostgreSQL database so the later migrations, their 45 RLS policies, functions and triggers
-- run UNCHANGED. Tenant isolation stays inside the database: the application runs every user query as role
-- `authenticated` with the user id in the transaction-local setting read by auth.uid().
--
-- On a real Supabase database (auth.users already exists) this migration does nothing.

do $compat$
begin
  if to_regclass('auth.users') is not null then
    raise notice 'auth.users exists (Supabase): platform compatibility layer skipped';
    return;
  end if;

  -- Roles. NOLOGIN: nobody connects as them; the application owner switches to them per transaction.
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit; end if;
  -- The owner (the migration runner and the application's connection) must be able to SET ROLE to them.
  execute format('grant anon, authenticated to %I', current_user);

  -- Supabase's defaults on schema public; later migrations narrow them explicitly (revoke/grant), as on Supabase.
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;

  -- Accounts. Passwords are scrypt hashes (src/lib/server/auth/password.ts); never readable by app roles.
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    encrypted_password text not null,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    -- Server/operator-only metadata (a user can never set it), as in Supabase. Used to mark test-run accounts.
    raw_app_meta_data jsonb not null default '{}'::jsonb,
    email_confirmed_at timestamptz,
    last_sign_in_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint users_email_format check (email = lower(btrim(email)) and length(email) between 3 and 320 and position('@' in email) > 1)
  );
  create unique index users_email_key on auth.users (email);

  -- Sessions: only a SHA-256 of the random token is stored, so a database read cannot be replayed as a cookie.
  create table auth.sessions (
    token_hash text primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    expires_at timestamptz not null
  );
  create index sessions_user_idx on auth.sessions (user_id);
  create index sessions_expiry_idx on auth.sessions (expires_at);

  -- Throttling of sign-in / sign-up attempts (hashed keys only: no raw IP or email is stored).
  create table auth.rate_limits (
    bucket text not null,
    key_hash text not null,
    window_start timestamptz not null,
    attempts integer not null default 0,
    primary key (bucket, key_hash, window_start)
  );
  create index rate_limits_window_idx on auth.rate_limits (window_start);

  revoke all on all tables in schema auth from public, anon, authenticated, service_role;
end;
$compat$;

-- auth.uid(): the signed-in user of the current transaction (set with set_config(..., true) by the server).
-- Outside a user transaction it is NULL, so every RLS policy denies.
do $uid$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' and p.proname = 'uid') then
    return;
  end if;
  execute $f$
    create function auth.uid() returns uuid
    language sql stable
    set search_path = ''
    as $body$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $body$
  $f$;
  execute 'revoke all on function auth.uid() from public';
  execute 'grant execute on function auth.uid() to anon, authenticated, service_role';
end;
$uid$;
