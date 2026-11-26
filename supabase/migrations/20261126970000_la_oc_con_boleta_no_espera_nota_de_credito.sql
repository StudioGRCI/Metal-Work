-- =============================================================================
-- LA OC CON BOLETA NO ESPERA NOTA DE CRÉDITO
-- -----------------------------------------------------------------------------
-- «Esperan nota de crédito», la bandeja de Contabilidad en Adquisiciones, lista
-- lo que Almacén devolvió al proveedor sin reposición. Listaba también lo de la
-- OC con boleta, que se quedaba ahí para siempre en «esperan que se registre la
-- factura de su OC»: una nota de crédito se registra contra una factura, y a la
-- OC con boleta lo devuelto se lo arregla Tesorería con la devolución del dinero.
-- Y al devolver, Contabilidad recibía el aviso «Espera la nota de crédito» de esa
-- misma OC, para una nota que no tenía contra qué registrar.
--
-- La regla es «la OC con factura, o la de boleta que tiene una factura
-- registrada»: lo que acepta `registrar_nota_credito`, que registra la nota
-- contra una factura de esa OC (`facturas_de_la_compra`) y no contra un recibo
-- por honorarios ni otro comprobante. Esa regla queda en una sola función,
-- `compra_con_factura_registrada`, y la usan los cuatro lugares que la piden:
--
--   * la bandeja (`devoluciones_sin_nota_credito`), que además ofrece solo esas
--     facturas para registrar la nota;
--   * «Lo que falta» de cada compra (`documentos_de_las_compras`,
--     20261126480000), que miraba si la OC tenía algo facturado
--     (`compras_facturadas`): pedía la nota de la OC con boleta que solo tenía
--     una boleta de una parte, y no la pedía cuando la factura estaba en otra
--     moneda o llegó solo por el anexo de Logística;
--   * los dos avisos a Contabilidad: al devolver sin reposición
--     (`devolver_al_proveedor`) y al dejar de esperar la reposición
--     (`dejar_de_esperar_reposicion`, 20261026130000). El aviso a Logística no
--     cambia.
--
-- En `documentos_de_las_compras` y en los dos avisos cambia solo esa condición,
-- por reemplazo de texto sobre el cuerpo que hay en la base. Antes de tocar cada
-- función se mira su huella: la que tiene producción o la que deja esta
-- migración. Si alguien la cambió a mano, no se pisa. Las mismas columnas, los
-- mismos permisos y el mismo tope. Idempotente.
-- =============================================================================

-- Antes de crear nada, las cuatro huellas: si una no es la de producción ni la
-- que deja esta migración, o falta la función, no se toca ninguna.
do $$
declare
  v_f   record;
  v_md5 text;
begin
  for v_f in
    select * from (values
      ('devoluciones_sin_nota_credito', '1ad7345b8cec50593309ec147f6c0056', 'ed4f4a2eb129840a1ab7b1c853b2b845'),  -- 20261022220000
      ('documentos_de_las_compras',     '4f470602806c484e314d925599ca29cf', '9bdc9fc34c6865ababd8b967f3df11cc'),  -- 20261126480000
      ('devolver_al_proveedor',         '05764d06eb71172d75eef283edb55633', '9ef47a70f45a5c1deb253175b972cedb'),  -- 20261026130000
      ('dejar_de_esperar_reposicion',   'f184574800e4b163ddf709cf66303f16', 'f2cb431594e760e8bdadef26a02fcdbb')   -- 20261026130000
    ) as t (funcion, de_antes, de_ahora)
  loop
    select md5(replace(p.prosrc, E'\r', ''))
      into v_md5
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_f.funcion;
    if v_md5 is null then
      raise exception 'Falta la función % en la base: revisa antes de aplicar esta migración.', v_f.funcion;
    end if;
    if v_md5 not in (v_f.de_antes, v_f.de_ahora) then
      raise exception '% cambió en la base (huella %): revisa antes de reemplazarla.', v_f.funcion, v_md5;
    end if;
  end loop;
end $$;

create or replace function public.compra_con_factura_registrada(p_compra uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1
                   from public.facturas_de_la_compra(p_compra) f
                   join public.adquisiciones a on a.id = f.adquisicion_id
                  where a.tipo not in ('RECIBO_HONORARIOS', 'OTRO'));
$$;

comment on function public.compra_con_factura_registrada(uuid) is
  'Si la OC tiene una factura registrada contra la cual registrar una nota de crédito: no cuenta el recibo por honorarios ni otro comprobante, que `registrar_nota_credito` rechaza (20261126970000). La llaman las funciones de la nota de crédito, no la gente.';

revoke all on function public.compra_con_factura_registrada(uuid) from public, anon, authenticated;

