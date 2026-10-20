-- =============================================================================
-- LO DE RR. HH. QUE LLEGÓ DESPUÉS TAMBIÉN LO CAMBIA SOLO RR. HH.
-- -----------------------------------------------------------------------------
-- La migración 20261020167000 dejó todo lo que escribe Recursos Humanos sin el
-- atajo del administrador del sistema («admin solo visualizaría», StudioGRCI,
-- 2026-10-20). Recorrió una lista de funciones con nombre. Las funciones que se
-- escribieron después en otros trabajos (la planilla de cada persona de
-- Maestranza, 20261020181000, y lo que venga) nacieron con `exigir_permiso`,
-- que vuelve a dejar pasar al administrador.
--
-- Aquí no hay lista. Cada función que escribe (volátil) y exige un permiso de
-- RR. HH. con `exigir_permiso` pasa a `exigir_permiso_del_puesto`, desde su
-- propia definición vigente, sin tocar nada más. Si alguna queda con el atajo,
-- la migración no entra. El check 406 vigila lo mismo para las que vengan.
-- =============================================================================

do $$
declare
  v_viejo constant text := 'exigir_permiso\(''(rrhh\.[a-z_]+|planilla_diaria\.preparar|reporte_diario\.validar_rrhh)''';
  v_fn    record;
  v_def   text;
  v_nueva text;
begin
  for v_fn in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.provolatile = 'v' and p.prokind = 'f'
       and p.prosrc ~ v_viejo
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    v_def := pg_get_functiondef(v_fn.oid);
    v_nueva := regexp_replace(v_def, v_viejo, 'exigir_permiso_del_puesto(''\1''', 'g');
    if v_nueva <> v_def then
      execute v_nueva;
    end if;
  end loop;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.provolatile = 'v' and p.prosrc ~ v_viejo) then
    raise exception 'Quedaron con el atajo del administrador: %',
      (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.provolatile = 'v' and p.prosrc ~ v_viejo);
  end if;
end $$;
