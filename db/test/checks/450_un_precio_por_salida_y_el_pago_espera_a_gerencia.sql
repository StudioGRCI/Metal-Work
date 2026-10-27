-- Lo que halló la revisión del 27/10/2026 en la base (migraciones 20261027100000
-- y 20261027110000):
--   1. Una salida del almacén tiene un solo precio: el congelado, el del último
--      ingreso hasta ese día o el que fijó Logística. Lo leen igual el costeo del
--      código, el de la OT y la Valorización.
--   2. La factura de una OC que Gerencia no aprobó no se paga, y Cuentas por
--      pagar lo sabe por `adquisiciones_control`.
--   3. El historial no deja leer lo que la tabla tapa.
-- Cada paso con el rol que lo hace —nunca ADMIN— y `set local role authenticated`.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000450', 'PRUEBAS 450 S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA450', 'Taller prueba 450') on conflict (codigo) do nothing;

select test.crear_usuario('Lola', 'Logística', 'logistica450@demo.pe', 'COMPRADOR', (select id from public.sedes where codigo = 'QA450')) as compras_id \gset
select test.crear_usuario('Coni', 'Contable', 'contabilidad450@demo.pe', 'CONTABILIDAD', (select id from public.sedes where codigo = 'QA450')) as conta_id \gset
select test.crear_usuario('Teo', 'Tesoro', 'tesoreria450@demo.pe', 'TESORERIA', (select id from public.sedes where codigo = 'QA450')) as teso_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia450@demo.pe', 'GERENTE', (select id from public.sedes where codigo = 'QA450')) as gerente_id \gset
select test.crear_usuario('Susi', 'Supervisión', 'supgeneral450@demo.pe', 'SUPERVISOR_GENERAL', (select id from public.sedes where codigo = 'QA450')) as supgen_id \gset

select set_config('prueba.compras', :'compras_id', true);
select set_config('prueba.conta', :'conta_id', true);
select set_config('prueba.teso', :'teso_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.supgen', :'supgen_id', true);
select set_config('prueba.caja', test.crear_caja()::text, true);
select set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

