-- El servicio se paga con IGV y la detracción va aparte (migración 20261026100000),
-- y el cliente de la cotización aprobada se ve en Cotización (20261026110000).
--
-- DKS (26/10) pidió que la ventana del pago de una OS proponga lo que de verdad
-- se le paga al proveedor (el total con IGV menos la detracción) y que
-- Tesorería vea el cliente en Cotización como ya lo ve en Cuentas por cobrar.
-- Aquí, con las cuentas de Tesorería, Logística, Contabilidad, Gerencia y
-- Almacén y `set local role authenticated`:
--   1. Lo que se debe de una OS de S/ 1,800 con detracción del 12 %: S/ 2,124
--      con IGV, S/ 255 de detracción y S/ 1,869 al proveedor.
--   2. Los pagos a cada parte, la detracción que no pasa de lo que falta, la
--      orden que no se cancela sin la detracción, y la que sí se cancela.
--   3. La OS en dólares: la detracción en soles y su parte en dólares.
--   4. La OS sin detracción no recibe una, y la versión de 10 parámetros paga
--      al proveedor.
--   5. Quién lee los saldos.
--   6. El cliente de la cotización aprobada, para Tesorería y Contabilidad, y
--      el de la que no está aprobada, no.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['COMPRADOR:LOG', 'ALMACENERO:ALM', 'GERENTE:GER', 'CONTABILIDAD:CON', 'TESORERIA:TES'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.436@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 436', lower(replace(v, ':', '.')) || '.436@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  select '2060000436' || d, 'Proveedor de prueba 436', 'Av. Argentina 436, Lima', '999 436 436' from generate_series(0, 9) d
   where public.ruc_es_valido('2060000436' || d) limit 1
  returning id::text into v;
  perform set_config('prueba.proveedor', v, true);
  foreach v in array array['os', 'usd', 'sin', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'cot', 'cot2', 'cli'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
  -- Tres órdenes aprobadas, como dueño de la tabla: S/ 1,800 con detracción del
  -- 12 % (mínimo S/ 700), US$ 1,000 a 3.75 con la misma detracción, y S/ 500 sin
  -- detracción.
  insert into public.ordenes_servicio (id, numero, proveedor_id, proveedor, descripcion, monto, monto_pen, moneda, codigo_interno,
                                       aprobacion, aprobado_por, aprobado_en, creado_por,
                                       detraccion_afecta, detraccion_codigo, detraccion_porcentaje, detraccion_minimo, detraccion_motivo)
  values (current_setting('prueba.os')::uuid, 'QA-OS-436', current_setting('prueba.proveedor')::uuid, 'Proveedor de prueba 436',
          'Servicio de prueba del check 436', 1800, 1800, 'PEN', 'QA436-OS', 'APROBADA', current_setting('prueba.gerente')::uuid, now(),
          current_setting('prueba.comprador')::uuid, true, '020', 12, 700, null),
         (current_setting('prueba.usd')::uuid, 'QA-OS-436-USD', current_setting('prueba.proveedor')::uuid, 'Proveedor de prueba 436',
          'Servicio en dólares del check 436', 1000, 3750, 'USD', 'QA436-OS', 'APROBADA', current_setting('prueba.gerente')::uuid, now(),
          current_setting('prueba.comprador')::uuid, true, '020', 12, 700, null),
         (current_setting('prueba.sin')::uuid, 'QA-OS-436-SIN', current_setting('prueba.proveedor')::uuid, 'Proveedor de prueba 436',
          'Servicio sin detracción del check 436', 500, 500, 'PEN', 'QA436-OS', 'APROBADA', current_setting('prueba.gerente')::uuid, now(),
          current_setting('prueba.comprador')::uuid, false, null, null, null, 'No llega al mínimo de la detracción');
  -- Dos cotizaciones del mismo cliente, aún por revisar; la primera con su OT.
  insert into public.clientes (id, tipo_documento, numero_documento, razon_social)
  values (current_setting('prueba.cli')::uuid, 'RUC', '20990000436', 'Cliente de prueba 436');
  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, estado, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por)
  select x.id, x.numero, current_setting('prueba.cli')::uuid, (select id from public.tipos_carroceria where activo order by orden_secuencia limit 1),
         'POR_REVISAR', 'qa-436.pdf', 'cot/' || x.id || '/qa-436.pdf', 'application/pdf', 120, current_setting('prueba.gerente')::uuid
    from (values (current_setting('prueba.cot')::uuid, 'QA-PDF-436'), (current_setting('prueba.cot2')::uuid, 'QA-PDF-436-B')) x(id, numero);
  insert into public.ordenes_trabajo (numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado, cotizacion_pdf_id)
  select 'QA-OT-436', current_setting('prueba.cli')::uuid, s.id, 'FABRICACION', 'NORMAL', 'Prueba del check 436 del cliente', 'APROBADA',
         current_setting('prueba.cot')::uuid
    from public.sedes s order by s.codigo limit 1;
end $$;
select set_config('prueba.caja', test.crear_caja('PEN')::text, true);
select set_config('prueba.caja_usd', test.crear_caja('USD')::text, true);

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.pagar(p_os text, p_pago text, p_monto numeric, p_cancela boolean, p_destino text) returns uuid
language plpgsql as $$
declare
  v_ruta text := pg_temp.id(p_os) || '/' || gen_random_uuid() || '.pdf';
  -- Al proveedor de la OS en dólares se le paga desde la cuenta en dólares; la detracción, siempre desde una en soles.
  v_caja uuid := case when p_os = 'usd' and coalesce(p_destino, 'PROVEEDOR') = 'PROVEEDOR' then pg_temp.id('caja_usd') else pg_temp.id('caja') end;
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('pagos-servicio', v_ruta, auth.uid()::text, '{"mimetype": "application/pdf", "size": 2048}');
  if p_destino is null then
    return public.registrar_pago_servicio(pg_temp.id(p_pago), pg_temp.id(p_os), current_setting('prueba.hoy')::date, p_monto, p_cancela,
      'OP-436-' || p_pago, null, v_ruta, v_caja, null);
  end if;
  return public.registrar_pago_servicio(pg_temp.id(p_pago), pg_temp.id(p_os), current_setting('prueba.hoy')::date, p_monto, p_cancela,
    'OP-436-' || p_pago, null, v_ruta, v_caja, null, p_destino);
end $$;
create or replace function pg_temp.saldo(p_os text) returns record language sql as $$
  select (s.total, s.detraccion, s.detraccion_en_moneda, s.al_proveedor, s.pagado_proveedor, s.pagado_detraccion,
          s.saldo_proveedor, s.saldo_detraccion, s.cancelada)
    from public.saldos_de_servicios(array[pg_temp.id(p_os)]) s;
$$;

-- ============================================ 1. Lo que se debe
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar(
  (select (s.total, s.detraccion, s.detraccion_en_moneda, s.al_proveedor, s.saldo_proveedor, s.saldo_detraccion)
          = (2124.00::numeric, 255::numeric, 255::numeric, 1869.00::numeric, 1869.00::numeric, 255::numeric)
     from public.saldos_de_servicios(array[pg_temp.id('os')]) s),
  'S/ 1,800 sin IGV: S/ 2,124 con IGV, S/ 255 de detracción y S/ 1,869 al proveedor');

-- ============================================ 2. Cada parte
select pg_temp.pagar('os', 'p1', 1000, false, 'PROVEEDOR');
select test.afirmar((select saldo_proveedor = 869 and saldo_detraccion = 255 from public.saldos_de_servicios(array[pg_temp.id('os')])),
  'S/ 1,000 a cuenta al proveedor: faltan S/ 869 al proveedor y la detracción entera');
select test.debe_fallar($$ select pg_temp.pagar('os', 'p2', 869, true, 'PROVEEDOR') $$,
  'la orden no se cancela mientras falte depositar la detracción', 'Falta depositar S/ 255');
select test.debe_fallar($$ select pg_temp.pagar('os', 'p2', 300, false, 'DETRACCION') $$,
  'la detracción no pasa de lo que falta depositar', 'falta depositar S/ 255');
select test.debe_fallar($$ select pg_temp.pagar('os', 'p2', 255, false, 'OTRO') $$,
  'el destino es el proveedor o la detracción', 'Elige a quién le pagas');
select pg_temp.pagar('os', 'p2', 255, false, 'DETRACCION');
select test.afirmar((select moneda = 'PEN' and destino = 'DETRACCION' from public.pagos_orden_servicio where id = pg_temp.id('p2')),
  'la detracción queda como pago en soles a la detracción');
select test.afirmar((select saldo_proveedor = 869 and saldo_detraccion = 0 and pagado_detraccion = 255
                       from public.saldos_de_servicios(array[pg_temp.id('os')])),
  'depositada la detracción, solo faltan S/ 869 al proveedor');
select pg_temp.pagar('os', 'p3', 869, true, 'PROVEEDOR');
select test.afirmar((select saldo_proveedor = 0 and saldo_detraccion = 0 and cancelada from public.saldos_de_servicios(array[pg_temp.id('os')])),
  'con los S/ 869 que la cancelan, la orden queda pagada entera');
reset role;
-- El egreso de la detracción en la caja dice qué es.
select test.afirmar(exists (select 1 from public.movimientos_caja m
                              where m.origen = 'PAGO_ORDEN_SERVICIO' and m.origen_id = pg_temp.id('p2')
                                and m.descripcion like 'Detracción de la QA-OS-436 ·%' and m.monto = 255),
  'el egreso de la detracción entra a la caja como «Detracción de la …»');
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar((select t.pago from public.trazabilidad_de_compras() t where t.id = pg_temp.id('os')) = 'PAGADA',
  'Adquisiciones lee la OS pagada');
reset role;

-- ============================================ 3. La OS en dólares
select pg_temp.como('tesoreria');
set local role authenticated;
-- US$ 1,180 con IGV; en soles S/ 4,425, con S/ 531 de detracción, que a 3.75 son US$ 141.60.
select test.afirmar(
  (select (s.moneda, s.total, s.detraccion, s.detraccion_en_moneda, s.al_proveedor)
          = ('USD'::text, 1180.00::numeric, 531::numeric, 141.60::numeric, 1038.40::numeric)
     from public.saldos_de_servicios(array[pg_temp.id('usd')]) s),
  'US$ 1,000: US$ 1,180 con IGV, S/ 531 de detracción (US$ 141.60) y US$ 1,038.40 al proveedor');
select pg_temp.pagar('usd', 'p4', 531, false, 'DETRACCION');
select pg_temp.pagar('usd', 'p5', 1038.40, true, 'PROVEEDOR');
select test.afirmar((select moneda from public.pagos_orden_servicio where id = pg_temp.id('p4')) = 'PEN'
                and (select moneda from public.pagos_orden_servicio where id = pg_temp.id('p5')) = 'USD',
  'en la OS en dólares la detracción va en soles y el pago al proveedor en dólares');
select test.afirmar((select saldo_proveedor = 0 and saldo_detraccion = 0 and cancelada from public.saldos_de_servicios(array[pg_temp.id('usd')])),
  'la OS en dólares queda pagada entera');

-- ============================================ 4. Sin detracción, y la versión vieja
select test.debe_fallar($$ select pg_temp.pagar('sin', 'p6', 50, false, 'DETRACCION') $$,
  'la OS sin detracción no recibe una', 'no lleva detracción');
select pg_temp.pagar('sin', 'p6', 590, true, null);
select test.afirmar((select destino = 'PROVEEDOR' and cancela from public.pagos_orden_servicio where id = pg_temp.id('p6')),
  'la versión de 10 parámetros paga al proveedor, y la OS sin detracción se cancela');
select test.afirmar((select total = 590 and al_proveedor = 590 and saldo_proveedor = 0 from public.saldos_de_servicios(array[pg_temp.id('sin')])),
  'la OS sin detracción: S/ 590 con IGV, todo al proveedor');
-- Anular el pago que canceló devuelve lo que falta.
select public.anular_pago_servicio(pg_temp.id('p6'), 'El voucher era de otra orden de servicio');
select test.afirmar((select saldo_proveedor = 590 and not cancelada from public.saldos_de_servicios(array[pg_temp.id('sin')])),
  'anulado el pago, vuelven a faltar los S/ 590');
reset role;

-- ============================================ 5. Quién lee los saldos
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar($$ select * from public.saldos_de_servicios(array[pg_temp.id('os')]) $$,
  'Almacén no lee los saldos de los servicios', 'No tienes permiso');
select test.debe_fallar($$ select public.registrar_pago_servicio(pg_temp.id('p7'), pg_temp.id('sin'), current_setting('prueba.hoy')::date, 10, false,
                              null, null, 'x/y.pdf', pg_temp.id('caja'), null, 'PROVEEDOR') $$,
  'Almacén no paga servicios', 'tesoreria.pagar_servicios');
reset role;

-- ============================================ 6. El cliente de la cotización
select pg_temp.como('gerente');
set local role authenticated;
update public.cotizaciones_pdf set estado = 'APROBADA' where id = pg_temp.id('cot');
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select cliente from public.v_cotizaciones_pdf where id = pg_temp.id('cot')) is null,
  'Tesorería sigue sin ver el padrón de clientes en la vista');
select test.afirmar(
  (select array_agg(cliente) from public.clientes_de_cotizaciones(array[pg_temp.id('cot'), pg_temp.id('cot2')])) = array['Cliente de prueba 436'],
  'Tesorería ve el cliente de la cotización aprobada, y no el de la que está por revisar');
select test.afirmar(not exists (select 1 from public.clientes where id = pg_temp.id('cli')),
  'Tesorería no lee la ficha del cliente');
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar(
  (select cliente from public.clientes_de_cotizaciones(array[pg_temp.id('cot')])) = 'Cliente de prueba 436',
  'Contabilidad también ve el cliente de la cotización aprobada');
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar($$ select * from public.clientes_de_cotizaciones(array[pg_temp.id('cot')]) $$,
  'Almacén no ve el cliente de las cotizaciones', 'No tienes permiso');
reset role;

rollback;
