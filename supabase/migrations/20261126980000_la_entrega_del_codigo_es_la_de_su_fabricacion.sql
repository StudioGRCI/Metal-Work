-- =============================================================================
-- LA ENTREGA DEL CÓDIGO ES LA DE SU FABRICACIÓN, NO LA DE SU GARANTÍA
-- -----------------------------------------------------------------------------
-- «Se entregó el…», en el cierre del costeo de Códigos internos y en Por
-- decidir, sale de `codigos_internos_costo` (columna `entregada_el`), que
-- tomaba el acta de entrega más reciente de CUALQUIER OT de la unidad del
-- código. Una unidad que vuelve por garantía (o por mantenimiento) tiene otra OT
-- sobre la misma unidad, con su propia acta: la fecha de entrega del código
-- pasaba a ser la de ese retrabajo, meses después de entregada la carrocería.
-- Lo encontró la revisión del 26/11.
--
-- Desde la 20261120500000 la garantía y el mantenimiento se siguen por el número
-- de su OT, no por el código interno de la unidad (así trabaja la empresa: el
-- código nace con la fabricación). Aquí la entrega del código mira solo las OT
-- que no son de garantía ni de mantenimiento. Lo demás del costo no cambia: el
-- presupuesto fijado sigue sumando todas las OT de la unidad, como dice su
-- comentario.
--
-- En producción, al 26/11, hay 21 OT, todas de fabricación, y ninguna acta: no
-- cambia ninguna fecha que alguien haya visto. El check 491 lo prueba con una
-- unidad entregada y su garantía entregada después.
--
-- Guarda: si producción tiene otro texto en la función (un arreglo pegado a mano
-- en el editor), se detiene en vez de pisarlo. Acepta el de antes y el de esta
-- migración, para poder repetirla.
-- =============================================================================

