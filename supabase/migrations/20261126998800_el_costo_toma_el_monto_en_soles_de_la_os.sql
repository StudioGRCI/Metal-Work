-- El costo del código interno toma el monto en soles que guarda la orden de servicio
--
-- Por qué existe. Desde la 20261126998400 el costeo pasa la OS en dólares a
-- soles con el cambio del día de su factura. Casi siempre da lo mismo que el
-- monto en soles de la OS, pero no siempre, porque el costeo volvía a hacer la
-- cuenta con el cambio que ese día tiene hoy, y la OS guarda la que se hizo
-- en su momento:
--   · La OS que quedó fija (su detracción ya se depositó, o ya se pagó entera)
--     no se mueve si Contabilidad registra o corrige después el cambio de su
--     día. US$ 1 000 con el cambio corregido de 3,40 a 3,45: S/ 3 400 en
--     Compras y en Tesorería, S/ 3 450 en el costo de la unidad.
--   · La OS sin factura sale del último cambio que había al emitirla; si el de
--     su día se registró después, el costeo usaba ese y la OS el de la víspera.
--   · La OS emitida cuando el último cambio tenía más de diez días tiene soles,
--     y el costeo la dejaba «sin cambio» y no dejaba cerrar.
-- Gerencia decidió el 2026-11-26 que el costo tome el monto en soles que guarda
-- la OS: una sola cifra por orden.
--
-- Cómo. `soles_de_la_linea_del_costeo` dice lo que pesa en soles una línea en
-- dólares: la de una orden de servicio, el `monto_pen` de la OS (vacío si la OS
-- todavía no lo tiene: la factura de un día sin cambio registrado); las demás,
-- como hasta ahora, su monto por el cambio del día de su fecha. El costo
-- (`codigos_internos_costo_calculado`) y el cierre (`cerrar_costeo_codigo`)
-- dejan de multiplicar y la llaman. Nada más cambia en ellas.
--
-- Y la pantalla lo dice con lo que dice la OS: `codigo_interno_cambio_de_servicios`
-- suma el monto en soles de cada OS y de dónde sale su cambio, y el día del
-- cambio registrado pasa a ser el que da `cambio_de_los_servicios`, el mismo
-- que leen Compras y Tesorería (antes, el que usaba el costeo). Como cambian
-- sus columnas, se suelta y se vuelve a crear. `cambio_de_los_servicios` mira
-- los permisos de quien consulta (costos.ver entre ellos): Gerencia y
-- Administración, que son quienes ven el costeo, lo tienen; el check 499 falla
-- si un rol llega a ver el costeo sin poder leer el cambio de la OS.
--
-- Idempotente: `create or replace`, y un `drop function if exists` seguido de
-- su `create`. Las tres funciones que ya existían se comparan antes con el
-- texto que el repositorio conoce.

do $$
declare
  v record;
  v_actual text;
begin
  for v in
    select * from (values
    ('codigos_internos_costo_calculado', '08415ddedd88d264726703e47be9bc96', 'a55f8e1dd0f91f18a64a65bde5104c56'),
    ('cerrar_costeo_codigo', '826739fa1d2717f4a9b02b3766233ce5', '2627991f1c51e3b5c169b667bb50f717'),
    ('codigo_interno_cambio_de_servicios', '23984face7ec9bca7aefd9edb90cb3ec', '54344c8e9496b796b5c56bc891f19446')
    ) as t(nombre, antes, despues)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into v_actual
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = v.nombre;
    if v_actual is null then
      raise exception 'No existe la función public.%: esta migración la espera.', v.nombre;
    end if;
    if v_actual not in (v.antes, v.despues) then
      raise exception 'La función public.% tiene en esta base un texto que el repositorio no conoce (md5 %). Revisar antes de reemplazarla.', v.nombre, v_actual;
    end if;
  end loop;
end $$;

