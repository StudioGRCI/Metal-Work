\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000042', 'PRUEBAS TESORERIA Y DISENO S.A.C.');
insert into public.sedes (codigo, nombre) values ('QA42', 'Taller prueba finanzas');
insert into public.unidades_medida (codigo, nombre) values ('QA-UND-300', 'Unidad prueba') on conflict (codigo) do nothing;
insert into public.categorias_material (codigo, nombre) values ('QA-CAT-300', 'Material prueba') on conflict (codigo) do nothing;
insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
select 'QA-MAT-300', 'Material para prueba', c.id, u.id from public.categorias_material c, public.unidades_medida u
where c.codigo='QA-CAT-300' and u.codigo='QA-UND-300' on conflict (codigo) do nothing;

select test.crear_usuario('QA', 'Admin', 'qa-mw-300-admin@demo.pe', 'ADMIN', (select id from public.sedes where codigo='QA42')) as admin_id \gset
select test.crear_usuario('QA', 'Oficina', 'qa-mw-300-oficina@demo.pe', 'ADMINISTRACION', (select id from public.sedes where codigo='QA42')) as oficina_id \gset
select test.crear_usuario('QA', 'Gerencia', 'qa-mw-300-gerente@demo.pe', 'GERENTE', (select id from public.sedes where codigo='QA42')) as gerente_id \gset
select test.crear_usuario('QA', 'Tesoreria', 'qa-mw-300-tesoreria@demo.pe', 'COSTOS', (select id from public.sedes where codigo='QA42')) as tesoreria_id \gset
select test.crear_usuario('QA', 'Diseno', 'qa-mw-300-diseno@demo.pe', 'DISENO', (select id from public.sedes where codigo='QA42')) as diseno_id \gset
select test.crear_usuario('QA', 'Lider', 'qa-mw-300-lider@demo.pe', 'DISENO_LIDER', (select id from public.sedes where codigo='QA42')) as lider_id \gset
select test.crear_usuario('QA', 'Compras', 'qa-mw-300-compras@demo.pe', 'COMPRADOR', (select id from public.sedes where codigo='QA42')) as comprador_id \gset
select test.crear_usuario('QA', 'Taller', 'qa-mw-300-taller@demo.pe', 'OPERARIO', (select id from public.sedes where codigo='QA42'), true, 10) as taller_id \gset
select test.crear_usuario('QA', 'Cliente', 'qa-mw-300-otro-comercial@demo.pe', 'VENDEDOR', (select id from public.sedes where codigo='QA42')) as vendedor_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000300', 'QA Cliente Finanzas');
select id as cliente_id from public.clientes where numero_documento='20990000300' \gset
select id as carroceria_id from public.tipos_carroceria where activo order by orden_secuencia limit 1 \gset
select id as material_id from public.materiales where codigo='QA-MAT-300' \gset
select gen_random_uuid() as cotizacion_id \gset
select gen_random_uuid() as orden_id \gset
select gen_random_uuid() as compra_id \gset
select gen_random_uuid() as plano_id \gset
select gen_random_uuid() as documento_id \gset

insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, estado, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por)
values (:'cotizacion_id', 'QA-PDF-300', :'cliente_id', :'carroceria_id', 'POR_REVISAR', 'qa-300.pdf', 'cot/'||:'cotizacion_id'||'/qa-300.pdf', 'application/pdf', 120, :'vendedor_id');
select test.como_usuario(:'gerente_id');
set local role authenticated;
update public.cotizaciones_pdf set estado='APROBADA' where id=:'cotizacion_id';
reset role;

select test.como_usuario(:'admin_id');
set local role authenticated;
insert into public.ordenes_trabajo (id, numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado, monto_presupuestado, cotizacion_pdf_id)
select :'orden_id', 'QA-OT-300', :'cliente_id', s.id, 'FABRICACION', 'NORMAL', 'Prueba aislada de permisos y documentos', 'APROBADA', 0, :'cotizacion_id'
from public.sedes s where s.codigo='QA42';
insert into public.ot_planos (id, orden_id, orden_secuencia, numero_plano, nombre, creado_por)
values (:'plano_id', :'orden_id', 1, 'QA-300-01', 'Plano de prueba', :'diseno_id');
reset role;

