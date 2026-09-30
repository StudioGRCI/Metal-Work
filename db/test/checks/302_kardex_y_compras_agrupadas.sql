begin;
select set_config('prueba.detalle',(select d.id::text from public.requerimiento_material_detalles d join public.ot_materiales om on om.id=d.ot_material_id join public.ordenes_trabajo o on o.id=om.orden_id where o.estado::text<>'ANULADA' and d.aprobacion_diseno='APROBADO' limit 1),true);
select set_config('prueba.material',(select om.material_id::text from public.requerimiento_material_detalles d join public.ot_materiales om on om.id=d.ot_material_id where d.id=current_setting('prueba.detalle')::uuid),true);
select set_config('prueba.ingreso',gen_random_uuid()::text,true);
select set_config('prueba.despacho',gen_random_uuid()::text,true);
select set_config('request.jwt.claim.sub',(select u.id::text from public.usuarios u join public.roles r on r.id=u.rol_id where r.codigo='ALMACENERO' and u.activo limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
-- Solo el armazón reversible restablece la solicitud; las acciones usan su rol.
update public.requerimiento_material_detalles set decision_almacen='PENDIENTE',cantidad_stock=null where id=current_setting('prueba.detalle')::uuid;
insert into storage.objects(bucket_id,name,owner_id,metadata) values('evidencias-almacen',current_setting('request.jwt.claim.sub')||'/'||current_setting('prueba.despacho')||'.jpg',current_setting('request.jwt.claim.sub'),'{"mimetype":"image/jpeg","size":100}'::jsonb);
set local role authenticated;
do $$ declare v_id uuid; v_destino uuid; v_foto text; begin
 v_id:=public.registrar_ingreso_almacen(current_setting('prueba.ingreso')::uuid,current_setting('prueba.material')::uuid,1000,'INGRESO_GENERAL','ENSAYO REVERTIDO',5,'PEN');
 if public.registrar_ingreso_almacen(v_id,current_setting('prueba.material')::uuid,1000,'INGRESO_GENERAL','ENSAYO REVERTIDO',5,'PEN')<>v_id then raise exception 'FAIL: ingreso duplicado'; end if;
 perform public.revisar_stock_requerimiento(current_setting('prueba.detalle')::uuid,'STOCK');
 select u.id into v_destino from public.usuarios u join public.areas a on a.id=u.area_id where u.activo and a.codigo=(select r.area_destino from public.requerimientos_materiales r join public.requerimiento_material_detalles d on d.requerimiento_id=r.id where d.id=current_setting('prueba.detalle')::uuid) limit 1;
 begin
   perform public.despachar_material_con_foto(gen_random_uuid(),current_setting('prueba.detalle')::uuid,1,v_destino,'Persona de prueba',null);
   raise exception 'FAIL: despacho sin foto';
 exception when others then if sqlerrm like 'FAIL:%' then raise; end if; if sqlerrm not like 'Indica cantidad%' then raise; end if; end;
 v_foto:=auth.uid()::text||'/'||current_setting('prueba.despacho')||'.jpg';
 v_id:=public.despachar_material_con_foto(current_setting('prueba.despacho')::uuid,current_setting('prueba.detalle')::uuid,1,v_destino,'Persona de prueba',v_foto);
 if public.despachar_material_con_foto(v_id,current_setting('prueba.detalle')::uuid,1,v_destino,'Persona de prueba',v_foto)<>v_id then raise exception 'FAIL: despacho duplicado'; end if;
 if (select reservado from public.v_existencias_materiales where material_id=current_setting('prueba.material')::uuid)<0 then raise exception 'FAIL: reserva negativa'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select u.id::text from public.usuarios u join public.roles r on r.id=u.rol_id where r.codigo='COMPRADOR' and u.activo limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
-- Ensayar compra parcial y comprobar que nunca compra la parte reservada.
update public.requerimiento_material_detalles d set decision_almacen='COMPRA',cantidad_stock=1,
 cantidad_solicitada=3+(select coalesce(sum(cantidad),0) from public.orden_compra_material_detalles c where c.requerimiento_detalle_id=d.id)
 where d.id=current_setting('prueba.detalle')::uuid;
set local role authenticated;
do $$ declare v_id uuid:=gen_random_uuid(); v_json jsonb; begin
 v_json:=jsonb_build_array(jsonb_build_object('id',current_setting('prueba.detalle'),'cantidad',1,'precio',5));
 perform public.crear_compra_agrupada(v_id,'Proveedor de prueba',v_id::text,v_json,null,'CONTADO',0,'PEN');
 if public.crear_compra_agrupada(v_id,'Proveedor de prueba',v_id::text,v_json,null,'CONTADO',0,'PEN')<>v_id then raise exception 'FAIL: compra duplicada'; end if;
 begin
   perform public.crear_compra_agrupada(gen_random_uuid(),'Proveedor de prueba',gen_random_uuid()::text,jsonb_build_array(jsonb_build_object('id',current_setting('prueba.detalle'),'cantidad',2,'precio',5)),null,'CONTADO',0,'PEN');
   raise exception 'FAIL: compró parte reservada';
 exception when others then if sqlerrm like 'FAIL:%' then raise; end if; if sqlerrm not like 'La cantidad excede%' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select u.id::text from public.usuarios u join public.roles r on r.id=u.rol_id where r.codigo='SUPERVISOR' and u.activo limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 begin
   perform public.registrar_ingreso_almacen(gen_random_uuid(),current_setting('prueba.material')::uuid,1,'INGRESO_GENERAL','ENSAYO REVERTIDO',5,'PEN');
   raise exception 'FAIL: Supervisión registra ingreso';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'OK: ingreso y despacho idempotentes; foto obligatoria; compra limitada al faltante; Supervisión sin ingreso. Ensayo revertido.' comprobacion;
rollback;
