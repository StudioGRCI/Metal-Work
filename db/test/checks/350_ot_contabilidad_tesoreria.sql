-- La OT pasa por Contabilidad: Administración envía la cotización aprobada (con
-- su OT) a Contabilidad, que anexa la factura y la envía a Tesorería, donde
-- entra a cuentas por cobrar. La factura no se borra: se anula mientras no haya
-- cobros, y su número queda libre. Tesorería paga también las órdenes de
-- servicio aprobadas, con su comprobante. Contabilidad ve el kardex en lectura.
-- Cada paso con la cuenta del área que lo hace; ninguno como ADMIN.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000045', 'PRUEBAS FACTURACION S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA45', 'Taller prueba facturación') on conflict (codigo) do nothing;

select test.crear_usuario('Ada', 'Admin', 'admin345@demo.pe', 'ADMIN', (select id from public.sedes where codigo = 'QA45')) as admin_id \gset
select test.crear_usuario('Olga', 'Oficina', 'oficina345@demo.pe', 'ADMINISTRACION', (select id from public.sedes where codigo = 'QA45')) as oficina_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia345@demo.pe', 'GERENTE', (select id from public.sedes where codigo = 'QA45')) as gerente_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas345@demo.pe', 'VENDEDOR', (select id from public.sedes where codigo = 'QA45')) as vendedor_id \gset
select test.crear_usuario('Coni', 'Contable', 'contabilidad345@demo.pe', 'CONTABILIDAD', (select id from public.sedes where codigo = 'QA45')) as conta_id \gset
select test.crear_usuario('Teo', 'Tesoro', 'tesoreria345@demo.pe', 'TESORERIA', (select id from public.sedes where codigo = 'QA45')) as teso_id \gset
select test.crear_usuario('Lalo', 'Logística', 'logistica345@demo.pe', 'COMPRADOR', (select id from public.sedes where codigo = 'QA45')) as compras_id \gset
select test.crear_usuario('Rita', 'Requerimientos', 'req345@demo.pe', 'REQUERIMIENTOS', (select id from public.sedes where codigo = 'QA45')) as req_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social, direccion_fiscal, distrito)
values ('RUC', '20990000345', 'QA CLIENTE FACTURA', 'Av. de Prueba 345', 'Trujillo');
select id as cliente_id from public.clientes where numero_documento = '20990000345' \gset
select id as carroceria_id from public.tipos_carroceria where activo order by orden_secuencia limit 1 \gset
select gen_random_uuid() as cot1 \gset
select gen_random_uuid() as cot2 \gset
select gen_random_uuid() as ot1 \gset

-- El armazón, con ADMIN: dos cotizaciones aprobadas por Gerencia; solo la
-- primera tiene su OT.
insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, estado, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
values (:'cot1', 'QA-345-1', :'cliente_id', :'carroceria_id', 'POR_REVISAR', 'qa-345-1.pdf', 'cot/' || :'cot1' || '/qa-345-1.pdf', 'application/pdf', 120, :'vendedor_id', 50000, 'USD'),
       (:'cot2', 'QA-345-2', :'cliente_id', :'carroceria_id', 'POR_REVISAR', 'qa-345-2.pdf', 'cot/' || :'cot2' || '/qa-345-2.pdf', 'application/pdf', 120, :'vendedor_id', 20000, 'PEN');
select test.como_usuario(:'gerente_id');
set local role authenticated;
update public.cotizaciones_pdf set estado = 'APROBADA' where id in (:'cot1', :'cot2');
reset role;
select test.como_usuario(:'admin_id');
set local role authenticated;
insert into public.ordenes_trabajo (id, numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado, cotizacion_pdf_id)
select :'ot1', 'QA-OT-345', :'cliente_id', s.id, 'FABRICACION', 'NORMAL', 'Prueba de facturación de la OT', 'APROBADA', :'cot1'
  from public.sedes s where s.codigo = 'QA45';
reset role;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;
-- El archivo de la cotización, como si Ventas lo hubiera subido.
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('cotizaciones-pdf', 'cot/' || :'cot1' || '/qa-345-1.pdf', :'vendedor_id', '{"mimetype": "application/pdf", "size": 120}');

