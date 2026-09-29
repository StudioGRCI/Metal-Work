-- Costos reúne lo realmente despachado, la planilla cerrada distribuida a la
-- OT y los gastos externos aprobados. Una compra sin despacho no se suma dos
-- veces. Sin precio conocido, el material queda pendiente de valorización.
create or replace function public.resumen_costeo_ot(p_orden uuid)
returns table (fuente text, moneda text, monto numeric, pendientes bigint)
language plpgsql stable security definer set search_path = 'public' as $$
begin
  perform public.exigir_permiso('costos.ver');
  if not public.puede_ver_orden(p_orden) then
    raise exception 'No tienes acceso al costeo de esta OT.' using errcode='insufficient_privilege';
  end if;
  return query
  with despachos as (
    select m.id, m.cantidad::numeric as cantidad, m.registrado_en,
           d.id as detalle_id, om.material_id
      from public.movimientos_materiales m
      join public.requerimiento_material_detalles d on d.id=m.requerimiento_detalle_id
      join public.requerimientos_materiales r on r.id=d.requerimiento_id
      join public.ot_materiales om on om.id=d.ot_material_id
     where r.orden_id=p_orden and m.tipo='DESPACHO'
  ), valorizados as (
    select d.cantidad, precio.precio_unitario::numeric as precio,
           precio.moneda as moneda_compra
      from despachos d
      left join lateral (
        select cd.precio_unitario, oc.moneda
          from public.orden_compra_material_detalles cd
          join public.ordenes_compra_materiales oc on oc.id=cd.orden_compra_id
          join public.requerimiento_material_detalles rd on rd.id=cd.requerimiento_detalle_id
          join public.ot_materiales om on om.id=rd.ot_material_id
         where om.material_id=d.material_id and cd.precio_unitario>0
           and oc.moneda in ('PEN','USD') and oc.creado_en<=d.registrado_en
         order by case when cd.requerimiento_detalle_id=d.detalle_id then 0 else 1 end,
                  oc.creado_en desc,cd.id
         limit 1
      ) precio on true
  ), lineas as (
    select 'MATERIALES'::text fuente, v.moneda_compra moneda,
           round(v.cantidad*v.precio,2) monto,0::bigint pendientes
      from valorizados v where v.precio is not null
    union all
    select 'MATERIALES_SIN_PRECIO', null::text,0::numeric,1::bigint
      from valorizados v where v.precio is null
    union all
    select 'PLANILLA',p.moneda,
           round(pp.monto*d.porcentaje/100,2),0::bigint
      from public.planilla_distribuciones d
      join public.planilla_personas pp on pp.id=d.persona_id
      join public.planillas p on p.id=pp.planilla_id
     where d.orden_id=p_orden and p.estado='CERRADA'
    union all
    select 'GASTOS_AREA',g.moneda,g.monto,0::bigint
      from public.ot_gastos_areas g
     where g.orden_id=p_orden and g.estado='APROBADO'
  )
  select l.fuente,l.moneda,sum(l.monto)::numeric,sum(l.pendientes)::bigint
    from lineas l group by l.fuente,l.moneda order by l.fuente,l.moneda;
end $$;
revoke all on function public.resumen_costeo_ot(uuid) from public, anon;
grant execute on function public.resumen_costeo_ot(uuid) to authenticated;
