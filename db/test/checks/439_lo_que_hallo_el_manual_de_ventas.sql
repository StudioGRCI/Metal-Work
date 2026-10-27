-- Lo que halló el manual de Ventas (migración 20261026140000).
--
--   1. El aviso del rechazo no dice «..» cuando la observación termina en punto.
--   2. La cotización facturada no se corrige (si se anula la factura, sí), y la
--      que tiene una corrección sin aprobar no se factura.
--   3. El cliente toma como vendedor a quien lo da de alta o le sube la primera
--      cotización desde Ventas; el que ya tiene vendedor no cambia.
--   4. Lo que Ventas hace con clientes, contactos y unidades: crear, corregir y
--      desactivar entran; borrar no. La unidad no entraba: el disparador que
--      vigila su código llamaba a una función que Ventas no podía ejecutar.
--
-- Cada paso con la cuenta del puesto que lo hace y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000439', 'PRUEBAS VENTAS S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA439', 'Taller prueba de Ventas') on conflict (codigo) do nothing;

select test.crear_usuario('Gema', 'Gerente', 'gerencia439@demo.pe', 'GERENTE', (select id from public.sedes where codigo = 'QA439')) as gerente_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas439@demo.pe', 'VENDEDOR', (select id from public.sedes where codigo = 'QA439')) as vendedor_id \gset
select test.crear_usuario('Vera', 'Ventas', 'ventas439b@demo.pe', 'VENDEDOR', (select id from public.sedes where codigo = 'QA439')) as vendedor2_id \gset
select test.crear_usuario('Coni', 'Contable', 'contabilidad439@demo.pe', 'CONTABILIDAD', (select id from public.sedes where codigo = 'QA439')) as conta_id \gset
select test.crear_usuario('Dino', 'Diseño', 'diseno439@demo.pe', 'DISENO', (select id from public.sedes where codigo = 'QA439')) as disenador_id \gset
select test.crear_usuario('Olga', 'Oficina', 'oficina439@demo.pe', 'ADMINISTRACION', (select id from public.sedes where codigo = 'QA439')) as oficina_id \gset

select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.disenador', :'disenador_id', true);
select set_config('prueba.oficina', :'oficina_id', true);
select set_config('prueba.vendedor', :'vendedor_id', true);
select set_config('prueba.vendedor2', :'vendedor2_id', true);
select set_config('prueba.conta', :'conta_id', true);
select set_config('prueba.carroceria', (select id from public.tipos_carroceria where activo order by orden_secuencia limit 1)::text, true);
select set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

-- ============================================ 3 y 4. Ventas con sus clientes
do $$
declare
  v_cliente uuid;
  v_otro uuid;
  v_unidad uuid;
  v_contacto uuid;
  v integer;
begin
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;

  insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20990000439', 'QA CLIENTE VENTAS') returning id into v_cliente;
  perform test.afirmar((select vendedor_id from public.clientes where id = v_cliente) = current_setting('prueba.vendedor')::uuid,
    'el cliente que da de alta Ventas queda con su vendedor');

  update public.clientes set telefono = '044 100 439' where id = v_cliente;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Ventas corrige los datos del cliente');

  insert into public.contactos_cliente (cliente_id, nombre, cargo)
  values (v_cliente, 'Jefa de flota', 'Flota') returning id into v_contacto;
  update public.contactos_cliente set telefono = '944 000 439' where id = v_contacto;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Ventas registra y corrige un contacto');

  insert into public.unidades (cliente_id, tipo_vehiculo, marca, modelo, anio)
  values (v_cliente, 'CAMION', 'Hino', '500', 2025) returning id into v_unidad;
  update public.unidades set color = 'Blanco' where id = v_unidad;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Ventas registra y corrige una unidad');
  update public.unidades set activo = false where id = v_unidad;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Ventas desactiva la unidad');

  delete from public.unidades where id = v_unidad;
  get diagnostics v = row_count;
  perform test.afirmar(v = 0, 'Ventas no borra una unidad');
  delete from public.contactos_cliente where id = v_contacto;
  get diagnostics v = row_count;
  perform test.afirmar(v = 0, 'ni un contacto');

  update public.clientes set activo = false where id = v_cliente;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Ventas desactiva al cliente');
  delete from public.clientes where id = v_cliente;
  get diagnostics v = row_count;
  perform test.afirmar(v = 0, 'y no lo borra');
  update public.clientes set activo = true where id = v_cliente;

  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  -- Un cliente que no dio de alta Ventas: lo toma quien le sube la primera
  -- cotización, y la segunda vendedora no se lo quita.
  insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20990001439', 'QA CLIENTE SIN VENDEDOR S.A.C.') returning id into v_otro;
  perform test.afirmar((select vendedor_id from public.clientes where id = v_otro) is null, 'el cliente que da de alta otro puesto queda sin vendedor');
  perform set_config('prueba.cliente', v_cliente::text, true);
  perform set_config('prueba.otro', v_otro::text, true);
