-- Una orden de compra reúne insumos de varias solicitudes; cada línea conserva
-- su OT. La referencia es la numeración que Logística registra de su documento.
alter table public.orden_compra_material_detalles drop constraint if exists fk_oc_material_header_req;
-- Se conserva la FK orden_compra_id → cabecera y la FK compuesta línea → solicitud.
drop policy if exists ver_orden_compra_material_detalles on public.orden_compra_material_detalles;
create policy ver_orden_compra_material_detalles on public.orden_compra_material_detalles for select to authenticated using(
  ((select public.tiene_permiso('compras.ver')) or (select public.tiene_permiso('almacen.recibir')))
  and exists(select 1 from public.requerimientos_materiales r where r.id=requerimiento_id and public.puede_ver_area_material(r.area_destino))
);
create or replace view public.v_orden_compra_material_pendiente with(security_invoker=true) as
select d.id,d.requerimiento_id,d.requerimiento_detalle_id,c.proveedor,c.referencia,c.fecha_estimada,
 d.cantidad cantidad_comprada,
 coalesce(sum(m.cantidad) filter(where m.tipo='INGRESO'),0)::public.cantidad cantidad_recibida,
 greatest(d.cantidad-coalesce(sum(m.cantidad) filter(where m.tipo='INGRESO'),0),0)::public.cantidad cantidad_pendiente,
 c.id orden_compra_id
from public.orden_compra_material_detalles d join public.ordenes_compra_materiales c on c.id=d.orden_compra_id
left join public.movimientos_materiales m on m.orden_compra_detalle_id=d.id group by d.id,c.id;
revoke all on public.v_orden_compra_material_pendiente from public,anon;
grant select on public.v_orden_compra_material_pendiente to authenticated;

create or replace function public.fn_compra_exige_derivacion()
returns trigger language plpgsql set search_path='public' as $$
declare v_faltante numeric;
begin
 select d.cantidad_solicitada-coalesce(d.cantidad_stock,0)-coalesce((select sum(cantidad) from public.orden_compra_material_detalles x where x.requerimiento_detalle_id=d.id),0)
 into v_faltante from public.requerimiento_material_detalles d
 join public.requerimientos_materiales r on r.id=d.requerimiento_id join public.ordenes_trabajo o on o.id=r.orden_id
 where d.id=new.requerimiento_detalle_id and d.requerimiento_id=new.requerimiento_id
 and d.aprobacion_diseno='APROBADO' and d.decision_almacen='COMPRA' and o.estado::text<>'ANULADA' for update of d;
 if v_faltante is null then raise exception 'Almacén debe derivar a Logística el material aprobado antes de comprarlo.'; end if;
 if new.cantidad>v_faltante then raise exception 'La cantidad excede lo que falta comprar de esta línea (%).',v_faltante; end if;
 return new;
end $$;
revoke all on function public.fn_compra_exige_derivacion() from public,anon,authenticated;

create or replace function public.crear_compra_agrupada(p_id uuid,p_proveedor text,p_referencia text,p_detalles jsonb,p_fecha date,p_condicion text,p_dias integer,p_moneda text)
returns uuid language plpgsql security definer set search_path='public' as $$
declare v_ancla uuid; v_actual public.ordenes_compra_materiales%rowtype; v_linea record; v_req uuid;
begin
 perform public.exigir_permiso('compras.crear');
 if p_id is null or length(btrim(coalesce(p_proveedor,''))) not between 2 and 160
 or length(btrim(coalesce(p_referencia,''))) not between 2 and 100
 or jsonb_typeof(p_detalles) is distinct from 'array' then raise exception 'Completa proveedor, referencia y líneas de compra.'; end if;
 if jsonb_array_length(p_detalles) not between 1 and 100 then raise exception 'Selecciona entre una y cien líneas.'; end if;
 if p_condicion is null or p_condicion not in('CONTADO','CREDITO') or p_dias is null or p_dias not between 0 and 365
 or (p_condicion='CONTADO' and p_dias<>0) or (p_condicion='CREDITO' and p_dias=0)
 or p_moneda is null or p_moneda not in('PEN','USD') then raise exception 'Indica la moneda y el plazo de pago válidos.'; end if;
 if (select count(distinct x.id) from jsonb_to_recordset(p_detalles) x(id uuid,cantidad numeric,precio numeric))<>jsonb_array_length(p_detalles)
 then raise exception 'No repitas un material de la misma solicitud.'; end if;
 -- Serializa los reintentos antes de consultar cabecera y las líneas en orden.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into v_actual from public.ordenes_compra_materiales where id=p_id;
 if found then
   if v_actual.creado_por=public.usuario_actual() and v_actual.proveedor=btrim(p_proveedor) and v_actual.referencia=btrim(p_referencia)
   and v_actual.fecha_estimada is not distinct from p_fecha and v_actual.condicion_pago=p_condicion and v_actual.dias_credito=p_dias and v_actual.moneda=p_moneda
   and (select jsonb_agg(jsonb_build_object('id',d.requerimiento_detalle_id,'cantidad',d.cantidad,'precio',d.precio_unitario) order by d.requerimiento_detalle_id) from public.orden_compra_material_detalles d where d.orden_compra_id=p_id)
     =(select jsonb_agg(jsonb_build_object('id',x.id,'cantidad',x.cantidad,'precio',x.precio) order by x.id) from jsonb_to_recordset(p_detalles) x(id uuid,cantidad numeric,precio numeric))
   then return p_id; end if;
   raise exception 'Esta compra ya existe con otros datos. Recarga antes de intentar de nuevo.';
 end if;
 for v_linea in select * from jsonb_to_recordset(p_detalles) x(id uuid,cantidad numeric,precio numeric) order by id loop
   if v_linea.cantidad is null or v_linea.cantidad<=0 or v_linea.cantidad<>round(v_linea.cantidad,3)
   or v_linea.precio is null or v_linea.precio<0 or v_linea.precio<>round(v_linea.precio,2) then raise exception 'Cada línea necesita cantidad y precio unitario válidos.'; end if;
   select d.requerimiento_id into v_req from public.requerimiento_material_detalles d join public.requerimientos_materiales r on r.id=d.requerimiento_id
   where d.id=v_linea.id and public.puede_ver_area_material(r.area_destino) for update of d;
   if not found then raise exception 'La solicitud no está disponible para tu perfil.'; end if;
   v_ancla:=coalesce(v_ancla,v_req);
 end loop;
 insert into public.ordenes_compra_materiales(id,requerimiento_id,proveedor,referencia,fecha_estimada,creado_por,condicion_pago,dias_credito,moneda)
 values(p_id,v_ancla,btrim(p_proveedor),btrim(p_referencia),p_fecha,public.usuario_actual(),p_condicion,p_dias,p_moneda);
 insert into public.orden_compra_material_detalles(orden_compra_id,requerimiento_id,requerimiento_detalle_id,cantidad,precio_unitario)
 select p_id,d.requerimiento_id,x.id,x.cantidad,x.precio from jsonb_to_recordset(p_detalles) x(id uuid,cantidad numeric,precio numeric)
 join public.requerimiento_material_detalles d on d.id=x.id order by x.id;
 return p_id;
