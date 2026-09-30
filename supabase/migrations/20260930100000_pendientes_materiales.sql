-- Cada solicitud indica el siguiente paso en su OT, sin saltar Diseño ni Almacén.
create or replace view public.v_pendientes_materiales
with (security_invoker = true) as
select v.detalle_id, v.orden_id, v.numero_ot,
 d.aprobacion_diseno = 'PROPUESTO' as por_aprobar,
 d.aprobacion_diseno = 'APROBADO' and d.decision_almacen = 'PENDIENTE' as por_revisar_stock,
 d.aprobacion_diseno = 'APROBADO' and d.decision_almacen = 'COMPRA'
   and v.cantidad_solicitada - coalesce(d.cantidad_stock,0) > v.cantidad_comprada as por_comprar,
 d.aprobacion_diseno = 'APROBADO' and exists (
   select 1 from public.orden_compra_material_detalles c
   join public.ordenes_compra_materiales h on h.id=c.orden_compra_id
   where c.requerimiento_detalle_id=v.detalle_id and h.entregado_almacen_en is not null
   and c.cantidad > coalesce((select sum(m.cantidad) from public.movimientos_materiales m
      where m.orden_compra_detalle_id=c.id and m.tipo='INGRESO'),0)
 ) as por_recibir,
 d.aprobacion_diseno = 'APROBADO' and d.decision_almacen <> 'PENDIENTE'
   and least(v.cantidad_solicitada, coalesce(d.cantidad_stock,0)+v.cantidad_recibida)>v.cantidad_despachada as por_despachar
from public.v_atencion_materiales v
join public.requerimiento_material_detalles d on d.id=v.detalle_id
join public.ordenes_trabajo o on o.id=v.orden_id
where o.estado::text not in ('BORRADOR','ANULADA','ENTREGADA','FACTURADA');
revoke all on public.v_pendientes_materiales from public,anon;
grant select on public.v_pendientes_materiales to authenticated;
