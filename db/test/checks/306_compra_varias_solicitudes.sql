\set ON_ERROR_STOP on
begin;
-- El check se arma su propio taller: antes leía la primera línea aprobada y la
-- primera cuenta de cada rol de la base, y en una base vacía se quedaba con un
-- uuid en blanco.
insert into public.empresa (ruc, razon_social) values ('20100000306', 'PRUEBAS 306 S.A.C.');
insert into public.sedes (codigo, nombre) values ('QA306', 'Taller 306');
select test.crear_usuario('QA', 'Admin',   'qa-306-admin@demo.pe',   'ADMIN',      (select id from public.sedes where codigo = 'QA306')) as admin_id \gset
select test.crear_usuario('QA', 'Almacen', 'qa-306-almacen@demo.pe', 'ALMACENERO', (select id from public.sedes where codigo = 'QA306')) as almacen_id \gset
select test.crear_usuario('QA', 'Mtz',     'qa-306-mtz@demo.pe',     'SUPERVISOR', (select id from public.sedes where codigo = 'QA306')) as supervisor_id \gset
select test.crear_usuario('QA', 'Prd',     'qa-306-prd@demo.pe',     'SUPERVISOR', (select id from public.sedes where codigo = 'QA306')) as prd_id \gset
select test.crear_usuario('QA', 'Diseno',  'qa-306-diseno@demo.pe',  'DISENO',     (select id from public.sedes where codigo = 'QA306')) as diseno_id \gset
select test.crear_usuario('QA', 'Compras', 'qa-306-compras@demo.pe', 'COMPRADOR',  (select id from public.sedes where codigo = 'QA306')) as comprador_id \gset
select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'ALM') where id = :'almacen_id';
update public.usuarios set area_id = (select id from public.areas where codigo = 'MTZ') where id = :'supervisor_id';
update public.usuarios set area_id = (select id from public.areas where codigo = 'PRD') where id = :'prd_id';
-- Como en Supabase, Storage guarda los archivos con RLS y el rol authenticated
-- llega a la tabla; el shim local no lo trae puesto.
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990000306', 'QA Cliente 306');
insert into public.unidades_medida (codigo, nombre) values ('QA-UND-306', 'Unidad prueba') on conflict (codigo) do nothing;
insert into public.categorias_material (codigo, nombre) values ('QA-CAT-306', 'Material prueba') on conflict (codigo) do nothing;
insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
select 'QA-MAT-306', 'Material de prueba', c.id, u.id from public.categorias_material c, public.unidades_medida u
 where c.codigo = 'QA-CAT-306' and u.codigo = 'QA-UND-306';
insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
select 'QA-MAT-306B', 'Segundo material de prueba', c.id, u.id from public.categorias_material c, public.unidades_medida u
 where c.codigo = 'QA-CAT-306' and u.codigo = 'QA-UND-306';
-- Desde la migración 20261001100000 el despacho sale a nombre de la unidad.
insert into public.unidades (cliente_id, placa, tipo_vehiculo, marca, modelo)
select id, 'Q3B-306', 'VOLQUETE', 'VOLVO', 'FMX' from public.clientes where numero_documento = '20990000306';
select gen_random_uuid() as orden_id \gset
insert into public.ordenes_trabajo (id, cliente_id, unidad_id, sede_id, descripcion)
select :'orden_id', c.id, (select id from public.unidades where placa = 'Q3B-306'), (select id from public.sedes where codigo = 'QA306'), 'OT de prueba 306'
  from public.clientes c where c.numero_documento = '20990000306';
