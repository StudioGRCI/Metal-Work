-- =============================================================================
-- DE QUÉ ESTÁ HECHO EL COSTO DE UNA CARROCERÍA
-- -----------------------------------------------------------------------------
-- `resumen_costeo_ot` dice cuánto lleva gastado una OT —material, planilla y
-- gastos de las áreas—, pero no de qué: quien costea veía «Materiales
-- S/ 26,021» y no podía saber si eso era la plancha, el panel isotérmico o un
-- despacho mal cargado. El kardex no le sirve, porque se lee con permisos de
-- Almacén que Costos no tiene.
--
-- Esta función devuelve las líneas del mismo cálculo, con la misma valoración
-- (precio congelado del despacho; si falta, el de la última compra del material
-- anterior al despacho) y las mismas reglas (devoluciones restadas, solo
-- planillas cerradas, solo gastos aprobados). Sumadas por fuente y moneda dan
-- exactamente el resumen: el check 312 lo comprueba.
--
-- La planilla va por período, no por persona: el expediente de una carrocería
-- no es el lugar para leer el sueldo de cada trabajador.
--
-- Mismas llaves que el resumen: `costos.ver` y poder ver la orden.
-- =============================================================================

create or replace function public.detalle_costeo_ot(p_orden uuid)
returns table (
  fuente text,
  fecha date,
  concepto text,
  detalle text,
  cantidad numeric,
  unidad text,
  precio_unitario numeric,
  moneda text,
  monto numeric,
  referencia text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform public.exigir_permiso('costos.ver');
  if not public.puede_ver_orden(p_orden) then
    raise exception 'No tienes acceso al costeo de esta OT.' using errcode = 'insufficient_privilege';
  end if;

  return query
  with despachos as (
    select m.id,
           greatest(m.cantidad - coalesce((select sum(x.cantidad) from public.movimientos_materiales x
                                            where x.devolucion_de = m.id), 0), 0)::numeric as cantidad,
           m.registrado_en, m.precio_unitario as precio_registrado, m.moneda as moneda_registrada,
           m.documento_referencia, d.id as detalle_id, om.material_id, r.area_destino
      from public.movimientos_materiales m
      join public.requerimiento_material_detalles d on d.id = m.requerimiento_detalle_id
      join public.requerimientos_materiales r on r.id = d.requerimiento_id
      join public.ot_materiales om on om.id = d.ot_material_id
     where r.orden_id = p_orden and m.tipo = 'DESPACHO'
  ), valorizados as (
    select d.*, coalesce(d.precio_registrado, precio.precio_unitario)::numeric as precio,
           coalesce(d.moneda_registrada, precio.moneda) as moneda_compra
      from despachos d
      left join lateral (
        select cd.precio_unitario, oc.moneda
          from public.orden_compra_material_detalles cd
          join public.ordenes_compra_materiales oc on oc.id = cd.orden_compra_id
          join public.requerimiento_material_detalles rd on rd.id = cd.requerimiento_detalle_id
          join public.ot_materiales om on om.id = rd.ot_material_id
         where om.material_id = d.material_id and cd.precio_unitario >= 0
           and oc.moneda in ('PEN', 'USD') and oc.creado_en <= d.registrado_en
         order by case when cd.requerimiento_detalle_id = d.detalle_id then 0 else 1 end,
                  oc.creado_en desc, cd.id
         limit 1
      ) precio on true
     where d.cantidad > 0
  )
  select case when v.precio is null then 'MATERIALES_SIN_PRECIO' else 'MATERIALES' end,
         (v.registrado_en at time zone 'America/Lima')::date,
         mat.descripcion,
         case v.area_destino when 'MTZ' then 'Maestranza' when 'PRD' then 'Producción'
                             when 'ACB' then 'Acabados' else v.area_destino end,
         v.cantidad,
         um.codigo,
         v.precio,
         v.moneda_compra,
         case when v.precio is null then null else round(v.cantidad * v.precio, 2) end,
         v.documento_referencia
    from valorizados v
    join public.materiales mat on mat.id = v.material_id
    left join public.unidades_medida um on um.id = mat.unidad_medida_id
  union all
  select 'PLANILLA',
         p.periodo,
         'Planilla ' || case p.tipo when 'TALLER' then 'de taller' when 'ADMINISTRATIVA' then 'administrativa'
                                    when 'SUBCONTRATOS' then 'de subcontratos' else lower(p.tipo) end
           || ' ' || to_char(p.periodo, 'MM/YYYY'),
         count(*)::text || case when count(*) = 1 then ' persona' else ' personas' end,
         null::numeric, null::text, null::numeric,
         p.moneda,
         sum(round(pp.monto * d.porcentaje / 100, 2)),
         null::text
    from public.planilla_distribuciones d
    join public.planilla_personas pp on pp.id = d.persona_id
    join public.planillas p on p.id = pp.planilla_id
   where d.orden_id = p_orden and p.estado = 'CERRADA'
   group by p.id, p.periodo, p.tipo, p.moneda
  union all
  select 'GASTOS_AREA',
         g.fecha,
         g.descripcion,
         case g.tipo when 'SERVICIO' then 'Servicio' when 'TRANSPORTE' then 'Transporte'
                     when 'VIATICO' then 'Viático' when 'SUBCONTRATO' then 'Subcontrato' else 'Otro' end
           || coalesce(' · ' || a.nombre, ''),
         null::numeric, null::text, null::numeric,
         g.moneda,
         g.monto,
         g.comprobante_nombre
    from public.ot_gastos_areas g
    left join public.areas a on a.id = g.area_id
   where g.orden_id = p_orden and g.estado = 'APROBADO'
   order by 1, 2, 3;
end
$function$;

comment on function public.detalle_costeo_ot(uuid) is
  'Las líneas del costeo de una OT —despachos valorizados, planilla por período y gastos aprobados— con la misma valoración que resumen_costeo_ot. Exige costos.ver y poder ver la orden.';

revoke all on function public.detalle_costeo_ot(uuid) from public, anon;
grant execute on function public.detalle_costeo_ot(uuid) to authenticated;