end $$;

select gen_random_uuid() as cot1 \gset
select gen_random_uuid() as cot2 \gset
select gen_random_uuid() as ot1 \gset
select set_config('prueba.cot1', :'cot1', true);
select set_config('prueba.cot2', :'cot2', true);
select set_config('prueba.ot1', :'ot1', true);

do $$
begin
  perform test.como_usuario(current_setting('prueba.vendedor2')::uuid);
  set local role authenticated;
  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
  values (current_setting('prueba.cot2')::uuid, 'QA-439-2', current_setting('prueba.otro')::uuid, current_setting('prueba.carroceria')::uuid,
          'qa-439-2.pdf', 'cot/' || current_setting('prueba.cot2') || '/qa-439-2.pdf', 'application/pdf', 120,
          current_setting('prueba.vendedor2')::uuid, 30000, 'PEN');
  reset role;
  perform test.afirmar((select vendedor_id from public.clientes where id = current_setting('prueba.otro')::uuid) = current_setting('prueba.vendedor2')::uuid,
    'quien le sube la primera cotización queda como vendedor del cliente');

  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
  values (current_setting('prueba.cot1')::uuid, 'QA-439-1', current_setting('prueba.otro')::uuid, current_setting('prueba.carroceria')::uuid,
          'qa-439-1.pdf', 'cot/' || current_setting('prueba.cot1') || '/qa-439-1.pdf', 'application/pdf', 120,
          current_setting('prueba.vendedor')::uuid, 50000, 'PEN');
  reset role;
  perform test.afirmar((select vendedor_id from public.clientes where id = current_setting('prueba.otro')::uuid) = current_setting('prueba.vendedor2')::uuid,
    'la cotización de otra vendedora no le cambia el vendedor');
  -- La razón social termina en punto: el aviso a Gerencia no le pone otro.
  perform test.afirmar((select bool_and(cuerpo like '%QA CLIENTE SIN VENDEDOR S.A.C.' and cuerpo not like '%..')
                          from public.notificaciones
                         where usuario_id = current_setting('prueba.gerente')::uuid and titulo = 'Cotización por revisar'
                           and cuerpo like '%QA-439-%'),
    'el aviso de la cotización por revisar no sale con doble punto');
end $$;

insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('cotizaciones-pdf', 'cot/' || :'cot1' || '/qa-439-1.pdf', :'vendedor_id', '{"mimetype": "application/pdf", "size": 120}'),
  ('cotizaciones-pdf', 'cot/' || :'cot1' || '/qa-439-1-v2.pdf', :'vendedor_id', '{"mimetype": "application/pdf", "size": 120}'),
  ('cotizaciones-pdf', 'cot/' || :'cot1' || '/qa-439-1-v3.pdf', :'vendedor_id', '{"mimetype": "application/pdf", "size": 120}'),
  ('cotizaciones-pdf', 'cot/' || :'cot1' || '/qa-439-1-v4.pdf', :'vendedor_id', '{"mimetype": "application/pdf", "size": 120}');

