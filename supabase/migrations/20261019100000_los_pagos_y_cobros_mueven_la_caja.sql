-- =============================================================================
-- Los pagos y los cobros del sistema mueven la caja diaria solos
-- =============================================================================
-- DKS (16/10) pidió la caja diaria con ingresos y egresos a mano «pero después
-- vamos a conectar por ejemplo los egresos de personal o de órdenes de compra y
-- servicio para que se vaya realizando automáticamente su descuento de su
-- saldo». El 19/10 eligió en la tarjeta «Conectar ya»: al pagar o al cobrar,
-- Tesorería elige la cuenta y la caja se mueve sola.
--
-- Desde esta migración, cada uno de estos registros deja su movimiento en la
-- cuenta elegida, el mismo día, en la misma transacción:
--
--   · el pago de una factura de compra       → egreso  PAGO_ADQUISICION
--   · el pago de una orden de servicio       → egreso  PAGO_ORDEN_SERVICIO
--   · el pago de un recibo por honorarios    → egreso  PAGO_RECIBO_HONORARIOS
--   · el pago de la planilla diaria          → egreso  PAGO_PLANILLA_DIARIA
--   · el cobro de una factura de venta       → ingreso COBRO_FACTURA_VENTA
--
-- Las reglas, las mismas de la caja:
--   · La cuenta es obligatoria y tiene que estar activa, y quien paga tiene
--     que llevar la caja (`tesoreria.caja`).
--   · El día de la cuenta tiene que estar abierto: un día cerrado ya cuadró con
--     el banco. Lo que se pagó ese día y faltó va en un día abierto, o se reabre
--     el cierre.
--   · Un pago o cobro de antes del saldo inicial de la cuenta no la mueve: ese
--     dinero ya está en el saldo con el que empezó. El pago queda registrado.
--   · Si la cuenta es de otra moneda que el documento, se escribe lo que salió
--     o entró en la cuenta, como en el estado de cuenta; el dólar tiene que
--     salir entre S/ 2 y S/ 6, como en una transferencia.
--   · Anular el pago o el cobro anula también su movimiento, con el mismo
--     motivo, si su día sigue abierto y la cuenta activa. En la caja ese
--     movimiento no se anula suelto (`anular_movimiento_caja` ya lo rechaza).
--
-- El costeo del código interno (20261017300000) suma solo los egresos MANUAL de
-- la caja: estos movimientos no se cuentan dos veces.
--
-- Cada función de pago o cobro gana dos parámetros al final (`p_caja`,
-- `p_monto_cuenta`). La versión vieja, sin ellos, se queda con su nombre y solo
-- dice que vuelvan a cargar la pantalla: así una pantalla abierta desde antes
-- no paga sin mover la caja, y la migración no necesita `drop`.
--
-- Idempotente: solo `create or replace`, `revoke` y `grant`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. El movimiento que deja un pago o un cobro
-- -----------------------------------------------------------------------------
create or replace function public.caja_mover_por_pago(
  p_origen text, p_origen_id uuid, p_tipo text, p_caja uuid, p_fecha date,
  p_monto numeric, p_moneda text, p_monto_cuenta numeric,
  p_descripcion text, p_codigo text, p_operacion text
) returns uuid language plpgsql set search_path to 'public' as $$
declare
  v_caja    public.cajas%rowtype;
  v_monto   numeric;
  v_cambio  numeric;
  v_id      uuid;
  v_cobro   boolean := p_tipo = 'INGRESO';