select set_config('prueba.cot1', :'cot1', true);
select set_config('prueba.cot2', :'cot2', true);
select set_config('prueba.ot1', :'ot1', true);
select set_config('prueba.oficina', :'oficina_id', true);
select set_config('prueba.vendedor', :'vendedor_id', true);
select set_config('prueba.conta', :'conta_id', true);
select set_config('prueba.teso', :'teso_id', true);
select set_config('prueba.compras', :'compras_id', true);
select set_config('prueba.req', :'req_id', true);
select set_config('prueba.f1', gen_random_uuid()::text, true);
select set_config('prueba.f2', gen_random_uuid()::text, true);
select set_config('prueba.f3', gen_random_uuid()::text, true);
select set_config('prueba.f1_ruta', current_setting('prueba.f1') || '/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.f2_ruta', current_setting('prueba.f2') || '/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.f3_ruta', current_setting('prueba.f3') || '/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);

-- ------------------------------------------- Administración envía a Contabilidad
do $$
declare v uuid; v2 uuid;
begin
  -- Ventas no envía.
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.enviar_cotizacion_a_contabilidad(%L)', current_setting('prueba.cot1')),
    'Ventas no envía la cotización a Contabilidad', 'cotizaciones.enviar_contabilidad');
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.enviar_cotizacion_a_contabilidad(%L)', current_setting('prueba.cot2')),
    'sin OT no va a Contabilidad', 'Primero emite la OT');
  perform test.afirmar((select por_enviar_contabilidad from public.finanzas_pendientes()) >= 1,
    'el tablero de Administración cuenta la cotización con OT por enviar');
  v := public.enviar_cotizacion_a_contabilidad(current_setting('prueba.cot1')::uuid);
  v2 := public.enviar_cotizacion_a_contabilidad(current_setting('prueba.cot1')::uuid);
  perform test.afirmar(v = v2, 'un segundo toque no envía otra');
  perform test.afirmar((select orden_id from public.cotizaciones_envios_contabilidad where id = v) = current_setting('prueba.ot1')::uuid,
    'el envío lleva la OT de la cotización');
  perform test.debe_fallar(format('delete from public.cotizaciones_envios_contabilidad where id = %L', v),
    'Administración no borra el envío', 'permission denied');
  reset role;

  perform test.afirmar(exists (select 1 from public.notificaciones n
                                where n.usuario_id = current_setting('prueba.conta')::uuid and n.origen_id = v),
    'a Contabilidad le llega el aviso');
end $$;

-- -------------------------------------------------- Contabilidad ve lo que factura
do $$
declare r record;
begin
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  select * into r from public.facturacion_bandeja() where cotizacion_id = current_setting('prueba.cot1')::uuid;
  perform test.afirmar(r.numero = 'QA-345-1' and r.orden_numero = 'QA-OT-345' and r.monto_venta = 50000 and r.moneda = 'USD',
    'la bandeja trae la cotización con su OT y su total');
  perform test.afirmar(r.cliente_documento = 'RUC 20990000345' and r.cliente_direccion like 'Av. de Prueba 345, Trujillo%',
    'con el RUC y la dirección fiscal del cliente');
  perform test.afirmar(r.archivo_ruta = 'cot/' || current_setting('prueba.cot1') || '/qa-345-1.pdf', 'y el archivo aprobado');
  perform test.afirmar((select count(*) from public.facturacion_bandeja()
                         where cotizacion_id = current_setting('prueba.cot2')::uuid) = 0, 'la que no se envió no está');
  perform test.afirmar((select count(*) from storage.objects
                         where bucket_id = 'cotizaciones-pdf' and name = r.archivo_ruta) = 1,
    'Contabilidad abre el PDF de la cotización que le enviaron');
  perform test.afirmar((select por_facturar from public.finanzas_pendientes()) >= 1, 'su tablero la cuenta por facturar');
  -- El kardex, en lectura.
  perform test.afirmar(public.tiene_permiso('almacen.ver'), 'Contabilidad tiene el kardex en lectura');
  perform count(*) from public.v_kardex_almacen;
  perform test.afirmar(not public.tiene_permiso('almacen.recibir') and not public.tiene_permiso('almacen.despachar'),
    'y no registra ingresos ni salidas');
  reset role;

  perform test.como_usuario(current_setting('prueba.teso')::uuid);
  set local role authenticated;
  perform test.debe_fallar('select * from public.facturacion_bandeja()', 'Tesorería no abre la bandeja de facturación', 'Contabilidad');
  perform test.afirmar((select count(*) from storage.objects
                         where bucket_id = 'cotizaciones-pdf' and name = 'cot/' || current_setting('prueba.cot1') || '/qa-345-1.pdf') = 0,
    'Tesorería no abre el PDF de la cotización');
  reset role;

  perform test.como_usuario(current_setting('prueba.req')::uuid);
  set local role authenticated;
  perform test.debe_fallar('select * from public.facturacion_bandeja()', 'Requerimientos tampoco', 'Contabilidad');
  perform test.afirmar((select por_facturar from public.finanzas_pendientes()) is null, 'ni ve el pendiente');
  reset role;
