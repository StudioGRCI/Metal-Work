-- Tesorería paga las órdenes de servicio aprobadas, con su comprobante, en uno o
-- varios pagos; un pago no se borra: se anula con motivo. Logística ve que se
-- pagó, pero no paga. Contabilidad ve el kardex en lectura.
-- Cada paso con la cuenta del área que lo hace; ninguno como ADMIN.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000045', 'PRUEBAS TESORERIA S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA45', 'Taller prueba de Tesorería') on conflict (codigo) do nothing;

select test.crear_usuario('Gema', 'Gerente', 'gerencia345@demo.pe', 'GERENTE', (select id from public.sedes where codigo = 'QA45')) as gerente_id \gset
select test.crear_usuario('Coni', 'Contable', 'contabilidad345@demo.pe', 'CONTABILIDAD', (select id from public.sedes where codigo = 'QA45')) as conta_id \gset
select test.crear_usuario('Teo', 'Tesoro', 'tesoreria345@demo.pe', 'TESORERIA', (select id from public.sedes where codigo = 'QA45')) as teso_id \gset
select test.crear_usuario('Lalo', 'Logística', 'logistica345@demo.pe', 'COMPRADOR', (select id from public.sedes where codigo = 'QA45')) as compras_id \gset
select test.crear_usuario('Rita', 'Requerimientos', 'req345@demo.pe', 'REQUERIMIENTOS', (select id from public.sedes where codigo = 'QA45')) as req_id \gset

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

select set_config('prueba.conta', :'conta_id', true);
select set_config('prueba.teso', :'teso_id', true);
select set_config('prueba.caja', test.crear_caja()::text, true);  -- desde la 20261019100000 todo pago pide su cuenta
select set_config('prueba.compras', :'compras_id', true);
select set_config('prueba.req', :'req_id', true);
select set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);

-- ------------------------------------------------------- Contabilidad ve el kardex
do $$ begin
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  perform test.afirmar(public.tiene_permiso('almacen.ver'), 'Contabilidad tiene el kardex en lectura');
  perform count(*) from public.v_kardex_almacen;
  perform test.afirmar(not public.tiene_permiso('almacen.recibir') and not public.tiene_permiso('almacen.despachar'),
    'y no registra ingresos ni salidas');
  perform test.debe_fallar('select * from public.servicios_por_pagar()', 'Contabilidad no lleva los pagos de servicio', 'Tesorería');
  reset role;
end $$;

-- ------------------------------------------------------- Tesorería paga un servicio
insert into public.proveedores (id, numero_documento, razon_social) values (gen_random_uuid(), '20100047218', 'PROVEEDOR DE PRUEBA')
on conflict (tipo_documento, numero_documento) do update set activo = true;
select gen_random_uuid() as os_id \gset
insert into public.ordenes_servicio (id, numero, proveedor_id, proveedor, codigo_interno, descripcion, moneda, monto,
                                     aprobacion, aprobado_por, aprobado_en, estado, iniciado_en, conformidad_por, conformidad_en, creado_por)
select :'os_id', 'OS-QA-345', p.id, p.razon_social, 'QA-345', 'Arenado de la tolva de prueba', 'PEN', 1000,
       'APROBADA', :'gerente_id', now(), 'CONFORME', now(), :'compras_id', now(), :'compras_id'
  from public.proveedores p where p.numero_documento = '20100047218';
select set_config('prueba.os', :'os_id', true);
select set_config('prueba.p1', gen_random_uuid()::text, true);
select set_config('prueba.p2', gen_random_uuid()::text, true);
select set_config('prueba.p3', gen_random_uuid()::text, true);

