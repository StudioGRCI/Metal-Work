-- La factura de venta y su cobro cuelgan del código interno (2026-10-15).
-- Gerencia aprueba la cotización con el código interno de la unidad y su OT
-- (migración 20261016900000); Contabilidad ve la cotización aprobada y registra la factura con
-- su PDF; la factura entra sola a cuentas por cobrar; Tesorería registra cada
-- cobro con su voucher. Ni la factura ni el cobro se borran: se anulan.
-- Cada paso con la cuenta del área que lo hace; ADMIN solo arma la aprobada
-- de antes que quedó sin OT.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000057', 'PRUEBAS FACTURACION S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA57', 'Taller prueba de facturación') on conflict (codigo) do nothing;

select test.crear_usuario('Olga', 'Oficina', 'oficina357@demo.pe', 'ADMINISTRACION', (select id from public.sedes where codigo = 'QA57')) as oficina_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia357@demo.pe', 'GERENTE', (select id from public.sedes where codigo = 'QA57')) as gerente_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas357@demo.pe', 'VENDEDOR', (select id from public.sedes where codigo = 'QA57')) as vendedor_id \gset
select test.crear_usuario('Coni', 'Contable', 'contabilidad357@demo.pe', 'CONTABILIDAD', (select id from public.sedes where codigo = 'QA57')) as conta_id \gset
select test.crear_usuario('Teo', 'Tesoro', 'tesoreria357@demo.pe', 'TESORERIA', (select id from public.sedes where codigo = 'QA57')) as teso_id \gset
select test.crear_usuario('Lalo', 'Logística', 'logistica357@demo.pe', 'COMPRADOR', (select id from public.sedes where codigo = 'QA57')) as compras_id \gset
select test.crear_usuario('Rita', 'Requerimientos', 'req357@demo.pe', 'REQUERIMIENTOS', (select id from public.sedes where codigo = 'QA57')) as req_id \gset
select test.crear_usuario('Gino', 'General', 'general357@demo.pe', 'SUPERVISOR_GENERAL', (select id from public.sedes where codigo = 'QA57')) as general_id \gset
select test.crear_usuario('Dina', 'Diseño', 'diseno357@demo.pe', 'DISENO', (select id from public.sedes where codigo = 'QA57')) as diseno_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social, direccion_fiscal, distrito)
values ('RUC', '20990000357', 'QA CLIENTE FACTURA', 'Av. de Prueba 357', 'Trujillo');
select id as cliente_id from public.clientes where numero_documento = '20990000357' \gset
select id as carroceria_id from public.tipos_carroceria where activo order by orden_secuencia limit 1 \gset
select gen_random_uuid() as cot1 \gset
select gen_random_uuid() as cot2 \gset
select gen_random_uuid() as cot3 \gset
select gen_random_uuid() as ot1 \gset

-- Tres cotizaciones de Ventas: la primera la aprueba Gerencia con su código y
-- su OT; la segunda es una aprobada de antes, sin OT ni código.
insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, estado, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
values (:'cot1', 'QA-357-1', :'cliente_id', :'carroceria_id', 'POR_REVISAR', 'qa-357-1.pdf', 'cot/' || :'cot1' || '/qa-357-1.pdf', 'application/pdf', 120, :'vendedor_id', 50000, 'USD'),
       (:'cot2', 'QA-357-2', :'cliente_id', :'carroceria_id', 'POR_REVISAR', 'qa-357-2.pdf', 'cot/' || :'cot2' || '/qa-357-2.pdf', 'application/pdf', 120, :'vendedor_id', 20000, 'PEN'),
       (:'cot3', 'QA-357-3', :'cliente_id', :'carroceria_id', 'POR_REVISAR', 'qa-357-3.pdf', 'cot/' || :'cot3' || '/qa-357-3.pdf', 'application/pdf', 120, :'vendedor_id', 9000, 'PEN');
