-- Emula lo mínimo de Supabase que necesitan las migraciones para poder
-- aplicarlas y probarlas en un Postgres local (roles, schema auth, auth.uid()).
-- No forma parte del despliegue: en Supabase todo esto ya existe.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id                uuid primary key default gen_random_uuid(),
  email             text unique,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.email', true), '');
$$;

create table if not exists storage.buckets (
  id      text primary key,
  name    text not null,
  public  boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text not null,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz not null default now()
);

grant usage on schema auth, storage to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Utilidades para las pruebas del esquema (solo entorno local)
-- ---------------------------------------------------------------------------
create schema if not exists test;

create or replace function test.afirmar(p_condicion boolean, p_mensaje text)
returns void language plpgsql as $$
begin
  if p_condicion is not true then
    raise exception 'FALLA: %', p_mensaje using errcode = 'assert_failure';
  end if;
  raise notice '  ok · %', p_mensaje;
end;
$$;

-- Verifica que una sentencia falle. Si NO falla, la prueba falla.
create or replace function test.debe_fallar(p_sql text, p_mensaje text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when assert_failure then raise;
    when others then
      raise notice '  ok · % (%).', p_mensaje, sqlerrm;
      return;
  end;
  raise exception 'FALLA: se esperaba un error pero la sentencia pasó · %', p_mensaje
    using errcode = 'assert_failure';
end;
$$;

-- Ejecuta como si fuera un usuario autenticado de Supabase.
create or replace function test.como_usuario(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

-- Crea un usuario completo (auth + perfil), como haría el alta real desde la
-- aplicación, y devuelve su id.
create or replace function test.crear_usuario(
  p_nombres    text,
  p_apellidos  text,
  p_correo     text,
  p_rol        text,
  p_sede       uuid default null,
  p_operario   boolean default false,
  p_costo_hora numeric default 0
) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_id, p_correo);
  insert into public.usuarios
    (id, nombres, apellidos, correo, rol_id, sede_id, es_operario, costo_hora)
  select v_id, p_nombres, p_apellidos, p_correo, r.id, p_sede, p_operario, p_costo_hora
    from public.roles r where r.codigo = p_rol;
  return v_id;
end;
$$;

-- Las pruebas de RLS se ejecutan con "set role authenticated", así que ese rol
-- necesita poder llamar a los ayudantes de prueba.
grant usage on schema test to authenticated;
grant execute on all functions in schema test to authenticated;

