-- La factura de compra cubre una o varias OC del mismo proveedor; Adquisiciones
-- avisa si su total no calza con el de sus OC (solo avisa), y Tesorería paga cada
-- factura, al contado o a crédito, con su voucher. Logística ve Adquisiciones
-- sin registrar nada. Cada paso con la cuenta del área que lo hace.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000355', 'PRUEBAS ADQUISICIONES S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA55', 'Taller prueba adquisiciones') on conflict (codigo) do nothing;

select test.crear_usuario('Ada', 'Admin', 'admin355@demo.pe', 'ADMIN', (select id from public.sedes where codigo = 'QA55')) as admin_id \gset
select test.crear_usuario('Coni', 'Contable', 'contabilidad355@demo.pe', 'CONTABILIDAD', (select id from public.sedes where codigo = 'QA55')) as conta_id \gset
select test.crear_usuario('Teo', 'Tesoro', 'tesoreria355@demo.pe', 'TESORERIA', (select id from public.sedes where codigo = 'QA55')) as teso_id \gset
select test.crear_usuario('Lalo', 'Logística', 'logistica355@demo.pe', 'COMPRADOR', (select id from public.sedes where codigo = 'QA55')) as compras_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas355@demo.pe', 'VENDEDOR', (select id from public.sedes where codigo = 'QA55')) as vendedor_id \gset

select set_config('prueba.admin', :'admin_id', true);
select set_config('prueba.conta', :'conta_id', true);
select set_config('prueba.teso', :'teso_id', true);
select set_config('prueba.caja', test.crear_caja()::text, true);  -- desde la 20261019100000 todo pago pide su cuenta
select set_config('prueba.compras', :'compras_id', true);
select set_config('prueba.vendedor', :'vendedor_id', true);
select set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

-- ------------------------------------------------------------------ armazón
-- Dos proveedores, un material y ocho OC directas, como dueño de las tablas:
--   oc1  P1 contado PEN  10 × 100.00 con factura  → 1 180.00
--   oc2  P1 contado PEN   5 ×  20.00 con factura  →   118.00
--   oc3  P2 contado PEN                           (otro proveedor)
--   oc4  P1 crédito PEN   1 ×  50.00 con factura  →    59.00
--   oc5  P1 contado USD                           (otra moneda)
--   oc6  P1 contado PEN   sin precio
--   oc7  P1 contado PEN   2 ×  25.00 sin factura  →    50.00
--   oc8  P1 contado PEN   rechazada
do $$
declare
  v_mat uuid;
  r record;
