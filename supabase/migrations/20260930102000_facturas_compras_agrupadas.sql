-- Una factura de compra agrupada conserva todas sus OT, no solo la cabecera.
-- Vista financiera cerrada por permiso dentro del SELECT: Tesorería no tiene
-- lectura técnica general de solicitudes; el filtro existente se conserva.
create or replace view public.v_documentos_compra_tesoreria
with (security_invoker = false) as
select d.id,d.orden_compra_id,d.tipo,d.nombre_archivo,d.ruta_storage,
 d.mime_type,d.tamano_bytes,d.subido_por,d.creado_en,
 oc.proveedor,oc.referencia,oc.fecha_estimada,r.orden_id,ot.numero as numero_ot,r.area_destino,
 coalesce((select jsonb_agg(jsonb_build_object('orden_id',x.orden_id,'numero_ot',x.numero_ot,'area_destino',x.area_destino) order by x.numero_ot,x.area_destino)
 from (select distinct rq.orden_id,o.numero as numero_ot,rq.area_destino
   from public.orden_compra_material_detalles l
   join public.requerimientos_materiales rq on rq.id=l.requerimiento_id
   join public.ordenes_trabajo o on o.id=rq.orden_id
   where l.orden_compra_id=oc.id) x),'[]'::jsonb) as vinculos_ot
from public.documentos_compra_material d
join public.ordenes_compra_materiales oc on oc.id=d.orden_compra_id
left join public.requerimientos_materiales r on r.id=oc.requerimiento_id
left join public.ordenes_trabajo ot on ot.id=r.orden_id
where public.es_admin() or public.tiene_permiso('compras.ver') or public.tiene_permiso('tesoreria.ver_documentos');
revoke all on public.v_documentos_compra_tesoreria from public,anon;
grant select on public.v_documentos_compra_tesoreria to authenticated;