begin
  -- Quien paga desde una cuenta tiene que poder verla: hoy los dos permisos
  -- son de Tesorería, y si mañana otro puesto paga, no mueve a ciegas la caja.
  perform public.exigir_permiso('tesoreria.caja');
  if p_caja is null then
    raise exception '%', case when v_cobro then 'Elige la cuenta a la que entró el cobro.'
                              else 'Elige la cuenta de la que salió el pago.' end
      using errcode = 'check_violation';
  end if;
  select * into v_caja from public.cajas where id = p_caja for update;
  if not found then
    raise exception 'Esa cuenta no existe: vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if not v_caja.activa then
    raise exception 'La cuenta % está desactivada: elige otra.', v_caja.nombre using errcode = 'check_violation';
  end if;

  -- Antes del saldo inicial: ese dinero ya está en el saldo con que empezó la cuenta.
  if p_fecha < v_caja.fecha_inicio then return null; end if;

  -- El día tiene que estar abierto (y no ser futuro).
  v_caja := public.caja_dia_abierto(p_caja, p_fecha);

  if v_caja.moneda = p_moneda then
    v_monto := p_monto;
  else
    if p_monto_cuenta is null or p_monto_cuenta <= 0 or p_monto_cuenta > 999999999
       or p_monto_cuenta <> round(p_monto_cuenta, 2) then
      raise exception 'La cuenta % es en %: escribe cuánto % en %, como dice el estado de cuenta.',
        v_caja.nombre, case when v_caja.moneda = 'USD' then 'dólares' else 'soles' end,
        case when v_cobro then 'entró' else 'salió' end,
        case when v_caja.moneda = 'USD' then 'dólares' else 'soles' end using errcode = 'check_violation';
    end if;
    v_monto := p_monto_cuenta;
    v_cambio := round(case when v_caja.moneda = 'PEN' then p_monto_cuenta / p_monto else p_monto / p_monto_cuenta end, 4);
    -- Un dólar fuera de S/ 2 a S/ 6 es un monto mal escrito, no un cambio.
    if v_cambio not between 2 and 6 then
      raise exception 'Con esos montos el dólar sale a S/ %: revisa cuánto % de la cuenta.', round(v_cambio, 3),
        case when v_cobro then 'entró a' else 'salió' end using errcode = 'check_violation';
    end if;
  end if;

  insert into public.movimientos_caja (caja_id, fecha, tipo, monto, descripcion, codigo_interno, operacion,
                                       tipo_cambio, origen, origen_id)
  values (p_caja, p_fecha, p_tipo, v_monto,
          left(regexp_replace(btrim(p_descripcion), '\s+', ' ', 'g'), 300),
          left(public.normalizar_codigo_interno(p_codigo), 60),
          nullif(left(btrim(coalesce(p_operacion, '')), 60), ''),
          v_cambio, p_origen, p_origen_id)
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.caja_mover_por_pago(text, uuid, text, uuid, date, numeric, text, numeric, text, text, text) is
  'Deja en la cuenta elegida el movimiento de un pago o un cobro del sistema. La llaman las funciones de pago y cobro, no la gente.';
revoke all on function public.caja_mover_por_pago(text, uuid, text, uuid, date, numeric, text, numeric, text, text, text)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Anular el pago o el cobro anula su movimiento
-- -----------------------------------------------------------------------------
create or replace function public.caja_anular_por_pago(p_origen text, p_origen_id uuid, p_motivo text, p_que text)
returns void language plpgsql set search_path to 'public' as $$
declare
  v_mov     record;
  v_caja    public.cajas%rowtype;
  v_cierre  date;
begin
  for v_mov in
    select m.id, m.caja_id, m.fecha from public.movimientos_caja m
     where m.origen = p_origen and m.origen_id = p_origen_id and m.anulado_en is null
     order by m.caja_id
  loop
    select * into v_caja from public.cajas where id = v_mov.caja_id for update;
    if not v_caja.activa then
      raise exception 'Este % está en la cuenta %, que está desactivada: actívala para anularlo.', p_que, v_caja.nombre
        using errcode = 'check_violation';
    end if;
    select max(fecha) into v_cierre from public.cierres_caja where caja_id = v_mov.caja_id and anulado_en is null;
    if v_cierre is not null and v_mov.fecha <= v_cierre then
      raise exception 'Este % está en la cuenta % el %, y ese día ya está cerrado: reabre el cierre para anularlo.',
        p_que, v_caja.nombre, public.caja_texto_fecha(v_mov.fecha) using errcode = 'check_violation';
    end if;
    update public.movimientos_caja
       set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
     where id = v_mov.id;
  end loop;
end;
$$;
comment on function public.caja_anular_por_pago(text, uuid, text, text) is
  'Anula, con el motivo del pago o del cobro, su movimiento de caja, si su día sigue abierto. La llaman las funciones de anular.';