select test.crear_usuario('Ada', 'Admin', 'admin357@demo.pe', 'ADMIN', (select id from public.sedes where codigo = 'QA57')) as admin_id \gset
select test.como_usuario(:'admin_id');
update public.cotizaciones_pdf set estado = 'APROBADA' where id = :'cot2';

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('cotizaciones-pdf', 'cot/' || :'cot1' || '/qa-357-1.pdf', :'vendedor_id', '{"mimetype": "application/pdf", "size": 120}'),
  ('cotizaciones-pdf', 'cot/' || :'cot3' || '/qa-357-3.pdf', :'vendedor_id', '{"mimetype": "application/pdf", "size": 120}');

-- Gerencia aprueba la primera con el código interno de la unidad y su OT.
select test.como_usuario(:'gerente_id');
set local role authenticated;
select public.aprobar_cotizacion_con_ot(:'cot1', :'ot1', 'qa-ci 357', '9357', 'SEMIRREMOLQUE',
                                        ((now() at time zone 'America/Lima')::date + 30),
                                        'ot/' || :'ot1' || '/orden.pdf', 'orden.pdf', 100);
reset role;

select set_config('prueba.cot1', :'cot1', true);
select set_config('prueba.cot2', :'cot2', true);
select set_config('prueba.cot3', :'cot3', true);
select set_config('prueba.oficina', :'oficina_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.conta', :'conta_id', true);
select set_config('prueba.teso', :'teso_id', true);
select set_config('prueba.caja', test.crear_caja('USD')::text, true);  -- desde la 20261019100000 todo cobro pide su cuenta; las facturas son en dólares
select set_config('prueba.compras', :'compras_id', true);
select set_config('prueba.req', :'req_id', true);
select set_config('prueba.general', :'general_id', true);
select set_config('prueba.diseno', :'diseno_id', true);
select set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
select set_config('prueba.f1', gen_random_uuid()::text, true);
select set_config('prueba.f2', gen_random_uuid()::text, true);
select set_config('prueba.f3', gen_random_uuid()::text, true);
select set_config('prueba.f1_ruta', current_setting('prueba.f1') || '/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.f2_ruta', current_setting('prueba.f2') || '/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.f3_ruta', current_setting('prueba.f3') || '/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.c1', gen_random_uuid()::text, true);
select set_config('prueba.c2', gen_random_uuid()::text, true);
select set_config('prueba.c3', gen_random_uuid()::text, true);
select set_config('prueba.c1_ruta', current_setting('prueba.f1') || '/' || gen_random_uuid() || '.jpg', true);
select set_config('prueba.c2_ruta', current_setting('prueba.f1') || '/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.c3_ruta', current_setting('prueba.f1') || '/' || gen_random_uuid() || '.pdf', true);

-- ------------------------------------------------ Contabilidad ve lo que factura
do $$
declare r record;
begin
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  select * into r from public.cotizaciones_para_facturar() where cotizacion_id = current_setting('prueba.cot1')::uuid;
  perform test.afirmar(r.numero = 'QA-357-1' and r.codigo_interno = 'QA-CI 357' and r.monto_venta = 50000 and r.moneda = 'USD',
    'Facturación trae la cotización aprobada con su código interno y su total');
  perform test.afirmar(r.cliente_documento = 'RUC 20990000357' and r.cliente_direccion like 'Av. de Prueba 357, Trujillo%',
    'con el RUC y la dirección fiscal del cliente');
  perform test.afirmar(r.archivo_ruta = 'cot/' || current_setting('prueba.cot1') || '/qa-357-1.pdf' and r.facturas = 0,
    'y el archivo aprobado, sin facturas todavía');
  select * into r from public.cotizaciones_para_facturar() where cotizacion_id = current_setting('prueba.cot2')::uuid;
  perform test.afirmar(r.numero = 'QA-357-2' and r.codigo_interno is null, 'la aprobada sin OT sale sin código interno');
  perform test.afirmar((select count(*) from public.cotizaciones_para_facturar()
                         where cotizacion_id = current_setting('prueba.cot3')::uuid) = 0, 'la que Gerencia no aprobó no sale');
  perform test.afirmar((select count(*) from public.cotizaciones_pdf
                         where id in (current_setting('prueba.cot1')::uuid, current_setting('prueba.cot2')::uuid)) = 2
    and (select count(*) from public.cotizaciones_pdf where id = current_setting('prueba.cot3')::uuid) = 0,
    'Contabilidad ve las cotizaciones aprobadas y no las demás');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'cotizaciones-pdf'
                         and name = 'cot/' || current_setting('prueba.cot1') || '/qa-357-1.pdf') = 1
    and (select count(*) from storage.objects where bucket_id = 'cotizaciones-pdf'
          and name = 'cot/' || current_setting('prueba.cot3') || '/qa-357-3.pdf') = 0,
    'y abre el PDF de la aprobada, no el de la otra');
  perform test.afirmar((select por_facturar from public.facturacion_pendientes()) >= 1
    and (select por_cobrar from public.facturacion_pendientes()) is null, 'su tablero la cuenta por facturar');
  reset role;