end $$;

-- -------------------------------------------------- Contabilidad anexa la factura
do $$
declare v uuid;
begin
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('facturas-venta', current_setting('prueba.f1_ruta'), current_setting('prueba.conta'), '{"mimetype": "application/pdf", "size": 2048}'),
    ('facturas-venta', current_setting('prueba.f2_ruta'), current_setting('prueba.conta'), '{"mimetype": "application/pdf", "size": 2048}'),
    ('facturas-venta', current_setting('prueba.f3_ruta'), current_setting('prueba.conta'), '{"mimetype": "application/pdf", "size": 2048}');

  perform test.debe_fallar(format('select public.anexar_factura_venta(%L, %L, %L, %L, %L, %L, %s, null, %L, null)',
      current_setting('prueba.f1'), current_setting('prueba.cot1'), 'factura 626', current_setting('prueba.hoy'),
      current_setting('prueba.hoy'), 'USD', 29500, current_setting('prueba.f1_ruta')),
    'el número va como en SUNAT', 'E001-626');
  perform test.debe_fallar(format('select public.anexar_factura_venta(%L, %L, %L, %L, %L, %L, %s, null, %L, null)',
      current_setting('prueba.f1'), current_setting('prueba.cot1'), 'E001-626', (current_setting('prueba.hoy')::date + 1)::text,
      (current_setting('prueba.hoy')::date + 30)::text, 'USD', 29500, current_setting('prueba.f1_ruta')),
    'la emisión no es mañana', 'de hoy hacia atrás');
  perform test.debe_fallar(format('select public.anexar_factura_venta(%L, %L, %L, %L, %L, %L, %s, null, %L, null)',
      current_setting('prueba.f1'), current_setting('prueba.cot2'), 'E001-626', current_setting('prueba.hoy'),
      current_setting('prueba.hoy'), 'PEN', 100, current_setting('prueba.f1_ruta')),
    'la cotización que no se envió no se factura', 'no se envió a Contabilidad');
  perform test.debe_fallar(format('select public.anexar_factura_venta(%L, %L, %L, %L, %L, %L, %s, null, %L, null)',
      current_setting('prueba.f1'), current_setting('prueba.cot1'), 'E001-626', current_setting('prueba.hoy'),
      current_setting('prueba.hoy'), 'USD', 29500, current_setting('prueba.f2_ruta')),
    'el PDF va en la carpeta de su factura', 'Vuelve a adjuntar');

  v := public.anexar_factura_venta(current_setting('prueba.f1')::uuid, current_setting('prueba.cot1')::uuid, ' e001-00000626 ',
         current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date + 30, 'USD', 29500, 'Inicial 50 %',
         current_setting('prueba.f1_ruta'), 'E001-626.pdf');
  perform test.afirmar((select numero from public.facturas_venta where id = v) = 'E001-626', 'el número queda como E001-626');
  perform test.afirmar((select cliente from public.facturas_venta where id = v) = 'QA CLIENTE FACTURA', 'con el cliente de la cotización');
  perform test.afirmar(public.anexar_factura_venta(current_setting('prueba.f1')::uuid, current_setting('prueba.cot1')::uuid, 'E001-626',
         current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date + 30, 'USD', 29500, null,
         current_setting('prueba.f1_ruta'), null) = v, 'un reintento no anexa otra');
  perform test.debe_fallar(format('select public.anexar_factura_venta(%L, %L, %L, %L, %L, %L, %s, null, %L, null)',
      current_setting('prueba.f2'), current_setting('prueba.cot1'), 'E001-0626', current_setting('prueba.hoy'),
      current_setting('prueba.hoy'), 'USD', 100, current_setting('prueba.f2_ruta')),
    'el mismo número no se anexa dos veces', 'ya está anexada');
  perform test.debe_fallar(format('update public.facturas_venta set total = 1 where id = %L', v),
    'Contabilidad no corrige la factura por debajo', 'permission denied');
  perform test.afirmar((select facturas_por_enviar from public.finanzas_pendientes()) >= 1, 'su tablero la cuenta por enviar');
  reset role;

  -- Mientras no se envía, Tesorería no la ve.
  perform test.como_usuario(current_setting('prueba.teso')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.facturas_venta where id = current_setting('prueba.f1')::uuid) = 0,
    'Tesorería no ve la factura anexada sin enviar');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'facturas-venta' and name = current_setting('prueba.f1_ruta')) = 0,
    'ni su PDF');
  perform test.debe_fallar(format('select public.enviar_factura_a_tesoreria(%L)', current_setting('prueba.f1')),
    'Tesorería no se la envía a sí misma', 'contabilidad.facturar');
  perform test.debe_fallar(format('insert into storage.objects (bucket_id, name, owner_id, metadata) values (''facturas-venta'', %L, %L, ''{}'')',
      current_setting('prueba.f1') || '/otro.pdf', current_setting('prueba.teso')),
    'Tesorería no sube facturas', 'row-level security');
  reset role;