revoke all on function public.caja_anular_por_pago(text, uuid, text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Pago de una factura de compra
-- -----------------------------------------------------------------------------
create or replace function public.registrar_pago_factura(
  p_id uuid, p_adquisicion uuid, p_fecha date, p_monto numeric, p_referencia text, p_ruta text,
  p_caja uuid, p_monto_cuenta numeric
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo   uuid := public.usuario_actual();
  v_hoy  date := (now() at time zone 'America/Lima')::date;
  v_adq  public.adquisiciones%rowtype;
  v_obj  storage.objects%rowtype;
  v_ref  text := btrim(coalesce(p_referencia, ''));
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  if p_id is null then raise exception 'Vuelve a abrir el formulario del pago.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.pagos_adquisicion where id = p_id) then return p_id; end if;
  select * into v_adq from public.adquisiciones where id = p_adquisicion;
  if not found or v_adq.estado <> 'REGISTRADA' then
    raise exception 'Esa factura todavía no está registrada en Adquisiciones.' using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha > v_hoy or p_fecha < v_hoy - 365 then
    raise exception 'Elige el día del pago: de hoy hacia atrás.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe lo que se pagó, en dos decimales.' using errcode = 'check_violation';
  end if;
  if char_length(v_ref) not between 3 and 120 then
    raise exception 'Escribe el número de operación del banco, de 3 a 120 caracteres.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.pagos_adquisicion
              where adquisicion_id = p_adquisicion and referencia = v_ref and anulado_en is null) then
    raise exception 'La operación % ya está registrada en esta factura.', v_ref using errcode = 'unique_violation';
  end if;
  -- Mientras siga la restricción vieja (la suelta la 20261015123000).
  if exists (select 1 from public.pagos_adquisicion
              where adquisicion_id = p_adquisicion and referencia = v_ref and anulado_en is not null)
     and exists (select 1 from pg_constraint where conname = 'pagos_adquisicion_adquisicion_id_referencia_key'
                   and conrelid = 'public.pagos_adquisicion'::regclass) then
    raise exception 'La operación % ya se usó en un pago anulado de esta factura: para volver a usarla, el administrador del sistema tiene que liberarla.', v_ref
      using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('pagos-facturas', p_ruta, p_adquisicion,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

  insert into public.pagos_adquisicion (id, adquisicion_id, fecha, monto, referencia, registrado_por,
                                        archivo_ruta, archivo_mime, archivo_tamano)
  values (p_id, p_adquisicion, p_fecha, p_monto, v_ref, v_yo,
          p_ruta, v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer);

  perform public.caja_mover_por_pago('PAGO_ADQUISICION', p_id, 'EGRESO', p_caja, p_fecha, p_monto, v_adq.moneda, p_monto_cuenta,
    'Pago de la factura ' || v_adq.numero_documento || ' · ' || v_adq.proveedor, null, v_ref);
  return p_id;
end;
$$;
comment on function public.registrar_pago_factura(uuid, uuid, date, numeric, text, text, uuid, numeric) is
  'Tesorería paga una factura de compra con su voucher, desde la cuenta de la caja que elige: deja su egreso en la caja. Exige tesoreria.registrar_pagos.';
revoke all on function public.registrar_pago_factura(uuid, uuid, date, numeric, text, text, uuid, numeric) from public, anon;
grant execute on function public.registrar_pago_factura(uuid, uuid, date, numeric, text, text, uuid, numeric) to authenticated;

create or replace function public.registrar_pago_factura(
  p_id uuid, p_adquisicion uuid, p_fecha date, p_monto numeric, p_referencia text, p_ruta text
) returns uuid language plpgsql security invoker set search_path to 'public' as $$
begin
  raise exception 'Vuelve a cargar la pantalla: el pago ahora pide de qué cuenta de la caja salió.' using errcode = 'check_violation';
end;
$$;
comment on function public.registrar_pago_factura(uuid, uuid, date, numeric, text, text) is
  'Versión vieja, sin la cuenta de la caja: ya no paga (migración 20261019100000).';

create or replace function public.anular_pago_factura(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_pago public.pagos_adquisicion%rowtype;
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_pago from public.pagos_adquisicion where id = p_id for update;
  if not found then raise exception 'Ese pago no existe.' using errcode = 'check_violation'; end if;
  if v_pago.anulado_en is not null then return p_id; end if;
  perform public.caja_anular_por_pago('PAGO_ADQUISICION', p_id, p_motivo, 'pago');
  update public.pagos_adquisicion
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Pago de una orden de servicio
-- -----------------------------------------------------------------------------
create or replace function public.registrar_pago_servicio(
  p_id uuid, p_orden_servicio uuid, p_fecha_pago date, p_monto numeric, p_cancela boolean,
  p_operacion text, p_comprobante text, p_ruta text, p_caja uuid, p_monto_cuenta numeric
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo   uuid := public.usuario_actual();
  v_hoy  date := (now() at time zone 'America/Lima')::date;
  v_os   public.ordenes_servicio%rowtype;
  v_obj  storage.objects%rowtype;
  v_op   text := nullif(btrim(coalesce(p_operacion, '')), '');
  v_comp text := nullif(upper(btrim(coalesce(p_comprobante, ''))), '');
begin
  perform public.exigir_permiso('tesoreria.pagar_servicios');
  if p_id is null then raise exception 'Vuelve a abrir el formulario del pago.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.pagos_orden_servicio where id = p_id) then return p_id; end if;
  select * into v_os from public.ordenes_servicio where id = p_orden_servicio for update;
  if not found then raise exception 'Esa orden de servicio no existe.' using errcode = 'check_violation'; end if;
  if v_os.estado = 'ANULADA' or v_os.aprobacion <> 'APROBADA' then
    raise exception 'La orden de servicio % no está aprobada por Gerencia: no se paga.', v_os.numero using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.pagos_orden_servicio
              where orden_servicio_id = p_orden_servicio and anulado_en is null and cancela) then
    raise exception 'La orden de servicio % ya está cancelada.', v_os.numero using errcode = 'check_violation';
  end if;
  if p_fecha_pago is null or p_fecha_pago > v_hoy or p_fecha_pago < v_hoy - 365 then
    raise exception 'Elige el día del pago: de hoy hacia atrás.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe lo que se pagó, en dos decimales.' using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  if v_comp is not null and char_length(v_comp) not between 3 and 30 then
    raise exception 'El número de la factura o recibo del proveedor va de 3 a 30 caracteres.' using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('pagos-servicio', p_ruta, p_orden_servicio,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

  insert into public.pagos_orden_servicio (id, orden_servicio_id, fecha_pago, moneda, monto, cancela, operacion,
                                           comprobante_proveedor, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
  values (p_id, p_orden_servicio, p_fecha_pago, v_os.moneda, p_monto, coalesce(p_cancela, true), v_op, v_comp, p_ruta,
          v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);

  perform public.caja_mover_por_pago('PAGO_ORDEN_SERVICIO', p_id, 'EGRESO', p_caja, p_fecha_pago, p_monto, v_os.moneda, p_monto_cuenta,
    'Pago de la ' || v_os.numero || ' · ' || v_os.proveedor, v_os.codigo_interno, v_op);

  perform public.notificar_a_permiso('compras.crear',
    case when coalesce(p_cancela, true) then 'Servicio pagado: ' else 'Pago a cuenta de un servicio: ' end || v_os.numero,
    v_os.proveedor || ' · ' || case when v_os.moneda = 'USD' then 'US$ ' else 'S/ ' end || to_char(p_monto, 'FM999G999G990D00'),
    '/compras/servicios', 'pagos_orden_servicio', p_id, v_yo);
  return p_id;
end;
$$;
comment on function public.registrar_pago_servicio(uuid, uuid, date, numeric, boolean, text, text, text, uuid, numeric) is
  'Tesorería paga una orden de servicio aprobada con su voucher, desde la cuenta de la caja que elige: deja su egreso en la caja. Exige tesoreria.pagar_servicios.';
revoke all on function public.registrar_pago_servicio(uuid, uuid, date, numeric, boolean, text, text, text, uuid, numeric) from public, anon;
grant execute on function public.registrar_pago_servicio(uuid, uuid, date, numeric, boolean, text, text, text, uuid, numeric) to authenticated;

create or replace function public.registrar_pago_servicio(
  p_id uuid, p_orden_servicio uuid, p_fecha_pago date, p_monto numeric, p_cancela boolean,
  p_operacion text, p_comprobante text, p_ruta text
) returns uuid language plpgsql security invoker set search_path to 'public' as $$
begin
  raise exception 'Vuelve a cargar la pantalla: el pago ahora pide de qué cuenta de la caja salió.' using errcode = 'check_violation';
end;
$$;
comment on function public.registrar_pago_servicio(uuid, uuid, date, numeric, boolean, text, text, text) is
  'Versión vieja, sin la cuenta de la caja: ya no paga (migración 20261019100000).';

create or replace function public.anular_pago_servicio(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_pago public.pagos_orden_servicio%rowtype;
begin
  perform public.exigir_permiso('tesoreria.pagar_servicios');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_pago from public.pagos_orden_servicio where id = p_id for update;
  if not found then raise exception 'Ese pago no existe.' using errcode = 'check_violation'; end if;
  if v_pago.anulado_en is not null then return p_id; end if;
  perform public.caja_anular_por_pago('PAGO_ORDEN_SERVICIO', p_id, p_motivo, 'pago');
  update public.pagos_orden_servicio
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Cobro de una factura de venta
-- -----------------------------------------------------------------------------
create or replace function public.registrar_cobro_factura(
  p_id uuid, p_factura uuid, p_fecha date, p_monto numeric, p_cancela boolean, p_operacion text, p_ruta text,
  p_caja uuid, p_monto_cuenta numeric
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_fac     public.facturas_venta%rowtype;
  v_cobrado numeric;
  v_cancela boolean;
  v_obj     storage.objects%rowtype;
  v_op      text := nullif(btrim(coalesce(p_operacion, '')), '');
  v_mon     text;
begin
  perform public.exigir_permiso('tesoreria.registrar_cobros');
  if p_id is null then raise exception 'Vuelve a abrir el formulario del cobro.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.cobros_factura_venta where id = p_id) then return p_id; end if;
  select * into v_fac from public.facturas_venta where id = p_factura for update;
  if not found then raise exception 'Esa factura no existe.' using errcode = 'check_violation'; end if;
  if v_fac.anulada_en is not null then
    raise exception 'La factura % está anulada: no se cobra.', v_fac.numero using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.cobros_factura_venta where factura_id = p_factura and anulado_en is null and cancela) then
    raise exception 'La factura % ya está cobrada.', v_fac.numero using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha > v_hoy or p_fecha < v_hoy - 365 then
    raise exception 'Elige el día del cobro: de hoy hacia atrás.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe lo que se cobró, en dos decimales.' using errcode = 'check_violation';
  end if;
  select coalesce(sum(monto), 0) into v_cobrado from public.cobros_factura_venta
   where factura_id = p_factura and anulado_en is null;
  v_mon := case when v_fac.moneda = 'USD' then 'US$ ' else 'S/ ' end;
  if v_cobrado + p_monto > v_fac.total then
    raise exception 'Con ese cobro la factura % pasaría de su total: le quedan % por cobrar.',
      v_fac.numero, v_mon || to_char(v_fac.total - v_cobrado, 'FM999G999G990D00') using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('cobros-venta', p_ruta, p_factura,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  v_cancela := coalesce(p_cancela, false) or v_cobrado + p_monto >= v_fac.total;

  insert into public.cobros_factura_venta (id, factura_id, fecha, moneda, monto, cancela, operacion,
                                           archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
  values (p_id, p_factura, p_fecha, v_fac.moneda, p_monto, v_cancela, v_op, p_ruta,
          v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);

  perform public.caja_mover_por_pago('COBRO_FACTURA_VENTA', p_id, 'INGRESO', p_caja, p_fecha, p_monto, v_fac.moneda, p_monto_cuenta,
    'Cobro de la factura ' || v_fac.numero || ' · ' || v_fac.cliente, v_fac.codigo_interno, v_op);

  perform public.notificar_a_permiso('contabilidad.facturar',
    case when v_cancela then 'Factura cobrada: ' else 'Cobro a cuenta: ' end || v_fac.numero,
    v_fac.cliente || ' · código ' || v_fac.codigo_interno || ' · ' || v_mon || to_char(p_monto, 'FM999G999G990D00'),
    '/contabilidad/facturacion#' || p_factura, 'cobros_factura_venta', p_id, v_yo);
  return p_id;
end;
$$;
comment on function public.registrar_cobro_factura(uuid, uuid, date, numeric, boolean, text, text, uuid, numeric) is
  'Tesorería registra un cobro de una factura de venta con su voucher, en la cuenta de la caja que elige: deja su ingreso en la caja. Exige tesoreria.registrar_cobros.';
revoke all on function public.registrar_cobro_factura(uuid, uuid, date, numeric, boolean, text, text, uuid, numeric) from public, anon;
grant execute on function public.registrar_cobro_factura(uuid, uuid, date, numeric, boolean, text, text, uuid, numeric) to authenticated;

create or replace function public.registrar_cobro_factura(
  p_id uuid, p_factura uuid, p_fecha date, p_monto numeric, p_cancela boolean, p_operacion text, p_ruta text
) returns uuid language plpgsql security invoker set search_path to 'public' as $$
begin
  raise exception 'Vuelve a cargar la pantalla: el cobro ahora pide a qué cuenta de la caja entró.' using errcode = 'check_violation';
end;
$$;
comment on function public.registrar_cobro_factura(uuid, uuid, date, numeric, boolean, text, text) is
  'Versión vieja, sin la cuenta de la caja: ya no cobra (migración 20261019100000).';

create or replace function public.anular_cobro_factura(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_cobro public.cobros_factura_venta%rowtype;
begin
  perform public.exigir_permiso('tesoreria.registrar_cobros');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_cobro from public.cobros_factura_venta where id = p_id for update;
  if not found then raise exception 'Ese cobro no existe.' using errcode = 'check_violation'; end if;
  if v_cobro.anulado_en is not null then return p_id; end if;
  perform public.caja_anular_por_pago('COBRO_FACTURA_VENTA', p_id, p_motivo, 'cobro');
  update public.cobros_factura_venta
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Pago de un recibo por honorarios
-- -----------------------------------------------------------------------------
create or replace function public.registrar_pago_recibo_honorarios(
  p_id uuid, p_recibo_id uuid, p_fecha_pago date, p_operacion text, p_ruta text,
  p_caja uuid, p_monto_cuenta numeric
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo   uuid := public.usuario_actual();
  v_hoy  date := (now() at time zone 'America/Lima')::date;
  v_rec  public.recibos_honorarios%rowtype;
  v_sc   public.subcontratos%rowtype;
  v_sub  public.subcontratistas%rowtype;
  v_obj  storage.objects%rowtype;
  v_op   text := nullif(btrim(coalesce(p_operacion, '')), '');
begin
  perform public.exigir_permiso('subcontratos.pagar');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del pago.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.pagos_recibo_honorarios where id = p_id) then return p_id; end if;
  select * into v_rec from public.recibos_honorarios where id = p_recibo_id for update;
  if not found then raise exception 'Ese recibo no existe.' using errcode = 'check_violation'; end if;
  if v_rec.anulado_en is not null then
    raise exception 'El recibo % está anulado: no se paga.', v_rec.numero using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.pagos_recibo_honorarios where recibo_id = p_recibo_id and anulado_en is null) then
    raise exception 'El recibo % ya está pagado. Si el pago salió mal, anúlalo y regístralo de nuevo.', v_rec.numero
      using errcode = 'check_violation';
  end if;
  if p_fecha_pago is null or p_fecha_pago > v_hoy or p_fecha_pago < v_rec.fecha_emision then
    raise exception 'Elige el día del pago: desde la fecha del recibo hasta hoy.' using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  v_obj := public.subcontrato_archivo(v_rec.subcontrato_id, p_ruta);

  insert into public.pagos_recibo_honorarios (id, recibo_id, fecha_pago, monto, operacion, voucher_ruta, voucher_mime, voucher_tamano, registrado_por)
  values (p_id, p_recibo_id, p_fecha_pago, v_rec.monto_neto, v_op, p_ruta, v_obj.metadata->>'mimetype',
          (v_obj.metadata->>'size')::integer, v_yo);

  select * into v_sc from public.subcontratos where id = v_rec.subcontrato_id;
  select * into v_sub from public.subcontratistas where id = v_rec.subcontratista_id;

  perform public.caja_mover_por_pago('PAGO_RECIBO_HONORARIOS', p_id, 'EGRESO', p_caja, p_fecha_pago, v_rec.monto_neto, v_rec.moneda,
    p_monto_cuenta, 'Pago del recibo por honorarios ' || v_rec.numero || ' · ' || v_sub.nombre, v_sc.codigo_interno, v_op);

  perform public.notificar_a_permiso('subcontratos.gestionar', 'Recibo por honorarios pagado: ' || v_rec.numero,
    v_sub.nombre || ' · ' || v_sc.numero || ' · Tesorería adjuntó el voucher.',
    '/subcontratos/' || v_sc.id, 'recibos_honorarios', p_recibo_id, v_yo);
  return p_id;
end;
$$;
comment on function public.registrar_pago_recibo_honorarios(uuid, uuid, date, text, text, uuid, numeric) is
  'Tesorería paga el neto de un recibo por honorarios con su voucher, desde la cuenta de la caja que elige: deja su egreso en la caja. Exige subcontratos.pagar.';
revoke all on function public.registrar_pago_recibo_honorarios(uuid, uuid, date, text, text, uuid, numeric) from public, anon;
grant execute on function public.registrar_pago_recibo_honorarios(uuid, uuid, date, text, text, uuid, numeric) to authenticated;

create or replace function public.registrar_pago_recibo_honorarios(
  p_id uuid, p_recibo_id uuid, p_fecha_pago date, p_operacion text, p_ruta text
) returns uuid language plpgsql security invoker set search_path to 'public' as $$
begin
  raise exception 'Vuelve a cargar la pantalla: el pago ahora pide de qué cuenta de la caja salió.' using errcode = 'check_violation';
end;
$$;
comment on function public.registrar_pago_recibo_honorarios(uuid, uuid, date, text, text) is
  'Versión vieja, sin la cuenta de la caja: ya no paga (migración 20261019100000).';

create or replace function public.anular_pago_recibo_honorarios(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_pago  public.pagos_recibo_honorarios%rowtype;
  v_rec   public.recibos_honorarios%rowtype;
begin
  perform public.exigir_permiso('subcontratos.pagar');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_pago from public.pagos_recibo_honorarios where id = p_id for update;
  if not found then raise exception 'Ese pago no existe.' using errcode = 'check_violation'; end if;
  if v_pago.anulado_en is not null then return p_id; end if;
  perform public.caja_anular_por_pago('PAGO_RECIBO_HONORARIOS', p_id, p_motivo, 'pago');
  update public.pagos_recibo_honorarios
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  select * into v_rec from public.recibos_honorarios where id = v_pago.recibo_id;
  perform public.notificar_a_permiso('subcontratos.gestionar', 'Pago anulado: recibo ' || v_rec.numero,
    'Tesorería anuló el pago: el recibo vuelve a quedar por pagar. Motivo: ' || btrim(p_motivo),
    '/subcontratos/' || v_rec.subcontrato_id, 'recibos_honorarios', v_rec.id, public.usuario_actual());
  return p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Pago de la planilla diaria (una o varias personas, un solo voucher)
-- -----------------------------------------------------------------------------
create or replace function public.registrar_pago_planilla_diaria(
  p_id uuid, p_planilla_id uuid, p_personas uuid[], p_fecha_pago date, p_operacion text, p_ruta text,
  p_caja uuid, p_monto_cuenta numeric
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo    uuid := public.usuario_actual();
  v_hoy   date := (now() at time zone 'America/Lima')::date;
  v_pla   public.planillas_diarias%rowtype;
  v_obj   storage.objects%rowtype;
  v_n     int;
  v_op    text := nullif(btrim(coalesce(p_operacion, '')), '');
  v_total numeric;
begin
  perform public.exigir_permiso('planilla_diaria.pagar');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del pago.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.planilla_diaria_pagos where id = p_id) then return p_id; end if;
  select * into v_pla from public.planillas_diarias where id = p_planilla_id for update;
  if not found then raise exception 'Esa planilla no existe.' using errcode = 'check_violation'; end if;
  if v_pla.anulado_en is not null then
    raise exception 'La planilla % está anulada: no se paga.', v_pla.numero using errcode = 'check_violation';
  end if;
  if p_personas is null or cardinality(p_personas) = 0 then
    raise exception 'Marca a quién le pagaste.' using errcode = 'check_violation';
  end if;
  if p_fecha_pago is null or p_fecha_pago > v_hoy or p_fecha_pago < v_pla.fecha - 7 then
    raise exception 'Elige el día del pago: desde que llegó la planilla hasta hoy.' using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  select count(*) into v_n from public.planilla_diaria_personas
   where planilla_id = p_planilla_id and id = any(p_personas) and pago_id is null;
  if v_n <> cardinality(array(select distinct unnest(p_personas))) then
    raise exception 'Alguna de las personas marcadas ya está pagada o no es de esta planilla: recarga la pantalla.' using errcode = 'check_violation';
  end if;
  v_obj := public.planilla_diaria_archivo(p_planilla_id, p_ruta);
  if exists (select 1 from public.planilla_diaria_pagos where comprobante_ruta = p_ruta)
     or exists (select 1 from public.planilla_diaria_personas where boleta_ruta = p_ruta) then
    raise exception 'Ese archivo ya está adjunto: sube el comprobante de este pago.' using errcode = 'check_violation';
  end if;

  insert into public.planilla_diaria_pagos (id, planilla_id, fecha_pago, operacion, comprobante_ruta, comprobante_mime, comprobante_tamano, registrado_por)
  values (p_id, p_planilla_id, p_fecha_pago, v_op, p_ruta, v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);
  update public.planilla_diaria_personas set pago_id = p_id
   where planilla_id = p_planilla_id and id = any(p_personas) and pago_id is null;

  -- La cuenta se pide siempre; un pago de S/ 0 no mueve plata.
  select coalesce(sum(total), 0) into v_total from public.planilla_diaria_personas where pago_id = p_id;
  if p_caja is null then
    raise exception 'Elige la cuenta de la que salió el pago.' using errcode = 'check_violation';
  end if;
  if v_total > 0 then
    perform public.caja_mover_por_pago('PAGO_PLANILLA_DIARIA', p_id, 'EGRESO', p_caja, p_fecha_pago, v_total, 'PEN', p_monto_cuenta,
      'Pago de la planilla diaria ' || v_pla.numero || ' · ' || v_n || case when v_n = 1 then ' persona' else ' personas' end,
      null, v_op);
  end if;

  if not exists (select 1 from public.planilla_diaria_personas where planilla_id = p_planilla_id and pago_id is null) then
    perform public.notificar_a_permiso('planilla_diaria.preparar', 'Planilla diaria pagada: ' || v_pla.numero,
      'Tesorería pagó a todos y adjuntó los comprobantes.', '/planilla-diaria/' || p_planilla_id, 'planillas_diarias', p_planilla_id, v_yo);
  end if;
  return p_id;
end;
$$;
comment on function public.registrar_pago_planilla_diaria(uuid, uuid, uuid[], date, text, text, uuid, numeric) is
  'Tesorería paga a una o varias personas de la planilla diaria con un comprobante, desde la cuenta de la caja que elige: deja su egreso en la caja. Exige planilla_diaria.pagar.';
revoke all on function public.registrar_pago_planilla_diaria(uuid, uuid, uuid[], date, text, text, uuid, numeric) from public, anon;
grant execute on function public.registrar_pago_planilla_diaria(uuid, uuid, uuid[], date, text, text, uuid, numeric) to authenticated;

create or replace function public.registrar_pago_planilla_diaria(
  p_id uuid, p_planilla_id uuid, p_personas uuid[], p_fecha_pago date, p_operacion text, p_ruta text
) returns uuid language plpgsql security invoker set search_path to 'public' as $$
begin
  raise exception 'Vuelve a cargar la pantalla: el pago ahora pide de qué cuenta de la caja salió.' using errcode = 'check_violation';
end;
$$;
comment on function public.registrar_pago_planilla_diaria(uuid, uuid, uuid[], date, text, text) is
  'Versión vieja, sin la cuenta de la caja: ya no paga (migración 20261019100000).';

create or replace function public.anular_pago_planilla_diaria(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_pago public.planilla_diaria_pagos%rowtype;
begin
  perform public.exigir_permiso('planilla_diaria.pagar');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_pago from public.planilla_diaria_pagos where id = p_id for update;
  if not found then raise exception 'Ese pago no existe.' using errcode = 'check_violation'; end if;
  if v_pago.anulado_en is not null then return p_id; end if;
  perform public.caja_anular_por_pago('PAGO_PLANILLA_DIARIA', p_id, p_motivo, 'pago');
  update public.planilla_diaria_personas set pago_id = null where pago_id = p_id;
  update public.planilla_diaria_pagos
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;
