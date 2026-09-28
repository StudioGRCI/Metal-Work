-- Un índice parcial `columna IS NOT NULL` sí sirve para la llave: las filas con
-- NULL no participan en la integridad referencial. Un predicado adicional que
-- deja fuera referencias vigentes no alcanza para SET NULL al borrar el padre.
--
-- También se comprueba que borrar una etapa anule la etapa del avance y no su
-- orden: en una llave de dos columnas, `set null` sin lista las anula las dos.
--
-- Los valores se derivan del catálogo, nunca de una lista escrita a mano: así
-- atrapa también la tabla que alguien agregue mañana.
\set ON_ERROR_STOP on
begin;

-- ------------------------------------- ninguna llave vive solo de un parcial
do $$
declare
  v_culpables text;
  v_cuantas   int;
begin
  select string_agg(c.conrelid::regclass::text || ' · ' || c.conname, ', ' order by c.conname),
         count(*)
    into v_culpables, v_cuantas
    from pg_constraint c
   where c.contype = 'f'
     and c.connamespace = 'public'::regnamespace
     -- no hay un índice pleno ni un parcial que cubra todos los valores no nulos…
     and not exists (
       select 1 from pg_index i
        where i.indrelid = c.conrelid
          and i.indisvalid and i.indpred is null
          and (i.indkey::int2[])[0] = c.conkey[1]
     )
     -- …ni uno parcial cuyo único filtro sea excluir llaves NULL.
     and not exists (
       select 1 from pg_index i
        where i.indrelid = c.conrelid
          and i.indisvalid and i.indpred is not null
          and (i.indkey::int2[])[0] = c.conkey[1]
          and regexp_replace(lower(pg_get_expr(i.indpred, i.indrelid)), '[()"]', '', 'g')
              = format('%s is not null', lower((select a.attname from pg_attribute a
                 where a.attrelid=c.conrelid and a.attnum=c.conkey[1])))
     )
     -- …pero sí uno parcial que deja fuera referencias existentes.
     and exists (
       select 1 from pg_index i
        where i.indrelid = c.conrelid
          and i.indisvalid and i.indpred is not null
          and (i.indkey::int2[])[0] = c.conkey[1]
          and regexp_replace(lower(pg_get_expr(i.indpred, i.indrelid)), '[()"]', '', 'g')
              <> format('%s is not null', lower((select a.attname from pg_attribute a
                 where a.attrelid=c.conrelid and a.attnum=c.conkey[1])))
     );

  if v_cuantas > 0 then
    raise exception 'FALLA: % llave(s) foránea(s) cubiertas solo por un índice parcial, que la integridad no puede usar: %',
      v_cuantas, v_culpables;
  end if;

  raise notice '  ok · ninguna llave foránea depende de un índice parcial';
end $$;

-- La cotización puede eliminarse después de anular sus OTs; SET NULL tiene que
-- localizar también esas órdenes, que el índice único parcial excluye.
do $$
begin
  if not exists (
    select 1 from pg_index i
    where i.indrelid='public.ordenes_trabajo'::regclass
      and i.indisvalid and i.indpred is null
      and (i.indkey::int2[])[0] = (
        select attnum from pg_attribute
         where attrelid='public.ordenes_trabajo'::regclass and attname='cotizacion_pdf_id')
  ) then
    raise exception 'FALLA: falta índice completo para anular el vínculo PDF de cualquier OT';
  end if;
  raise notice '  ok · borrar una cotización encuentra también las OTs anuladas';
end $$;

-- ------------------------------------- el avance pierde la etapa, no la orden
do $$
declare
  v_cols int2[];
begin
  select confdelsetcols into v_cols
    from pg_constraint
   where conname = 'fk_avance_etapa_de_la_orden'
     and conrelid = 'public.ot_avances'::regclass;

  if v_cols is null then
    raise exception 'FALLA: fk_avance_etapa_de_la_orden anula las dos columnas al borrar la etapa; orden_id es not null, así que el borrado revienta en inglés';
  end if;

  if v_cols <> array[(select attnum from pg_attribute
                       where attrelid = 'public.ot_avances'::regclass and attname = 'etapa_id')]::int2[] then
    raise exception 'FALLA: fk_avance_etapa_de_la_orden debería anular solo etapa_id';
  end if;

  raise notice '  ok · borrar una etapa deja el avance sin etapa, no sin orden';
end $$;

-- ------------------------------------- inventario, no falla: para leerlo
-- Estas llaves no tienen índice que empiece por su primera columna. Se revisaron
-- una por una el 2026-08-28 contra el plan de ejecución y se decidió no crear
-- índice: son catálogos acotados (tipos_documento, series_documentarias,
-- roles_permisos, codificación de materiales) o columnas de «quién firmó» que la
-- aplicación nunca filtra y cuyo padre no se borra en ningún flujo. Si esta
-- lista crece con una tabla que sí crece, hay que volver a decidir.
do $$
declare
  v_sueltas text;
  v_cuantas int;
begin
  select string_agg(c.conrelid::regclass::text || '.' || c.conname, ', ' order by c.conname),
         count(*)
    into v_sueltas, v_cuantas
    from pg_constraint c
   where c.contype = 'f'
     and c.connamespace = 'public'::regnamespace
     and not exists (
       select 1 from pg_index i
        where i.indrelid = c.conrelid
          and i.indisvalid and i.indpred is null
          and (i.indkey::int2[])[0] = c.conkey[1]
     );

  raise notice '  ·· % llave(s) sin índice de primera columna, revisadas y aceptadas: %',
    coalesce(v_cuantas, 0), coalesce(v_sueltas, 'ninguna');
end $$;

rollback;