-- ============================================ 1. El aviso del rechazo
do $$
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'RECHAZADA', observacion = 'Falta el precio de la bomba.'
   where id = current_setting('prueba.cot2')::uuid;
  update public.cotizaciones_pdf set estado = 'RECHAZADA', observacion = 'Falta el plazo de entrega'
   where id = current_setting('prueba.cot1')::uuid;
  reset role;
  perform test.afirmar((select cuerpo from public.notificaciones
                         where usuario_id = current_setting('prueba.vendedor2')::uuid and titulo = 'Gerencia rechazó tu cotización')
                       = 'La QA-439-2: Falta el precio de la bomba. Corrígela y sube la corrección.',
    'la observación que termina en punto no lleva otro');
  perform test.afirmar((select cuerpo from public.notificaciones
                         where usuario_id = current_setting('prueba.vendedor')::uuid and titulo = 'Gerencia rechazó tu cotización')
                       = 'La QA-439-1: Falta el plazo de entrega. Corrígela y sube la corrección.',
    'y la que no termina en punto lo recibe');
end $$;

-- ============================================ 2. Facturada, no se corrige
-- Ventas corrige la rechazada, Gerencia la aprueba y Administración le da su
-- código y sube su OT (migración 20261027200000).
do $$
begin
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf
     set ruta_storage = 'cot/' || current_setting('prueba.cot1') || '/qa-439-1-v2.pdf', nombre_archivo = 'qa-439-1-v2.pdf',
         motivo_correccion = 'Se agregó el plazo de entrega.'
   where id = current_setting('prueba.cot1')::uuid;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  update public.cotizaciones_pdf set estado = 'APROBADA' where id = current_setting('prueba.cot1')::uuid;
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  perform public.cargar_codigo_y_ot_de_cotizacion(current_setting('prueba.cot1')::uuid, current_setting('prueba.ot1')::uuid, 'qa-ci 439', '9439', 'SEMIRREMOLQUE',
                                                  current_setting('prueba.hoy')::date + 30, 'ot/' || current_setting('prueba.ot1') || '/orden.pdf', 'orden.pdf', 100);
  reset role;
  perform test.afirmar((select estado::text from public.cotizaciones_pdf where id = current_setting('prueba.cot1')::uuid) = 'APROBADA',
    'la cotización queda aprobada');
  perform test.afirmar((select cuerpo from public.notificaciones
                         where usuario_id = current_setting('prueba.vendedor')::uuid and titulo = 'Gerencia aprobó tu cotización')
                       = 'La QA-439-1 de QA CLIENTE SIN VENDEDOR S.A.C. Administración le da su código interno y sube su OT.',
    'el aviso de la aprobación no sale con doble punto');
  perform test.afirmar((select cuerpo from public.notificaciones
                         where usuario_id = current_setting('prueba.vendedor')::uuid and titulo = 'Tu cotización ya tiene su código')
                       = 'La QA-439-1 de QA CLIENTE SIN VENDEDOR S.A.C. quedó con el código interno QA-CI 439 y la OT 9439-'
                         || to_char(current_setting('prueba.hoy')::date, 'YYYY') || '.',
    'ni el del código que le da Administración');
  perform test.afirmar((select cuerpo from public.notificaciones
                         where usuario_id = current_setting('prueba.oficina')::uuid and titulo = 'Cotización aprobada: falta su código y su OT')
                       = 'Gerencia aprobó la QA-439-1 de QA CLIENTE SIN VENDEDOR S.A.C. Dale su código interno y sube su OT.',
    'ni el que le llega a Administración');
  perform test.afirmar((select bool_and(cuerpo like '%de QA CLIENTE SIN VENDEDOR S.A.C. Entrega prometida:%')
                          from public.notificaciones where titulo = 'Código nuevo con su OT' and cuerpo like 'QA-CI 439:%'
                           and usuario_id = current_setting('prueba.disenador')::uuid),
    'el aviso a Diseño del código nuevo tampoco');
end $$;

select set_config('prueba.f1', gen_random_uuid()::text, true);
select set_config('prueba.f1_ruta', current_setting('prueba.f1') || '/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.f2', gen_random_uuid()::text, true);
select set_config('prueba.f2_ruta', current_setting('prueba.f2') || '/' || gen_random_uuid() || '.pdf', true);