end $$;

-- ------------------------------------------------ Contabilidad registra la factura
do $$
declare v uuid;
begin
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('facturas-venta', current_setting('prueba.f1_ruta'), current_setting('prueba.conta'), '{"mimetype": "application/pdf", "size": 900}'),
    ('facturas-venta', current_setting('prueba.f2_ruta'), current_setting('prueba.conta'), '{"mimetype": "application/pdf", "size": 900}'),
    ('facturas-venta', current_setting('prueba.f3_ruta'), current_setting('prueba.conta'), '{"mimetype": "application/pdf", "size": 900}');
  perform test.debe_fallar(format('select public.registrar_factura_venta(%L, %L, ''E001-700'', current_setting(''prueba.hoy'')::date, current_setting(''prueba.hoy'')::date, ''PEN'', 100, null, %L, ''f.pdf'')',
      current_setting('prueba.f2'), current_setting('prueba.cot2'), current_setting('prueba.f2_ruta')),
    'sin código interno no se factura', 'todavía no tiene código interno');
  perform test.debe_fallar(format('select public.registrar_factura_venta(%L, %L, ''E001-700'', current_setting(''prueba.hoy'')::date, current_setting(''prueba.hoy'')::date, ''PEN'', 100, null, %L, ''f.pdf'')',
      current_setting('prueba.f2'), current_setting('prueba.cot3'), current_setting('prueba.f2_ruta')),
    'la cotización sin aprobar no se factura', 'no está aprobada');
  perform test.debe_fallar(format('select public.registrar_factura_venta(%L, %L, ''626'', current_setting(''prueba.hoy'')::date, current_setting(''prueba.hoy'')::date, ''USD'', 100, null, %L, ''f.pdf'')',
      current_setting('prueba.f1'), current_setting('prueba.cot1'), current_setting('prueba.f1_ruta')),
    'el número va como en SUNAT', 'la serie, un guion');
  perform test.debe_fallar(format('select public.registrar_factura_venta(%L, %L, ''E001-626'', current_setting(''prueba.hoy'')::date + 1, current_setting(''prueba.hoy'')::date + 1, ''USD'', 100, null, %L, ''f.pdf'')',
      current_setting('prueba.f1'), current_setting('prueba.cot1'), current_setting('prueba.f1_ruta')),
    'la factura no es de mañana', 'de hoy hacia atrás');
  perform test.debe_fallar(format('select public.registrar_factura_venta(%L, %L, ''E001-626'', current_setting(''prueba.hoy'')::date, current_setting(''prueba.hoy'')::date, ''USD'', 100, null, %L, ''f.pdf'')',
      current_setting('prueba.f1'), current_setting('prueba.cot1'), current_setting('prueba.f2_ruta')),
    'el PDF va en la carpeta de su factura', 'Vuelve a adjuntar');

  v := public.registrar_factura_venta(current_setting('prueba.f1')::uuid, current_setting('prueba.cot1')::uuid, 'e001-00000626',
         current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date + 30, 'USD', 29500, 'Inicial 50 %',
         current_setting('prueba.f1_ruta'), 'E001-626.pdf');
  perform test.afirmar(public.registrar_factura_venta(current_setting('prueba.f1')::uuid, current_setting('prueba.cot1')::uuid, 'E001-626',
         current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date + 30, 'USD', 29500, 'Inicial 50 %',
         current_setting('prueba.f1_ruta'), 'E001-626.pdf') = v, 'un reintento no registra otra');
  perform test.afirmar((select numero = 'E001-626' and codigo_interno = 'QA-CI 357' and cliente = 'QA CLIENTE FACTURA'
                          and cotizacion_numero = 'QA-357-1' from public.facturas_venta where id = v),
    'la factura queda colgada del código interno y de la cotización');
  perform test.debe_fallar(format('select public.registrar_factura_venta(%L, %L, ''E001-626'', current_setting(''prueba.hoy'')::date, current_setting(''prueba.hoy'')::date, ''USD'', 100, null, %L, ''f.pdf'')',
      current_setting('prueba.f2'), current_setting('prueba.cot1'), current_setting('prueba.f2_ruta')),
    'un número de factura vale una vez', 'ya está registrada en el código QA-CI 357');
  perform test.debe_fallar(format('update public.facturas_venta set total = 1 where id = %L', v), 'la factura no se corrige por debajo', 'permission denied');
  perform test.debe_fallar(format('delete from public.facturas_venta where id = %L', v), 'ni se borra', 'permission denied');
  reset role;

  perform test.afirmar(exists (select 1 from public.notificaciones n
                                where n.usuario_id = current_setting('prueba.teso')::uuid and n.origen_id = v),
    'a Tesorería le llega el aviso de la factura por cobrar');
