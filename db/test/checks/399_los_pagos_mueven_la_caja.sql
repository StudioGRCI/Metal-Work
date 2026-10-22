-- Los pagos y los cobros del sistema mueven la caja diaria solos (migración
-- 20261019100000, «Conectar ya» de DKS el 19/10). Tesorería paga una factura de
-- compra, una orden de servicio, un recibo por honorarios y la planilla diaria,
-- y cobra una factura de venta: cada uno pide la cuenta y deja su movimiento ahí.
-- Anular el pago anula su movimiento; un día cerrado no se toca (la devolución
-- entra hoy); lo anotado a mano no se cuenta dos veces; lo de antes del
-- saldo inicial no mueve la cuenta; otra moneda pide lo que salió de la cuenta.
-- Todo con la cuenta de Tesorería y `set local role authenticated`; Gerencia,
-- que consulta, no paga. Termina en rollback.
\set ON_ERROR_STOP on
begin;

-- En Supabase el bucket ya trae RLS y el permiso; el shim no.
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.sedes (codigo, nombre) values ('QA98', 'Taller prueba de la caja 398') on conflict (codigo) do nothing;
select test.crear_usuario('Tea', 'Tesoro', 'tesoreria398@demo.pe', 'TESORERIA', (select id from public.sedes where codigo = 'QA98')) as teso_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia398@demo.pe', 'GERENTE', (select id from public.sedes where codigo = 'QA98')) as gerente_id \gset
select test.crear_usuario('Coni', 'Contable', 'contabilidad398@demo.pe', 'CONTABILIDAD', (select id from public.sedes where codigo = 'QA98')) as conta_id \gset
select test.crear_usuario('Teo', 'Tesoro', 'tesoreria398b@demo.pe', 'TESORERIA', (select id from public.sedes where codigo = 'QA98')) as teso2_id \gset
select set_config('prueba.teso', :'teso_id', true);
select set_config('prueba.teso2', :'teso2_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.conta', :'conta_id', true);
select set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);

-- Las cuentas: soles y dólares desde hace un mes, una que empieza hoy, una
-- desactivada y una para probar los cierres.
select set_config('prueba.cpen', test.crear_caja('PEN')::text, true);
select set_config('prueba.cusd', test.crear_caja('USD')::text, true);
select set_config('prueba.cnueva', test.crear_caja('PEN', current_setting('prueba.hoy')::date)::text, true);
select set_config('prueba.cinactiva', test.crear_caja('PEN')::text, true);
select set_config('prueba.ccierre', test.crear_caja('PEN')::text, true);
update public.cajas set activa = false where id = current_setting('prueba.cinactiva')::uuid;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform test.como_usuario(current_setting('prueba.' || p_clave)::uuid);
end $$;

-- Un voucher subido por Tesorería en el bucket y la carpeta del documento.
create or replace function pg_temp.voucher(p_bucket text, p_carpeta text) returns text language plpgsql as $$
declare v_ruta text := p_carpeta || '/' || gen_random_uuid() || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values (p_bucket, v_ruta, current_setting('prueba.teso'), '{"mimetype": "application/pdf", "size": 2048}');
  return v_ruta;
end $$;

-- El movimiento vigente que dejó un pago (egreso) o un cobro (ingreso); la
-- devolución de una anulación en un día cerrado es del otro tipo.
create or replace function pg_temp.mov(p_origen text, p_id text) returns public.movimientos_caja language sql as $$
  select * from public.movimientos_caja where origen = p_origen and origen_id = p_id::uuid and anulado_en is null
     and tipo = case when p_origen = 'COBRO_FACTURA_VENTA' then 'INGRESO' else 'EGRESO' end
$$;

-- ------------------------------------------------------------------ armazón
-- Los cinco documentos que Tesorería paga o cobra, como dueño de las tablas.
do $$
declare
  v_hoy   date := current_setting('prueba.hoy')::date;
  v_prov  uuid;
  v_cli   uuid;
  v_cot   uuid := gen_random_uuid();
  v_sub   uuid := gen_random_uuid();
  v_trab  uuid;
  v_dni   text;
  v text;
