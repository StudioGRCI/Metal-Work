-- =============================================================================
-- 0010 · ENDURECIMIENTO DE PRIVILEGIOS
-- -----------------------------------------------------------------------------
-- Corrige dos hallazgos del analizador de seguridad de Supabase sobre el
-- esquema recién desplegado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. EXECUTE sobre las funciones venía de PUBLIC, no de un grant a anon
-- -----------------------------------------------------------------------------
-- Postgres concede EXECUTE a PUBLIC en toda función nueva. La migración 0007
-- revocaba el privilegio a `anon`, pero eso no quita lo que PUBLIC concede: el
-- rol anónimo seguía pudiendo llamar funciones SECURITY DEFINER como
-- confirmar_movimiento_almacen(), que se ejecutan como su propietario y por
-- tanto pasan por encima de RLS.
--
-- Se revoca a PUBLIC y se concede explícitamente solo a quien debe tenerlo.

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;

grant execute on all functions in schema public to authenticated, service_role;

-- Las futuras funciones nacen sin el privilegio para PUBLIC.
alter default privileges in schema public revoke execute on functions from public;

-- Estas instalan triggers: son mantenimiento del esquema, no API de la aplicación.
revoke execute on function public.activar_auditoria(text) from authenticated;
revoke execute on function public.activar_timestamps(text) from authenticated;

-- -----------------------------------------------------------------------------
-- 2. search_path fijo en todas las funciones del esquema
-- -----------------------------------------------------------------------------
-- Las funciones SECURITY DEFINER ya lo declaraban. Se completa el resto: sin un
-- search_path fijo, quien pueda crear objetos en un esquema que preceda a public
-- podría alterar qué función u operador resuelve un nombre sin calificar.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       -- Se omiten las que instalan las extensiones: no son nuestras.
       and not exists (
         select 1 from pg_depend d
          where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
       )
       and (p.proconfig is null
            or not exists (
              select 1 from unnest(p.proconfig) c where c like 'search\_path=%'
            ))
  loop
    execute format('alter function %s set search_path = public', r.firma);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Comprobación: el rol anónimo no debe poder ejecutar nada del esquema
-- -----------------------------------------------------------------------------

do $$
declare v_ejecutables int;
begin
  select count(*)
    into v_ejecutables
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and not exists (
       select 1 from pg_depend d
        where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
     );

  if v_ejecutables > 0 then
    raise exception 'El rol anon todavía puede ejecutar % funciones del esquema public', v_ejecutables;
  end if;
end;
$$;