end $$;

-- ------------------------------------------------ Tesorería cobra con su voucher
do $$
declare r record;
begin
  perform test.como_usuario(current_setting('prueba.teso')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.cotizaciones_pdf where id = current_setting('prueba.cot1')::uuid) = 1
    and (select count(*) from public.cotizaciones_pdf where id = current_setting('prueba.cot3')::uuid) = 0,
    'Tesorería ve la cotización aprobada, no la que falta aprobar');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'cotizaciones-pdf'
                         and name = 'cot/' || current_setting('prueba.cot1') || '/qa-357-1.pdf') = 1, 'y abre su PDF');
  select * into r from public.v_facturas_venta where id = current_setting('prueba.f1')::uuid;
  perform test.afirmar(r.saldo = 29500 and not r.cancelada and r.codigo_interno = 'QA-CI 357', 'la factura le llegó por cobrar');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'facturas-venta'
                         and name = current_setting('prueba.f1_ruta')) = 1, 'y abre el PDF de la factura');
  perform test.afirmar((select por_cobrar from public.facturacion_pendientes()) >= 1
    and (select por_facturar from public.facturacion_pendientes()) is null, 'su tablero la cuenta por cobrar');
  perform test.debe_fallar(format('select public.registrar_factura_venta(%L, %L, ''E001-701'', current_setting(''prueba.hoy'')::date, current_setting(''prueba.hoy'')::date, ''USD'', 100, null, %L, ''f.pdf'')',
      current_setting('prueba.f2'), current_setting('prueba.cot1'), current_setting('prueba.f2_ruta')),
    'Tesorería no registra facturas', 'contabilidad.facturar');

  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('cobros-venta', current_setting('prueba.c1_ruta'), current_setting('prueba.teso'), '{"mimetype": "image/jpeg", "size": 900}'),
    ('cobros-venta', current_setting('prueba.c2_ruta'), current_setting('prueba.teso'), '{"mimetype": "application/pdf", "size": 900}'),
    ('cobros-venta', current_setting('prueba.c3_ruta'), current_setting('prueba.teso'), '{"mimetype": "application/pdf", "size": 900}');
  perform test.debe_fallar(format('select public.registrar_cobro_factura(%L, %L, current_setting(''prueba.hoy'')::date, 29500.01, false, null, %L, current_setting(''prueba.caja'')::uuid, null)',
      current_setting('prueba.c1'), current_setting('prueba.f1'), current_setting('prueba.c1_ruta')),
    'no se cobra más que la factura', 'pasaría de su total');
  perform test.debe_fallar(format('select public.registrar_cobro_factura(%L, %L, current_setting(''prueba.hoy'')::date + 1, 100, false, null, %L, current_setting(''prueba.caja'')::uuid, null)',
      current_setting('prueba.c1'), current_setting('prueba.f1'), current_setting('prueba.c1_ruta')),
    'el cobro no es de mañana', 'de hoy hacia atrás');
  perform test.debe_fallar(format('select public.registrar_cobro_factura(%L, %L, current_setting(''prueba.hoy'')::date, 100, false, null, %L, current_setting(''prueba.caja'')::uuid, null)',
      current_setting('prueba.c1'), current_setting('prueba.f1'), gen_random_uuid() || '/' || gen_random_uuid() || '.jpg'),
    'el voucher va en la carpeta de su factura', 'Vuelve a adjuntar');
  perform public.registrar_cobro_factura(current_setting('prueba.c1')::uuid, current_setting('prueba.f1')::uuid,
    current_setting('prueba.hoy')::date, 10000, false, 'OP-357-1', current_setting('prueba.c1_ruta'), current_setting('prueba.caja')::uuid, null);
  perform test.afirmar(public.registrar_cobro_factura(current_setting('prueba.c1')::uuid, current_setting('prueba.f1')::uuid,
    current_setting('prueba.hoy')::date, 10000, false, 'OP-357-1', current_setting('prueba.c1_ruta'), current_setting('prueba.caja')::uuid, null) = current_setting('prueba.c1')::uuid,
    'un reintento no registra otro cobro');
  select * into r from public.v_facturas_venta where id = current_setting('prueba.f1')::uuid;
  perform test.afirmar(r.cobrado = 10000 and r.saldo = 19500 and not r.cancelada, 'un cobro a cuenta baja el saldo');
  reset role;

  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.anular_factura_venta(%L, ''Se registró con el total equivocado.'')', current_setting('prueba.f1')),
    'la factura con cobros no se anula', 'ya registró cobros');
  perform test.afirmar((select count(*) from public.cobros_factura_venta where factura_id = current_setting('prueba.f1')::uuid) = 1
    and (select count(*) from storage.objects where bucket_id = 'cobros-venta' and name = current_setting('prueba.c1_ruta')) = 1,
    'Contabilidad ve el cobro y su voucher');
  reset role;
  perform test.afirmar(exists (select 1 from public.notificaciones n
                                where n.usuario_id = current_setting('prueba.conta')::uuid and n.origen_id = current_setting('prueba.c1')::uuid),
    'a Contabilidad le llega el aviso del cobro');

  perform test.como_usuario(current_setting('prueba.teso')::uuid);
  set local role authenticated;
  -- La detracción: lo cobrado no llega al total y Tesorería la da por cancelada.
  perform public.registrar_cobro_factura(current_setting('prueba.c2')::uuid, current_setting('prueba.f1')::uuid,
    current_setting('prueba.hoy')::date, 16550, true, 'OP-357-2', current_setting('prueba.c2_ruta'), current_setting('prueba.caja')::uuid, null);
  select * into r from public.v_facturas_venta where id = current_setting('prueba.f1')::uuid;
  perform test.afirmar(r.cobrado = 26550 and r.saldo = 0 and r.cancelada, 'el cobro que la cancela la deja cobrada');
  perform test.debe_fallar(format('select public.registrar_cobro_factura(%L, %L, current_setting(''prueba.hoy'')::date, 10, false, null, %L, current_setting(''prueba.caja'')::uuid, null)',
      current_setting('prueba.c3'), current_setting('prueba.f1'), current_setting('prueba.c3_ruta')),
    'la factura cobrada no se cobra otra vez', 'ya está cobrada');
  perform test.debe_fallar(format('select public.anular_cobro_factura(%L, ''corto'')', current_setting('prueba.c2')),
    'anular el cobro pide motivo', '10 a 500');
  perform public.anular_cobro_factura(current_setting('prueba.c2')::uuid, 'Se registró con el voucher de otro cliente.');
  select * into r from public.v_facturas_venta where id = current_setting('prueba.f1')::uuid;
  perform test.afirmar(r.cobrado = 10000 and r.saldo = 19500 and not r.cancelada, 'anulado el cobro, la factura vuelve a quedar por cobrar');
  -- Llegar al total la cancela sola.
  perform public.registrar_cobro_factura(current_setting('prueba.c3')::uuid, current_setting('prueba.f1')::uuid,
    current_setting('prueba.hoy')::date, 19500, false, 'OP-357-3', current_setting('prueba.c3_ruta'), current_setting('prueba.caja')::uuid, null);
  select * into r from public.v_facturas_venta where id = current_setting('prueba.f1')::uuid;
  perform test.afirmar(r.cobrado = 29500 and r.saldo = 0 and r.cancelada, 'el cobro que completa el total la cancela');
  perform test.debe_fallar(format('delete from public.cobros_factura_venta where id = %L', current_setting('prueba.c1')),
    'un cobro no se borra', 'permission denied');
  perform test.debe_fallar(format('update public.cobros_factura_venta set monto = 1 where id = %L', current_setting('prueba.c1')),
    'ni se corrige por debajo', 'permission denied');
  reset role;
