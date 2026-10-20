\set ON_ERROR_STOP on
begin;
-- El check se arma su propio taller: antes leía la primera línea aprobada y la
-- primera cuenta de cada rol de la base, y en una base vacía se quedaba con un
-- uuid en blanco.
insert into public.empresa (ruc, razon_social) values ('20100000302', 'PRUEBAS KARDEX S.A.C.');
insert into public.sedes (codigo, nombre) values ('QA302', 'Taller kardex');
select test.crear_usuario('QA', 'Admin',   'qa-302-admin@demo.pe',   'ADMIN',      (select id from public.sedes where codigo = 'QA302')) as admin_id \gset
select test.crear_usuario('QA', 'Almacen', 'qa-302-almacen@demo.pe', 'ALMACENERO', (select id from public.sedes where codigo = 'QA302')) as almacen_id \gset
select test.crear_usuario('QA', 'Compras', 'qa-302-compras@demo.pe', 'COMPRADOR',  (select id from public.sedes where codigo = 'QA302')) as comprador_id \gset
select test.crear_usuario('QA', 'Mtz',     'qa-302-mtz@demo.pe',     'SUPERVISOR', (select id from public.sedes where codigo = 'QA302')) as supervisor_id \gset
select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'ALM') where id = :'almacen_id';
update public.usuarios set area_id = (select id from public.areas where codigo = 'MTZ') where id = :'supervisor_id';

insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990000302', 'QA Cliente Kardex');
insert into public.unidades_medida (codigo, nombre) values ('QA-UND-302', 'Unidad prueba') on conflict (codigo) do nothing;
insert into public.categorias_material (codigo, nombre) values ('QA-CAT-302', 'Material prueba') on conflict (codigo) do nothing;
insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
select 'QA-MAT-302', 'Material kardex', c.id, u.id from public.categorias_material c, public.unidades_medida u
 where c.codigo = 'QA-CAT-302' and u.codigo = 'QA-UND-302';
-- Desde la migración 20261001100000 el despacho sale a nombre de la unidad.
insert into public.unidades (cliente_id, placa, tipo_vehiculo, marca, modelo)
select id, 'K3X-302', 'VOLQUETE', 'VOLVO', 'FMX' from public.clientes where numero_documento = '20990000302';
select gen_random_uuid() as orden_id \gset
insert into public.ordenes_trabajo (id, cliente_id, unidad_id, sede_id, descripcion)
select :'orden_id', c.id, (select id from public.unidades where placa = 'K3X-302'), (select id from public.sedes where codigo = 'QA302'), 'OT de prueba del kardex'
  from public.clientes c where c.numero_documento = '20990000302';
update public.ordenes_trabajo set estado = 'APROBADA' where id = :'orden_id';
insert into public.ot_materiales (orden_id, material_id, cantidad, area_destino)
select :'orden_id', id, 10, 'MTZ' from public.materiales where codigo = 'QA-MAT-302';
insert into public.requerimientos_materiales (orden_id, area_destino, solicitado_por) values (:'orden_id', 'MTZ', :'supervisor_id');
insert into public.requerimiento_material_detalles (requerimiento_id, ot_material_id, cantidad_solicitada)
select r.id, om.id, 3 from public.requerimientos_materiales r, public.ot_materiales om
 where r.orden_id = :'orden_id' and om.orden_id = :'orden_id';
-- Lo que pide el área entra como propuesta (fn_material_propuesta_inicial): el
-- armazón la deja aprobada por Diseño, como la encontraba el check.
update public.requerimiento_material_detalles d set aprobacion_diseno = 'APROBADO'
  from public.requerimientos_materiales r where r.id = d.requerimiento_id and r.orden_id = :'orden_id';

-- Desde el padrón (migración 20261012100000) la compra elige su proveedor.
insert into public.proveedores(id,numero_documento,razon_social) values(gen_random_uuid(),'20100047218','PROVEEDOR DE PRUEBA') on conflict (tipo_documento,numero_documento) do update set activo=true;
select set_config('prueba.proveedor',(select id::text from public.proveedores where tipo_documento='RUC' and numero_documento='20100047218'),true);
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
reset role;
select test.como_usuario(:'comprador_id');
-- Ensayar compra parcial y comprobar que nunca compra la parte reservada.
update public.requerimiento_material_detalles d set decision_almacen='COMPRA',cantidad_stock=1,
 cantidad_solicitada=3+(select coalesce(sum(cantidad),0) from public.orden_compra_material_detalles c where c.requerimiento_detalle_id=d.id)
 where d.id=current_setting('prueba.detalle')::uuid;
set local role authenticated;
do $$ declare v_id uuid:=gen_random_uuid(); v_json jsonb; begin
 v_json:=jsonb_build_array(jsonb_build_object('id',current_setting('prueba.detalle'),'cantidad',1,'precio',5));
 perform public.emitir_compra_agrupada(v_id,current_setting('prueba.proveedor')::uuid,v_id::text,v_json,null,'CONTADO',0,'PEN', true, 'PLANTA');
 if public.emitir_compra_agrupada(v_id,current_setting('prueba.proveedor')::uuid,v_id::text,v_json,null,'CONTADO',0,'PEN', true, 'PLANTA')<>v_id then raise exception 'FAIL: compra duplicada'; end if;
 begin
   perform public.emitir_compra_agrupada(gen_random_uuid(),current_setting('prueba.proveedor')::uuid,gen_random_uuid()::text,jsonb_build_array(jsonb_build_object('id',current_setting('prueba.detalle'),'cantidad',2,'precio',5)),null,'CONTADO',0,'PEN', true, 'PLANTA');
   raise exception 'FAIL: compró parte reservada';
 exception when others then if sqlerrm like 'FAIL:%' then raise; end if; if sqlerrm not like 'La cantidad excede%' then raise; end if; end;
end $$;
reset role;
select test.como_usuario(:'supervisor_id');
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
