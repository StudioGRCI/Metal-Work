-- =============================================================================
-- EL SERVICIO SE PAGA CON IGV, Y LA DETRACCIÓN VA APARTE
-- -----------------------------------------------------------------------------
-- DKS (26/10), al revisar el manual de Tesorería: la ventana del pago de una
-- orden de servicio decía «Falta pagar S/ 900.00 del monto aprobado» y proponía
-- ese importe, sacado del monto SIN IGV de la orden, mientras Adquisiciones
-- muestra la misma OS con IGV y la detracción se calcula sobre el total con
-- IGV. «La corrección va en tus manos según tú creas que es lo mejor.»
--
-- Lo que se decidió, como se paga de verdad un servicio con factura:
--
--   · Lo que se debe por una OS es su total con IGV (monto × 1,18), el mismo que
--     muestra Adquisiciones.
--   · Si lleva detracción, esa parte se deposita en soles en la cuenta del
--     proveedor en el Banco de la Nación, y al proveedor se le paga el resto:
--     el total con IGV menos la detracción. En una OS en dólares la detracción
--     se pasa a dólares con el mismo cambio con el que la orden se pasó a soles.
--   · Cada pago dice a quién se le pagó (`destino`): al PROVEEDOR o la
--     DETRACCION. La detracción va siempre en soles, no pasa de lo que falta
--     depositar, y solo la tiene una OS afecta.
--   · `cancela` sigue diciendo que con ese pago la orden queda pagada entera.
--     Mientras falte depositar la detracción, la orden no se cancela: quedaría
--     cerrada y la detracción ya no tendría dónde registrarse.
--   · `saldos_de_servicios` da, para cada OS, el total con IGV, la detracción,
--     lo que va al proveedor y lo que falta de cada parte: la pantalla, el
--     Dashboard y la ventana del pago leen de aquí, no lo recalculan.
--
-- Los pagos que ya existen quedan como pagos al proveedor (el `default`).
--
-- Idempotente. Sin `drop`: la versión de 10 parámetros de
-- `registrar_pago_servicio` se queda con su nombre y paga al proveedor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A quién se le pagó
-- -----------------------------------------------------------------------------
alter table public.pagos_orden_servicio
  add column if not exists destino text not null default 'PROVEEDOR';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_pago_servicio_destino') then
    -- La detracción se deposita en soles en el Banco de la Nación, también la de una OS en dólares.
    alter table public.pagos_orden_servicio add constraint ck_pago_servicio_destino
      check (destino in ('PROVEEDOR', 'DETRACCION') and (destino <> 'DETRACCION' or moneda = 'PEN'));
  end if;
end $$;
comment on column public.pagos_orden_servicio.destino is
  'A quién se le pagó: al PROVEEDOR (el total con IGV menos la detracción) o la DETRACCION (en soles, a su cuenta del Banco de la Nación).';