end $$;

-- ----------------------------------- Anular deja libre el número de la factura
do $$ begin
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  perform public.registrar_factura_venta(current_setting('prueba.f2')::uuid, current_setting('prueba.cot1')::uuid, 'E001-627',
    current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'USD', 29500, 'Saldo', current_setting('prueba.f2_ruta'), 'E001-627.pdf');
  perform test.debe_fallar(format('select public.anular_factura_venta(%L, ''corto'')', current_setting('prueba.f2')),
    'anular la factura pide motivo', '10 a 500');
  perform public.anular_factura_venta(current_setting('prueba.f2')::uuid, 'SUNAT la rechazó por el RUC del cliente.');
  perform test.afirmar((select anulada_en is not null and motivo_anulacion like 'SUNAT%' from public.facturas_venta
                         where id = current_setting('prueba.f2')::uuid), 'la factura anulada queda con su motivo');
  perform public.registrar_factura_venta(current_setting('prueba.f3')::uuid, current_setting('prueba.cot1')::uuid, 'E001-627',
    current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'USD', 29500, 'Saldo', current_setting('prueba.f3_ruta'), 'E001-627.pdf');
  perform test.afirmar((select count(*) from public.facturas_venta where numero = 'E001-627') = 2,
    'y su número vuelve a entrar bien registrado');
  perform test.afirmar((select facturas = 2 and facturado = 59000 and cobrado = 29500 from public.cotizaciones_para_facturar()
                         where cotizacion_id = current_setting('prueba.cot1')::uuid),
    'Facturación suma lo facturado y lo cobrado sin la anulada');
  reset role;
  perform test.afirmar(exists (select 1 from public.notificaciones n
                                where n.usuario_id = current_setting('prueba.teso')::uuid
                                  and n.origen_id = current_setting('prueba.f2')::uuid and n.titulo like 'Factura anulada%'),
    'a Tesorería le llega el aviso de la anulación');