-- ---------------------------------------------------------------- 1. el precio
do $$
declare v_mat uuid; v_sin uuid; r record;
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id) values
    ('CHK450-A', 'Plancha de prueba 450',
     (select id from public.categorias_material where activo order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND')),
    ('CHK450-B', 'Consumible sin compra 450',
     (select id from public.categorias_material where activo order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND'));
  v_mat := (select id from public.materiales where codigo = 'CHK450-A');
  v_sin := (select id from public.materiales where codigo = 'CHK450-B');
  perform set_config('prueba.mat', v_mat::text, true);

  -- Sin ingreso ni precio de Logística: no hay precio, y nadie se lo inventa.
  select * into r from public.precio_de_salida(v_mat, now());
  perform test.afirmar(r.precio is null and r.origen is null, 'sin compra ni precio de Logística, la salida queda sin precio');

  -- Logística fija 6.00 mañana: una salida de hoy toma el primero después.
  insert into public.valorizaciones_material (id, material_id, precio, moneda, vigente_desde, observacion, registrado_por)
  values (gen_random_uuid(), v_mat, 6.00, 'PEN', now() + interval '1 day', 'Precio de prueba 450', current_setting('prueba.compras')::uuid);
  select * into r from public.precio_de_salida(v_mat, now());
  perform test.afirmar(r.precio = 6.00 and r.moneda = 'PEN' and r.origen = 'LOGISTICA',
    'sin compra, el precio de Logística (el primero después, si lo fijó más tarde)');

  -- Entra con 8.50 hace dos días: desde ahí manda el último ingreso.
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             precio_unitario, moneda, registrado_en)
  values (gen_random_uuid(), 'INGRESO', v_mat, 10, 'INGRESO_GENERAL', 'GR 450-1', current_setting('prueba.compras')::uuid,
          8.50, 'PEN', now() - interval '2 days');
  select * into r from public.precio_de_salida(v_mat, now());
  perform test.afirmar(r.precio = 8.50 and r.origen = 'COMPRA', 'con compra, el precio del último ingreso');
  select * into r from public.precio_de_salida(v_mat, now() - interval '3 days');
  perform test.afirmar(r.precio = 6.00 and r.origen = 'LOGISTICA', 'el ingreso de después no valoriza la salida de antes');
  select * into r from public.precio_de_salida(v_mat, now(), 7.25, 'USD');
  perform test.afirmar(r.precio = 7.25 and r.moneda = 'USD' and r.origen = 'SALIDA', 'el precio congelado en la salida manda');

  -- Las tres fuentes leen la misma función: ninguna busca el precio por su lado.
  perform test.afirmar((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public'
                           and p.proname in ('codigo_interno_lineas', 'detalle_costeo_ot', 'materiales_para_valorizar')
                           and p.prosrc like '%precio_de_salida(%') = 3,
    'el costeo del código, el de la OT y la Valorización usan precio_de_salida');
  perform test.afirmar(not has_function_privilege('authenticated', 'public.precio_de_salida(uuid, timestamptz, numeric, text, uuid)', 'execute'),
    'la función de precio es un cálculo interno: la sesión no la llama');
end $$;

-- Logística ve en Valorización la última compra que el costeo usa.
do $$
declare r record;
begin
  perform test.como_usuario(current_setting('prueba.compras')::uuid);
  set local role authenticated;
  select * into r from public.materiales_para_valorizar() where material_id = current_setting('prueba.mat')::uuid;
  perform test.afirmar(r.ultima_compra = 8.50 and r.moneda_compra = 'PEN' and r.precio = 6.00,
    'Valorización muestra la compra del ingreso (8.50) y el precio de Logística aparte (6.00)');
  reset role;
end $$;

-- ------------------------------------------- 2. la factura espera a Gerencia
do $$
declare v_mat uuid := current_setting('prueba.mat')::uuid; r record;
begin
  insert into public.proveedores (numero_documento, razon_social) values ('20100450004', 'PROVEEDOR 450')
  on conflict (tipo_documento, numero_documento) do update set activo = true;
  perform set_config('prueba.oc', gen_random_uuid()::text, true);
  perform set_config('prueba.fac', gen_random_uuid()::text, true);
  insert into public.ordenes_compra_materiales (id, proveedor_id, proveedor, referencia, condicion_pago, dias_credito, moneda,
                                                origen, motivo, con_factura, creado_por, aprobacion, aprobacion_pedida_en)
  select current_setting('prueba.oc')::uuid, p.id, p.razon_social, 'QA450-OC', 'CONTADO', 0, 'PEN',
         'DIRECTA', 'Reposición de prueba 450', true, current_setting('prueba.compras')::uuid, 'POR_APROBAR', now()
    from public.proveedores p where p.numero_documento = '20100450004';
  insert into public.orden_compra_material_detalles (orden_compra_id, cantidad, precio_unitario, material_id)
  values (current_setting('prueba.oc')::uuid, 10, 10.00, v_mat);
end $$;

-- Contabilidad registra la factura de esa OC con su PDF.
do $$
begin
  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  insert into public.adquisiciones (id, orden_compra_id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
  values (current_setting('prueba.fac')::uuid, current_setting('prueba.oc')::uuid, 'FACTURA_COMPRA', 'PROVEEDOR 450', 'F001-450',
          current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'PEN', 118, 'CONTADO');
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('comprobantes-financieros', 'adquisiciones/' || current_setting('prueba.fac') || '/comprobante.pdf', current_setting('prueba.conta'),
          '{"mimetype": "application/pdf", "size": 2048}');
  update public.adquisiciones set ruta_storage = 'adquisiciones/' || current_setting('prueba.fac') || '/comprobante.pdf', estado = 'REGISTRADA'
   where id = current_setting('prueba.fac')::uuid;
  reset role;
end $$;

select set_config('prueba.pago', gen_random_uuid()::text, true);
select set_config('prueba.pago_ruta', current_setting('prueba.fac') || '/' || current_setting('prueba.pago') || '.pdf', true);

do $$
declare r record; v uuid;
begin
  perform test.como_usuario(current_setting('prueba.teso')::uuid);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('pagos-facturas', current_setting('prueba.pago_ruta'), current_setting('prueba.teso'), '{"mimetype": "application/pdf", "size": 900}');

  select * into r from public.adquisiciones_control(array[current_setting('prueba.fac')::uuid]);
  perform test.afirmar(r.ordenes -> 0 ->> 'aprobacion' = 'POR_APROBAR', 'Cuentas por pagar sabe que la OC de la factura espera a Gerencia');
  perform test.debe_fallar(format('select public.registrar_pago_factura(%L, %L, %L, 118, ''OP-450-1'', %L, %L, null)',
      current_setting('prueba.pago'), current_setting('prueba.fac'), current_setting('prueba.hoy'),
      current_setting('prueba.pago_ruta'), current_setting('prueba.caja')),
    'Tesorería no paga la factura de una OC por aprobar', 'espera la aprobación de Gerencia');
  perform test.afirmar((select pagado from public.v_cuentas_pagar where id = current_setting('prueba.fac')::uuid) = 0,
    'y la factura sigue sin pagar');
  reset role;

  -- Gerencia la aprueba.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform public.aprobar_compra(current_setting('prueba.oc')::uuid);
  reset role;

  perform test.como_usuario(current_setting('prueba.teso')::uuid);
  set local role authenticated;
  select * into r from public.adquisiciones_control(array[current_setting('prueba.fac')::uuid]);
  perform test.afirmar(r.ordenes -> 0 ->> 'aprobacion' = 'APROBADA', 'aprobada, la factura ya no espera');
  v := public.registrar_pago_factura(current_setting('prueba.pago')::uuid, current_setting('prueba.fac')::uuid,
         current_setting('prueba.hoy')::date, 118, 'OP-450-1', current_setting('prueba.pago_ruta'), current_setting('prueba.caja')::uuid, null);
  perform test.afirmar((select saldo from public.v_cuentas_pagar where id = current_setting('prueba.fac')::uuid) = 0,
    'con la OC aprobada, Tesorería la paga');
  reset role;
end $$;

-- ------------------------------------------ 3. el historial, con su llave
do $$
declare v_ids bigint[];
begin
  with nuevas as (
    insert into public.audit_log (tabla, registro_id, accion, datos_despues)
    select t, gen_random_uuid(), 'INSERT', jsonb_build_object('monto', 999.99, 'prueba', 450)
      from unnest(array['subcontratos', 'recibos_honorarios', 'pagos_adquisicion', 'adquisiciones', 'permisos_personal', 'observaciones_personal']) t
    returning id)
  select array_agg(id) into v_ids from nuevas;
  perform set_config('prueba.audit', v_ids::text, true);

  perform test.como_usuario(current_setting('prueba.supgen')::uuid);
  set local role authenticated;
  perform test.afirmar(public.tiene_permiso('auditoria.ver'), 'Supervisión general abre el historial');
  perform test.afirmar((select count(*) from public.audit_log where id = any (current_setting('prueba.audit')::bigint[])) = 0,
    'pero no lee ahí montos ni datos del personal que sus tablas le tapan');
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.audit_log where id = any (current_setting('prueba.audit')::bigint[])) = 6,
    'Gerencia, que tiene la llave de cada tabla, los lee');
  reset role;
end $$;

rollback;