do $$
declare r record;
begin
  perform test.como_usuario(current_setting('prueba.compras')::uuid);
  set local role authenticated;
  perform test.debe_fallar('select * from public.servicios_por_pagar()', 'Logística no lleva los pagos', 'Tesorería');
  perform test.afirmar(public.servicios_pendientes_de_pago() is null, 'ni ve el pendiente de Tesorería');
  reset role;

  perform test.como_usuario(current_setting('prueba.teso')::uuid);
  set local role authenticated;
  select * into r from public.servicios_por_pagar() where id = current_setting('prueba.os')::uuid;
  perform test.afirmar(r.numero = 'OS-QA-345' and r.pagado = 0 and not r.cancelada and r.codigo_interno = 'QA-345',
    'Tesorería ve la OS conforme por pagar, con su código interno');
  perform test.afirmar(public.servicios_pendientes_de_pago() >= 1, 'su tablero la cuenta');
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('pagos-servicio', current_setting('prueba.os') || '/' || current_setting('prueba.p1') || '.pdf', current_setting('prueba.teso'), '{"mimetype": "application/pdf", "size": 900}'),
    ('pagos-servicio', current_setting('prueba.os') || '/' || current_setting('prueba.p2') || '.jpg', current_setting('prueba.teso'), '{"mimetype": "image/jpeg", "size": 900}'),
    ('pagos-servicio', current_setting('prueba.os') || '/' || current_setting('prueba.p3') || '.pdf', current_setting('prueba.teso'), '{"mimetype": "application/pdf", "size": 900}');
  perform test.debe_fallar(format('select public.registrar_pago_servicio(%L, %L, %L, 10, true, null, null, %L, current_setting(''prueba.caja'')::uuid, null)',
      current_setting('prueba.p1'), current_setting('prueba.os'), (current_setting('prueba.hoy')::date + 1)::text,
      current_setting('prueba.os') || '/' || current_setting('prueba.p1') || '.pdf'),
    'el pago no es de mañana', 'de hoy hacia atrás');
  perform test.debe_fallar(format('select public.registrar_pago_servicio(%L, %L, current_setting(''prueba.hoy'')::date, 10, true, null, null, %L, current_setting(''prueba.caja'')::uuid, null)',
      current_setting('prueba.p1'), current_setting('prueba.os'), gen_random_uuid() || '/' || current_setting('prueba.p1') || '.pdf'),
    'el comprobante va en la carpeta de su orden de servicio', 'Vuelve a adjuntar');
  perform public.registrar_pago_servicio(current_setting('prueba.p1')::uuid, current_setting('prueba.os')::uuid, current_setting('prueba.hoy')::date, 590, false,
    'OP-1', 'E001-45', current_setting('prueba.os') || '/' || current_setting('prueba.p1') || '.pdf', current_setting('prueba.caja')::uuid, null);
  perform test.afirmar(public.registrar_pago_servicio(current_setting('prueba.p1')::uuid, current_setting('prueba.os')::uuid, current_setting('prueba.hoy')::date, 590, false,
    'OP-1', 'E001-45', current_setting('prueba.os') || '/' || current_setting('prueba.p1') || '.pdf', current_setting('prueba.caja')::uuid, null) = current_setting('prueba.p1')::uuid,
    'un reintento no registra otro pago');
  select * into r from public.servicios_por_pagar() where id = current_setting('prueba.os')::uuid;
  perform test.afirmar(r.pagado = 590 and not r.cancelada, 'un pago a cuenta no la cancela');
  perform public.registrar_pago_servicio(current_setting('prueba.p2')::uuid, current_setting('prueba.os')::uuid, current_setting('prueba.hoy')::date, 590, true,
    'OP-2', 'E001-45', current_setting('prueba.os') || '/' || current_setting('prueba.p2') || '.jpg', current_setting('prueba.caja')::uuid, null);
  select * into r from public.servicios_por_pagar() where id = current_setting('prueba.os')::uuid;
  perform test.afirmar(r.pagado = 1180 and r.cancelada, 'el pago que la cancela la deja pagada');
  perform test.debe_fallar(format('select public.registrar_pago_servicio(%L, %L, current_setting(''prueba.hoy'')::date, 10, true, null, null, %L, current_setting(''prueba.caja'')::uuid, null)',
      current_setting('prueba.p3'), current_setting('prueba.os'), current_setting('prueba.os') || '/' || current_setting('prueba.p3') || '.pdf'),
    'la OS cancelada no se paga de nuevo', 'ya está cancelada');
  perform test.debe_fallar(format('select public.anular_pago_servicio(%L, ''corto'')', current_setting('prueba.p2')),
    'anular el pago pide motivo', '10 a 500');
  perform public.anular_pago_servicio(current_setting('prueba.p2')::uuid, 'Se registró con el voucher de otro pago.');
  select * into r from public.servicios_por_pagar() where id = current_setting('prueba.os')::uuid;
  perform test.afirmar(r.pagado = 590 and not r.cancelada, 'anulado el pago, la OS vuelve a quedar por pagar');
  perform test.debe_fallar(format('delete from public.pagos_orden_servicio where id = %L', current_setting('prueba.p1')),
    'un pago no se borra', 'permission denied');
  perform test.debe_fallar(format('update public.pagos_orden_servicio set monto = 1 where id = %L', current_setting('prueba.p1')),
    'ni se corrige por debajo', 'permission denied');
  reset role;

  perform test.como_usuario(current_setting('prueba.compras')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.registrar_pago_servicio(%L, %L, current_setting(''prueba.hoy'')::date, 10, true, null, null, %L, current_setting(''prueba.caja'')::uuid, null)',
      current_setting('prueba.p3'), current_setting('prueba.os'), current_setting('prueba.os') || '/' || current_setting('prueba.p3') || '.pdf'),
    'Logística no registra pagos', 'tesoreria.pagar_servicios');
  perform test.afirmar((select count(*) from public.pagos_orden_servicio where orden_servicio_id = current_setting('prueba.os')::uuid) = 2,
    'pero ve que se pagó');
  perform test.debe_fallar(format('insert into storage.objects (bucket_id, name, owner_id, metadata) values (''pagos-servicio'', %L, %L, ''{}'')',
      current_setting('prueba.os') || '/otro.pdf', current_setting('prueba.compras')),
    'Logística no sube comprobantes de pago', 'row-level security');
  reset role;

  perform test.como_usuario(current_setting('prueba.req')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.pagos_orden_servicio) = 0, 'Requerimientos no ve los pagos');
  reset role;
end $$;

-- Nada de esto lo puede anon.
do $$ begin
  perform test.afirmar(not has_function_privilege('anon', 'public.registrar_pago_servicio(uuid, uuid, date, numeric, boolean, text, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.servicios_por_pagar()', 'execute')
    and not has_function_privilege('authenticated', 'public.archivo_subido_por_mi(text, text, uuid, text[])', 'execute')
    and not has_table_privilege('anon', 'public.pagos_orden_servicio', 'select'),
    'anon no entra a los pagos de servicio');
end $$;

rollback;