begin
  insert into public.proveedores (numero_documento, razon_social) values ('20100055008', 'PROVEEDOR UNO 355')
  on conflict (tipo_documento, numero_documento) do update set activo = true;
  insert into public.proveedores (numero_documento, razon_social) values ('20100055016', 'PROVEEDOR DOS 355')
  on conflict (tipo_documento, numero_documento) do update set activo = true;
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK355', 'Material de la factura 355',
          (select id from public.categorias_material order by 1 limit 1),
          (select id from public.unidades_medida order by 1 limit 1))
  returning id into v_mat;

  for r in select * from (values
      ('oc1', '20100055008', 'CONTADO', 'PEN', 10::numeric, 100.00::numeric, true,  'NO_REQUERIDA'),
      ('oc2', '20100055008', 'CONTADO', 'PEN',  5,  20.00, true,  'NO_REQUERIDA'),
      ('oc3', '20100055016', 'CONTADO', 'PEN',  1,  50.00, true,  'NO_REQUERIDA'),
      ('oc4', '20100055008', 'CREDITO', 'PEN',  1,  50.00, true,  'NO_REQUERIDA'),
      ('oc5', '20100055008', 'CONTADO', 'USD',  1,  50.00, true,  'NO_REQUERIDA'),
      ('oc6', '20100055008', 'CONTADO', 'PEN',  1,   null, true,  'NO_REQUERIDA'),
      ('oc7', '20100055008', 'CONTADO', 'PEN',  2,  25.00, false, 'NO_REQUERIDA'),
      ('oc8', '20100055008', 'CONTADO', 'PEN',  1,  50.00, true,  'RECHAZADA')
    ) as t(clave, ruc, condicion, moneda, cantidad, precio, con_factura, aprobacion)
  loop
    perform set_config('prueba.' || r.clave, gen_random_uuid()::text, true);
    insert into public.ordenes_compra_materiales (id, proveedor_id, proveedor, referencia, condicion_pago, dias_credito, moneda,
                                                  origen, motivo, con_factura, creado_por, aprobacion,
                                                  rechazado_por, rechazado_en, motivo_rechazo)
    select current_setting('prueba.' || r.clave)::uuid, p.id, p.razon_social, 'QA355-' || r.clave, r.condicion,
           case when r.condicion = 'CREDITO' then 30 else 0 end, r.moneda,
           'DIRECTA', 'Reposición de prueba 355', r.con_factura, current_setting('prueba.compras')::uuid, r.aprobacion,
           case when r.aprobacion = 'RECHAZADA' then current_setting('prueba.admin')::uuid end,
           case when r.aprobacion = 'RECHAZADA' then now() end,
           case when r.aprobacion = 'RECHAZADA' then 'No se compra este mes.' end
      from public.proveedores p where p.numero_documento = r.ruc;
    insert into public.orden_compra_material_detalles (orden_compra_id, cantidad, precio_unitario, material_id)
    values (current_setting('prueba.' || r.clave)::uuid, r.cantidad, r.precio, v_mat);
  end loop;

  perform set_config('prueba.a1', gen_random_uuid()::text, true);
  perform set_config('prueba.a2', gen_random_uuid()::text, true);
  perform set_config('prueba.a3', gen_random_uuid()::text, true);
  perform set_config('prueba.a4', gen_random_uuid()::text, true);
  perform set_config('prueba.a5', gen_random_uuid()::text, true);
  perform set_config('prueba.a6', gen_random_uuid()::text, true);
end $$;

-- --------------------------------------- Logística ve Adquisiciones, sin registrar
do $$
declare r record;
begin
  perform test.como_usuario(current_setting('prueba.compras')::uuid);
  set local role authenticated;
  perform test.afirmar(public.tiene_permiso('adquisiciones.ver') and not public.tiene_permiso('adquisiciones.registrar'),
    'Logística tiene Adquisiciones en lectura');
  select * into r from public.compras_sin_factura() where orden_compra_id = current_setting('prueba.oc1')::uuid;
  perform test.afirmar(r.total = 1180 and not r.sin_precio and not r.en_borrador and r.condicion_pago = 'CONTADO',
    've la OC que espera su factura, con su total e IGV');
  perform test.afirmar((select count(*) from public.compras_sin_factura()
                         where orden_compra_id in (current_setting('prueba.oc7')::uuid, current_setting('prueba.oc8')::uuid)) = 0,
    'no salen la OC sin factura ni la rechazada');
  perform test.debe_fallar(format(
      'insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago) values (%L, ''FACTURA_COMPRA'', ''PROVEEDOR UNO 355'', ''F001-1'', %L, %L, ''PEN'', 10, ''CONTADO'')',
      current_setting('prueba.a1'), current_setting('prueba.hoy'), current_setting('prueba.hoy')),
    'Logística no registra facturas', 'row-level security');
  reset role;

  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.debe_fallar('select * from public.compras_sin_factura()', 'Ventas no ve las OC sin factura', 'Contabilidad, Tesorería y Logística');
  perform test.debe_fallar(format('select * from public.adquisiciones_control(array[%L]::uuid[])', current_setting('prueba.a1')),
    'ni el aviso de Adquisiciones', 'Contabilidad, Tesorería y Logística');
  reset role;