end $$;

-- ------------------------------------- La envía a Tesorería: nace la cuenta por cobrar
do $$
declare v_cuenta uuid;
begin
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  perform public.enviar_factura_a_tesoreria(current_setting('prueba.f1')::uuid);
  perform test.afirmar(public.enviar_factura_a_tesoreria(current_setting('prueba.f1')::uuid) = current_setting('prueba.f1')::uuid,
    'un segundo envío no duplica');
  perform test.afirmar((select estado from public.facturas_venta where id = current_setting('prueba.f1')::uuid) = 'ENVIADA', 'queda enviada');
  reset role;

  perform test.afirmar(exists (select 1 from public.notificaciones n
                                where n.usuario_id = current_setting('prueba.teso')::uuid and n.origen_id = current_setting('prueba.f1')::uuid),
    'a Tesorería le llega el aviso');

  perform test.como_usuario(current_setting('prueba.teso')::uuid);
  set local role authenticated;
  select id into v_cuenta from public.v_cuentas_cobrar_ot where factura_venta_id = current_setting('prueba.f1')::uuid;
  perform test.afirmar(v_cuenta is not null, 'Tesorería ve la cuenta por cobrar');
  perform test.afirmar((select saldo from public.v_cuentas_cobrar_ot where id = v_cuenta) = 29500
                       and (select cliente from public.v_cuentas_cobrar_ot where id = v_cuenta) = 'QA CLIENTE FACTURA'
                       and (select cotizacion_numero from public.v_cuentas_cobrar_ot where id = v_cuenta) = 'QA-345-1'
                       and (select numero_ot from public.v_cuentas_cobrar_ot where id = v_cuenta) = 'QA-OT-345',
    'con su saldo, el cliente, la cotización y la OT');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'facturas-venta' and name = current_setting('prueba.f1_ruta')) = 1,
    'y abre el PDF de la factura');
  perform test.debe_fallar(format('insert into public.cuentas_cobrar_ot (orden_id, numero_documento, fecha_emision, fecha_vencimiento, moneda, total) values (%L, ''E001-999'', current_setting(''prueba.hoy'')::date, current_setting(''prueba.hoy'')::date, ''PEN'', 10)',
      current_setting('prueba.ot1')),
    'Tesorería ya no anota facturas a mano', 'permission denied');
  insert into public.cobros_ot (cuenta_id, fecha, monto, referencia) values (v_cuenta, current_setting('prueba.hoy')::date, 10000, 'OP-QA-345-1');
  perform test.afirmar((select saldo from public.v_cuentas_cobrar_ot where id = v_cuenta) = 19500, 'el cobro baja el saldo');
  reset role;

  -- Con cobros, Contabilidad ya no la anula.
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.anular_factura_venta(%L, ''Se emitió con el monto equivocado.'')', current_setting('prueba.f1')),
    'una factura con cobros no se anula', 'ya registró cobros');
  reset role;
