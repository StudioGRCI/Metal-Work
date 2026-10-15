-- Ninguna función del sistema le contesta a quien no entró, y las de los
-- disparadores no le contestan a nadie. Las funciones que trajo una extensión
-- quedan fuera: no son nuestras y la aplicación no las expone.
\set ON_ERROR_STOP on
begin;

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

do $$
declare
  v_abiertas text;
  v_cuantas  int;
begin
  select string_agg(p.proname, ', ' order by p.proname), count(*)
    into v_abiertas, v_cuantas
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and not pg_temp.es_de_extension(p.oid)
     and has_function_privilege('anon', p.oid, 'execute');

  if v_cuantas > 0 then
    raise exception 'FALLA: % funciones quedaron abiertas a quien no entró: %', v_cuantas, v_abiertas;
  end if;
  raise notice '  ok · ninguna función del esquema público atiende a anon';
end $$;

do $$
declare
  v_abiertas text;
  v_cuantas  int;
begin
  select string_agg(p.proname, ', ' order by p.proname), count(*)
    into v_abiertas, v_cuantas
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prorettype = 'trigger'::regtype
     and not pg_temp.es_de_extension(p.oid)
     and (has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute'));

  if v_cuantas > 0 then
    raise exception 'FALLA: % funciones de disparador son llamables a mano: %', v_cuantas, v_abiertas;
  end if;
  raise notice '  ok · las funciones de disparador no se pueden llamar a mano';
end $$;

do $$
declare
  v_sueltas text;
  v_cuantas int;
begin
  select string_agg(p.proname, ', ' order by p.proname), count(*)
    into v_sueltas, v_cuantas
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and not pg_temp.es_de_extension(p.oid)
     and (p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));

  if v_cuantas > 0 then
    raise exception 'FALLA: % funciones sin camino de búsqueda fijo: %', v_cuantas, v_sueltas;
  end if;
  raise notice '  ok · todas las funciones tienen su camino de búsqueda fijo';
end $$;

-- Toda vista mira con los ojos de quien consulta. Un `create or replace view`
-- que no repite `with (security_invoker = true)` le borra la opción sin avisar,
-- y la vista pasa a correr como su dueño, por encima del RLS (le pasó a
-- v_compras_credito_sin_comprobante en la 20261016602000).
do $$
declare
  v_sueltas text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_sueltas
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
     and not exists (select 1 from unnest(coalesce(c.reloptions, '{}')) o
                      where o in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1'));
  if v_sueltas is not null then
    raise exception 'FALLA: vistas que corren como su dueño, por encima del RLS: %', v_sueltas;
  end if;
  raise notice '  ok · toda vista mira con el rol de quien consulta';
end $$;

-- Y lo que sí tiene que seguir funcionando: quien entró puede consultar el
-- calendario y mirar el tablero.
do $$
begin
  if not has_function_privilege('authenticated', 'public.sumar_dias_habiles(date, int)', 'execute') then
    raise exception 'FALLA: quien entró se quedó sin poder calcular plazos';
  end if;
  if not has_function_privilege('authenticated', 'public.indicadores_tablero(uuid)', 'execute') then
    raise exception 'FALLA: quien entró se quedó sin el tablero';
  end if;
  -- Y lo que estaba cerrado a propósito sigue cerrado.
  if has_function_privilege('authenticated', 'public.siguiente_correlativo(public.tipo_correlativo, text, uuid)', 'execute') then
    raise exception 'FALLA: se volvió a abrir la función que quema correlativos';
  end if;
  raise notice '  ok · quien entró conserva lo suyo y lo cerrado sigue cerrado';
end $$;

rollback;
