-- =============================================================================
-- EL SERVICIO CANCELADO NO PIERDE LO QUE CONTÓ
-- -----------------------------------------------------------------------------
-- Hallazgo de la revisión de Adquisiciones (#130), que su PR dejó anotado:
--
-- La orden de servicio se lee pagada cuando tiene un pago vigente que la
-- cancela. Si Tesorería anula un pago a cuenta que se registró antes del que
-- la canceló, la orden seguía leyéndose pagada aunque ya se debiera esa
-- parte. Desde aquí ese pago a cuenta no se anula mientras esté vigente el
-- que la canceló contando con él: primero se anula ese y se vuelve a
-- registrar con lo que de verdad quedó pagado. La OC con boleta ya lo
-- resolvió así en la migración 20261020210000.
--
-- Idempotente. Sin `drop` de funciones ni de políticas.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.anular_pago_servicio(p_id uuid, p_motivo text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_pago public.pagos_orden_servicio%rowtype; v_cancela public.pagos_orden_servicio%rowtype;
begin
  perform public.exigir_permiso('tesoreria.pagar_servicios');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_pago from public.pagos_orden_servicio where id = p_id for update;
  if not found then raise exception 'Ese pago no existe.' using errcode = 'check_violation'; end if;
  if v_pago.anulado_en is not null then return p_id; end if;
  -- El pago que canceló la orden se registró contando este (después de cancelada
  -- ya no entra ningún pago): sin este, la orden seguiría leyéndose pagada
  -- aunque se deba. Primero se anula ese.
  select * into v_cancela from public.pagos_orden_servicio x
   where x.orden_servicio_id = v_pago.orden_servicio_id and x.anulado_en is null and x.cancela and x.id <> p_id
     and not v_pago.cancela
   order by x.creado_en limit 1;
  if found then
    raise exception 'El pago de % % del % canceló la orden contando este: anula primero ese y vuelve a registrarlo con lo que de verdad quedó pagado.',
      case when v_cancela.moneda = 'USD' then 'US$' else 'S/' end, to_char(v_cancela.monto, 'FM999G999G990D00'),
      to_char(v_cancela.fecha_pago, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;
  perform public.caja_anular_por_pago('PAGO_ORDEN_SERVICIO', p_id, p_motivo, 'pago');
  update public.pagos_orden_servicio
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$function$;