end $$;

-- ----------------------------------------------- Quién más ve y quién no
do $$ begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.v_facturas_venta where cotizacion_pdf_id = current_setting('prueba.cot1')::uuid) = 3,
    'Gerencia ve las facturas del código');
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.cobros_factura_venta c join public.facturas_venta f on f.id = c.factura_id
                         where f.cotizacion_pdf_id = current_setting('prueba.cot1')::uuid) = 3,
    'Administración ve los cobros');
  perform test.debe_fallar(format('select public.anular_cobro_factura(%L, ''No corresponde a este cliente.'')', current_setting('prueba.c1')),
    'pero no los anula', 'tesoreria.registrar_cobros');
  reset role;

  perform test.como_usuario(current_setting('prueba.compras')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.facturas_venta) = 0 and (select count(*) from public.cobros_factura_venta) = 0,
    'Logística no ve facturas de venta ni cobros');
  perform test.debe_fallar('select * from public.cotizaciones_para_facturar()', 'ni las cotizaciones por facturar', 'No tienes permiso para ver las cotizaciones aprobadas');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'cobros-venta' and name = current_setting('prueba.c1_ruta')) = 0,
    'ni los vouchers');
  perform test.debe_fallar(format('insert into storage.objects (bucket_id, name, owner_id, metadata) values (''facturas-venta'', %L, %L, ''{}'')',
      current_setting('prueba.f1') || '/otro.pdf', current_setting('prueba.compras')),
    'Logística no sube facturas de venta', 'row-level security');
  reset role;

  perform test.como_usuario(current_setting('prueba.req')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.facturas_venta) = 0
    and (select count(*) from public.cotizaciones_pdf where id = current_setting('prueba.cot1')::uuid) = 0,
    'Requerimientos no ve facturas ni cotizaciones');
  perform test.afirmar((select por_facturar is null and por_cobrar is null from public.facturacion_pendientes()), 'ni los pendientes');
  reset role;

  -- La cotización la ven Administración, Gerencia, Tesorería y Contabilidad (y
  -- Ventas, que la hace); Supervisión General y Diseño ya no (20261015125000).
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.cotizaciones_pdf where id = current_setting('prueba.cot3')::uuid) = 1,
    'Gerencia ve también la cotización que falta aprobar');
  reset role;
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.cotizaciones_pdf where id = current_setting('prueba.cot1')::uuid) = 1,
    'Administración ve la cotización');
  reset role;
  perform test.como_usuario(current_setting('prueba.general')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.cotizaciones_pdf where id in (current_setting('prueba.cot1')::uuid, current_setting('prueba.cot3')::uuid)) = 0
    and (select count(*) from public.cotizaciones_pdf_versiones where cotizacion_id = current_setting('prueba.cot1')::uuid) = 0
    and (select count(*) from public.facturas_venta) = 0,
    'Supervisión General ya no ve la cotización ni sus facturas');
  perform test.debe_fallar('select * from public.cotizaciones_para_facturar()', 'ni la bandeja de facturación', 'No tienes permiso para ver las cotizaciones aprobadas');
  reset role;
  perform test.como_usuario(current_setting('prueba.diseno')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.cotizaciones_pdf where id = current_setting('prueba.cot1')::uuid) = 0,
    'Diseño ve la OT, no la cotización');
  reset role;
end $$;

-- Nada de esto lo puede anon.
do $$ begin
  perform test.afirmar(not has_function_privilege('anon', 'public.registrar_factura_venta(uuid, uuid, text, date, date, text, numeric, text, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.registrar_cobro_factura(uuid, uuid, date, numeric, boolean, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.cotizaciones_para_facturar()', 'execute')
    and not has_function_privilege('anon', 'public.codigo_interno_de_cotizacion(uuid)', 'execute')
    and not has_table_privilege('anon', 'public.facturas_venta', 'select')
    and not has_table_privilege('anon', 'public.cobros_factura_venta', 'select')
    and not has_table_privilege('anon', 'public.v_facturas_venta', 'select'),
    'anon no entra a las facturas de venta');
end $$;

rollback;