update public.ordenes_trabajo set estado = 'APROBADA' where id = :'orden_id';
insert into public.ot_materiales (orden_id, material_id, cantidad, area_destino)
select :'orden_id', id, 10, 'MTZ' from public.materiales where codigo = 'QA-MAT-306';
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
select set_config('prueba.req',gen_random_uuid()::text,true);
select set_config('prueba.om',gen_random_uuid()::text,true);
select set_config('prueba.detalle2',gen_random_uuid()::text,true);
-- El armazón reversible prepara dos solicitudes; la compra se ejecuta como Logística.
select test.como_usuario(:'prd_id');
insert into public.ot_materiales(id,orden_id,plano_id,material_id,cantidad,area_destino)
select current_setting('prueba.om')::uuid,om.orden_id,om.plano_id,(select id from public.materiales where codigo = 'QA-MAT-306B'),4,'PRD'
from public.requerimiento_material_detalles d join public.ot_materiales om on om.id=d.ot_material_id where d.id=current_setting('prueba.detalle')::uuid;
insert into public.requerimientos_materiales(id,orden_id,area_destino,solicitado_por)
select current_setting('prueba.req')::uuid,orden_id,'PRD',public.usuario_actual() from public.ot_materiales where id=current_setting('prueba.om')::uuid;
insert into public.requerimiento_material_detalles(id,requerimiento_id,ot_material_id,cantidad_solicitada,aprobacion_diseno,decision_almacen,cantidad_stock)
values(current_setting('prueba.detalle2')::uuid,current_setting('prueba.req')::uuid,current_setting('prueba.om')::uuid,4,'APROBADO','COMPRA',0);
select test.como_usuario(:'diseno_id');
set local role authenticated;
select public.resolver_propuesta_material(current_setting('prueba.detalle2')::uuid,true);
reset role;
select test.como_usuario(:'almacen_id');
set local role authenticated;
select public.revisar_stock_requerimiento(current_setting('prueba.detalle2')::uuid,'COMPRA');
reset role;
update public.requerimiento_material_detalles d set decision_almacen='COMPRA',cantidad_stock=0,cantidad_solicitada=4+(select coalesce(sum(cantidad),0) from public.orden_compra_material_detalles c where c.requerimiento_detalle_id=d.id) where id=current_setting('prueba.detalle')::uuid;
select test.como_usuario(:'comprador_id');
set local role authenticated;
do $$ declare v_id uuid:=gen_random_uuid(); v_doc uuid:=gen_random_uuid(); v_json jsonb;begin
 if (select count(*) from public.v_pendientes_materiales where detalle_id in (current_setting('prueba.detalle')::uuid,current_setting('prueba.detalle2')::uuid) and por_comprar)<>2 then raise exception 'FAIL: pendientes no muestra ambos insumos a Logística';end if;
 v_json:=jsonb_build_array(jsonb_build_object('id',current_setting('prueba.detalle'),'cantidad',2,'precio',5),jsonb_build_object('id',current_setting('prueba.detalle2'),'cantidad',3,'precio',6));
 perform public.emitir_compra_agrupada(v_id,current_setting('prueba.proveedor')::uuid,v_id::text,v_json,null,'CONTADO',0,'PEN', true, 'PLANTA');
 if (select count(distinct requerimiento_id) from public.orden_compra_material_detalles where orden_compra_id=v_id)<>2 then raise exception 'FAIL: compra no conservó dos solicitudes';end if;
 if (select count(distinct requerimiento_id) from public.v_orden_compra_material_pendiente where orden_compra_id=v_id)<>2 then raise exception 'FAIL: seguimiento usa solo la solicitud de cabecera';end if;
 if public.emitir_compra_agrupada(v_id,current_setting('prueba.proveedor')::uuid,v_id::text,v_json,null,'CONTADO',0,'PEN', true, 'PLANTA')<>v_id then raise exception 'FAIL: duplicó OC';end if;
 insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('documentos-compras','compra/'||v_id||'/'||v_doc||'.pdf',auth.uid()::text,'{"mimetype":"application/pdf","size":5}');
 -- Desde la migración 20260930090000 una factura dice su número y su fecha.
 insert into public.documentos_compra_material(id,orden_compra_id,tipo,nombre_archivo,ruta_storage,mime_type,tamano_bytes,subido_por,numero_documento,fecha_emision)
 values(v_doc,v_id,'FACTURA','Ensayo.pdf','compra/'||v_id||'/'||v_doc||'.pdf','application/pdf',5,public.usuario_actual(),'F001-306',current_date);
 if (select jsonb_array_length(vinculos_ot) from public.v_documentos_compra_tesoreria where id=v_doc)<>2 then raise exception 'FAIL: factura perdió los vínculos de solicitudes agrupadas';end if;
end $$;
reset role;
select 'OK: dos solicitudes en una OC con trazabilidad por línea; reintento sin duplicar' comprobacion;
rollback;
