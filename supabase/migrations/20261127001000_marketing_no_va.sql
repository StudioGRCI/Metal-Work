-- =============================================================================
-- MARKETING NO VA
-- -----------------------------------------------------------------------------
-- DKS, 2026-11-27, en el hilo del plan «Las demás áreas»: «marketing no va» y
-- «elimina lo de marketing». La entrega A.5 (Marketing) no se hace, y el área
-- deja de salir en el sistema.
--
-- El área Marketing (MKT) venía del organigrama («CODIFICACION DE AREAS.xlsx»,
-- docs/ANALISIS-ONEDRIVE.md) y nunca tuvo gente: el 2026-11-27, en producción,
-- ninguna fila de ninguna tabla apuntaba a ella (cuentas, Personal, etapas,
-- averías, inspecciones, requerimientos ni ninguna otra), ni tenía cuenta
-- responsable.
--
-- Se da de baja, no se borra: así se retiran las áreas en este sistema. Todas
-- las listas de áreas de la aplicación leen solo las activas, así que deja de
-- aparecer en Configuración, Personal, Requerimientos, Calidad, SSOMA y el
-- resto; el código MKT queda guardado y no lo toma otra área. Si algún día la
-- empresa abre el área, se vuelve a dar de alta.
--
-- Si cuando esta migración corre alguien ya está en el área o algo apunta a
-- ella, se detiene sin tocar nada: eso ya no es «un área sin gente», y lo
-- decide DKS.
-- =============================================================================

do $$
declare
  v_mkt   uuid := (select id from public.areas where codigo = 'MKT');
  f       record;
  n       bigint;
  v_usada text := '';
begin
  if v_mkt is null then
    raise notice 'No hay un área Marketing (MKT): no hay nada que dar de baja.';
    return;
  end if;
  if not (select activo from public.areas where id = v_mkt) then
    return;  -- ya estaba dada de baja: volver a correrla no cambia nada
  end if;

  -- Toda tabla que apunta a las áreas, la que sea, sin escribir la lista a mano.
  for f in
    select c.conrelid::regclass::text as tabla, a.attname as columna
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.areas'::regclass
       and c.conrelid <> 'public.areas'::regclass
  loop
    execute format('select count(*) from %s where %I = $1', f.tabla, f.columna) into n using v_mkt;
    if n > 0 then
      v_usada := v_usada || format(' %s (%s)', f.tabla, n);
    end if;
  end loop;
  if exists (select 1 from public.areas where id = v_mkt and jefe_id is not null)
     or exists (select 1 from public.areas where llevada_por_id = v_mkt) then
    v_usada := v_usada || ' cuenta responsable o un área que lleva';
  end if;
  if v_usada <> '' then
    raise exception 'El área Marketing ya se usa:%. No se da de baja: avisa a DKS antes de seguir.', v_usada;
  end if;

  update public.areas set activo = false where id = v_mkt;
end $$;