-- -----------------------------------------------------------------------------
-- 2. Lo que se debe de cada orden de servicio, y lo que falta de cada parte
-- -----------------------------------------------------------------------------
create or replace function public.saldos_de_servicios(p_ids uuid[])
returns table (
  orden_servicio_id uuid, moneda text, total numeric, detraccion numeric, detraccion_en_moneda numeric,
  al_proveedor numeric, pagado_proveedor numeric, pagado_detraccion numeric,
  saldo_proveedor numeric, saldo_detraccion numeric, cancelada boolean
) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('tesoreria.pagar_servicios') or public.tiene_permiso('tesoreria.ver_documentos')) then
    raise exception 'No tienes permiso para ver los pagos de servicio.' using errcode = 'insufficient_privilege';
  end if;
  return query
    with base as (
      select s.id, s.moneda,
             round(s.monto * 1.18, 2) as total,
             coalesce(s.detraccion_monto, 0)::numeric as detr,
             -- La detracción es en soles; en una OS en dólares se pasa con el cambio de la orden.
             case when s.detraccion_monto is null then 0::numeric
                  when s.moneda = 'PEN' then s.detraccion_monto
                  else round(s.detraccion_monto * s.monto / nullif(s.monto_pen, 0), 2)
             end as detr_moneda
        from public.ordenes_servicio s
       where s.id = any(p_ids)
    ), pagos as (
      select g.orden_servicio_id as id,
             coalesce(sum(g.monto) filter (where g.destino = 'PROVEEDOR'), 0)::numeric as proveedor,
             coalesce(sum(g.monto) filter (where g.destino = 'DETRACCION'), 0)::numeric as detraccion,
             bool_or(g.cancela) as cancela
        from public.pagos_orden_servicio g
       where g.orden_servicio_id = any(p_ids) and g.anulado_en is null
       group by g.orden_servicio_id
    )
    select b.id, b.moneda, b.total, b.detr, coalesce(b.detr_moneda, 0),
           b.total - coalesce(b.detr_moneda, 0),
           coalesce(p.proveedor, 0), coalesce(p.detraccion, 0),
           greatest(b.total - coalesce(b.detr_moneda, 0) - coalesce(p.proveedor, 0), 0),
           greatest(b.detr - coalesce(p.detraccion, 0), 0),
           coalesce(p.cancela, false)
      from base b
      left join pagos p on p.id = b.id;
end;
$$;
comment on function public.saldos_de_servicios(uuid[]) is
  'Para cada orden de servicio: el total con IGV, la detracción (en soles y en la moneda de la orden), lo que va al proveedor, lo pagado y lo que falta de cada parte. Lo ven Tesorería y quien ve sus documentos.';
