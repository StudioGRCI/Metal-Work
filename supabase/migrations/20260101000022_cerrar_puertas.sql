-- =============================================================================
-- CERRAR LAS PUERTAS QUE QUEDARON ENTREABIERTAS
-- -----------------------------------------------------------------------------
-- En Postgres, una función nace con permiso de ejecución para todo el mundo.
-- Darle el permiso a «authenticated» no le quita nada a nadie: el permiso de
-- fábrica sigue ahí, y en Supabase eso significa que cualquiera puede llamarla
-- desde internet sin haber entrado, con /rest/v1/rpc/loquesea.
--
-- Las funciones del sistema se defienden solas —piden permiso antes de hacer
-- nada—, pero unas cuantas de consulta no: el calendario laboral contestaba a
-- cualquiera qué días trabaja la empresa. Y las funciones de disparador no
-- tienen por qué ser llamables: existen para que las corra un trigger.
--
-- Acá se cierran las dos cosas de una vez, y con una regla que sigue valiendo
-- para lo que se agregue después.
--
-- Se dejan fuera las funciones que trajo una extensión —unaccent, pg_trgm,
-- btree_gist viven en public—: no son nuestras, no las expone la aplicación y
-- tocarlas fallaría por no ser su dueño. Y cada paso va con su red por si
-- alguna función tiene otro dueño: se salta esa y sigue con el resto.
-- =============================================================================

-- Las que vinieron con una extensión no se tocan.
create or replace function pg_temp.es_de_extension(p_oid oid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from pg_depend d
     where d.objid = p_oid
       and d.classid = 'pg_proc'::regclass
       and d.deptype = 'e'
  );
$$;

-- ------------------------------------------- las funciones de los disparadores
-- No las llama nadie a mano: las corre el trigger, que no pasa por el permiso
-- de ejecución. Se las quitamos a todos, incluida la sesión con usuario.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'trigger'::regtype
       and not pg_temp.es_de_extension(p.oid)
  loop
    begin
      execute format('revoke all on function %s from public, anon, authenticated', f.firma);
    exception when insufficient_privilege then
      raise notice 'Sin permiso para cerrar %; se deja como está', f.firma;
    end;
  end loop;
end;
$$;

-- ------------------------------------------------- las demás, cerradas a anon
-- El sistema no tiene nada que contestarle a quien no entró: se entra por la
-- pantalla de ingreso, no por /rest/v1/rpc. Vale para todas, no solo para las
-- definidoras, porque el permiso de fábrica es igual de amplio en cualquiera.
--
-- Ojo con el detalle: quitar el permiso de fábrica también se lo quita a quien
-- lo tenía solo por esa vía. Así que primero se anota quién podía llamar cada
-- función y después se le devuelve —a nadie más—. Las que estaban cerradas a
-- propósito, como la que quema correlativos, siguen cerradas.
do $$
declare
  f record;
  v_auth boolean;
  v_serv boolean;
  v_hay_service boolean := exists (select 1 from pg_roles where rolname = 'service_role');
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype <> 'trigger'::regtype
       and not pg_temp.es_de_extension(p.oid)
  loop
    v_auth := has_function_privilege('authenticated', f.firma, 'execute');
    v_serv := v_hay_service and has_function_privilege('service_role', f.firma, 'execute');

    begin
      execute format('revoke all on function %s from public, anon', f.firma);

      if v_auth then
        execute format('grant execute on function %s to authenticated', f.firma);
      end if;
      if v_serv then
        execute format('grant execute on function %s to service_role', f.firma);
      end if;
    exception when insufficient_privilege then
      raise notice 'Sin permiso para cerrar %; se deja como está', f.firma;
    end;
  end loop;
end;
$$;

-- ------------------------------------------------ el camino de búsqueda fijo
-- Sin search_path fijo, una función definidora puede terminar llamando a una
-- tabla o función puesta por otro en un esquema que se lee antes. Se lo fijamos
-- a las que quedaron sin él.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and not pg_temp.es_de_extension(p.oid)
       and (p.proconfig is null
            or not exists (
              select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
  loop
    begin
      execute format('alter function %s set search_path to ''public''', f.firma);
    exception when insufficient_privilege then
      raise notice 'Sin permiso para fijar el camino de búsqueda de %', f.firma;
    end;
  end loop;
end;
$$;