-- Lo que pesa en soles una línea en dólares del costeo.
create or replace function public.soles_de_la_linea_del_costeo(p_fuente text, p_referencia uuid, p_fecha date, p_monto numeric)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select case when p_fuente in ('SERVICIOS', 'SERVICIOS_POR_APROBAR')
              then (select s.monto_pen from public.ordenes_servicio s where s.id = p_referencia)
              else round(p_monto * public.cambio_del_dia(p_fecha, 'VENTA'), 2)
         end
$$;

comment on function public.soles_de_la_linea_del_costeo(text, uuid, date, numeric) is
  'Lo que pesa en soles una línea en dólares del costeo de un código interno: la de una orden de servicio (SERVICIOS, SERVICIOS_POR_APROBAR), el monto en soles que guarda la OS, el mismo que leen Compras y Tesorería; las demás, su monto por el cambio de venta del día de su fecha (cambio_del_dia). Vacío si todavía no se puede pasar a soles. No pide permiso: la llaman codigos_internos_costo_calculado y cerrar_costeo_codigo (20261126998800).';

revoke all on function public.soles_de_la_linea_del_costeo(text, uuid, date, numeric) from public, anon, authenticated;

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
           -- Lo que la línea en dólares pesa en soles; vacío si todavía no se puede pasar. La orden de
           -- servicio pesa el monto en soles que guarda; lo demás, el cambio del día de su fecha
           -- (20261126998800).
           case when k.moneda = 'USD' then public.soles_de_la_linea_del_costeo(k.fuente, k.referencia_id, k.fecha, k.monto) end as en_soles
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
           coalesce(sum(case when l.moneda = 'PEN' then l.monto else l.en_soles end)
                      filter (where l.suma and (l.moneda = 'PEN' or l.en_soles is not null)), 0)::numeric as costo_pen,
           coalesce(sum(l.monto) filter (where l.suma and l.moneda = 'USD' and l.en_soles is null), 0)::numeric as usd_sin_cambio,
           count(*) filter (where l.suma and l.moneda = 'USD' and l.en_soles is null)::integer as sin_cambio,
           -- Los dólares que sí pasan a soles, y en cuánto: con eso las partes cuadran con el total.
           coalesce(sum(l.monto) filter (where l.suma and l.moneda = 'USD' and l.en_soles is not null), 0)::numeric as usd_al_cambio,
           coalesce(sum(l.en_soles) filter (where l.suma and l.moneda = 'USD' and l.en_soles is not null), 0)::numeric as usd_en_soles,
           count(*) filter (where l.fuente = 'MATERIALES_SIN_PRECIO')::integer as sin_precio,
           coalesce(sum(l.horas) filter (where l.fuente = 'MANO_OBRA_SIN_COSTO'), 0)::numeric as horas_sin_costo
      from linea l
     group by l.codigo
  ), cotizacion as (
    -- La cotización aprobada (o aprobada antes de una corrección) de las OT del
    -- código: a cada código vigente de la cotización, su parte del total.
    select x.codigo, c.moneda::text as moneda,
           round(c.monto_venta::numeric / greatest(c.cantidad_unidades, 1), 2) as monto,
           ig.incluye_igv, (coalesce(c.revisado_en, c.creado_en) at time zone 'America/Lima')::date as fecha
      from public.cotizaciones_pdf c
      -- El IGV confirmado para esta versión: una corrección sin confirmar no tiene precio.
      left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id and ig.version = c.version
      cross join lateral (
        select distinct e ->> 'codigo_interno' as codigo
          from jsonb_array_elements(public.ordenes_de_cotizacion(c.id)) e
         where e ->> 'codigo_interno' is not null
      ) x
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

CREATE OR REPLACE FUNCTION public.cerrar_costeo_codigo(p_codigo text, p_observacion text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
  v_id uuid;
  k record;
  v_falta text[] := '{}';
  v_fuentes jsonb;
  v_meses text;
begin
  perform public.exigir_permiso('codigos_internos.cerrar');
  if v_codigo is null then
    raise exception 'Indica el código interno.' using errcode = 'check_violation';
  end if;
  if v_codigo = 'PLANTA' then
    raise exception 'PLANTA no es una unidad: su costeo no se cierra.' using errcode = 'check_violation';
  end if;
  -- El sistema no sabe todavía cuándo se entrega una unidad: lo dice Gerencia al cerrar.
  if char_length(btrim(coalesce(p_observacion, ''))) not between 10 and 500 then
    raise exception 'Escribe cómo y cuándo se entregó la unidad (de 10 a 500 caracteres).' using errcode = 'check_violation';
  end if;
  -- Un reintento no cierra dos veces.
  select id into v_id from public.codigo_interno_cierres where codigo = v_codigo and reabierto_en is null;
  if found then
    return v_id;
  end if;

  select * into k from public.codigos_internos_costo_calculado(v_codigo) where codigo = v_codigo;
  if not found then
    raise exception 'El código % no tiene costos que cerrar.', v_codigo using errcode = 'check_violation';
  end if;
  if k.materiales_sin_precio > 0 then
    v_falta := v_falta || (k.materiales_sin_precio || case when k.materiales_sin_precio = 1 then ' salida del almacén sin precio (la valoriza Logística)'
                                                      else ' salidas del almacén sin precio (las valoriza Logística)' end);
  end if;
  if k.horas_sin_costo > 0 then
    v_falta := v_falta || (trim(to_char(k.horas_sin_costo, 'FM999990.##')) || ' h de personal sin costo mensual (lo pone RR. HH.)');
  end if;
  if k.lineas_sin_cambio > 0 then
    v_falta := v_falta || (k.lineas_sin_cambio || case when k.lineas_sin_cambio = 1 then ' línea en dólares sin tipo de cambio' else ' líneas en dólares sin tipo de cambio' end
                           || ' (lo registran Contabilidad o Administración)');
  end if;
  -- Con cotización aprobada, el cierre congela también el margen: sin el IGV
  -- confirmado o sin el cambio del día de la venta en dólares quedaría congelado
  -- sin margen, y nada empujaría después a reabrirlo.
  if k.cotizaciones > 0 and k.venta_sin_igv_confirmado > 0 then
    v_falta := v_falta || (case when k.venta_sin_igv_confirmado = 1 then 'confirmar si la cotización incluye IGV'
                                else 'confirmar si ' || k.venta_sin_igv_confirmado || ' cotizaciones incluyen IGV' end
                           || ' (Gerencia o Administración en el expediente de la OT, o Ventas al corregir la cotización)');
  end if;
  if k.cotizaciones > 0 and k.venta_sin_cambio > 0 then
    v_falta := v_falta || 'el tipo de cambio del día en que se aprobó la cotización en dólares (lo registran Contabilidad o Administración)'::text;
  end if;
  -- Los gastos del mes y el sueldo de la oficina se reparten por las horas de
  -- todo el mes (migración 20261020110000): cerrado a mitad de mes, la unidad se
  -- quedaría con una parte que el resto del mes todavía mueve.
  if exists (select 1 from public.horas_por_codigo_del_mes((now() at time zone 'America/Lima')::date) h where h.codigo = v_codigo) then
    v_falta := v_falta || ('que termine el mes ' || to_char(now() at time zone 'America/Lima', 'MM/YYYY')
                           || ': los gastos del mes y el sueldo de la oficina se reparten por las horas de todo el mes');
  end if;
  -- El sueldo de la oficina sale de los pagos que registra RR. HH. (migración
  -- 20261020120000): con días de la oficina sin pago en un mes en que la unidad
  -- trabajó, quedaría congelada sin esa parte.
  -- En una variable aparte: un select into sin filas dejaría v_falta en null y el cierre pasaría.
  select string_agg(to_char(m.periodo, 'MM/YYYY'), ', ' order by m.periodo) into v_meses
    from public.meses_sin_pagos_oficina(v_codigo) m;
  if v_meses is not null then
    v_falta := v_falta || ('registrar los pagos de la oficina de ' || v_meses
                           || ' (RR. HH.: los pagos, o la fecha de ingreso de quien entró después)');
  end if;
  -- El ajuste de la planilla de taller del mes entra al cerrarla (20261026210000).
  v_meses := null;
  select string_agg(to_char(m.periodo, 'MM/YYYY'), ', ' order by m.periodo) into v_meses
    from public.meses_sin_planilla_taller(v_codigo) m;
  if v_meses is not null then
    v_falta := v_falta || ('cerrar la planilla de taller de ' || v_meses
                           || ' (RR. HH., en Planillas: al cerrarla entra el ajuste de la mano de obra)');
  end if;
  if cardinality(v_falta) > 0 then
    raise exception 'El costeo de % todavía no está completo: falta %.', v_codigo, array_to_string(v_falta, '; ')
      using errcode = 'check_violation';
  end if;
  if k.costo_pen <= 0 then
    raise exception 'El código % todavía no tiene costo cargado: no hay nada que congelar.', v_codigo
      using errcode = 'check_violation';
  end if;

  select coalesce(jsonb_object_agg(f.fuente, f.total), '{}'::jsonb) into v_fuentes
    from (select l.fuente, sum(case when l.moneda = 'PEN' then l.monto
                                    else public.soles_de_la_linea_del_costeo(l.fuente, l.referencia_id, l.fecha, l.monto) end) as total
            from public.codigo_interno_lineas(v_codigo, true) l
           where l.fuente in ('MANO_OBRA', 'RECARGO_EXTRAS', 'MATERIALES', 'SERVICIOS', 'SUBCONTRATOS',
                              'SUBCONTRATOS_POR_PAGAR', 'GASTOS_DEL_MES', 'CAJA', 'GASTOS_OT', 'MERMA')
           group by l.fuente) f;

  insert into public.codigo_interno_cierres (codigo, costo_pen, precio_neto_pen, margen_pen, margen_pct, por_fuente, observacion)
  values (v_codigo, k.costo_pen, k.precio_neto_pen, k.margen_pen, k.margen_pct, v_fuentes, nullif(btrim(coalesce(p_observacion, '')), ''))
  returning id into v_id;
  return v_id;
end;
$function$;


-- Con qué cambio va cada OS en dólares del código, y cuánto pesa en soles.
drop function if exists public.codigo_interno_cambio_de_servicios(text);

create function public.codigo_interno_cambio_de_servicios(p_codigo text)
returns table (orden_servicio_id uuid, dia date, registrado_el date, emitida_el date, monto_pen numeric, origen text)
language plpgsql
stable
security definer
rows 20
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso('codigos_internos.ver');
  return query
  with os as (
    select l.referencia_id as id, l.fecha
      from public.codigo_interno_lineas_servicio(p_codigo) l
     where l.moneda <> 'PEN'
  ), cambio as (
    -- Lo mismo que leen Compras y Tesorería de esa OS.
    select c.orden_servicio_id, c.origen, c.registrado_el
      from public.cambio_de_los_servicios(coalesce((select array_agg(o.id) from os o), '{}'::uuid[])) c
  )
  select o.id, o.fecha, c.registrado_el, public.fecha_de_lima(s.creado_en), s.monto_pen, c.origen
    from os o
    join public.ordenes_servicio s on s.id = o.id
    left join cambio c on c.orden_servicio_id = o.id;
end;
$$;

comment on function public.codigo_interno_cambio_de_servicios(text) is
  'Cuánto pesa en soles en el costeo cada orden de servicio en otra moneda de un código interno (o de todos) y con qué tipo de cambio: `monto_pen` es el monto en soles que guarda la OS, que es lo que suma el costo (vacío: todavía no tiene, y la línea no suma); `dia` el día que le toca (el de su factura o, sin ella, el día en que se emitió); `registrado_el` el día del cambio registrado del que sale ese monto y `origen` de dónde sale, los dos como los da cambio_de_los_servicios (vacíos si quien consulta no puede leerlo); `emitida_el` el día en que se emitió. Las OS en soles no vienen. Pide codigos_internos.ver, como codigo_interno_costeo (20261126998400, 20261126998800).';

revoke all on function public.codigo_interno_cambio_de_servicios(text) from public, anon;
grant execute on function public.codigo_interno_cambio_de_servicios(text) to authenticated;