begin
  foreach v in array array['adq1', 'adq2', 'os', 'fv', 'sc', 'rec', 'pd', 'pp1', 'pp2', 'pp3'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;

  insert into public.proveedores (numero_documento, razon_social)
  select '2010039800' || d, 'PROVEEDOR 398' from generate_series(0, 9) d
   where public.ruc_es_valido('2010039800' || d) limit 1
  on conflict (tipo_documento, numero_documento) do update set activo = true
  returning id into v_prov;

  -- Facturas de compra (las registra Contabilidad, como en el 390).
  perform pg_temp.como('conta');
  insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
  values (current_setting('prueba.adq1')::uuid, 'FACTURA_COMPRA', 'PROVEEDOR 398', 'F001-398', v_hoy - 10, v_hoy - 10, 'PEN', 1180, 'CONTADO'),
         (current_setting('prueba.adq2')::uuid, 'FACTURA_COMPRA', 'PROVEEDOR 398', 'F001-399', v_hoy - 10, v_hoy - 10, 'USD', 100, 'CONTADO');
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  select 'comprobantes-financieros', 'adquisiciones/' || x || '/comprobante.pdf', current_setting('prueba.conta'),
         '{"mimetype": "application/pdf", "size": 2048}'
    from unnest(array[current_setting('prueba.adq1'), current_setting('prueba.adq2')]) x;
  update public.adquisiciones set ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf', estado = 'REGISTRADA'
   where id in (current_setting('prueba.adq1')::uuid, current_setting('prueba.adq2')::uuid);

  -- Una orden de servicio aprobada, con su código interno.
  insert into public.ordenes_servicio (id, numero, proveedor_id, proveedor, descripcion, monto, moneda, codigo_interno,
                                       aprobacion, aprobado_por, aprobado_en)
  values (current_setting('prueba.os')::uuid, 'QA-OS-398', v_prov, 'PROVEEDOR 398', 'Servicio de prueba del check 399',
          500, 'PEN', 'QA398-OS', 'APROBADA', current_setting('prueba.gerente')::uuid, now());

  -- Una factura de venta en dólares, de una cotización.
  insert into public.clientes (tipo_documento, numero_documento, razon_social, direccion_fiscal, distrito)
  select 'RUC', '2099039800' || d, 'QA CLIENTE 398', 'Av. de Prueba 398', 'Trujillo' from generate_series(0, 9) d
   where public.ruc_es_valido('2099039800' || d) limit 1
  returning id into v_cli;
  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, estado, nombre_archivo, ruta_storage, mime_type,
                                       tamano_bytes, registrado_por, monto_venta, moneda)
  values (v_cot, 'QA-398-1', v_cli, (select id from public.tipos_carroceria where activo order by orden_secuencia limit 1),
          'POR_REVISAR', 'qa-398-1.pdf', 'cot/' || v_cot || '/qa-398-1.pdf', 'application/pdf', 120, current_setting('prueba.conta')::uuid,
          1000, 'USD');
  insert into public.facturas_venta (id, codigo_interno, cotizacion_pdf_id, cotizacion_numero, cliente, numero, fecha_emision,
                                     fecha_vencimiento, moneda, total, ruta_storage, nombre_archivo, tamano_bytes, registrado_por)
  values (current_setting('prueba.fv')::uuid, 'QA398-V', v_cot, 'QA-398-1', 'QA CLIENTE 398', 'E001-398', v_hoy - 10, v_hoy,
          'USD', 1000, 'fv/qa-398.pdf', 'qa-398.pdf', 120, current_setting('prueba.conta')::uuid);

  -- Un recibo por honorarios de 1 000 con 8 % de retención: se pagan 920.
  insert into public.subcontratistas (id, ruc, nombre)
  select v_sub, '1071239800' || d, 'SUBCONTRATISTA 398' from generate_series(0, 9) d
   where public.ruc_es_valido('1071239800' || d) limit 1;
  insert into public.subcontratos (id, numero, subcontratista_id, codigo_interno, descripcion, moneda, monto)
  values (current_setting('prueba.sc')::uuid, 'QA-SC-398', v_sub, 'QA398-SC', 'Subcontrato de prueba del check 399', 'PEN', 1000);
  insert into public.recibos_honorarios (id, subcontrato_id, subcontratista_id, numero, fecha_emision, moneda, monto_bruto,
                                         retencion_porcentaje, archivo_ruta, archivo_mime, archivo_tamano)
  values (current_setting('prueba.rec')::uuid, current_setting('prueba.sc')::uuid, v_sub, 'E001-398', v_hoy - 3, 'PEN', 1000, 8,
          current_setting('prueba.sc') || '/' || gen_random_uuid() || '.pdf', 'application/pdf', 2048);

  -- Una planilla diaria de ayer con tres personas: S/ 100, S/ 200 y S/ 50.
  insert into public.planillas_diarias (id, numero, fecha, personas, total)
  values (current_setting('prueba.pd')::uuid, 'QA-PD-398', v_hoy - 1, 3, 350);
  foreach v in array array['pp1:100', 'pp2:200', 'pp3:50'] loop
    select lpad(n::text, 8, '0') into v_dni from generate_series(79839800, 79839899) n
     where not exists (select 1 from public.trabajadores t where t.dni = lpad(n::text, 8, '0')) limit 1;
    insert into public.trabajadores (nombres, apellidos, dni) values ('Persona', 'Check 398', v_dni) returning id into v_trab;
    insert into public.planilla_diaria_personas (id, planilla_id, trabajador_id, nombre, horas_ordinarias, horas_extras,
                                                 monto_ordinarias, monto_extras, total)
    values (current_setting('prueba.' || split_part(v, ':', 1))::uuid, current_setting('prueba.pd')::uuid, v_trab,
            'Persona Check 398', 8, 0, split_part(v, ':', 2)::numeric, 0, split_part(v, ':', 2)::numeric);
  end loop;

  foreach v in array array['pago1', 'pago2', 'pago3', 'pago4', 'pago5', 'pago6', 'pago7', 'pago8', 'pago9', 'manual'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;

-- ------------------------------------------- 1. La factura de compra
do $$
declare
  v_hoy  date := current_setting('prueba.hoy')::date;
  v_ruta text;
  m      public.movimientos_caja;
begin
  perform pg_temp.como('teso');
  set local role authenticated;
  v_ruta := pg_temp.voucher('pagos-facturas', current_setting('prueba.adq1'));

  perform test.debe_fallar(format('select public.registrar_pago_factura(%L, %L, %L, 500, ''OP-398-1'', %L, null, null)',
      current_setting('prueba.pago1'), current_setting('prueba.adq1'), v_hoy, v_ruta),
    'sin cuenta no se paga', 'Elige la cuenta de la que salió el pago');
  perform test.debe_fallar(format('select public.registrar_pago_factura(%L, %L, %L, 500, ''OP-398-1'', %L, %L, null)',
      current_setting('prueba.pago1'), current_setting('prueba.adq1'), v_hoy, v_ruta, gen_random_uuid()),
    'una cuenta que no existe no paga', 'Esa cuenta no existe');
  perform test.debe_fallar(format('select public.registrar_pago_factura(%L, %L, %L, 500, ''OP-398-1'', %L, %L, null)',
      current_setting('prueba.pago1'), current_setting('prueba.adq1'), v_hoy, v_ruta, current_setting('prueba.cinactiva')),
    'una cuenta desactivada no paga', 'está desactivada');
  perform test.debe_fallar(format('select public.registrar_pago_factura(%L, %L, %L, 500, ''OP-398-1'', %L)',
      current_setting('prueba.pago1'), current_setting('prueba.adq1'), v_hoy, v_ruta),
    'la versión vieja, sin cuenta, ya no paga', 'Vuelve a cargar la pantalla');

  perform public.registrar_pago_factura(current_setting('prueba.pago1')::uuid, current_setting('prueba.adq1')::uuid, v_hoy, 500,
    'OP-398-1', v_ruta, current_setting('prueba.cpen')::uuid, null);
  perform public.registrar_pago_factura(current_setting('prueba.pago1')::uuid, current_setting('prueba.adq1')::uuid, v_hoy, 500,
    'OP-398-1', v_ruta, current_setting('prueba.cpen')::uuid, null);
  m := pg_temp.mov('PAGO_ADQUISICION', current_setting('prueba.pago1'));
  perform test.afirmar(m.caja_id = current_setting('prueba.cpen')::uuid and m.tipo = 'EGRESO' and m.monto = 500 and m.fecha = v_hoy
      and m.descripcion = 'Pago de la factura F001-398 · PROVEEDOR 398' and m.operacion = 'OP-398-1' and m.tipo_cambio is null
      and m.registrado_por = current_setting('prueba.teso')::uuid,
    'el pago deja su egreso en la cuenta elegida, con la factura, el proveedor y la operación');
  perform test.afirmar((select count(*) from public.movimientos_caja where origen = 'PAGO_ADQUISICION'
                         and origen_id = current_setting('prueba.pago1')::uuid) = 1,
    'pagar dos veces el mismo formulario deja un solo egreso');
  -- Con otro voucher ya no es el mismo envío: se perdió la respuesta, se volvió
  -- a pulsar y la pantalla subió el archivo a otra ruta (migración 20261022160000).
  perform test.debe_fallar(format('select public.registrar_pago_factura(%L, %L, %L, 500, ''OP-398-1'', %L, %L, null)',
      current_setting('prueba.pago1'), current_setting('prueba.adq1'), v_hoy,
      pg_temp.voucher('pagos-facturas', current_setting('prueba.adq1')), current_setting('prueba.cpen')),
    'el mismo formulario con otro voucher no se da por pagado', 'ya quedó registrado con otro comprobante');
  perform test.afirmar((select egresos = 500 and saldo_final = -500 from public.caja_del_dia(v_hoy)
                         where caja_id = current_setting('prueba.cpen')::uuid),
    'la caja del día lo cuenta en los egresos y en el saldo');

  -- La factura en dólares, desde la cuenta en soles.
  v_ruta := pg_temp.voucher('pagos-facturas', current_setting('prueba.adq2'));
  perform test.debe_fallar(format('select public.registrar_pago_factura(%L, %L, %L, 100, ''OP-398-2'', %L, %L, null)',
      current_setting('prueba.pago2'), current_setting('prueba.adq2'), v_hoy, v_ruta, current_setting('prueba.cpen')),
    'en otra moneda pide lo que salió de la cuenta', 'escribe cuánto salió en soles');
  perform test.debe_fallar(format('select public.registrar_pago_factura(%L, %L, %L, 100, ''OP-398-2'', %L, %L, 37)',
      current_setting('prueba.pago2'), current_setting('prueba.adq2'), v_hoy, v_ruta, current_setting('prueba.cpen')),
    'un dólar a S/ 0.37 es un monto mal escrito', 'el dólar sale a S/ 0.370');
  perform public.registrar_pago_factura(current_setting('prueba.pago2')::uuid, current_setting('prueba.adq2')::uuid, v_hoy, 100,
    'OP-398-2', v_ruta, current_setting('prueba.cpen')::uuid, 370);
  m := pg_temp.mov('PAGO_ADQUISICION', current_setting('prueba.pago2'));
  perform test.afirmar(m.monto = 370 and m.tipo_cambio = 3.7 and m.caja_id = current_setting('prueba.cpen')::uuid,
    'sale de la cuenta lo que dice el estado de cuenta, con su tipo de cambio');
  perform test.afirmar((select monto = 100 from public.pagos_adquisicion where id = current_setting('prueba.pago2')::uuid),
    'y la factura queda pagada en su moneda');

  -- De antes del saldo inicial: el pago entra y la cuenta no se mueve.
  v_ruta := pg_temp.voucher('pagos-facturas', current_setting('prueba.adq1'));
  perform public.registrar_pago_factura(current_setting('prueba.pago3')::uuid, current_setting('prueba.adq1')::uuid, v_hoy - 5, 100,
    'OP-398-3', v_ruta, current_setting('prueba.cnueva')::uuid, null);
  perform test.afirmar(exists (select 1 from public.pagos_adquisicion where id = current_setting('prueba.pago3')::uuid)
      and not exists (select 1 from public.movimientos_caja where origen_id = current_setting('prueba.pago3')::uuid),
    'un pago de antes del saldo inicial queda registrado sin mover la cuenta: ya está en ese saldo');

  -- Anular el pago anula su egreso, con el mismo motivo.
  perform test.debe_fallar(format('select public.anular_movimiento_caja(%L, ''Se anula suelto en la caja'')', m.id),
    'el egreso de un pago no se anula suelto en la caja', 'se anula anulando ese pago');
  perform public.anular_pago_factura(current_setting('prueba.pago2')::uuid, 'El banco devolvió la transferencia');
  perform test.afirmar((select anulado_en is not null and motivo_anulacion = 'El banco devolvió la transferencia'
                              and anulado_por = current_setting('prueba.teso')::uuid
                         from public.movimientos_caja where id = m.id),
    'anular el pago anula su egreso con el mismo motivo');
  perform test.afirmar((select egresos = 500 from public.caja_del_dia(v_hoy) where caja_id = current_setting('prueba.cpen')::uuid),
    'y la caja deja de contarlo');
  reset role;
end $$;

-- ------------------------------------------- 2. La orden de servicio, con su código
do $$
declare
  v_hoy  date := current_setting('prueba.hoy')::date;
  v_ruta text;
  m      public.movimientos_caja;
begin
  perform pg_temp.como('teso');
  set local role authenticated;
  v_ruta := pg_temp.voucher('pagos-servicio', current_setting('prueba.os'));
  perform test.debe_fallar(format('select public.registrar_pago_servicio(%L, %L, %L, 500, true, ''OP-398-4'', null, %L)',
      current_setting('prueba.pago4'), current_setting('prueba.os'), v_hoy, v_ruta),
    'la versión vieja del pago de servicio ya no paga', 'Vuelve a cargar la pantalla');
  perform public.registrar_pago_servicio(current_setting('prueba.pago4')::uuid, current_setting('prueba.os')::uuid, v_hoy, 500, true,
    'OP-398-4', null, v_ruta, current_setting('prueba.cpen')::uuid, null);
  m := pg_temp.mov('PAGO_ORDEN_SERVICIO', current_setting('prueba.pago4'));
  perform test.afirmar(m.tipo = 'EGRESO' and m.monto = 500 and m.codigo_interno = 'QA398-OS'
      and m.descripcion = 'Pago de la QA-OS-398 · PROVEEDOR 398',
    'el pago del servicio deja su egreso con el código interno de la OS');
  -- El mismo envío repetido entra una vez; con otro comprobante, u otra persona
  -- con el mismo, no es el mismo envío (migración 20261022160000).
  perform test.afirmar(public.registrar_pago_servicio(current_setting('prueba.pago4')::uuid, current_setting('prueba.os')::uuid,
      v_hoy, 500, true, 'OP-398-4', null, v_ruta, current_setting('prueba.cpen')::uuid, null) = current_setting('prueba.pago4')::uuid
      and (select count(*) from public.pagos_orden_servicio where id = current_setting('prueba.pago4')::uuid) = 1,
    'el pago del servicio repetido con su comprobante devuelve el mismo pago');
  perform test.debe_fallar(format('select public.registrar_pago_servicio(%L, %L, %L, 500, true, ''OP-398-4'', null, %L, %L, null)',
      current_setting('prueba.pago4'), current_setting('prueba.os'), v_hoy,
      pg_temp.voucher('pagos-servicio', current_setting('prueba.os')), current_setting('prueba.cpen')),
    'el pago del servicio con otro comprobante no se da por pagado', 'ya quedó registrado con otro comprobante');
  reset role;
  perform pg_temp.como('teso2');
  set local role authenticated;
  perform test.debe_fallar(format('select public.registrar_pago_servicio(%L, %L, %L, 500, true, ''OP-398-4'', null, %L, %L, null)',
      current_setting('prueba.pago4'), current_setting('prueba.os'), v_hoy, v_ruta, current_setting('prueba.cpen')),
    'otra persona con el mismo id y el mismo comprobante no lo da por pagado', 'ya quedó registrado con otro comprobante');
  reset role;
  perform pg_temp.como('teso');
  set local role authenticated;

  -- Un egreso escrito a mano con el mismo código, para ver qué cuenta el costeo.
  perform public.registrar_movimiento_caja(current_setting('prueba.manual')::uuid, current_setting('prueba.cpen')::uuid, v_hoy,
    'EGRESO', 25, 'Movilidad para el servicio', 'QA398-OS', null, null);
  reset role;

  -- (como dueño: la función no se da a nadie)
  perform test.afirmar((select count(*) = 1 and sum(monto) = 25 from public.codigo_interno_lineas_caja('QA398-OS')),
    'el costeo del código suma el egreso a mano y no el del pago de la OS, que ya está contado');

  perform pg_temp.como('teso');
  set local role authenticated;
  perform public.anular_pago_servicio(current_setting('prueba.pago4')::uuid, 'Se pagó a otra cuenta del proveedor');
  perform test.afirmar((pg_temp.mov('PAGO_ORDEN_SERVICIO', current_setting('prueba.pago4'))).id is null
      and (select anulado_en is not null from public.movimientos_caja where id = m.id),
    'anular el pago del servicio anula su egreso');
  reset role;
end $$;

-- ------------------------------------------- 3. El cobro de la factura de venta
do $$
declare
  v_hoy  date := current_setting('prueba.hoy')::date;
  v_ruta text;
  m      public.movimientos_caja;
begin
  perform pg_temp.como('teso');
  set local role authenticated;
  v_ruta := pg_temp.voucher('cobros-venta', current_setting('prueba.fv'));
  perform test.debe_fallar(format('select public.registrar_cobro_factura(%L, %L, %L, 400, false, ''OP-398-5'', %L, null, null)',
      current_setting('prueba.pago5'), current_setting('prueba.fv'), v_hoy, v_ruta),
    'sin cuenta no se cobra', 'Elige la cuenta a la que entró el cobro');
  perform test.debe_fallar(format('select public.registrar_cobro_factura(%L, %L, %L, 400, false, ''OP-398-5'', %L)',
      current_setting('prueba.pago5'), current_setting('prueba.fv'), v_hoy, v_ruta),
    'la versión vieja del cobro ya no cobra', 'el cobro ahora pide a qué cuenta');
  perform public.registrar_cobro_factura(current_setting('prueba.pago5')::uuid, current_setting('prueba.fv')::uuid, v_hoy, 400, false,
    'OP-398-5', v_ruta, current_setting('prueba.cusd')::uuid, null);
  m := pg_temp.mov('COBRO_FACTURA_VENTA', current_setting('prueba.pago5'));
  perform test.afirmar(m.tipo = 'INGRESO' and m.monto = 400 and m.caja_id = current_setting('prueba.cusd')::uuid
      and m.codigo_interno = 'QA398-V' and m.descripcion = 'Cobro de la factura E001-398 · QA CLIENTE 398',
    'el cobro deja su ingreso en la cuenta en dólares, con el código interno');
  perform test.afirmar(public.registrar_cobro_factura(current_setting('prueba.pago5')::uuid, current_setting('prueba.fv')::uuid, v_hoy,
                         400, false, 'OP-398-5', v_ruta, current_setting('prueba.cusd')::uuid, null) = current_setting('prueba.pago5')::uuid
                       and (select count(*) from public.cobros_factura_venta where id = current_setting('prueba.pago5')::uuid) = 1,
    'el mismo cobro repetido, con su voucher, se reconoce sin duplicarse');
  perform test.debe_fallar(format('select public.registrar_cobro_factura(%L, %L, %L, 400, false, ''OP-398-5'', %L, %L, null)',
      current_setting('prueba.pago5'), current_setting('prueba.fv'), v_hoy,
      pg_temp.voucher('cobros-venta', current_setting('prueba.fv')), current_setting('prueba.cusd')),
    'con otro voucher no se da por cobrado', 'ya quedó registrado con otro voucher');

  -- Un cobro en dólares que entró a la cuenta en soles.
  v_ruta := pg_temp.voucher('cobros-venta', current_setting('prueba.fv'));
  perform test.debe_fallar(format('select public.registrar_cobro_factura(%L, %L, %L, 100, false, ''OP-398-6'', %L, %L, null)',
      current_setting('prueba.pago6'), current_setting('prueba.fv'), v_hoy, v_ruta, current_setting('prueba.cpen')),
    'en otra moneda pide lo que entró a la cuenta', 'escribe cuánto entró en soles');
  perform public.registrar_cobro_factura(current_setting('prueba.pago6')::uuid, current_setting('prueba.fv')::uuid, v_hoy, 100, false,
    'OP-398-6', v_ruta, current_setting('prueba.cpen')::uuid, 375);
  m := pg_temp.mov('COBRO_FACTURA_VENTA', current_setting('prueba.pago6'));
  perform test.afirmar(m.tipo = 'INGRESO' and m.monto = 375 and m.tipo_cambio = 3.75,
    'entra a la cuenta en soles lo que dice el estado de cuenta, con su tipo de cambio');

  perform public.anular_cobro_factura(current_setting('prueba.pago5')::uuid, 'El cliente pagó con un cheque sin fondos');
  perform test.afirmar((pg_temp.mov('COBRO_FACTURA_VENTA', current_setting('prueba.pago5'))).id is null,
    'anular el cobro anula su ingreso');
  reset role;
end $$;

-- ------------------------------------------- 4. El recibo por honorarios y la planilla diaria
do $$
declare
  v_hoy  date := current_setting('prueba.hoy')::date;
  v_ruta text;
  m      public.movimientos_caja;
begin
  perform pg_temp.como('teso');
  set local role authenticated;
  v_ruta := current_setting('prueba.sc') || '/' || gen_random_uuid() || '.pdf';
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('subcontratos', v_ruta, current_setting('prueba.teso'), '{"mimetype": "application/pdf", "size": 2048}');
  perform test.debe_fallar(format('select public.registrar_pago_recibo_honorarios(%L, %L, %L, ''OP-398-7'', %L)',
      current_setting('prueba.pago7'), current_setting('prueba.rec'), v_hoy, v_ruta),
    'la versión vieja del pago del recibo ya no paga', 'Vuelve a cargar la pantalla');
  perform public.registrar_pago_recibo_honorarios(current_setting('prueba.pago7')::uuid, current_setting('prueba.rec')::uuid, v_hoy,
    'OP-398-7', v_ruta, current_setting('prueba.cpen')::uuid, null);
  m := pg_temp.mov('PAGO_RECIBO_HONORARIOS', current_setting('prueba.pago7'));
  perform test.afirmar(m.tipo = 'EGRESO' and m.monto = 920 and m.codigo_interno = 'QA398-SC'
      and m.descripcion = 'Pago del recibo por honorarios E001-398 · SUBCONTRATISTA 398',
    'el pago del recibo deja su egreso por el neto, sin la retención, con el código del subcontrato');
  perform test.debe_fallar(format('select public.registrar_pago_recibo_honorarios(%L, %L, %L, ''OP-398-7'', %L, %L, null)',
      current_setting('prueba.pago7'), current_setting('prueba.rec'), v_hoy,
      pg_temp.voucher('subcontratos', current_setting('prueba.sc')), current_setting('prueba.cpen')),
    'el pago del recibo con otro voucher no se da por pagado', 'ya quedó registrado con otro voucher');
  perform public.anular_pago_recibo_honorarios(current_setting('prueba.pago7')::uuid, 'El voucher era de otro recibo');
  perform test.afirmar((pg_temp.mov('PAGO_RECIBO_HONORARIOS', current_setting('prueba.pago7'))).id is null,
    'anular el pago del recibo anula su egreso');

  -- La planilla: dos personas con un comprobante, una sola salida por el total.
  v_ruta := current_setting('prueba.pd') || '/' || gen_random_uuid() || '.pdf';
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('planilla-diaria', v_ruta, current_setting('prueba.teso'), '{"mimetype": "application/pdf", "size": 2048}');
  perform test.debe_fallar(format('select public.registrar_pago_planilla_diaria(%L, %L, %L, %L, ''OP-398-8'', %L, null, null)',
      current_setting('prueba.pago8'), current_setting('prueba.pd'), array[current_setting('prueba.pp1'), current_setting('prueba.pp2')],
      v_hoy, v_ruta),
    'la planilla sin cuenta no se paga', 'Elige la cuenta de la que salió el pago');
  perform test.debe_fallar(format('select public.registrar_pago_planilla_diaria(%L, %L, %L, %L, ''OP-398-8'', %L)',
      current_setting('prueba.pago8'), current_setting('prueba.pd'), array[current_setting('prueba.pp1'), current_setting('prueba.pp2')],
      v_hoy, v_ruta),
    'la versión vieja del pago de la planilla ya no paga', 'Vuelve a cargar la pantalla');
  perform public.registrar_pago_planilla_diaria(current_setting('prueba.pago8')::uuid, current_setting('prueba.pd')::uuid,
    array[current_setting('prueba.pp1')::uuid, current_setting('prueba.pp2')::uuid], v_hoy, 'OP-398-8', v_ruta,
    current_setting('prueba.cpen')::uuid, null);
  m := pg_temp.mov('PAGO_PLANILLA_DIARIA', current_setting('prueba.pago8'));
  perform test.afirmar(m.tipo = 'EGRESO' and m.monto = 300 and m.codigo_interno is null
      and m.descripcion = 'Pago de la planilla diaria QA-PD-398 · 2 personas',
    'el pago de la planilla deja un egreso por lo de las personas marcadas');
  perform test.debe_fallar(format('select public.registrar_pago_planilla_diaria(%L, %L, %L, %L, ''OP-398-8'', %L, %L, null)',
      current_setting('prueba.pago8'), current_setting('prueba.pd'), array[current_setting('prueba.pp1'), current_setting('prueba.pp2')],
      v_hoy, pg_temp.voucher('planilla-diaria', current_setting('prueba.pd')), current_setting('prueba.cpen')),
    'el pago de la planilla con otro comprobante no se da por pagado', 'ya quedó registrado con otro comprobante');
  perform public.anular_pago_planilla_diaria(current_setting('prueba.pago8')::uuid, 'Se marcó a la persona equivocada');
  perform test.afirmar((pg_temp.mov('PAGO_PLANILLA_DIARIA', current_setting('prueba.pago8'))).id is null
      and (select count(*) from public.planilla_diaria_personas where planilla_id = current_setting('prueba.pd')::uuid and pago_id is null) = 3,
    'anular el pago de la planilla anula su egreso y la deja por pagar');
  reset role;
end $$;

-- ------------------------------------------- 5. Los días cerrados no se tocan
do $$
declare
  v_hoy  date := current_setting('prueba.hoy')::date;
  v_ruta text;
begin
  perform pg_temp.como('teso');
  set local role authenticated;
  perform public.cerrar_dia_caja(gen_random_uuid(), current_setting('prueba.ccierre')::uuid, v_hoy - 2, 0, null);
  v_ruta := pg_temp.voucher('pagos-servicio', current_setting('prueba.os'));
  perform test.debe_fallar(format('select public.registrar_pago_servicio(%L, %L, %L, 500, true, ''OP-398-9'', null, %L, %L, null)',
      current_setting('prueba.pago9'), current_setting('prueba.os'), v_hoy - 2, v_ruta, current_setting('prueba.ccierre')),
    'un pago no entra en un día cerrado de la cuenta', 'está cerrada hasta');
  perform test.afirmar(not exists (select 1 from public.pagos_orden_servicio where id = current_setting('prueba.pago9')::uuid),
    'y el pago tampoco queda: va en un día abierto o se reabre el cierre');

  perform public.registrar_pago_servicio(current_setting('prueba.pago9')::uuid, current_setting('prueba.os')::uuid, v_hoy - 1, 500, true,
    'OP-398-9', null, v_ruta, current_setting('prueba.ccierre')::uuid, null);
  perform public.cerrar_dia_caja(gen_random_uuid(), current_setting('prueba.ccierre')::uuid, v_hoy - 1, -500, null);

  -- Anular un pago cuyo día ya se cerró: ese día no se toca y la devolución entra hoy.
  perform public.anular_pago_servicio(current_setting('prueba.pago9')::uuid, 'El proveedor devolvió el pago');
  perform test.afirmar((select anulado_en is not null from public.pagos_orden_servicio where id = current_setting('prueba.pago9')::uuid),
    'un pago cuyo egreso está en un día cerrado sí se anula');
  perform test.afirmar((pg_temp.mov('PAGO_ORDEN_SERVICIO', current_setting('prueba.pago9'))).fecha = v_hoy - 1,
    'su egreso se queda en el día cerrado, que ya cuadró con el banco');
  perform test.afirmar((select count(*) = 1 and min(fecha) = v_hoy and min(monto) = 500 and bool_and(operacion is null)
                               and bool_and(descripcion like 'Anulación del pago del %')
                          from public.movimientos_caja
                         where origen = 'PAGO_ORDEN_SERVICIO' and origen_id = current_setting('prueba.pago9')::uuid
                           and tipo = 'INGRESO' and anulado_en is null),
    'y la devolución, del mismo monto, entra hoy como ingreso');
  perform test.afirmar((select saldo_final = 0 from public.caja_del_dia(v_hoy) where caja_id = current_setting('prueba.ccierre')::uuid),
    'con la devolución la cuenta vuelve a su saldo');

  -- Con la cuenta cerrada también hoy no hay dónde dejar la devolución.
  perform set_config('prueba.pago11', gen_random_uuid()::text, true);
  v_ruta := pg_temp.voucher('pagos-servicio', current_setting('prueba.os'));
  perform public.registrar_pago_servicio(current_setting('prueba.pago11')::uuid, current_setting('prueba.os')::uuid, v_hoy, 500, true,
    'OP-398-11', null, v_ruta, current_setting('prueba.ccierre')::uuid, null);
  perform public.cerrar_dia_caja(gen_random_uuid(), current_setting('prueba.ccierre')::uuid, v_hoy, -500, null);
  perform test.debe_fallar(format('select public.anular_pago_servicio(%L, ''El proveedor devolvió el pago'')', current_setting('prueba.pago11')),
    'con la cuenta cerrada hasta hoy el pago no se anula', 'reabre el cierre de hoy');
  perform test.afirmar((select anulado_en is null from public.pagos_orden_servicio where id = current_setting('prueba.pago11')::uuid)
      and (pg_temp.mov('PAGO_ORDEN_SERVICIO', current_setting('prueba.pago11'))).id is not null,
    'y el pago y su egreso siguen vigentes');
  reset role;
  perform test.afirmar((select count(*) from public.codigo_interno_lineas_caja('QA398-OS')) =
                       (select count(*) from public.movimientos_caja where origen = 'MANUAL' and tipo = 'EGRESO'
                           and codigo_interno = 'QA398-OS' and anulado_en is null),
    'la devolución no entra al costeo del código: el costeo cuenta solo lo anotado a mano (la función es del costeo, no de Tesorería)');
end $$;

-- ------------------------------------------- 5b. Lo mismo no se cuenta dos veces
do $$
declare
  v_hoy  date := current_setting('prueba.hoy')::date;
  v_ruta text;
begin
  perform pg_temp.como('teso');
  set local role authenticated;
  -- Anotado a mano primero, registrado después en Cuentas por pagar.
  perform public.registrar_movimiento_caja(gen_random_uuid(), current_setting('prueba.cpen')::uuid, v_hoy, 'EGRESO', 77,
    'Pago al proveedor 398, anotado a mano', null, 'op-398-dup', null);
  v_ruta := pg_temp.voucher('pagos-facturas', current_setting('prueba.adq1'));
  perform test.debe_fallar(format('select public.registrar_pago_factura(gen_random_uuid(), %L, %L, 77, ''OP-398-DUP'', %L, %L, null)',
      current_setting('prueba.adq1'), v_hoy, v_ruta, current_setting('prueba.cpen')),
    'un pago ya anotado a mano con su operación y su monto no se descuenta dos veces', 'ya está anotado a mano');
  -- Con otro monto es otro dinero, y desde otra cuenta también.
  perform public.registrar_pago_factura(gen_random_uuid(), current_setting('prueba.adq1')::uuid, v_hoy, 78,
    'OP-398-DUP', v_ruta, current_setting('prueba.cpen')::uuid, null);
  -- Registrado primero, anotado a mano después.
  perform test.debe_fallar(format('select public.registrar_movimiento_caja(gen_random_uuid(), %L, %L, ''EGRESO'', 78, ''Lo mismo, a mano'', null, ''OP-398-DUP'', null)',
      current_setting('prueba.cpen'), v_hoy),
    'lo que dejó un pago no se vuelve a anotar a mano', 'Los pagos y cobros del sistema entran solos');
  -- Dos pagos del sistema con la misma operación (una transferencia que paga dos facturas) sí van:
  -- la de dólares, US$ 20 que salieron como S/ 78 de la misma cuenta.
  v_ruta := pg_temp.voucher('pagos-facturas', current_setting('prueba.adq2'));
  perform public.registrar_pago_factura(gen_random_uuid(), current_setting('prueba.adq2')::uuid, v_hoy, 20,
    'OP-398-DUP', v_ruta, current_setting('prueba.cpen')::uuid, 78);
  perform test.afirmar((select count(*) from public.movimientos_caja where operacion = 'OP-398-DUP' and origen = 'PAGO_ADQUISICION') = 2,
    'dos pagos del sistema con la misma operación entran los dos');
  reset role;
end $$;

-- ------------------------------------------- 6. Quién paga y quién no
do $$
declare v_hoy date := current_setting('prueba.hoy')::date;
begin
  perform pg_temp.como('gerente');
  set local role authenticated;
  perform test.debe_fallar(format('select public.registrar_pago_factura(gen_random_uuid(), %L, %L, 10, ''OP-398-G'', null, %L, null)',
      current_setting('prueba.adq1'), v_hoy, current_setting('prueba.cpen')),
    'Gerencia consulta, no paga', 'tesoreria.registrar_pagos');
  perform test.afirmar((select count(*) from public.movimientos_caja) = 0, 'ni ve los movimientos de la caja');
  perform test.afirmar((select count(*) from public.audit_log where tabla in ('cajas', 'movimientos_caja', 'cierres_caja')) = 0,
    'ni los lee por la auditoría, aunque tenga auditoria.ver');
  perform test.afirmar((select count(*) from public.audit_log where tabla = 'pagos_adquisicion') > 0,
    'el resto de la auditoría lo sigue viendo');
  reset role;
end $$;
select test.afirmar((select count(*) from public.audit_log where tabla = 'movimientos_caja') > 0,
  'y la auditoría de la caja sí está: es la política la que la guarda');

-- Quien paga sin llevar la caja no la mueve (hoy los dos permisos son de Tesorería).
delete from public.roles_permisos
 where permiso_codigo = 'tesoreria.caja' and rol_id = (select id from public.roles where codigo = 'TESORERIA');
do $$
declare v_ruta text;
begin
  perform pg_temp.como('teso');
  set local role authenticated;
  v_ruta := pg_temp.voucher('pagos-facturas', current_setting('prueba.adq1'));
  perform test.debe_fallar(format('select public.registrar_pago_factura(gen_random_uuid(), %L, %L, 10, ''OP-398-S'', %L, %L, null)',
      current_setting('prueba.adq1'), current_setting('prueba.hoy'), v_ruta, current_setting('prueba.cpen')),
    'sin tesoreria.caja no se paga desde una cuenta', 'tesoreria.caja');
  perform test.debe_fallar(format('select public.anular_pago_factura(%L, ''Se anula sin llevar la caja'')', current_setting('prueba.pago1')),
    'ni se anula un pago que movió una cuenta', 'tesoreria.caja');
  reset role;
end $$;

-- Las puertas: las versiones nuevas son para la gente con sesión, no para anon;
-- las dos que mueven la caja no las llama nadie directamente.
select test.afirmar(
  not has_function_privilege('anon', 'public.registrar_pago_factura(uuid, uuid, date, numeric, text, text, uuid, numeric)', 'execute')
  and not has_function_privilege('anon', 'public.registrar_pago_servicio(uuid, uuid, date, numeric, boolean, text, text, text, uuid, numeric)', 'execute')
  and not has_function_privilege('anon', 'public.registrar_cobro_factura(uuid, uuid, date, numeric, boolean, text, text, uuid, numeric)', 'execute')
  and not has_function_privilege('anon', 'public.registrar_pago_recibo_honorarios(uuid, uuid, date, text, text, uuid, numeric)', 'execute')
  and not has_function_privilege('anon', 'public.registrar_pago_planilla_diaria(uuid, uuid, uuid[], date, text, text, uuid, numeric)', 'execute')
  and has_function_privilege('authenticated', 'public.registrar_pago_factura(uuid, uuid, date, numeric, text, text, uuid, numeric)', 'execute')
  and has_function_privilege('authenticated', 'public.registrar_pago_planilla_diaria(uuid, uuid, uuid[], date, text, text, uuid, numeric)', 'execute'),
  'los pagos y cobros nuevos los llama solo quien tiene sesión');
select test.afirmar(
  not has_function_privilege('authenticated', 'public.caja_mover_por_pago(text, uuid, text, uuid, date, numeric, text, numeric, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.caja_anular_por_pago(text, uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.caja_mover_por_pago(text, uuid, text, uuid, date, numeric, text, numeric, text, text, text)', 'execute'),
  'mover o anular la caja por un pago no se llama suelto');

rollback;
