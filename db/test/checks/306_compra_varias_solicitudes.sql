begin;
select set_config('prueba.detalle',(select d.id::text from public.requerimiento_material_detalles d join public.ot_materiales om on om.id=d.ot_material_id join public.ordenes_trabajo o on o.id=om.orden_id where o.estado::text<>'ANULADA' and d.aprobacion_diseno='APROBADO' limit 1),true);
select set_config('prueba.req',gen_random_uuid()::text,true);
select set_config('prueba.om',gen_random_uuid()::text,true);
select set_config('prueba.detalle2',gen_random_uuid()::text,true);
-- El armazón reversible prepara dos solicitudes; la compra se ejecuta como Logística.
select set_config('request.jwt.claim.sub',(select u.id::text from public.usuarios u join public.roles r on r.id=u.rol_id join public.areas a on a.id=u.area_id where r.codigo='SUPERVISOR' and a.codigo='PRD' and u.activo limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
insert into public.ot_materiales(id,orden_id,plano_id,material_id,cantidad,area_destino)
select current_setting('prueba.om')::uuid,om.orden_id,om.plano_id,(select id from public.materiales where activo and not unidad_pendiente and id<>om.material_id order by id limit 1),4,'PRD'
from public.requerimiento_material_detalles d join public.ot_materiales om on om.id=d.ot_material_id where d.id=current_setting('prueba.detalle')::uuid;
insert into public.requerimientos_materiales(id,orden_id,area_destino,solicitado_por)
select current_setting('prueba.req')::uuid,orden_id,'PRD',public.usuario_actual() from public.ot_materiales where id=current_setting('prueba.om')::uuid;
insert into public.requerimiento_material_detalles(id,requerimiento_id,ot_material_id,cantidad_solicitada,aprobacion_diseno,decision_almacen,cantidad_stock)
values(current_setting('prueba.detalle2')::uuid,current_setting('prueba.req')::uuid,current_setting('prueba.om')::uuid,4,'APROBADO','COMPRA',0);
select set_config('request.jwt.claim.sub',(select u.id::text from public.usuarios u join public.roles r on r.id=u.rol_id where r.codigo='DISENO' and u.activo limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
set local role authenticated;
select public.resolver_propuesta_material(current_setting('prueba.detalle2')::uuid,true);
reset role;
select set_config('request.jwt.claim.sub',(select u.id::text from public.usuarios u join public.roles r on r.id=u.rol_id where r.codigo='ALMACENERO' and u.activo limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
set local role authenticated;
select public.revisar_stock_requerimiento(current_setting('prueba.detalle2')::uuid,'COMPRA');
reset role;
update public.requerimiento_material_detalles d set decision_almacen='COMPRA',cantidad_stock=0,cantidad_solicitada=4+(select coalesce(sum(cantidad),0) from public.orden_compra_material_detalles c where c.requerimiento_detalle_id=d.id) where id=current_setting('prueba.detalle')::uuid;
select set_config('request.jwt.claim.sub',(select u.id::text from public.usuarios u join public.roles r on r.id=u.rol_id where r.codigo='COMPRADOR' and u.activo limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare v_id uuid:=gen_random_uuid(); v_doc uuid:=gen_random_uuid(); v_json jsonb;begin
 if (select count(*) from public.v_pendientes_materiales where detalle_id in (current_setting('prueba.detalle')::uuid,current_setting('prueba.detalle2')::uuid) and por_comprar)<>2 then raise exception 'FAIL: pendientes no muestra ambos insumos a Logística';end if;
 v_json:=jsonb_build_array(jsonb_build_object('id',current_setting('prueba.detalle'),'cantidad',2,'precio',5),jsonb_build_object('id',current_setting('prueba.detalle2'),'cantidad',3,'precio',6));
 perform public.crear_compra_agrupada(v_id,'Proveedor de ensayo',v_id::text,v_json,null,'CONTADO',0,'PEN');
 if (select count(distinct requerimiento_id) from public.orden_compra_material_detalles where orden_compra_id=v_id)<>2 then raise exception 'FAIL: compra no conservó dos solicitudes';end if;
 if (select count(distinct requerimiento_id) from public.v_orden_compra_material_pendiente where orden_compra_id=v_id)<>2 then raise exception 'FAIL: seguimiento usa solo la solicitud de cabecera';end if;
 if public.crear_compra_agrupada(v_id,'Proveedor de ensayo',v_id::text,v_json,null,'CONTADO',0,'PEN')<>v_id then raise exception 'FAIL: duplicó OC';end if;
 insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('documentos-compras','compra/'||v_id||'/'||v_doc||'.pdf',auth.uid()::text,'{"mimetype":"application/pdf","size":5}');
 insert into public.documentos_compra_material(id,orden_compra_id,tipo,nombre_archivo,ruta_storage,mime_type,tamano_bytes,subido_por)
 values(v_doc,v_id,'FACTURA','Ensayo.pdf','compra/'||v_id||'/'||v_doc||'.pdf','application/pdf',5,public.usuario_actual());
 if (select jsonb_array_length(vinculos_ot) from public.v_documentos_compra_tesoreria where id=v_doc)<>2 then raise exception 'FAIL: factura perdió los vínculos de solicitudes agrupadas';end if;
end $$;
reset role;
select 'OK: dos solicitudes en una OC con trazabilidad por línea; reintento sin duplicar' comprobacion;
rollback;