do $$
declare v integer;
begin
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('facturas-venta', current_setting('prueba.f1_ruta'), current_setting('prueba.conta'), '{"mimetype": "application/pdf", "size": 900}'),
    ('facturas-venta', current_setting('prueba.f2_ruta'), current_setting('prueba.conta'), '{"mimetype": "application/pdf", "size": 900}');
  perform public.registrar_factura_venta(current_setting('prueba.f1')::uuid, current_setting('prueba.cot1')::uuid, 'E001-439',
    current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'PEN', 25000, 'Inicial 50 %', current_setting('prueba.f1_ruta'), 'f.pdf');

  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  perform test.afirmar((select count(*) from public.facturas_venta) = 0
                   and (select array_agg(cotizacion) from public.cotizaciones_con_factura(array[current_setting('prueba.cot1')::uuid, current_setting('prueba.cot2')::uuid]))
                       = array[current_setting('prueba.cot1')::uuid],
    'Ventas no ve la factura, pero sabe qué cotización suya ya está facturada');
  perform test.debe_fallar(format(
      'update public.cotizaciones_pdf set ruta_storage = %L, nombre_archivo = ''qa-439-1-v3.pdf'', motivo_correccion = ''Otro monto.'' where id = %L',
      'cot/' || current_setting('prueba.cot1') || '/qa-439-1-v3.pdf', current_setting('prueba.cot1')),
    'la cotización facturada no se corrige', 'ya está facturada: no se corrige');

  -- Contabilidad anula la factura: entonces sí se corrige.
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  perform public.anular_factura_venta(current_setting('prueba.f1')::uuid, 'Se emitió con el monto equivocado.');
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  update public.cotizaciones_pdf
     set ruta_storage = 'cot/' || current_setting('prueba.cot1') || '/qa-439-1-v3.pdf', nombre_archivo = 'qa-439-1-v3.pdf',
         motivo_correccion = 'El cliente pidió otro monto.', monto_venta = 52000
   where id = current_setting('prueba.cot1')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'con la factura anulada, Ventas sube la corrección');

  -- Y mientras Gerencia no apruebe esa corrección, no se factura.
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  perform test.debe_fallar(format('select public.registrar_factura_venta(%L, %L, ''E001-439'', %L::date, %L::date, ''PEN'', 26000, null, %L, ''f.pdf'')',
      current_setting('prueba.f2'), current_setting('prueba.cot1'), current_setting('prueba.hoy'), current_setting('prueba.hoy'), current_setting('prueba.f2_ruta')),
    'la cotización con una corrección sin aprobar no se factura', 'todavía no aprueba');

  -- Si Gerencia rechaza la corrección, el mensaje lo dice así; Ventas sube otra.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  update public.cotizaciones_pdf set estado = 'RECHAZADA', observacion = 'El monto no es el acordado.'
   where id = current_setting('prueba.cot1')::uuid;
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  perform test.debe_fallar(format('select public.registrar_factura_venta(%L, %L, ''E001-439'', %L::date, %L::date, ''PEN'', 26000, null, %L, ''f.pdf'')',
      current_setting('prueba.f2'), current_setting('prueba.cot1'), current_setting('prueba.hoy'), current_setting('prueba.hoy'), current_setting('prueba.f2_ruta')),
    'la cotización con la corrección rechazada no se factura', 'Gerencia rechazó la corrección');
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  update public.cotizaciones_pdf
     set ruta_storage = 'cot/' || current_setting('prueba.cot1') || '/qa-439-1-v4.pdf', nombre_archivo = 'qa-439-1-v4.pdf',
         motivo_correccion = 'El monto acordado.', monto_venta = 52000
   where id = current_setting('prueba.cot1')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Ventas sube la corrección de la rechazada');

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  update public.cotizaciones_pdf set estado = 'APROBADA' where id = current_setting('prueba.cot1')::uuid;
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  perform public.registrar_factura_venta(current_setting('prueba.f2')::uuid, current_setting('prueba.cot1')::uuid, 'E001-439',
    current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'PEN', 26000, null, current_setting('prueba.f2_ruta'), 'f.pdf');
  perform test.afirmar((select count(*) from public.facturas_venta where cotizacion_pdf_id = current_setting('prueba.cot1')::uuid and anulada_en is null) = 1,
    'aprobada la corrección, Contabilidad la factura');
  reset role;
end $$;

rollback;
