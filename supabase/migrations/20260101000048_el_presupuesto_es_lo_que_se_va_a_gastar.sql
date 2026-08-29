-- =============================================================================
-- EL PRESUPUESTO DE LA ORDEN ES LO QUE SE VA A GASTAR
-- -----------------------------------------------------------------------------
-- El circuito de tres manos (migración 041) separó dos números que hasta
-- entonces eran uno solo: Ventas fija el PRECIO —`precio_venta`, que manda y es
-- el que termina en `total`— y Administración carga el COSTO en las partidas,
-- que se suma en `costo_estimado`.
--
-- Esta función se escribió antes de esa separación, cuando el subtotal de una
-- partida era precio de venta. Su comentario todavía lo dice y su parámetro
-- `p_factor_costo` existía para eso: llamarla con 0.75 para descontar un margen
-- del 25 % y sacar el costo esperado. Hoy es al revés —la partida ya es costo—
-- y aplicarle ese factor presupuestaría un 25 % por debajo de lo que el taller
-- va a gastar de verdad. El comentario viejo era una instrucción para meter la
-- pata.
--
-- Y falta una división. La cotización es por el LOTE: si el concepto dice «3
-- furgones», el precio y el costo son de los tres, y por eso el papel divide
-- entre la cantidad para imprimir el unitario. Pero cada orden de trabajo es de
-- UNA unidad —eso lo defiende `fn_ot_una_por_unidad_cotizada`, que permite
-- abrir tantas órdenes como unidades cotizadas—. Al arrastrar el lote entero a
-- cada orden, las tres nacían presupuestadas por el triple, la desviación daba
-- siempre a favor y el costeo real, que es para lo que existe este sistema, no
-- servía para nada.
--
-- El detalle se arrastra por unidad: la cantidad de cada partida se divide, el
-- costo unitario se respeta, y la suma de las tres órdenes vuelve a dar el
-- costo del lote.
-- =============================================================================

create or replace function public.generar_presupuesto_desde_cotizacion(
  p_orden_id uuid,
  p_factor_costo numeric default 1,
  p_reemplazar boolean default false)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cotizacion uuid;
  v_estado     public.estado_cotizacion;
  v_moneda     public.moneda;
  v_tc         numeric;
  v_unidades   numeric;
  v_filas      integer;
begin
  if p_factor_costo <= 0 then
    raise exception 'El factor de costo debe ser mayor que cero' using errcode = 'check_violation';
  end if;

  perform public.costos_validar_orden(p_orden_id);

  select o.cotizacion_id into v_cotizacion
    from public.ordenes_trabajo o
   where o.id = p_orden_id;

  if v_cotizacion is null then
    raise exception 'La orden de trabajo % no nace de una cotización: su presupuesto se carga a mano', p_orden_id
      using errcode = 'no_data_found';
  end if;

  select c.estado, c.moneda, c.tipo_cambio, greatest(coalesce(c.concepto_cantidad, 1), 1)
    into v_estado, v_moneda, v_tc, v_unidades
    from public.cotizaciones c
   where c.id = v_cotizacion;

  -- Solo se arrastra lo que el cliente aceptó: una cotización en borrador o
  -- rechazada no es un compromiso y presupuestar sobre ella es inventar.
  if v_estado <> 'APROBADA' then
    raise exception 'La cotización de la orden % está en estado % y solo se puede presupuestar desde una cotización APROBADA', p_orden_id, v_estado
      using errcode = 'check_violation';
  end if;

  if p_reemplazar then
    delete from public.ot_presupuesto
     where orden_id = p_orden_id
       and origen = 'COTIZACION';
  end if;

  insert into public.ot_presupuesto (
    orden_id, tipo_costo, descripcion, detalle, unidad_medida, cantidad,
    monto_presupuestado, origen, cotizacion_partida_id
  )
  select
    p_orden_id,
    -- El enum de la cotización no conoce INDIRECTO; el resto mapea uno a uno.
    case cp.tipo_costo
      when 'MATERIAL'  then 'MATERIAL'::public.tipo_costo
      when 'MANO_OBRA' then 'MANO_OBRA'::public.tipo_costo
      when 'SERVICIO'  then 'SERVICIO'::public.tipo_costo
      else 'OTRO'::public.tipo_costo
    end,
    cp.descripcion,
    cp.detalle,
    cp.unidad_medida,
    -- Una orden fabrica una unidad: le toca su parte del material y de las horas.
    round(cp.cantidad::numeric / v_unidades, 4),
    -- El subtotal de la partida ES el costo esperado desde que Administración
    -- costea aparte del precio (migración 041), así que el factor por omisión
    -- es 1 y no hay margen que descontar. `p_factor_costo` queda solo para
    -- ajustar a mano un lote entero; con 0.75 se presupuesta un 25 % por
    -- debajo, que es un error caro si se usa creyendo que la partida es venta.
    round(cp.subtotal::numeric * v_tc / v_unidades * p_factor_costo, 2),
    'COTIZACION',
    cp.id
  from public.cotizacion_partidas cp
  where cp.cotizacion_id = v_cotizacion
    -- Idempotente: repetir la llamada no duplica lo ya arrastrado.
    and not exists (
      select 1 from public.ot_presupuesto op
       where op.orden_id = p_orden_id
         and op.cotizacion_partida_id = cp.id
    );

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

comment on function public.generar_presupuesto_desde_cotizacion is
  'Baja el costo de las partidas de la cotización al presupuesto de la orden, por unidad: la cotización es del lote y cada orden fabrica una. Lo que se arrastra es costo, no precio de venta.';

grant execute on function public.generar_presupuesto_desde_cotizacion(uuid, numeric, boolean)
  to authenticated;

-- ------------------------------------------------ el encabezado, con lo mismo
-- La tarjeta «Presupuesto» de la orden lee `ordenes_trabajo.monto_presupuestado`
-- directamente, no la suma del detalle, así que quedaba mostrando el precio de
-- venta al lado de una pestaña de costos que mostraba el costo. Dos números
-- distintos con el mismo rótulo en la misma pantalla.
--
-- Se corrigen las órdenes ya abiertas desde una cotización que tenga costeo.
-- Las que no lo tengan se quedan como están: no hay con qué reemplazarlas y
-- borrar el número sin tener otro solo pierde información.
update public.ordenes_trabajo o
   set monto_presupuestado = round(
         c.costo_estimado::numeric / greatest(coalesce(c.concepto_cantidad, 1), 1), 2)
  from public.cotizaciones c
 where c.id = o.cotizacion_id
   and c.costo_estimado > 0
   and o.monto_presupuestado is distinct from round(
         c.costo_estimado::numeric / greatest(coalesce(c.concepto_cantidad, 1), 1), 2);