end $$;
revoke all on function public.crear_compra_agrupada(uuid,text,text,jsonb,date,text,integer,text) from public,anon;
grant execute on function public.crear_compra_agrupada(uuid,text,text,jsonb,date,text,integer,text) to authenticated;

create or replace function public.registrar_abastecimiento_en_ot()
returns trigger language plpgsql security definer set search_path='public' as $$
declare v_fila jsonb; v_orden uuid; v_nombre text; v_actor uuid; v_compra uuid;
begin
 v_fila:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='movimientos_materiales' then
   select r.orden_id into v_orden from public.requerimiento_material_detalles d join public.requerimientos_materiales r on r.id=d.requerimiento_id where d.id=(v_fila->>'requerimiento_detalle_id')::uuid;
   if v_orden is null and v_fila->>'devolucion_de' is not null then
     select r.orden_id into v_orden from public.movimientos_materiales m join public.requerimiento_material_detalles d on d.id=m.requerimiento_detalle_id
     join public.requerimientos_materiales r on r.id=d.requerimiento_id where m.id=(v_fila->>'devolucion_de')::uuid;
   end if;
   v_nombre:=case v_fila->>'tipo' when 'DESPACHO' then 'Despacho de almacén' when 'INGRESO' then 'Ingreso a almacén' else 'Movimiento de material' end;
   v_actor:=(v_fila->>'registrado_por')::uuid;
 elsif tg_table_name='orden_compra_material_detalles' then
   select orden_id into v_orden from public.requerimientos_materiales where id=(v_fila->>'requerimiento_id')::uuid;
   v_nombre:='Detalle de compra';
 elsif tg_table_name in('ordenes_compra_materiales','documentos_compra_material') then
   v_compra:=case when tg_table_name='ordenes_compra_materiales' then (v_fila->>'id')::uuid else (v_fila->>'orden_compra_id')::uuid end;
   v_nombre:=case when tg_table_name='ordenes_compra_materiales' then 'Compra de materiales' else 'Documento de compra' end;
   v_actor:=coalesce((v_fila->>'subido_por')::uuid,(v_fila->>'creado_por')::uuid,public.usuario_actual());
   for v_orden in select distinct r.orden_id from public.orden_compra_material_detalles d join public.requerimientos_materiales r on r.id=d.requerimiento_id where d.orden_compra_id=v_compra loop
     insert into public.ot_bitacora(orden_id,tipo_evento,descripcion,datos,usuario_id)
     values(v_orden,'COMENTARIO',v_nombre||case when tg_op='INSERT' then ' registrado' else ' actualizado' end,
       jsonb_build_object('tabla',tg_table_name,'registro_id',v_fila->>'id','accion',tg_op),v_actor);
   end loop;
   return case when tg_op='DELETE' then old else new end;
 end if;
 if v_orden is not null then
   insert into public.ot_bitacora(orden_id,tipo_evento,descripcion,datos,usuario_id)
   values(v_orden,'COMENTARIO',v_nombre||case when tg_op='INSERT' then ' registrado' else ' actualizado' end,
     jsonb_build_object('tabla',tg_table_name,'registro_id',v_fila->>'id','accion',tg_op,'cantidad',v_fila->>'cantidad','destinatario',v_fila->>'recibido_por_nombre'),coalesce(v_actor,public.usuario_actual()));
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.registrar_abastecimiento_en_ot() from public,anon,authenticated;