select set_config('prueba.cotizacion', :'cotizacion_id', true);
select set_config('prueba.compra', :'compra_id', true);
select set_config('prueba.orden', :'orden_id', true);
select set_config('prueba.lider', :'lider_id', true);
select set_config('prueba.diseno', :'diseno_id', true);
select set_config('prueba.taller', :'taller_id', true);
select set_config('prueba.plano', :'plano_id', true);

-- Un requerimiento y compra de prueba para comprobar acceso a adjuntos con OT y área.
insert into public.ot_materiales (orden_id, material_id, cantidad, observacion, creado_por)
values (:'orden_id', :'material_id', 1, 'Prueba compras Tesorería', :'diseno_id');
select id as ot_material_id from public.ot_materiales where orden_id=:'orden_id' limit 1 \gset
insert into public.requerimientos_materiales (orden_id, area_destino, solicitado_por)
values (:'orden_id', 'MTZ', :'diseno_id');
select id as requerimiento_id from public.requerimientos_materiales where orden_id=:'orden_id' and area_destino='MTZ' \gset
insert into public.requerimiento_material_detalles (requerimiento_id, ot_material_id, cantidad_solicitada)
values (:'requerimiento_id', :'ot_material_id', 1);
select id as req_detalle_id from public.requerimiento_material_detalles where requerimiento_id=:'requerimiento_id' \gset

select test.como_usuario(:'comprador_id');
set local role authenticated;
select public.crear_orden_compra_material(:'compra_id', :'requerimiento_id', 'Proveedor QA', 'QA-OC-300', jsonb_build_array(jsonb_build_object('id', :'req_detalle_id', 'cantidad', 1)), current_date + 7);
insert into public.documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
values (:'documento_id', :'compra_id', 'FACTURA', 'qa-factura.pdf', 'compra/'||:'compra_id'||'/'||:'documento_id'||'.pdf', 'application/pdf', 120, :'comprador_id');
reset role;

-- El mismo PDF no se ve a COSTOS hasta que Administración lo libera.
select test.como_usuario(:'tesoreria_id');
set local role authenticated;
do $$
begin
  perform test.afirmar(not exists (select 1 from public.cotizaciones_pdf where id=current_setting('prueba.cotizacion')::uuid), 'Tesorería no ve cotizaciones antes de la liberación');
  perform test.afirmar(exists (select 1 from public.v_documentos_compra_tesoreria where orden_compra_id=current_setting('prueba.compra')::uuid), 'Tesorería sí ve documentos de compra antes de liberar la cotización');
end $$;
reset role;

select test.como_usuario(:'oficina_id');
set local role authenticated;
select public.liberar_cotizacion_a_tesoreria(current_setting('prueba.cotizacion')::uuid);
reset role;

select test.como_usuario(:'tesoreria_id');
set local role authenticated;
insert into public.cotizaciones_pdf_observaciones_tesoreria (cotizacion_pdf_id, observacion, registrado_por)
values (current_setting('prueba.cotizacion')::uuid, 'Revisar el número de factura antes de emitir.', current_setting('request.jwt.claim.sub')::uuid);
reset role;

select test.como_usuario(:'tesoreria_id');
set local role authenticated;
do $$
begin
  perform test.afirmar(exists (select 1 from public.cotizaciones_pdf where id=current_setting('prueba.cotizacion')::uuid), 'Tesorería ve el PDF tras la liberación');
  perform test.afirmar(exists (select 1 from public.cotizaciones_pdf_observaciones_tesoreria where cotizacion_pdf_id=current_setting('prueba.cotizacion')::uuid), 'Tesorería ve sus observaciones');
  perform test.afirmar(exists (select 1 from public.v_documentos_compra_tesoreria where orden_compra_id=current_setting('prueba.compra')::uuid), 'Tesorería ve documentos y metadatos de compra');
end $$;
reset role;