end $$;

-- ------------------------------------------- Contabilidad: una factura, dos OC
do $$
declare r record;
begin
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  insert into public.adquisiciones (id, orden_compra_id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
  values (current_setting('prueba.a1')::uuid, current_setting('prueba.oc1')::uuid, 'FACTURA_COMPRA', 'PROVEEDOR UNO 355', 'F001-355',
          current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'PEN', 1298, 'CONTADO');
  perform test.afirmar((select count(*) from public.adquisiciones_ordenes_compra
                         where adquisicion_id = current_setting('prueba.a1')::uuid
                           and orden_compra_id = current_setting('prueba.oc1')::uuid) = 1,
    'la OC elegida en la factura queda enlazada sola');
  insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id)
  values (current_setting('prueba.a1')::uuid, current_setting('prueba.oc2')::uuid);
  perform test.debe_fallar(format('insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id) values (%L, %L)',
      current_setting('prueba.a1'), current_setting('prueba.oc3')),
    'una factura es de un solo proveedor: con los dos en el padrón, lo dice el RUC', 'se liga solo a las OC de su proveedor');
  perform test.debe_fallar(format('insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id) values (%L, %L)',
      current_setting('prueba.a1'), current_setting('prueba.oc4')),
    'la OC a crédito no entra en una factura al contado', 'tiene que ir igual');
  perform test.debe_fallar(format('insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id) values (%L, %L)',
      current_setting('prueba.a1'), current_setting('prueba.oc8')),
    'la OC rechazada no se factura', 'rechazada');
  reset role;

  perform test.como_usuario(current_setting('prueba.compras')::uuid);
  set local role authenticated;
  perform test.afirmar((select en_borrador from public.compras_sin_factura() where orden_compra_id = current_setting('prueba.oc2')::uuid),
    'mientras la factura está en borrador, la OC sigue esperando y se nota');
  reset role;

  -- Contabilidad sube el PDF y la registra.
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('comprobantes-financieros', 'adquisiciones/' || current_setting('prueba.a1') || '/comprobante.pdf', current_setting('prueba.conta'),
          '{"mimetype": "application/pdf", "size": 2048}');
  update public.adquisiciones set ruta_storage = 'adquisiciones/' || current_setting('prueba.a1') || '/comprobante.pdf', estado = 'REGISTRADA'
   where id = current_setting('prueba.a1')::uuid;
  perform test.afirmar((select estado from public.adquisiciones where id = current_setting('prueba.a1')::uuid) = 'REGISTRADA', 'la factura queda registrada');
  perform test.debe_fallar(format('insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id) values (%L, %L)',
      current_setting('prueba.a1'), current_setting('prueba.oc7')),
    'registrada, ya no se le suman OC', 'ya no cambian');
  perform test.debe_fallar(format('delete from public.adquisiciones_ordenes_compra where adquisicion_id = %L', current_setting('prueba.a1')),
    'ni se le quitan', 'permission denied');
  perform test.debe_fallar(format('update public.adquisiciones_ordenes_compra set orden_compra_id = %L where adquisicion_id = %L',
      current_setting('prueba.oc7'), current_setting('prueba.a1')),
    'ni se le cambian', 'permission denied');

  select * into r from public.adquisiciones_control(array[current_setting('prueba.a1')::uuid]);
  perform test.afirmar(r.control = 'CALZA' and r.total_oc = 1298 and r.diferencia = 0 and jsonb_array_length(r.ordenes) = 2,
    'la factura de 1 298.00 calza con sus dos OC (1 180.00 + 118.00)');
  perform test.afirmar((select count(*) from public.compras_sin_factura()
                         where orden_compra_id in (current_setting('prueba.oc1')::uuid, current_setting('prueba.oc2')::uuid)) = 0,
    'con la factura registrada, sus OC dejan de esperar');
  reset role;

  -- Por debajo, ni el dueño enlaza otra OC a la registrada.
  perform test.debe_fallar(format('insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id) values (%L, %L)',
      current_setting('prueba.a1'), current_setting('prueba.oc7')),
    'la base tampoco deja sumar una OC a la registrada', 'ya no cambian');
  perform test.debe_fallar(format('delete from public.adquisiciones_ordenes_compra where adquisicion_id = %L', current_setting('prueba.a1')),
    'ni quitarla', 'no se cambian ni se quitan');
  -- Logística ya no cambia la moneda de la segunda OC de la factura.
  perform test.debe_fallar(format('update public.ordenes_compra_materiales set moneda = ''USD'' where id = %L', current_setting('prueba.oc2')),
    'la OC con factura no cambia de moneda', 'ya tiene factura');
