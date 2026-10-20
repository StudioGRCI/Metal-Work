\set ON_ERROR_STOP on
begin;
-- El check se arma su propio taller: antes leía la primera línea aprobada y la
-- primera cuenta de cada rol de la base, y en una base vacía se quedaba con un
-- uuid en blanco.
insert into public.empresa (ruc, razon_social) values ('20100000305', 'PRUEBAS 305 S.A.C.');
insert into public.sedes (codigo, nombre) values ('QA305', 'Taller 305');
select test.crear_usuario('QA', 'Admin',   'qa-305-admin@demo.pe',   'ADMIN',      (select id from public.sedes where codigo = 'QA305')) as admin_id \gset
select test.crear_usuario('QA', 'Almacen', 'qa-305-almacen@demo.pe', 'ALMACENERO', (select id from public.sedes where codigo = 'QA305')) as almacen_id \gset
select test.crear_usuario('QA', 'Mtz',     'qa-305-mtz@demo.pe',     'SUPERVISOR', (select id from public.sedes where codigo = 'QA305')) as supervisor_id \gset
select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'ALM') where id = :'almacen_id';
update public.usuarios set area_id = (select id from public.areas where codigo = 'MTZ') where id = :'supervisor_id';

insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990000305', 'QA Cliente 305');
insert into public.unidades_medida (codigo, nombre) values ('QA-UND-305', 'Unidad prueba') on conflict (codigo) do nothing;
insert into public.categorias_material (codigo, nombre) values ('QA-CAT-305', 'Material prueba') on conflict (codigo) do nothing;
insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
select 'QA-MAT-305', 'Material de prueba', c.id, u.id from public.categorias_material c, public.unidades_medida u
 where c.codigo = 'QA-CAT-305' and u.codigo = 'QA-UND-305';
-- Desde la migración 20261001100000 el despacho sale a nombre de la unidad.
insert into public.unidades (cliente_id, placa, tipo_vehiculo, marca, modelo)
select id, 'Q3A-305', 'VOLQUETE', 'VOLVO', 'FMX' from public.clientes where numero_documento = '20990000305';
select gen_random_uuid() as orden_id \gset
insert into public.ordenes_trabajo (id, cliente_id, unidad_id, sede_id, descripcion)
select :'orden_id', c.id, (select id from public.unidades where placa = 'Q3A-305'), (select id from public.sedes where codigo = 'QA305'), 'OT de prueba 305'
  from public.clientes c where c.numero_documento = '20990000305';
update public.ordenes_trabajo set estado = 'APROBADA' where id = :'orden_id';
insert into public.ot_materiales (orden_id, material_id, cantidad, area_destino)
select :'orden_id', id, 10, 'MTZ' from public.materiales where codigo = 'QA-MAT-305';
insert into public.requerimientos_materiales (orden_id, area_destino, solicitado_por) values (:'orden_id', 'MTZ', :'supervisor_id');
insert into public.requerimiento_material_detalles (requerimiento_id, ot_material_id, cantidad_solicitada)
select r.id, om.id, 3 from public.requerimientos_materiales r, public.ot_materiales om
 where r.orden_id = :'orden_id' and om.orden_id = :'orden_id';
-- Lo que pide el área entra como propuesta (fn_material_propuesta_inicial): el
-- armazón la deja aprobada por Diseño, como la encontraba el check.
update public.requerimiento_material_detalles d set aprobacion_diseno = 'APROBADO'
  from public.requerimientos_materiales r where r.id = d.requerimiento_id and r.orden_id = :'orden_id';
select set_config('prueba.detalle',(select d.id::text from public.requerimiento_material_detalles d join public.ot_materiales om on om.id=d.ot_material_id join public.ordenes_trabajo o on o.id=om.orden_id where o.id=:'orden_id' and d.aprobacion_diseno='APROBADO' limit 1),true);
select set_config('prueba.material',(select om.material_id::text from public.requerimiento_material_detalles d join public.ot_materiales om on om.id=d.ot_material_id where d.id=current_setting('prueba.detalle')::uuid),true);
select set_config('prueba.ingreso',gen_random_uuid()::text,true);
select set_config('prueba.despacho',gen_random_uuid()::text,true);
select test.como_usuario(:'almacen_id');
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