-- Diseño hereda cotización.ver por su flujo técnico, pero el PDF comercial queda cerrado.
select test.como_usuario(:'diseno_id');
set local role authenticated;
do $$
begin
  perform test.afirmar(not exists (select 1 from public.cotizaciones_pdf_observaciones_tesoreria where cotizacion_pdf_id=current_setting('prueba.cotizacion')::uuid), 'Diseño no ve observaciones de Tesorería');
end $$;
reset role;

-- Taller tampoco ve el PDF por tabla ni por Storage.
select test.como_usuario(:'taller_id');
set local role authenticated;
do $$
begin
  perform test.afirmar(not exists (select 1 from public.cotizaciones_pdf where id=current_setting('prueba.cotizacion')::uuid), 'Taller no ve cotización comercial');
  perform test.afirmar(not exists (select 1 from public.v_documentos_compra_tesoreria where orden_compra_id=current_setting('prueba.compra')::uuid), 'Taller no ve documentos financieros de compra');
end $$;
select test.debe_fallar(format('select public.liberar_cotizacion_a_tesoreria(%L)', current_setting('prueba.cotizacion')), 'Taller no puede llamar la liberación a Tesorería', 'cotizaciones.liberar_tesoreria');
reset role;

-- Administración puede liberar y Gerencia ve la bandeja de Tesorería.
select test.como_usuario(:'admin_id');
set local role authenticated;
do $$
begin
  perform test.afirmar(exists (select 1 from public.cotizaciones_pdf_liberaciones_tesoreria where cotizacion_pdf_id=current_setting('prueba.cotizacion')::uuid), 'Administración consulta estado de liberación');
end $$;
reset role;

select test.como_usuario(:'diseno_id');
set local role authenticated;
select test.debe_fallar(format('select public.asignar_equipo_diseno(%L, %L, %L::jsonb)', current_setting('prueba.orden'), current_setting('prueba.diseno'), '{}'::jsonb), 'Diseño no puede asignar el equipo sin permiso', 'diseno.asignar');
reset role;

-- Asignación requiere diseno.asignar y valida perfil del líder y responsable.
select test.como_usuario(:'lider_id');
set local role authenticated;
select public.asignar_equipo_diseno(:'orden_id', :'lider_id', jsonb_build_object(:'plano_id', :'diseno_id'));
do $$
begin
  perform test.afirmar(exists (select 1 from public.ordenes_trabajo where id=current_setting('prueba.orden')::uuid and diseno_lider_id=current_setting('prueba.lider')::uuid), 'El líder asignado queda en la OT');
  perform test.afirmar(exists (select 1 from public.ot_planos where id=current_setting('prueba.plano')::uuid and responsable_diseno_id=current_setting('prueba.diseno')::uuid), 'La persona responsable queda en el plano');
  perform test.afirmar(exists (select 1 from public.v_equipo_diseno_ot where plano_id=current_setting('prueba.plano')::uuid and lider_nombre='QA Lider' and responsable_nombre='QA Diseno'), 'Líder ve el equipo de esta OT sin acceso general al personal');
end $$;
select test.debe_fallar(format('select public.asignar_equipo_diseno(%L, %L, %L::jsonb)', current_setting('prueba.orden'), current_setting('prueba.diseno'), '{}'::jsonb), 'Solo un perfil Líder de Diseño puede quedar como líder', 'El líder asignado');
select test.debe_fallar(format('select public.asignar_equipo_diseno(%L, %L, jsonb_build_object(%L, %L))', current_setting('prueba.orden'), current_setting('prueba.lider'), current_setting('prueba.plano'), current_setting('prueba.taller')), 'El responsable debe pertenecer a Diseño', 'El responsable del plano');
reset role;

do $$
declare v_policy text;
begin
  select pg_get_expr(polqual, polrelid) into v_policy
    from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'mw_leer_cotizaciones_pdf';
  perform test.afirmar(v_policy like '%cotizaciones.ver_pdf_comercial%'
    and v_policy like '%tesoreria.ver_documentos%'
    and v_policy like '%cotizaciones_pdf_liberaciones_tesoreria%',
    'Storage aplica los mismos permisos y liberación al enlace del PDF');
end $$;

rollback;
