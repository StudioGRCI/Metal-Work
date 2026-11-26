-- =============================================================================
-- LA OC CON BOLETA NO ESPERA NOTA DE CRÉDITO
-- -----------------------------------------------------------------------------
-- «Esperan nota de crédito», la bandeja de Contabilidad en Adquisiciones, lista
-- lo que Almacén devolvió al proveedor sin reposición. Listaba también lo de la
-- OC con boleta, que se quedaba ahí para siempre en «esperan que se registre la
-- factura de su OC»: una nota de crédito se registra contra una factura, y a la
-- OC con boleta lo devuelto se lo arregla Tesorería con la devolución del dinero.
--
-- La regla es «la OC con factura, o la de boleta que tiene una factura
-- registrada»: lo que acepta `registrar_nota_credito`, que registra la nota
-- contra una factura de esa OC (`facturas_de_la_compra`). «Lo que falta» de cada
-- compra (`documentos_de_las_compras`, 20261126480000) decía casi lo mismo, pero
-- miraba si la OC tenía algo facturado (`compras_facturadas`): pedía la nota de
-- la OC con boleta que solo tenía una boleta de una parte, donde no hay factura
-- contra la cual registrarla, y no la pedía cuando la factura estaba en otra
-- moneda o llegó solo por el anexo de Logística. Las dos pasan a mirar lo mismo.
-- En `documentos_de_las_compras` cambia solo esa condición, por reemplazo de
-- texto sobre el cuerpo que hay en la base.
--
-- Las mismas columnas, el mismo permiso y el mismo tope. Antes de reemplazar
-- cada función se mira su huella: la que tiene producción o la que deja esta
-- migración. Si alguien la cambió a mano, no se pisa. Solo lee. Idempotente.
-- =============================================================================

do $$
declare
  v_md5 text;
begin
  select md5(replace(p.prosrc, E'\r', ''))
    into v_md5
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'devoluciones_sin_nota_credito';
  -- La de 20261022220000, o esta misma si la migración se vuelve a correr.
  if v_md5 is not null and v_md5 not in ('1ad7345b8cec50593309ec147f6c0056', '1ceba8001fe8b00753b48df7c9ed40e9') then
    raise exception 'devoluciones_sin_nota_credito cambió en la base (huella %): revisa antes de reemplazarla.', v_md5;
  end if;
end $$;

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
    -- Las facturas registradas de su OC (`facturas_de_la_compra` ya trae solo las registradas).
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'numero', a.numero_documento) order by a.fecha_emision), '[]'::jsonb) as facturas
        from public.facturas_de_la_compra(c.id) f
        join public.adquisiciones a on a.id = f.adquisicion_id) fx
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

-- «Lo que falta» de cada compra pide la nota con la misma regla.
do $$
declare
  v_md5   text;
  v_def   text;
  v_vieja constant text := 'where c.con_factura or coalesce(f.facturado, 0) > 0';
  v_nueva constant text := 'where c.con_factura or exists (select 1 from public.facturas_de_la_compra(c.id))';
begin
  select md5(replace(p.prosrc, E'\r', '')), pg_get_functiondef(p.oid)
    into v_md5, v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'documentos_de_las_compras';
  if v_md5 is null or v_md5 = '1456ab25e747c672223a3ba3e9b80b06' then
    return;  -- sin la función, o ya con la regla nueva
  end if;
  -- La de 20261126480000, la que tiene producción.
  if v_md5 <> '4f470602806c484e314d925599ca29cf' then
    raise exception 'documentos_de_las_compras cambió en la base (huella %): revisa antes de reemplazarla.', v_md5;
  end if;
  if (length(v_def) - length(replace(v_def, v_vieja, ''))) / length(v_vieja) <> 1 then
    raise exception 'documentos_de_las_compras no trae una sola vez la condición de la nota de crédito.';
  end if;
  execute replace(v_def, v_vieja, v_nueva);
end $$;
