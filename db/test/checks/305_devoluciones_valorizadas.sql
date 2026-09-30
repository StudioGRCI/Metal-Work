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

do $$ declare v_id uuid:=gen_random_uuid();v_precio numeric;begin
 select precio_unitario into v_precio from public.movimientos_materiales where id=current_setting('prueba.despacho')::uuid;
 if v_precio is null then raise exception 'FAIL: el despacho no congeló el precio del ingreso';end if;
 perform public.registrar_ingreso_almacen(v_id,current_setting('prueba.material')::uuid,1,'DEVOLUCION','ENSAYO DEVOLUCION',null,'PEN',current_setting('prueba.despacho')::uuid);
 if public.registrar_ingreso_almacen(v_id,current_setting('prueba.material')::uuid,1,'DEVOLUCION','ENSAYO DEVOLUCION',null,'PEN',current_setting('prueba.despacho')::uuid)<>v_id then raise exception 'FAIL: devolución duplicada';end if;
 if (select precio_unitario from public.movimientos_materiales where id=v_id)<>v_precio then raise exception 'FAIL: cambió el precio devuelto';end if;
 begin
 perform public.registrar_ingreso_almacen(gen_random_uuid(),current_setting('prueba.material')::uuid,1,'DEVOLUCION','ENSAYO EXCESO',null,'PEN',current_setting('prueba.despacho')::uuid);
 raise exception 'FAIL: devolución excedió el despacho';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;if sqlerrm not like 'La devolución supera%' then raise;end if;end;
end $$;
reset role;
select 'OK: despacho valorado; devolución idempotente al precio original y sin exceso' comprobacion;
rollback;