end $$;

-- --------------------------------------------- El aviso: cuándo no calza y por qué
do $$
declare r record;
begin
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  insert into public.adquisiciones (id, orden_compra_id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
  values (current_setting('prueba.a2')::uuid, current_setting('prueba.oc5')::uuid, 'FACTURA_COMPRA', 'PROVEEDOR UNO 355', 'F001-356',
          current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'PEN', 59, 'CONTADO'),
         (current_setting('prueba.a3')::uuid, current_setting('prueba.oc6')::uuid, 'FACTURA_COMPRA', 'PROVEEDOR UNO 355', 'F001-357',
          current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'PEN', 10, 'CONTADO'),
         (current_setting('prueba.a4')::uuid, null, 'RECIBO_HONORARIOS', 'TÉCNICO EXTERNO 355', 'E001-12',
          current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'PEN', 300, 'CONTADO'),
         (current_setting('prueba.a5')::uuid, current_setting('prueba.oc7')::uuid, 'FACTURA_COMPRA', 'PROVEEDOR UNO 355', 'F001-358',
          current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'PEN', 80, 'CONTADO');
  select * into r from public.adquisiciones_control(array[current_setting('prueba.a2')::uuid]);
  perform test.afirmar(r.control = 'OTRA_MONEDA' and r.diferencia is null, 'la OC en dólares no se compara con una factura en soles');
  select * into r from public.adquisiciones_control(array[current_setting('prueba.a3')::uuid]);
  perform test.afirmar(r.control = 'SIN_PRECIO' and r.total_oc is null, 'la OC sin precio no se puede comparar');
  select * into r from public.adquisiciones_control(array[current_setting('prueba.a4')::uuid]);
  perform test.afirmar(r.control = 'SIN_OC' and r.ordenes = '[]'::jsonb, 'el recibo sin OC lo dice');
  select * into r from public.adquisiciones_control(array[current_setting('prueba.a5')::uuid]);
  perform test.afirmar(r.control = 'NO_CALZA' and r.total_oc = 50 and r.diferencia = 30,
    'la factura de 80.00 no calza con la OC sin IGV de 50.00, y se ve la diferencia');
  perform test.afirmar((select count(*) from public.adquisiciones_control(array[
                          current_setting('prueba.a1')::uuid, current_setting('prueba.a2')::uuid, current_setting('prueba.a3')::uuid,
                          current_setting('prueba.a4')::uuid, current_setting('prueba.a5')::uuid])) = 5,
    'una sola consulta trae el aviso de toda la lista');
  -- Que no calce no frena nada: se registra igual.
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('comprobantes-financieros', 'adquisiciones/' || current_setting('prueba.a5') || '/comprobante.pdf', current_setting('prueba.conta'),
          '{"mimetype": "application/pdf", "size": 2048}');
  update public.adquisiciones set ruta_storage = 'adquisiciones/' || current_setting('prueba.a5') || '/comprobante.pdf', estado = 'REGISTRADA'
   where id = current_setting('prueba.a5')::uuid;
  perform test.afirmar((select estado from public.adquisiciones where id = current_setting('prueba.a5')::uuid) = 'REGISTRADA',
    'la factura que no calza se registra igual: es solo un aviso');

  -- La factura a crédito saca a su OC de «compras a crédito sin comprobante».
  insert into public.adquisiciones (id, orden_compra_id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
  values (current_setting('prueba.a6')::uuid, current_setting('prueba.oc4')::uuid, 'FACTURA_COMPRA', 'PROVEEDOR UNO 355', 'F001-359',
          current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date + 30, 'PEN', 59, 'CREDITO');
  reset role;

  perform test.como_usuario(current_setting('prueba.teso')::uuid);
  set local role authenticated;
  perform test.afirmar((select total_estimado from public.v_compras_credito_sin_comprobante
                         where orden_compra_id = current_setting('prueba.oc4')::uuid) = 50,
    'Tesorería ve la OC a crédito que espera su factura');
  reset role;

  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('comprobantes-financieros', 'adquisiciones/' || current_setting('prueba.a6') || '/comprobante.pdf', current_setting('prueba.conta'),
          '{"mimetype": "application/pdf", "size": 2048}');
  update public.adquisiciones set ruta_storage = 'adquisiciones/' || current_setting('prueba.a6') || '/comprobante.pdf', estado = 'REGISTRADA'
   where id = current_setting('prueba.a6')::uuid;
  reset role;

  perform test.como_usuario(current_setting('prueba.teso')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.v_compras_credito_sin_comprobante
                         where orden_compra_id = current_setting('prueba.oc4')::uuid) = 0,
    'con su factura registrada, deja de esperar');
  reset role;
end $$;

-- ------------------------------------------ Tesorería paga la factura con su voucher
select set_config('prueba.p1', gen_random_uuid()::text, true);
select set_config('prueba.p2', gen_random_uuid()::text, true);
select set_config('prueba.p3', gen_random_uuid()::text, true);
select set_config('prueba.p1_ruta', current_setting('prueba.a1') || '/' || current_setting('prueba.p1') || '.pdf', true);
select set_config('prueba.p2_ruta', current_setting('prueba.a1') || '/' || current_setting('prueba.p2') || '.jpg', true);
select set_config('prueba.p3_ruta', current_setting('prueba.a1') || '/' || current_setting('prueba.p3') || '.pdf', true);
select set_config('prueba.otra_ruta', current_setting('prueba.a5') || '/' || current_setting('prueba.p3') || '.pdf', true);

do $$
declare r record; v uuid;
begin
  perform test.como_usuario(current_setting('prueba.teso')::uuid);
  set local role authenticated;
  select * into r from public.v_cuentas_pagar where id = current_setting('prueba.a1')::uuid;
  perform test.afirmar(r.saldo = 1298 and r.pagado = 0 and r.condicion_pago = 'CONTADO' and r.tipo = 'FACTURA_COMPRA',
    'la factura al contado le llega a Tesorería por pagar');
  perform test.afirmar((select count(*) from public.v_cuentas_pagar where id = current_setting('prueba.a2')::uuid) = 0,
    'la que sigue en borrador, no');

  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('pagos-facturas', current_setting('prueba.p1_ruta'), current_setting('prueba.teso'), '{"mimetype": "application/pdf", "size": 900}'),
    ('pagos-facturas', current_setting('prueba.p2_ruta'), current_setting('prueba.teso'), '{"mimetype": "image/jpeg", "size": 900}'),
    ('pagos-facturas', current_setting('prueba.otra_ruta'), current_setting('prueba.teso'), '{"mimetype": "application/pdf", "size": 900}');

  perform test.debe_fallar(format('select public.registrar_pago_factura(%L, %L, %L, 500, ''OP-355-1'', %L, current_setting(''prueba.caja'')::uuid, null)',
      current_setting('prueba.p1'), current_setting('prueba.a1'), current_setting('prueba.hoy'), current_setting('prueba.p3_ruta')),
    'sin el voucher subido no hay pago', 'no terminó de subir');
  perform test.debe_fallar(format('select public.registrar_pago_factura(%L, %L, %L, 500, ''OP-355-1'', %L, current_setting(''prueba.caja'')::uuid, null)',
      current_setting('prueba.p1'), current_setting('prueba.a1'), current_setting('prueba.hoy'), current_setting('prueba.otra_ruta')),
    'el voucher va en la carpeta de su factura', 'Vuelve a adjuntar');
  perform test.debe_fallar(format('select public.registrar_pago_factura(%L, %L, %L, 500, ''OP-355-1'', %L, current_setting(''prueba.caja'')::uuid, null)',
      current_setting('prueba.p1'), current_setting('prueba.a2'), current_setting('prueba.hoy'), current_setting('prueba.p1_ruta')),
    'la factura en borrador no se paga', 'todavía no está registrada');
  perform test.debe_fallar(format('select public.registrar_pago_factura(%L, %L, %L, 500, ''OP-355-1'', %L, current_setting(''prueba.caja'')::uuid, null)',
      current_setting('prueba.p1'), current_setting('prueba.a1'), (current_setting('prueba.hoy')::date + 1)::text, current_setting('prueba.p1_ruta')),
    'el pago no es de mañana', 'de hoy hacia atrás');
  perform test.debe_fallar(format('select public.registrar_pago_factura(%L, %L, %L, 1300, ''OP-355-1'', %L, current_setting(''prueba.caja'')::uuid, null)',
      current_setting('prueba.p1'), current_setting('prueba.a1'), current_setting('prueba.hoy'), current_setting('prueba.p1_ruta')),
    'no se paga más que el saldo', 'supera el saldo');

  v := public.registrar_pago_factura(current_setting('prueba.p1')::uuid, current_setting('prueba.a1')::uuid,
         current_setting('prueba.hoy')::date, 500, ' OP-355-1 ', current_setting('prueba.p1_ruta'), current_setting('prueba.caja')::uuid, null);
  perform test.afirmar(public.registrar_pago_factura(current_setting('prueba.p1')::uuid, current_setting('prueba.a1')::uuid,
         current_setting('prueba.hoy')::date, 500, 'OP-355-1', current_setting('prueba.p1_ruta'), current_setting('prueba.caja')::uuid, null) = v, 'un segundo toque no paga dos veces');
  select * into r from public.pagos_adquisicion where id = v;
  perform test.afirmar(r.referencia = 'OP-355-1' and r.archivo_ruta = current_setting('prueba.p1_ruta')
                       and r.archivo_mime = 'application/pdf' and r.archivo_tamano = 900 and r.registrado_por = current_setting('prueba.teso')::uuid,
    'el pago guarda su voucher y quién lo registró');
  perform test.afirmar((select saldo from public.v_cuentas_pagar where id = current_setting('prueba.a1')::uuid) = 798,
    'el pago baja el saldo de la factura');
  perform test.debe_fallar(format('select public.registrar_pago_factura(%L, %L, %L, 10, ''OP-355-1'', %L, current_setting(''prueba.caja'')::uuid, null)',
      current_setting('prueba.p2'), current_setting('prueba.a1'), current_setting('prueba.hoy'), current_setting('prueba.p2_ruta')),
    'la misma operación no entra dos veces', 'ya está registrada');
  perform test.debe_fallar(format('insert into public.pagos_adquisicion (adquisicion_id, fecha, monto, referencia, registrado_por) values (%L, current_setting(''prueba.hoy'')::date, 1, ''OP-A-MANO'', %L)',
      current_setting('prueba.a1'), current_setting('prueba.teso')),
    'nadie anota un pago sin voucher por debajo', 'permission denied');
  perform test.debe_fallar(format('delete from public.pagos_adquisicion where id = %L', v), 'un pago no se borra', 'permission denied');
  perform test.debe_fallar(format('update public.pagos_adquisicion set monto = 1 where id = %L', v), 'ni se corrige', 'permission denied');

  perform test.debe_fallar(format('select public.anular_pago_factura(%L, ''corto'')', v), 'anular pide el motivo', '10 a 500');
  perform public.anular_pago_factura(v, 'El voucher era de otra factura del proveedor.');
  select * into r from public.pagos_adquisicion where id = v;
  perform test.afirmar(r.anulado_en is not null and r.anulado_por = current_setting('prueba.teso')::uuid, 'el pago anulado queda como evidencia');
  perform test.afirmar((select saldo from public.v_cuentas_pagar where id = current_setting('prueba.a1')::uuid) = 1298,
    'anulado el pago, la factura vuelve a su saldo');
  -- La misma operación, bien registrada (la 20261015123000 soltó la restricción vieja).
  perform public.registrar_pago_factura(current_setting('prueba.p2')::uuid, current_setting('prueba.a1')::uuid,
         current_setting('prueba.hoy')::date, 1298, 'OP-355-1', current_setting('prueba.p2_ruta'), current_setting('prueba.caja')::uuid, null);
  select * into r from public.v_cuentas_pagar where id = current_setting('prueba.a1')::uuid;
  perform test.afirmar(r.saldo = 0 and r.pagado = 1298, 'la operación anulada vuelve a entrar y la factura queda pagada');
  reset role;

  perform test.afirmar(exists (select 1 from storage.objects where bucket_id = 'pagos-facturas' and name = current_setting('prueba.otra_ruta')),
    'el voucher suelto sigue ahí para que quien lo subió lo quite');

  -- Contabilidad ve el pago y su voucher, pero no paga.
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.pagos_adquisicion where adquisicion_id = current_setting('prueba.a1')::uuid) = 2,
    'Contabilidad ve los pagos de la factura');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'pagos-facturas' and name = current_setting('prueba.p2_ruta')) = 1,
    'y abre su voucher');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'pagos-facturas' and name = current_setting('prueba.otra_ruta')) = 0,
    'pero no el que no es de ningún pago');
  perform test.debe_fallar(format('select public.registrar_pago_factura(gen_random_uuid(), %L, %L, 1, ''OP-355-9'', %L, current_setting(''prueba.caja'')::uuid, null)',
      current_setting('prueba.a6'), current_setting('prueba.hoy'), current_setting('prueba.p1_ruta')),
    'Contabilidad no paga', 'tesoreria.registrar_pagos');
  perform test.debe_fallar(format('insert into storage.objects (bucket_id, name, owner_id, metadata) values (''pagos-facturas'', %L, %L, ''{}'')',
      current_setting('prueba.a6') || '/' || gen_random_uuid() || '.pdf', current_setting('prueba.conta')),
    'ni sube vouchers', 'row-level security');
  reset role;

  -- Ventas no ve nada de esto.
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.pagos_adquisicion) = 0 and (select count(*) from public.v_cuentas_pagar) = 0,
    'Ventas no ve pagos ni cuentas por pagar');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'pagos-facturas') = 0, 'ni los vouchers');
  reset role;
end $$;

-- Nada de esto lo puede anon, y el total de una OC no se pregunta suelto.
do $$ begin
  perform test.afirmar(not has_function_privilege('anon', 'public.registrar_pago_factura(uuid, uuid, date, numeric, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.anular_pago_factura(uuid, text)', 'execute')
    and not has_function_privilege('anon', 'public.compras_sin_factura()', 'execute')
    and not has_function_privilege('anon', 'public.adquisiciones_control(uuid[])', 'execute')
    and not has_function_privilege('authenticated', 'public.total_orden_compra(uuid)', 'execute')
    and not has_table_privilege('anon', 'public.adquisiciones_ordenes_compra', 'select'),
    'anon no entra, y el total de una OC solo sale por Adquisiciones');
end $$;

rollback;
