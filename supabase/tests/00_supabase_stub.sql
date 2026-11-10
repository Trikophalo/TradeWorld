-- Minimal stand-in for the objects a real Supabase project provides.
-- Used ONLY by verify_local.sh on a throwaway plain-Postgres cluster.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create schema extensions;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb,
  created_at         timestamptz not null default now()
);

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ), '')::uuid
$$;

create function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

-- Supabase's permissive defaults for the public schema. The migrations have
-- to close these again - that is part of what the verification checks.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create publication supabase_realtime;

-- Test helpers
create schema tests;
grant usage on schema tests to public;

create function tests.assert(p_condition boolean, p_message text) returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'ASSERTION FAILED: %', p_message;
  end if;
  raise notice 'ok - %', p_message;
end;
$$;

-- Switches the session to a role with the JWT claims PostgREST would set.
create function tests.login_as(p_role text, p_user uuid default null) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', p_role)::text, false);
  execute format('set role %I', p_role);
end;
$$;
grant execute on all functions in schema tests to public;

-- Runs a statement as the current role and asserts that it fails with the
-- expected SQLSTATE (e.g. 42501 = insufficient privilege / RLS violation).
create function tests.throws(p_sql text, p_sqlstate text, p_message text) returns void
language plpgsql
as $$
declare
  v_state text;
  v_msg   text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = p_sqlstate then
      raise notice 'ok - % (% %)', p_message, v_state, left(v_msg, 70);
      return;
    end if;
    raise exception 'ASSERTION FAILED: % - expected SQLSTATE % but got % (%)', p_message, p_sqlstate, v_state, v_msg;
  end;
  raise exception 'ASSERTION FAILED: % - statement succeeded but should fail with %', p_message, p_sqlstate;
end;
$$;

-- Number of rows a statement returns/affects for the current role.
create function tests.row_count(p_sql text) returns bigint
language plpgsql
as $$
declare
  v_count bigint;
begin
  execute p_sql;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on all functions in schema tests to public;