end $$;

-- --------------------- Una factura enviada y anulada: su cuenta se va y su número queda libre
do $$
declare v_cuenta uuid;
begin
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  perform public.anexar_factura_venta(current_setting('prueba.f2')::uuid, current_setting('prueba.cot1')::uuid, 'E001-627',
         current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'USD', 100, 'Saldo',
         current_setting('prueba.f2_ruta'), null);
  perform public.enviar_factura_a_tesoreria(current_setting('prueba.f2')::uuid);
  select id into v_cuenta from public.cuentas_cobrar_ot where factura_venta_id = current_setting('prueba.f2')::uuid;
  perform test.debe_fallar(format('select public.anular_factura_venta(%L, ''corto'')', current_setting('prueba.f2')),
    'anular pide el motivo', '10 a 500');
  perform public.anular_factura_venta(current_setting('prueba.f2')::uuid, 'El monto no era el de la factura en SUNAT.');
  perform test.afirmar((select estado from public.facturas_venta where id = current_setting('prueba.f2')::uuid) = 'ANULADA', 'queda anulada');
  perform test.debe_fallar(format('select public.enviar_factura_a_tesoreria(%L)', current_setting('prueba.f2')),
    'la anulada no se vuelve a enviar', 'está anulada');
  -- El mismo número, bien anexado.
  perform public.anexar_factura_venta(current_setting('prueba.f3')::uuid, current_setting('prueba.cot1')::uuid, 'E001-627',
         current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date + 15, 'USD', 29500, 'Saldo',
         current_setting('prueba.f3_ruta'), null);
  perform public.enviar_factura_a_tesoreria(current_setting('prueba.f3')::uuid);
  reset role;

  perform test.como_usuario(current_setting('prueba.teso')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.v_cuentas_cobrar_ot where id = v_cuenta) = 0,
    'la cuenta de la factura anulada deja de salir');
  perform test.afirmar((select count(*) from public.v_cuentas_cobrar_ot where factura_venta_id = current_setting('prueba.f3')::uuid) = 1,
    'la factura corregida entra con el mismo número');
  perform test.debe_fallar(format('insert into public.cobros_ot (cuenta_id, fecha, monto, referencia) values (%L, current_setting(''prueba.hoy'')::date, 50, ''OP-QA-345-2'')', v_cuenta),
    'la factura anulada ya no se cobra', 'anulada');
  reset role;

  perform test.afirmar(exists (select 1 from public.notificaciones n
                                where n.usuario_id = current_setting('prueba.teso')::uuid and n.titulo = 'Factura anulada: E001-627'),
    'a Tesorería le avisan de la anulación');

  -- Administración ve en qué quedó su cotización; Ventas, el envío.
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.facturas_venta where cotizacion_pdf_id = current_setting('prueba.cot1')::uuid) = 3,
    'Administración ve las facturas enviadas de su cotización');
  reset role;
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.cotizaciones_envios_contabilidad where cotizacion_pdf_id = current_setting('prueba.cot1')::uuid) = 1,
    'Ventas ve que se envió a Contabilidad');
  perform test.afirmar((select count(*) from public.facturas_venta) = 0, 'pero no las facturas');
  reset role;
end $$;

-- ------------------------------------------------------- Tesorería paga un servicio
insert into public.proveedores (id, numero_documento, razon_social) values (gen_random_uuid(), '20100047218', 'PROVEEDOR DE PRUEBA')
on conflict (tipo_documento, numero_documento) do update set activo = true;
select gen_random_uuid() as os_id \gset
insert into public.ordenes_servicio (id, numero, proveedor_id, proveedor, orden_id, descripcion, moneda, monto,
                                     aprobacion, aprobado_por, aprobado_en, estado, iniciado_en, conformidad_por, conformidad_en, creado_por)
