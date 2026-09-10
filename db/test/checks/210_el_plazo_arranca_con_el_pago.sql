-- El taller no empieza cuando Gerencia firma, sino cuando entra el adelanto.
-- Este check aprieta lo único que puede mentir de esa regla:
--
--   1. Que el primer pago selle el día desde el que corre el plazo.
--   2. Que las catorce etapas se reprogramen desde ese día, no desde el de la
--      aprobación. Sin esto la fecha queda escrita y no sirve para nada.
--   3. Que un pago posterior NO vuelva a mover el programa: el plazo arranca
--      una vez.
--   4. Que quien no es Tesorería ni Administración no pueda anotar un pago. Un
--      insert que el RLS esconde no da error: se cuenta con `debe_fallar`.
--   5. Y que el programa no se mueva debajo de un trabajo ya empezado, que
--      sería peor que tener la fecha vieja.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000019', 'PRUEBAS PAGOS S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Aldo', 'Quiroz',  'aldo@demo.pe',  'ADMIN',    (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Gabi', 'Ponce',   'gabi@demo.pe',  'COSTOS',   (select id from public.sedes limit 1)) as tesoreria_id \gset
select test.crear_usuario('Luis', 'Ochoa',   'luis@demo.pe',  'OPERARIO', (select id from public.sedes limit 1)) as operario_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20607761907', 'TRANSPORTES VEGA PIUNDO S.A.C');

-- El armazón se monta con ADMIN: una orden aprobada, con sus etapas programadas.
select test.como_usuario(:'admin_id');
set local role authenticated;

do $$
declare v_cot uuid; v_orden uuid;
begin
  insert into public.cotizaciones (cliente_id, fecha_emision, precio_venta, moneda)
  values ((select id from public.clientes limit 1), current_date, 40000, 'USD')
  returning id into v_cot;

  insert into public.cotizacion_etapas (cotizacion_id, etapa_catalogo_id, orden_secuencia, dias)
  select v_cot, ec.id, ec.orden_secuencia, 5
    from public.etapas_catalogo ec where ec.activo
    order by ec.orden_secuencia limit 3;

  insert into public.ordenes_trabajo (cliente_id, sede_id, descripcion, cotizacion_id)
  values ((select id from public.clientes limit 1),
          (select id from public.sedes limit 1),
          'Tolva de prueba del arranque por pago', v_cot)
  returning id into v_orden;

  -- Aprobar es lo que crea y programa las etapas.
  update public.ordenes_trabajo set estado = 'APROBADA' where id = v_orden;

  perform set_config('prueba.cotizacion', v_cot::text, false);
  perform set_config('prueba.orden', v_orden::text, false);

  perform test.afirmar(
    (select count(*) from public.ot_etapas where orden_id = v_orden) > 0,
    'la orden aprobada tiene sus etapas');

  perform test.afirmar(
    (select min(fecha_inicio_programada) from public.ot_etapas where orden_id = v_orden)
      is not null,
    'y están programadas desde la aprobación');
end $$;

reset role;

-- ---------------------------------- un operario no anota pagos del cliente
select test.como_usuario(:'operario_id');
set local role authenticated;

select test.debe_fallar(
  format($sql$insert into public.pagos_cliente (cotizacion_id, monto, fecha)
              values (%L, 5000, current_date)$sql$, current_setting('prueba.cotizacion')),
  'un operario no puede registrar un pago del cliente');

reset role;

-- ------------------------------------------- Tesorería registra el adelanto
select test.como_usuario(:'tesoreria_id');
set local role authenticated;

do $$
declare
  v_cot   uuid := current_setting('prueba.cotizacion')::uuid;
  v_orden uuid := current_setting('prueba.orden')::uuid;
  v_dia   date := current_date + 10;
begin
  insert into public.pagos_cliente (cotizacion_id, tipo, fecha, monto, medio, referencia)
  values (v_cot, 'ADELANTO', v_dia, 20000, 'TRANSFERENCIA', 'OP-99887');

  perform test.afirmar(
    (select plazo_arranca_en from public.cotizaciones where id = v_cot) = v_dia,
    'el primer pago sella el día desde el que corre el plazo');

  perform test.afirmar(
    (select min(fecha_inicio_programada) from public.ot_etapas where orden_id = v_orden) = v_dia,
    'y las etapas se reprograman desde ese día');

  perform test.afirmar(
    (select pagado from public.v_pagos_cotizacion where cotizacion_id = v_cot) = 20000,
    'el resumen dice lo pagado');

  perform test.afirmar(
    (select saldo from public.v_pagos_cotizacion where cotizacion_id = v_cot) = 20000,
    'y lo que falta: el 50 % que la casa cobra a la entrega');

  -- El segundo pago no vuelve a mover nada: el plazo arranca una sola vez.
  insert into public.pagos_cliente (cotizacion_id, tipo, fecha, monto, medio, referencia)
  values (v_cot, 'PARCIAL', v_dia + 30, 10000, 'DEPOSITO', 'OP-99888');

  perform test.afirmar(
    (select plazo_arranca_en from public.cotizaciones where id = v_cot) = v_dia,
    'un pago posterior no vuelve a mover el arranque');

  perform test.afirmar(
    (select min(fecha_inicio_programada) from public.ot_etapas where orden_id = v_orden) = v_dia,
    'ni el programa del taller');
end $$;

-- El mismo número de operación no entra dos veces: duplicaría un adelanto.
select test.debe_fallar(
  format($sql$insert into public.pagos_cliente (cotizacion_id, monto, fecha, referencia)
              values (%L, 20000, current_date, 'OP-99887')$sql$,
         current_setting('prueba.cotizacion')),
  'el mismo número de operación no se anota dos veces',
  'uq_pago_referencia');

reset role;

-- ------------------- con el taller ya trabajando, el programa no se mueve
select test.como_usuario(:'admin_id');
set local role authenticated;

do $$
declare
  v_orden uuid := current_setting('prueba.orden')::uuid;
  v_cot2  uuid;
  v_antes date;
begin
  update public.ot_etapas
     set estado = 'EN_PROCESO', fecha_inicio_real = current_date
   where orden_id = v_orden
     and orden_secuencia = (select min(orden_secuencia) from public.ot_etapas where orden_id = v_orden);

  select min(fecha_inicio_programada) into v_antes
    from public.ot_etapas where orden_id = v_orden;

  -- Otra cotización, otro pago, misma orden no: se prueba que la guarda existe
  -- llamando directo a la función con la cotización de esta orden.
  perform public.arrancar_plazo_de_cotizacion(current_setting('prueba.cotizacion')::uuid,
                                              current_date + 60);

  perform test.afirmar(
    (select min(fecha_inicio_programada) from public.ot_etapas where orden_id = v_orden) = v_antes,
    'con una etapa ya empezada, el programa no se mueve');
end $$;

reset role;

rollback;