do $$
declare
  v_actual text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_actual
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'codigos_internos_costo_calculado';
  if v_actual is null then
    raise exception 'No existe la función public.codigos_internos_costo_calculado: esta migración la espera.';
  end if;
  if v_actual not in ('e2fe09bb42d5872932489360fe533d20', '95d28c3af9ac2f10e6a3f161cd68596b') then
    raise exception 'La función public.codigos_internos_costo_calculado tiene en esta base un texto que el repositorio no conoce (md5 %). Revisar antes de reemplazarla.', v_actual;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.codigos_internos_costo_calculado(p_codigo text)
 RETURNS TABLE(codigo text, mano_obra numeric, recargo_extras numeric, gastos_mes_pen numeric, gastos_mes_usd numeric, caja_pen numeric, caja_usd numeric, egresos_caja integer, gastos_ot_pen numeric, gastos_ot_usd numeric, merma_pen numeric, merma_usd numeric, costo_pen numeric, usd_sin_cambio numeric, lineas_sin_cambio integer, usd_al_cambio numeric, usd_en_soles numeric, materiales_sin_precio integer, horas_sin_costo numeric, cotizaciones integer, moneda_venta text, precio_venta_pen numeric, precio_venta_usd numeric, venta_sin_igv_confirmado integer, venta_sin_cambio integer, precio_neto_pen numeric, margen_pen numeric, margen_pct numeric, presupuesto_pen numeric, presupuesto_fijado boolean, consumido_pct numeric, semaforo text, entregada_el date, cierre_id uuid, cerrado_en timestamp with time zone, cerrado_por text, costo_cerrado_pen numeric, margen_cerrado_pen numeric, margen_cerrado_pct numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  -- La tasa del IGV en el Perú desde 2011, y la utilidad estándar de la hoja RESUMEN.
  c_igv constant numeric := 0.18;
  c_utilidad constant numeric := 0.15;
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  return query
  with linea as (
    select k.*,
           k.fuente in ('MANO_OBRA', 'RECARGO_EXTRAS', 'MATERIALES', 'SERVICIOS', 'SUBCONTRATOS',
                        'SUBCONTRATOS_POR_PAGAR', 'GASTOS_DEL_MES', 'CAJA', 'GASTOS_OT', 'MERMA') as suma,
           case when k.moneda = 'USD' then public.cambio_del_dia(k.fecha, 'VENTA') end as cambio
      from public.codigo_interno_lineas(v_codigo, true) k
     where k.codigo is not null
  ), costo as (
    select l.codigo,
           coalesce(sum(l.monto) filter (where l.fuente = 'MANO_OBRA'), 0)::numeric as mano_obra,
           coalesce(sum(l.monto) filter (where l.fuente = 'RECARGO_EXTRAS'), 0)::numeric as recargo,
           coalesce(sum(l.monto) filter (where l.fuente = 'GASTOS_DEL_MES' and l.moneda = 'PEN'), 0)::numeric as gastos_pen,
           coalesce(sum(l.monto) filter (where l.fuente = 'GASTOS_DEL_MES' and l.moneda = 'USD'), 0)::numeric as gastos_usd,
           coalesce(sum(l.monto) filter (where l.fuente = 'CAJA' and l.moneda = 'PEN'), 0)::numeric as caja_pen,
           coalesce(sum(l.monto) filter (where l.fuente = 'CAJA' and l.moneda = 'USD'), 0)::numeric as caja_usd,
           count(*) filter (where l.fuente = 'CAJA')::integer as egresos_caja,
           coalesce(sum(l.monto) filter (where l.fuente = 'GASTOS_OT' and l.moneda = 'PEN'), 0)::numeric as gastos_ot_pen,
           coalesce(sum(l.monto) filter (where l.fuente = 'GASTOS_OT' and l.moneda = 'USD'), 0)::numeric as gastos_ot_usd,
           coalesce(sum(l.monto) filter (where l.fuente = 'MERMA' and l.moneda = 'PEN'), 0)::numeric as merma_pen,
           coalesce(sum(l.monto) filter (where l.fuente = 'MERMA' and l.moneda = 'USD'), 0)::numeric as merma_usd,
           coalesce(sum(case when l.moneda = 'PEN' then l.monto else round(l.monto * l.cambio, 2) end)
                      filter (where l.suma and (l.moneda = 'PEN' or l.cambio is not null)), 0)::numeric as costo_pen,
           coalesce(sum(l.monto) filter (where l.suma and l.moneda = 'USD' and l.cambio is null), 0)::numeric as usd_sin_cambio,
           count(*) filter (where l.suma and l.moneda = 'USD' and l.cambio is null)::integer as sin_cambio,
           -- Los dólares que sí pasan a soles, y en cuánto: con eso las partes cuadran con el total.
           coalesce(sum(l.monto) filter (where l.suma and l.moneda = 'USD' and l.cambio is not null), 0)::numeric as usd_al_cambio,
           coalesce(sum(round(l.monto * l.cambio, 2)) filter (where l.suma and l.moneda = 'USD' and l.cambio is not null), 0)::numeric as usd_en_soles,
           count(*) filter (where l.fuente = 'MATERIALES_SIN_PRECIO')::integer as sin_precio,
           coalesce(sum(l.horas) filter (where l.fuente = 'MANO_OBRA_SIN_COSTO'), 0)::numeric as horas_sin_costo
      from linea l
     group by l.codigo
  ), cotizacion as (
    -- La cotización aprobada (o aprobada antes de una corrección) de la OT del código.
    select public.codigo_interno_de_cotizacion(c.id) as codigo, c.moneda::text as moneda, c.monto_venta::numeric as monto,
           ig.incluye_igv, (coalesce(c.revisado_en, c.creado_en) at time zone 'America/Lima')::date as fecha
      from public.cotizaciones_pdf c
      -- El IGV confirmado para esta versión: una corrección sin confirmar no tiene precio.
      left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id and ig.version = c.version
     where c.estado::text <> 'ANULADA' and c.monto_venta is not null and public.cotizacion_fue_aprobada(c.id)
  ), venta_linea as (
    select v.*,
           case when v.incluye_igv then round(v.monto / (1 + c_igv), 2) when v.incluye_igv = false then v.monto end as neto,
           case when v.moneda = 'USD' then public.cambio_del_dia(v.fecha, 'COMPRA') end as cambio
      from cotizacion v
     where v.codigo is not null and (v_codigo is null or v.codigo = v_codigo)
  ), venta as (
    select v.codigo, count(*)::integer as cotizaciones,
           string_agg(distinct v.moneda, '+' order by v.moneda) as moneda,
           coalesce(sum(v.monto) filter (where v.moneda = 'PEN'), 0)::numeric as pen,
           coalesce(sum(v.monto) filter (where v.moneda = 'USD'), 0)::numeric as usd,
           count(*) filter (where v.incluye_igv is null)::integer as sin_igv,
           count(*) filter (where v.moneda = 'USD' and v.cambio is null)::integer as sin_cambio,
           -- Si falta saber el IGV o el cambio de alguna, el precio no se adivina.
           case when bool_and(v.neto is not null and (v.moneda = 'PEN' or v.cambio is not null))
                then sum(case when v.moneda = 'PEN' then v.neto else round(v.neto * v.cambio, 2) end) end as neto_pen
      from venta_linea v
     group by v.codigo
  ), fijado as (
    -- El presupuesto que Gerencia o Administración fijó a mano en la OT de la
    -- unidad manda sobre el de la hoja; con varias OT (una garantía), la suma.
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo, sum(p.monto_pen)::numeric as monto
      from public.ot_presupuestos p
      join public.ordenes_trabajo o on o.id = p.orden_id
      join public.unidades u on u.id = o.unidad_id
     where p.monto_pen is not null and o.estado::text <> 'ANULADA'
       and public.normalizar_codigo_interno(u.codigo_interno) is not null
       and (v_codigo is null or public.normalizar_codigo_interno(u.codigo_interno) = v_codigo)
     group by 1
  ), entrega as (
    -- El acta de entrega más reciente de las OT del código (la registra el taller).
    -- La garantía y el mantenimiento de la unidad van por el número de su propia
    -- OT (20261120500000): su acta es la de ese trabajo, no la de la unidad.
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo, max(e.fecha_entrega) as fecha
      from public.ot_entregas e
      join public.ordenes_trabajo o on o.id = e.orden_id
      join public.unidades u on u.id = o.unidad_id
     where o.estado::text <> 'ANULADA' and public.normalizar_codigo_interno(u.codigo_interno) is not null
       and o.tipo_trabajo not in ('GARANTIA', 'MANTENIMIENTO')
       and (v_codigo is null or public.normalizar_codigo_interno(u.codigo_interno) = v_codigo)
     group by 1
  ), cierre as (
    select z.* from public.codigo_interno_cierres z
     where z.reabierto_en is null and (v_codigo is null or z.codigo = v_codigo)
  ), codigos as (
    select k.codigo from costo k union select v.codigo from venta v union select z.codigo from cierre z
  )
  select c.codigo,
         coalesce(k.mano_obra, 0), coalesce(k.recargo, 0),
         coalesce(k.gastos_pen, 0), coalesce(k.gastos_usd, 0),
         coalesce(k.caja_pen, 0), coalesce(k.caja_usd, 0), coalesce(k.egresos_caja, 0),
         coalesce(k.gastos_ot_pen, 0), coalesce(k.gastos_ot_usd, 0), coalesce(k.merma_pen, 0), coalesce(k.merma_usd, 0),
         coalesce(k.costo_pen, 0), coalesce(k.usd_sin_cambio, 0), coalesce(k.sin_cambio, 0),
         coalesce(k.usd_al_cambio, 0), coalesce(k.usd_en_soles, 0),
         coalesce(k.sin_precio, 0), coalesce(k.horas_sin_costo, 0),
         coalesce(v.cotizaciones, 0), v.moneda, v.pen, v.usd,
         coalesce(v.sin_igv, 0), coalesce(v.sin_cambio, 0), v.neto_pen,
         -- Sin costo todavía el margen saldría 100 %: no hay margen hasta que algo cueste.
         case when v.neto_pen is not null and k.costo_pen > 0 then v.neto_pen - k.costo_pen end,
         case when v.neto_pen > 0 and k.costo_pen > 0 then round((v.neto_pen - k.costo_pen) / v.neto_pen * 100, 1) end,
         p.presupuesto, f.monto is not null,
         case when p.presupuesto > 0 then round(coalesce(k.costo_pen, 0) / p.presupuesto * 100, 1) end,
         -- Pasado el presupuesto, excedido; del 90 % en adelante, ajustado.
         case when p.presupuesto is null then null
              when coalesce(k.costo_pen, 0) > p.presupuesto then 'EXCEDIDO'
              when coalesce(k.costo_pen, 0) >= p.presupuesto * 0.9 then 'AJUSTADO'
              else 'EN_RANGO' end,
         en.fecha,
         z.id, z.cerrado_en, public.puesto_de(z.cerrado_por), z.costo_pen, z.margen_pen, z.margen_pct
    from codigos c
    left join costo k on k.codigo = c.codigo
    left join venta v on v.codigo = c.codigo
    left join cierre z on z.codigo = c.codigo
    left join fijado f on f.codigo = c.codigo
    left join entrega en on en.codigo = c.codigo
    cross join lateral (select coalesce(f.monto, round(v.neto_pen / (1 + c_utilidad), 2)) as presupuesto) p
   where c.codigo is not null
   order by 1;
end;
$function$;