select :'os_id', 'OS-QA-345', p.id, p.razon_social, :'ot1', 'Arenado de la tolva de prueba', 'PEN', 1000,
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
  reset role;

  perform test.como_usuario(current_setting('prueba.teso')::uuid);
  set local role authenticated;
  select * into r from public.servicios_por_pagar() where id = current_setting('prueba.os')::uuid;
  perform test.afirmar(r.numero = 'OS-QA-345' and r.pagado = 0 and not r.cancelada and r.orden = 'QA-OT-345',
    'Tesorería ve la OS conforme por pagar');
  perform test.afirmar((select servicios_por_pagar from public.finanzas_pendientes()) >= 1, 'su tablero la cuenta');
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('pagos-servicio', current_setting('prueba.os') || '/' || current_setting('prueba.p1') || '.pdf', current_setting('prueba.teso'), '{"mimetype": "application/pdf", "size": 900}'),
    ('pagos-servicio', current_setting('prueba.os') || '/' || current_setting('prueba.p2') || '.jpg', current_setting('prueba.teso'), '{"mimetype": "image/jpeg", "size": 900}'),
    ('pagos-servicio', current_setting('prueba.os') || '/' || current_setting('prueba.p3') || '.pdf', current_setting('prueba.teso'), '{"mimetype": "application/pdf", "size": 900}');
  perform public.registrar_pago_servicio(current_setting('prueba.p1')::uuid, current_setting('prueba.os')::uuid, current_setting('prueba.hoy')::date, 590, false,
    'OP-1', 'E001-45', current_setting('prueba.os') || '/' || current_setting('prueba.p1') || '.pdf');
  select * into r from public.servicios_por_pagar() where id = current_setting('prueba.os')::uuid;
  perform test.afirmar(r.pagado = 590 and not r.cancelada, 'un pago a cuenta no la cancela');
  perform public.registrar_pago_servicio(current_setting('prueba.p2')::uuid, current_setting('prueba.os')::uuid, current_setting('prueba.hoy')::date, 590, true,
    'OP-2', 'E001-45', current_setting('prueba.os') || '/' || current_setting('prueba.p2') || '.jpg');
  select * into r from public.servicios_por_pagar() where id = current_setting('prueba.os')::uuid;
  perform test.afirmar(r.pagado = 1180 and r.cancelada, 'el pago que la cancela la deja pagada');
  perform test.debe_fallar(format('select public.registrar_pago_servicio(%L, %L, current_setting(''prueba.hoy'')::date, 10, true, null, null, %L)',
      current_setting('prueba.p3'), current_setting('prueba.os'), current_setting('prueba.os') || '/' || current_setting('prueba.p3') || '.pdf'),
    'la OS cancelada no se paga de nuevo', 'ya está cancelada');
  perform test.debe_fallar(format('select public.anular_pago_servicio(%L, ''corto'')', current_setting('prueba.p2')),
    'anular el pago pide motivo', '10 a 500');
  perform public.anular_pago_servicio(current_setting('prueba.p2')::uuid, 'Se registró con el voucher de otro pago.');
  select * into r from public.servicios_por_pagar() where id = current_setting('prueba.os')::uuid;
  perform test.afirmar(r.pagado = 590 and not r.cancelada, 'anulado el pago, la OS vuelve a quedar por pagar');
  perform test.debe_fallar(format('delete from public.pagos_orden_servicio where id = %L', current_setting('prueba.p1')),
    'un pago no se borra', 'permission denied');
  reset role;

  perform test.como_usuario(current_setting('prueba.compras')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.registrar_pago_servicio(%L, %L, current_setting(''prueba.hoy'')::date, 10, true, null, null, %L)',
      current_setting('prueba.p3'), current_setting('prueba.os'), current_setting('prueba.os') || '/' || current_setting('prueba.p3') || '.pdf'),
    'Logística no registra pagos', 'tesoreria.pagar_servicios');
  perform test.afirmar((select count(*) from public.pagos_orden_servicio where orden_servicio_id = current_setting('prueba.os')::uuid) = 2,
    'pero ve que se pagó');
  reset role;
end $$;

-- Nada de esto lo puede anon.
do $$ begin
  perform test.afirmar(not has_function_privilege('anon', 'public.enviar_cotizacion_a_contabilidad(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.anexar_factura_venta(uuid, uuid, text, date, date, text, numeric, text, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.enviar_factura_a_tesoreria(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.registrar_pago_servicio(uuid, uuid, date, numeric, boolean, text, text, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.archivo_subido_por_mi(text, text, uuid, text[])', 'execute')
    and not has_table_privilege('anon', 'public.facturas_venta', 'select'),
    'anon no entra a nada de la facturación');
end $$;

rollback;