create or replace function public.devoluciones_sin_nota_credito()
returns table (devolucion_id uuid, fecha timestamptz, compra text, orden_compra_id uuid, proveedor text, material text,
               unidad text, cantidad numeric, importe numeric, moneda text, documento text, facturas jsonb)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if public.usuario_actual() is not null and not (public.es_admin() or public.tiene_permiso('adquisiciones.ver')) then
    raise exception 'No tienes permiso para ver Adquisiciones.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select m.id, m.registrado_en, public.nombre_de_oc(c.numero, c.referencia), c.id, c.proveedor, mt.descripcion::text,
         um.codigo::text, x.falta, round(x.falta * m.precio_unitario, 2), coalesce(m.moneda, c.moneda)::text,
         m.documento_referencia::text, fx.facturas
    from public.movimientos_materiales m
    join public.orden_compra_material_detalles d on d.id = m.orden_compra_detalle_id
    join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
    join public.materiales mt on mt.id = m.material_id
    left join public.unidades_medida um on um.id = mt.unidad_medida_id
    cross join lateral (
      select m.cantidad::numeric - coalesce((select sum(r.cantidad::numeric) from public.movimientos_materiales r
                                               where r.repone_devolucion = m.id), 0) as falta) x
    -- Las facturas registradas de su OC contra las que va la nota: las mismas que
    -- cuenta `compra_con_factura_registrada` (`facturas_de_la_compra` ya trae solo las registradas).
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'numero', a.numero_documento) order by a.fecha_emision), '[]'::jsonb) as facturas
        from public.facturas_de_la_compra(c.id) f
        join public.adquisiciones a on a.id = f.adquisicion_id
       where a.tipo not in ('RECIBO_HONORARIOS', 'OTRO')) fx
   where m.tipo = 'DEVOLUCION_PROVEEDOR' and not m.se_repone and x.falta > 0
     and not exists (select 1 from public.notas_credito_compra n where n.devolucion_id = m.id and n.anulado_en is null)
     -- La OC con factura, o la de boleta que igual tiene una factura registrada: contra ella va la nota (20261126970000).
     and (c.con_factura or jsonb_array_length(fx.facturas) > 0)
   order by m.registrado_en
   limit 200;
end;
$$;

comment on function public.devoluciones_sin_nota_credito() is
  'Lo que Almacén devolvió al proveedor sin reposición y todavía no tiene su nota de crédito, con las facturas registradas de su OC. Solo la OC con factura, o la de boleta que tiene una factura registrada: a la de boleta sin factura lo devuelto se lo arregla Tesorería (20261126970000). La lee quien lee Adquisiciones.';

revoke all on function public.devoluciones_sin_nota_credito() from public, anon;
grant execute on function public.devoluciones_sin_nota_credito() to authenticated;

-- «Lo que falta» de cada compra y los dos avisos a Contabilidad piden la nota con
-- la misma regla. Cada uno cambia una sola condición de su cuerpo.
do $$
declare
  v_f     record;
  v_md5   text;
  v_def   text;
begin
  for v_f in
    select * from (values
      ('documentos_de_las_compras',
       '4f470602806c484e314d925599ca29cf',   -- la de 20261126480000, la que tiene producción
       '9bdc9fc34c6865ababd8b967f3df11cc',
       'where c.con_factura or coalesce(f.facturado, 0) > 0',
       'where c.con_factura or public.compra_con_factura_registrada(c.id)'),
      ('devolver_al_proveedor',
       '05764d06eb71172d75eef283edb55633',   -- la de 20261026130000
       '9ef47a70f45a5c1deb253175b972cedb',
       E'  if not p_se_repone then\n    perform public.avisar_a_permiso(''adquisiciones.registrar''',
       E'  -- La nota va contra una factura: la OC con boleta sin factura no la espera (20261126970000).\n'
       || E'  if not p_se_repone and (v_c.con_factura or public.compra_con_factura_registrada(v_c.id)) then\n'
       || E'    perform public.avisar_a_permiso(''adquisiciones.registrar'''),
      ('dejar_de_esperar_reposicion',
       'f184574800e4b163ddf709cf66303f16',   -- la de 20261026130000
       'f2cb431594e760e8bdadef26a02fcdbb',
       E'  if current_setting(''metalwork.nota_credito'', true) is distinct from p_devolucion::text then\n',
       E'  -- La nota va contra una factura: la OC con boleta sin factura no la espera (20261126970000).\n'
       || E'  if current_setting(''metalwork.nota_credito'', true) is distinct from p_devolucion::text\n'
       || E'     and (v_c.con_factura or public.compra_con_factura_registrada(v_c.id)) then\n')
    ) as t (funcion, de_antes, de_ahora, vieja, nueva)
  loop
    select md5(replace(p.prosrc, E'\r', '')), replace(pg_get_functiondef(p.oid), E'\r', '')
      into v_md5, v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_f.funcion;
    if v_md5 = v_f.de_ahora then
      continue;  -- ya con la regla nueva
    end if;
    if v_md5 <> v_f.de_antes then
      raise exception '% cambió en la base (huella %): revisa antes de reemplazarla.', v_f.funcion, v_md5;
    end if;
    if (length(v_def) - length(replace(v_def, v_f.vieja, ''))) / length(v_f.vieja) <> 1 then
      raise exception '% no trae una sola vez la condición de la nota de crédito.', v_f.funcion;
    end if;
    execute replace(v_def, v_f.vieja, v_f.nueva);
  end loop;
end $$;