revoke all on function public.saldos_de_servicios(uuid[]) from public, anon;
grant execute on function public.saldos_de_servicios(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. El pago dice a quién se le pagó
-- -----------------------------------------------------------------------------
create or replace function public.registrar_pago_servicio(
  p_id uuid, p_orden_servicio uuid, p_fecha_pago date, p_monto numeric, p_cancela boolean,
  p_operacion text, p_comprobante text, p_ruta text, p_caja uuid, p_monto_cuenta numeric, p_destino text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_os      public.ordenes_servicio%rowtype;
  v_saldo   record;
  v_obj     storage.objects%rowtype;
  v_op      text := nullif(btrim(coalesce(p_operacion, '')), '');
  v_comp    text := nullif(upper(btrim(coalesce(p_comprobante, ''))), '');
  v_destino text := coalesce(nullif(btrim(coalesce(p_destino, '')), ''), 'PROVEEDOR');
  v_detr    boolean;
  v_moneda  text;
  v_cancela boolean := coalesce(p_cancela, true);
  v_falta   numeric;
begin
  perform public.exigir_permiso('tesoreria.pagar_servicios');
  if p_id is null then raise exception 'Vuelve a abrir el formulario del pago.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.pagos_orden_servicio where id = p_id) then return p_id; end if;
  if v_destino not in ('PROVEEDOR', 'DETRACCION') then
    raise exception 'Elige a quién le pagas: al proveedor o la detracción.' using errcode = 'check_violation';
  end if;
  v_detr := v_destino = 'DETRACCION';
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

  select * into v_saldo from public.saldos_de_servicios(array[p_orden_servicio]);
  if v_detr then
    if v_saldo.detraccion <= 0 then
      raise exception 'La orden de servicio % no lleva detracción: el pago va al proveedor.', v_os.numero using errcode = 'check_violation';
    end if;
    if p_monto > v_saldo.saldo_detraccion then
      raise exception 'La detracción de la % es S/ % y falta depositar S/ %: no se deposita más.', v_os.numero,
        to_char(v_saldo.detraccion, 'FM999G999G990D00'), to_char(v_saldo.saldo_detraccion, 'FM999G999G990D00')
        using errcode = 'check_violation';
    end if;
  end if;
  -- Cancelar con la detracción sin depositar la dejaría sin dónde registrarse.
  v_falta := v_saldo.saldo_detraccion - case when v_detr then p_monto else 0 end;
  if v_cancela and v_falta > 0 then
    raise exception 'Falta depositar S/ % de detracción de la %: regístrala antes de cancelar la orden, o deja este pago a cuenta.',
      to_char(v_falta, 'FM999G999G990D00'), v_os.numero using errcode = 'check_violation';
  end if;

  v_obj := public.archivo_subido_por_mi('pagos-servicio', p_ruta, p_orden_servicio,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  v_moneda := case when v_detr then 'PEN' else v_os.moneda end;

  insert into public.pagos_orden_servicio (id, orden_servicio_id, fecha_pago, moneda, monto, cancela, operacion,
                                           comprobante_proveedor, archivo_ruta, archivo_mime, archivo_tamano, registrado_por, destino)
  values (p_id, p_orden_servicio, p_fecha_pago, v_moneda, p_monto, v_cancela, v_op, v_comp, p_ruta,
          v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo, v_destino);

  perform public.caja_mover_por_pago('PAGO_ORDEN_SERVICIO', p_id, 'EGRESO', p_caja, p_fecha_pago, p_monto, v_moneda, p_monto_cuenta,
    case when v_detr then 'Detracción de la ' else 'Pago de la ' end || v_os.numero || ' · ' || v_os.proveedor,
    v_os.codigo_interno, v_op);

  perform public.notificar_a_permiso('compras.crear',
    case when v_cancela then 'Servicio pagado: '
         when v_detr then 'Detracción depositada de un servicio: '
         else 'Pago a cuenta de un servicio: ' end || v_os.numero,
    v_os.proveedor || ' · ' || case when v_moneda = 'USD' then 'US$ ' else 'S/ ' end || to_char(p_monto, 'FM999G999G990D00'),
    '/compras/servicios', 'pagos_orden_servicio', p_id, v_yo);
  return p_id;
end;
$$;
comment on function public.registrar_pago_servicio(uuid, uuid, date, numeric, boolean, text, text, text, uuid, numeric, text) is
  'Tesorería paga una orden de servicio aprobada con su voucher, al proveedor o la detracción (en soles), desde la cuenta de la caja que elige: deja su egreso en la caja. No cancela la orden mientras falte la detracción. Exige tesoreria.pagar_servicios.';
revoke all on function public.registrar_pago_servicio(uuid, uuid, date, numeric, boolean, text, text, text, uuid, numeric, text) from public, anon;
grant execute on function public.registrar_pago_servicio(uuid, uuid, date, numeric, boolean, text, text, text, uuid, numeric, text) to authenticated;

-- La versión de 10 parámetros, de una pantalla abierta desde antes: paga al proveedor.
create or replace function public.registrar_pago_servicio(
  p_id uuid, p_orden_servicio uuid, p_fecha_pago date, p_monto numeric, p_cancela boolean,
  p_operacion text, p_comprobante text, p_ruta text, p_caja uuid, p_monto_cuenta numeric
) returns uuid language sql security invoker set search_path to 'public' as $$
  select public.registrar_pago_servicio(p_id, p_orden_servicio, p_fecha_pago, p_monto, p_cancela,
                                        p_operacion, p_comprobante, p_ruta, p_caja, p_monto_cuenta, 'PROVEEDOR');
$$;
comment on function public.registrar_pago_servicio(uuid, uuid, date, numeric, boolean, text, text, text, uuid, numeric) is
  'Versión sin el destino: paga al proveedor (migración 20261026100000).';
revoke all on function public.registrar_pago_servicio(uuid, uuid, date, numeric, boolean, text, text, text, uuid, numeric) from public, anon;
grant execute on function public.registrar_pago_servicio(uuid, uuid, date, numeric, boolean, text, text, text, uuid, numeric) to authenticated;
